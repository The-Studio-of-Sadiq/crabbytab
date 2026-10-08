import { Team, TeamStandingRow, DebateSide, TournamentFormat, BPPullupDistribution, BPPositionCost, BPAssignmentMethod } from "@/types";
import { allocateSidesForDebate, SideAllocationOptions } from "./sideAllocator";
import { shuffle } from "./pairing";

export interface MatchupHistory {
  // Key: teamId, Value: set of teamIds they have debated before
  opponents: Map<string, Set<string>>;
  sides: Map<string, DebateSide[]>;
}

export interface PairedDebateDraft {
  bracket: number;
  teams: Team[];
  teamsWithSides: Record<DebateSide, Team>;
}

export interface BPDrawOptions {
  repeatMatchupPenalty?: number;
  institutionClashPenalty?: number;
  avoidSameInstitution?: boolean;
  avoidTeamHistory?: boolean;
  teamInstitutionPenalty?: number;
  teamHistoryPenalty?: number;
  pullupPenalty?: number;
  previouslySawPullupPenalty?: number;
  bpPullupDistribution?: BPPullupDistribution;
  bpPositionCost?: BPPositionCost;
  renyiOrder?: number;
  bpPositionCostExponent?: number;
  bpAssignmentMethod?: BPAssignmentMethod;
  sideBalancePenalty?: number;
  pairingDeviationPenalty?: number;
  maxTimesPerSide?: number;
  maxAllowedSideImbalance?: number;
}

/**
 * Calculates clash penalty between a set of candidate teams.
 */
function calculateDebateClashPenalty(
  teams: Team[],
  history: MatchupHistory,
  repeatMatchupPenalty: number,
  institutionClashPenalty: number,
  pulledUpTeamIds: Set<string>,
  pullupPenalty: number,
  previouslySawPullupPenalty: number,
  standingMap: Map<string, TeamStandingRow>
): number {
  let penalty = 0;
  const n = teams.length;

  for (let i = 0; i < n; i++) {
    const t1 = teams[i];
    if (pullupPenalty > 0 && pulledUpTeamIds.has(t1.id)) {
      penalty += pullupPenalty;
    }
    if (previouslySawPullupPenalty > 0) {
      const priorPullups = standingMap.get(t1.id)?.metrics?.pullups ?? 0;
      if (priorPullups > 0) {
        penalty += previouslySawPullupPenalty * priorPullups;
      }
    }

    for (let j = i + 1; j < n; j++) {
      const t2 = teams[j];

      // Repeat matchup penalty
      if (repeatMatchupPenalty > 0) {
        const pastOpponents = history.opponents.get(t1.id);
        if (pastOpponents && pastOpponents.has(t2.id)) {
          penalty += repeatMatchupPenalty;
        }
      }

      // Institutional clash penalty; names cover legacy records without IDs.
      if (institutionClashPenalty > 0) {
        const sameInstitutionById =
          Boolean(t1.institutionId && t2.institutionId && t1.institutionId === t2.institutionId);
        const sameInstitutionByName =
          Boolean(
            t1.institutionName?.trim() &&
            t2.institutionName?.trim() &&
            t1.institutionName.trim().toLowerCase() === t2.institutionName.trim().toLowerCase()
          );
        if (sameInstitutionById || sameInstitutionByName) {
          penalty += institutionClashPenalty;
        }
      }
    }
  }
  return penalty;
}

/**
 * Generates Swiss / Power-Paired debates based on standings, historical matchups,
 * and tournament preferences (pullup distribution, position cost functions, Hungarian assignment).
 */
export function generatePowerPairedDraw(
  teams: Team[],
  standings: TeamStandingRow[],
  history: MatchupHistory,
  format: TournamentFormat,
  sideRule: "balanced" | "random" = "balanced",
  options: BPDrawOptions = {
    repeatMatchupPenalty: 1000,
    institutionClashPenalty: 200,
  }
): PairedDebateDraft[] {
  const teamsPerDebate = format === "bp" ? 4 : 2;
  const totalTeams = teams.length;

  if (totalTeams % teamsPerDebate !== 0) {
    throw new Error(
      `Number of teams (${totalTeams}) must be a multiple of ${teamsPerDebate} for ${format.toUpperCase()} format.`
    );
  }

  const repeatMatchupPenalty =
    options.avoidTeamHistory === false
      ? 0
      : (options.teamHistoryPenalty ?? options.repeatMatchupPenalty ?? 1000);

  const institutionClashPenalty =
    options.avoidSameInstitution === false
      ? 0
      : (options.teamInstitutionPenalty ?? options.institutionClashPenalty ?? 200);

  const pullupPenalty = options.pullupPenalty ?? 0;
  const previouslySawPullupPenalty = options.previouslySawPullupPenalty ?? 0;
  const pullupDistribution = options.bpPullupDistribution ?? "anywhere";

  // Create a fast lookup map for team objects
  const teamMap = new Map<string, Team>();
  teams.forEach((t) => teamMap.set(t.id, t));

  // Sort teams according to standings (points desc, total speaker score desc)
  const sortedTeamIds: string[] = standings.length > 0
    ? standings.map((s) => s.teamId).filter((id) => teamMap.has(id))
    : shuffle(teams).map((t) => t.id);

  // Add any unranked teams to the bottom
  teams.forEach((t) => {
    if (!sortedTeamIds.includes(t.id)) sortedTeamIds.push(t.id);
  });

  // Group teams into point brackets
  const standingMap = new Map<string, TeamStandingRow>();
  standings.forEach((s) => standingMap.set(s.teamId, s));

  // Break teams into brackets
  const bracketMap = new Map<number, Team[]>();
  for (const id of sortedTeamIds) {
    const team = teamMap.get(id)!;
    const pts = standingMap.get(id)?.points ?? 0;
    if (!bracketMap.has(pts)) bracketMap.set(pts, []);
    bracketMap.get(pts)!.push(team);
  }

  // Sort bracket keys in descending order
  const bracketKeys = Array.from(bracketMap.keys()).sort((a, b) => b - a);

  // Flatten brackets handling pull-downs / pull-ups
  const completeBrackets: { bracketPts: number; teams: Team[] }[] = [];
  const pulledUpTeamIds = new Set<string>();
  let pullDownBuffer: Team[] = [];

  for (const pts of bracketKeys) {
    if (pullDownBuffer.length > 0) {
      pullDownBuffer.forEach((t) => pulledUpTeamIds.add(t.id));
    }
    let currentTeams = [...pullDownBuffer, ...(bracketMap.get(pts) || [])];
    pullDownBuffer = [];

    const remainder = currentTeams.length % teamsPerDebate;
    if (remainder !== 0) {
      // Pull down the lowest-ranked teams in this bracket to the next bracket
      const numToPullDown = remainder;
      pullDownBuffer = currentTeams.slice(currentTeams.length - numToPullDown);
      currentTeams = currentTeams.slice(0, currentTeams.length - numToPullDown);
    }

    if (currentTeams.length > 0) {
      completeBrackets.push({ bracketPts: pts, teams: currentTeams });
    }
  }

  // If leftover in buffer, push into last bracket
  if (pullDownBuffer.length > 0) {
    pullDownBuffer.forEach((t) => pulledUpTeamIds.add(t.id));
    if (completeBrackets.length > 0) {
      completeBrackets[completeBrackets.length - 1].teams.push(...pullDownBuffer);
    } else {
      completeBrackets.push({ bracketPts: 0, teams: pullDownBuffer });
    }
  }

  // Side allocation options passed to Hungarian side assigner
  const sideAllocationOptions: SideAllocationOptions = {
    bpPositionCost: options.bpPositionCost,
    renyiOrder: options.renyiOrder,
    bpPositionCostExponent: options.bpPositionCostExponent,
    bpAssignmentMethod: options.bpAssignmentMethod,
    sideBalancePenalty: options.sideBalancePenalty,
    maxTimesPerSide: options.maxTimesPerSide,
    maxAllowedSideImbalance: options.maxAllowedSideImbalance,
  };

  // Pair each bracket
  const pairedDebates: PairedDebateDraft[] = [];

  for (const { bracketPts, teams: bracketTeams } of completeBrackets) {
    const debatesInBracket = Math.floor(bracketTeams.length / teamsPerDebate);

    // Apply BP pullup distribution preference: "top", "bottom", or "anywhere" (WUDC)
    let orderedBracketTeams = [...bracketTeams];
    if (pullupDistribution === "top") {
      const pullups = orderedBracketTeams.filter((t) => pulledUpTeamIds.has(t.id));
      const regulars = orderedBracketTeams.filter((t) => !pulledUpTeamIds.has(t.id));
      orderedBracketTeams = [...pullups, ...regulars];
    } else if (pullupDistribution === "bottom") {
      const pullups = orderedBracketTeams.filter((t) => pulledUpTeamIds.has(t.id));
      const regulars = orderedBracketTeams.filter((t) => !pulledUpTeamIds.has(t.id));
      orderedBracketTeams = [...regulars, ...pullups];
    }

    // Greedy search / simulated annealing to minimize clash penalties within the bracket
    let bestBracketGrouping: Team[][] = [];
    let bestScore = Infinity;

    // Run multiple randomized passes to find minimal clash grouping
    const passes = 30;
    for (let pass = 0; pass < passes; pass++) {
      let candidate: Team[];
      if (pass === 0) {
        candidate = [...orderedBracketTeams];
      } else if (pullupDistribution === "top" || pullupDistribution === "bottom") {
        const pullups = shuffle(orderedBracketTeams.filter((team) => pulledUpTeamIds.has(team.id)));
        const regulars = shuffle(orderedBracketTeams.filter((team) => !pulledUpTeamIds.has(team.id)));
        candidate = pullupDistribution === "top"
          ? [...pullups, ...regulars]
          : [...regulars, ...pullups];
      } else {
        candidate = shuffle(orderedBracketTeams);
      }

      const candidateGroups: Team[][] = [];
      let currentPenalty = 0;

      for (let d = 0; d < debatesInBracket; d++) {
        const group = candidate.slice(d * teamsPerDebate, (d + 1) * teamsPerDebate);
        candidateGroups.push(group);
        currentPenalty += calculateDebateClashPenalty(
          group,
          history,
          repeatMatchupPenalty,
          institutionClashPenalty,
          pulledUpTeamIds,
          pullupPenalty,
          previouslySawPullupPenalty,
          standingMap
        );
      }

      if (currentPenalty < bestScore) {
        bestScore = currentPenalty;
        bestBracketGrouping = candidateGroups;
        if (bestScore === 0) break; // Perfect matching found
      }
    }

    // Allocate sides for each debate
    for (const group of bestBracketGrouping) {
      const teamsWithSides = allocateSidesForDebate(
        group,
        history.sides,
        format,
        sideRule,
        sideAllocationOptions
      );
      pairedDebates.push({
        bracket: bracketPts,
        teams: group,
        teamsWithSides,
      });
    }
  }

  return pairedDebates;
}

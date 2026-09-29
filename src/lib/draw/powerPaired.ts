import { Team, TeamStandingRow, DebateSide, TournamentFormat } from "@/types";
import { allocateSidesForDebate } from "./sideAllocator";

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

/**
 * Calculates clash penalty between a set of candidate teams.
 */
function calculateDebateClashPenalty(
  teams: Team[],
  history: MatchupHistory,
  repeatMatchupPenalty: number,
  institutionClashPenalty: number
): number {
  let penalty = 0;
  const n = teams.length;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const t1 = teams[i];
      const t2 = teams[j];

      // Repeat matchup penalty (heavy)
      const pastOpponents = history.opponents.get(t1.id);
      if (pastOpponents && pastOpponents.has(t2.id)) {
        penalty += repeatMatchupPenalty;
      }

      // Institutional clash penalty
      if (t1.institutionId && t2.institutionId && t1.institutionId === t2.institutionId) {
        penalty += institutionClashPenalty;
      }
    }
  }
  return penalty;
}

/**
 * Generates Swiss / Power-Paired debates based on standings and historical matchups.
 */
export function generatePowerPairedDraw(
  teams: Team[],
  standings: TeamStandingRow[],
  history: MatchupHistory,
  format: TournamentFormat,
  sideRule: "balanced" | "random" = "balanced",
  penalties: { repeatMatchupPenalty: number; institutionClashPenalty: number } = {
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

  // Create a fast lookup map for team objects
  const teamMap = new Map<string, Team>();
  teams.forEach((t) => teamMap.set(t.id, t));

  // Sort teams according to standings (points desc, total speaker score desc)
  const sortedTeamIds: string[] = standings.length > 0
    ? standings.map((s) => s.teamId).filter((id) => teamMap.has(id))
    : [...teams].sort(() => Math.random() - 0.5).map((t) => t.id);

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

  // Flatten brackets handling pull-downs
  const completeBrackets: { bracketPts: number; teams: Team[] }[] = [];
  let pullDownBuffer: Team[] = [];

  for (const pts of bracketKeys) {
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
    if (completeBrackets.length > 0) {
      completeBrackets[completeBrackets.length - 1].teams.push(...pullDownBuffer);
    } else {
      completeBrackets.push({ bracketPts: 0, teams: pullDownBuffer });
    }
  }

  // Pair each bracket
  const pairedDebates: PairedDebateDraft[] = [];

  for (const { bracketPts, teams: bracketTeams } of completeBrackets) {
    const debatesInBracket = Math.floor(bracketTeams.length / teamsPerDebate);

    // Greedy search / simulated annealing to minimize clash penalties within the bracket
    let bestBracketGrouping: Team[][] = [];
    let bestScore = Infinity;

    // Run multiple randomized passes to find minimal clash grouping
    const passes = 25;
    for (let pass = 0; pass < passes; pass++) {
      const shuffled = pass === 0 ? [...bracketTeams] : [...bracketTeams].sort(() => Math.random() - 0.5);
      const candidateGroups: Team[][] = [];
      let currentPenalty = 0;

      for (let d = 0; d < debatesInBracket; d++) {
        const group = shuffled.slice(d * teamsPerDebate, (d + 1) * teamsPerDebate);
        candidateGroups.push(group);
        currentPenalty += calculateDebateClashPenalty(group, history, penalties.repeatMatchupPenalty, penalties.institutionClashPenalty);
      }

      if (currentPenalty < bestScore) {
        bestScore = currentPenalty;
        bestBracketGrouping = candidateGroups;
        if (bestScore === 0) break; // Perfect matching found
      }
    }

    // Allocate sides for each debate
    for (const group of bestBracketGrouping) {
      const teamsWithSides = allocateSidesForDebate(group, history.sides, format, sideRule);
      pairedDebates.push({
        bracket: bracketPts,
        teams: group,
        teamsWithSides,
      });
    }
  }

  return pairedDebates;
}

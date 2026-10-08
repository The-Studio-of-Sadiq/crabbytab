import {
  Tournament,
  Round,
  Team,
  Venue,
  Debate,
  DebateSide,
  DebateResultStatus,
  TeamStandingRow,
  BPSide,
  TwoTeamSide,
} from "@/types";
import { BPDrawOptions, generatePowerPairedDraw, MatchupHistory } from "./powerPaired";
import { allocateSidesForDebate } from "./sideAllocator";
import { generateRoundRobinDraw } from "./roundRobin";
import { generateTwoTeamDraw } from "./twoTeamDraw";
import { generateEliminationDraw } from "./elimination";
import { shuffle } from "./pairing";
import { SideAllocationOptions } from "./sideAllocator";

export interface GenerateDrawParams {
  tournament: Tournament;
  round: Round;
  teams: Team[];
  venues: Venue[];
  pastDebates: Debate[];
  standings: TeamStandingRow[];
}

export function getEligibleTeamsForRound(teams: Team[], round: Round | null): Team[] {
  if (!round || round.stage !== "elimination") return teams;

  const breakHasBeenGenerated = teams.some((team) => team.breakCategoryIds !== undefined);
  if (!breakHasBeenGenerated) return teams;

  if (round.breakCategoryIds) {
    const categoryIds = new Set(round.breakCategoryIds);
    return teams.filter(
      (team) => team.breakStatus === "breaking" && team.breakCategoryIds?.some((id) => categoryIds.has(id))
    );
  }

  return teams.filter((team) => team.breakStatus === "breaking");
}

export function getRequiredVenueCount(
  tournament: Tournament,
  round: Round,
  teams: Team[]
): number {
  const teamsPerDebate = tournament.format === "bp" ? 4 : 2;
  const eligibleTeams = getEligibleTeamsForRound(teams, round).filter((team) => team.checkedIn !== false);
  const categories = round.stage === "elimination" && (round.breakCategoryIds?.length ?? 0) > 1
    ? round.breakCategoryIds!.map((categoryId) =>
        eligibleTeams.filter((team) => team.breakCategoryIds?.includes(categoryId))
      )
    : [eligibleTeams];
  const usesByes =
    round.stage === "preliminary" &&
    round.drawType !== "manual" &&
    Boolean(tournament.preferences?.byeTeamSelectionMethod) &&
    tournament.preferences?.byeTeamSelectionMethod !== "none";

  return categories.reduce((required, categoryTeams) => {
    const byeCount = usesByes ? categoryTeams.length % teamsPerDebate : 0;
    return required + Math.ceil((categoryTeams.length - byeCount) / teamsPerDebate);
  }, 0);
}

function groupRandomTeams(
  teams: Team[],
  teamsPerDebate: number,
  avoidSameInstitution: boolean
): Team[][] {
  const debateCount = teams.length / teamsPerDebate;
  if (!avoidSameInstitution) {
    const shuffledTeams = shuffle(teams);
    return Array.from({ length: debateCount }, (_, index) =>
      shuffledTeams.slice(index * teamsPerDebate, (index + 1) * teamsPerDebate)
    );
  }

  const roots = teams.map((_, index) => index);
  const find = (index: number): number => {
    if (roots[index] !== index) roots[index] = find(roots[index]);
    return roots[index];
  };
  const union = (a: number, b: number) => {
    roots[find(a)] = find(b);
  };
  const shareInstitution = (a: Team, b: Team) => {
    const sameId = Boolean(a.institutionId && b.institutionId && a.institutionId === b.institutionId);
    const aName = a.institutionName?.trim().toLowerCase();
    const bName = b.institutionName?.trim().toLowerCase();
    return sameId || Boolean(aName && bName && aName === bName);
  };

  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      if (shareInstitution(teams[i], teams[j])) union(i, j);
    }
  }

  const institutionGroups = new Map<number, Team[]>();
  teams.forEach((team, index) => {
    const root = find(index);
    const group = institutionGroups.get(root) ?? [];
    group.push(team);
    institutionGroups.set(root, group);
  });

  const orderedGroups = shuffle(
    [...institutionGroups.values()].map((group) => shuffle(group))
  );
  const debates = Array.from({ length: debateCount }, () => [] as Team[]);
  let nextDebate = Math.floor(Math.random() * debateCount);
  for (const institutionGroup of orderedGroups) {
    for (const team of institutionGroup) {
      debates[nextDebate].push(team);
      nextDebate = (nextDebate + 1) % debateCount;
    }
  }

  return debates;
}

/**
 * Builds historical matchup graph and side histories from all completed debates.
 */
export function buildMatchupHistory(debates: Debate[]): MatchupHistory {
  const opponents = new Map<string, Set<string>>();
  const sides = new Map<string, DebateSide[]>();

  for (const d of debates) {
    if (d.byeTeamId) continue;
    const teamSlots = Object.values(d.teams).filter((t) => t && t.teamId);
    for (let i = 0; i < teamSlots.length; i++) {
      const t1 = teamSlots[i];
      if (!opponents.has(t1.teamId)) opponents.set(t1.teamId, new Set());
      if (!sides.has(t1.teamId)) sides.set(t1.teamId, []);

      sides.get(t1.teamId)!.push(t1.side);

      for (let j = 0; j < teamSlots.length; j++) {
        if (i !== j) {
          opponents.get(t1.teamId)!.add(teamSlots[j].teamId);
        }
      }
    }
  }

  return { opponents, sides };
}

/**
 * Master draw generator function for any tournament round.
 */
export function generateRoundDraw(params: GenerateDrawParams): Debate[] {
  const { tournament, round, teams, venues, pastDebates, standings } = params;
  const isBP = tournament.format === "bp";
  const teamsPerDebate = isBP ? 4 : 2;
  const availableVenues = venues.filter((venue) => venue.available !== false);
  const requiredVenues = getRequiredVenueCount(tournament, round, teams);
  if (availableVenues.length < requiredVenues) {
    throw new Error(
      `Not enough available venues: ${requiredVenues} required, but only ${availableVenues.length} available.`
    );
  }

  if (round.stage === "elimination" && (round.breakCategoryIds?.length || 0) > 1) {
    const generated: Debate[] = [];
    for (const categoryId of round.breakCategoryIds!) {
      const categoryTeams = getEligibleTeamsForRound(teams, { ...round, breakCategoryIds: [categoryId] });
      if (categoryTeams.length === 0) continue;

      const categoryDebates = generateRoundDraw({
        ...params,
        round: { ...round, breakCategoryIds: [categoryId] },
        teams: categoryTeams,
        venues: availableVenues.slice(generated.length),
      });
      categoryDebates.forEach((debate, index) => {
        const roomRank = generated.length + index + 1;
        debate.id = `debate-${round.id}-${roomRank}`;
        debate.roomRank = roomRank;
        debate.breakCategoryId = categoryId;
        generated.push(debate);
      });
    }
    return generated;
  }

  // Filter checked-in teams (or all active if checkins aren't used)
  let activeTeams = getEligibleTeamsForRound(teams, round).filter((t) => t.checkedIn !== false);
  let byeTeams: Team[] = [];

  // Automatic byes apply only to preliminary rounds.
  const byeMethod = tournament.preferences?.byeTeamSelectionMethod;
  if (
    round.stage === "preliminary" &&
    round.drawType !== "manual" &&
    activeTeams.length % teamsPerDebate !== 0 &&
    byeMethod &&
    byeMethod !== "none"
  ) {
    const excess = activeTeams.length % teamsPerDebate;
    if (byeMethod === "random") {
      const shuffled = shuffle(activeTeams);
      byeTeams = shuffled.slice(0, excess);
    } else if (byeMethod === "lowest_ranked") {
      const standingMap = new Map(standings.map((s) => [s.teamId, s.rank ?? 9999]));
      const sorted = [...activeTeams].sort((a, b) => (standingMap.get(b.id) ?? 9999) - (standingMap.get(a.id) ?? 9999));
      byeTeams = sorted.slice(0, excess);
    }
    const byeIds = new Set(byeTeams.map((team) => team.id));
    activeTeams = activeTeams.filter((team) => !byeIds.has(team.id));
  }

  const totalTeams = activeTeams.length;

  if (totalTeams < teamsPerDebate) {
    throw new Error(`At least ${teamsPerDebate} teams are required to generate a draw.`);
  }

  if (totalTeams % teamsPerDebate !== 0) {
    throw new Error(
      `Number of teams (${totalTeams}) must be divisible by ${teamsPerDebate} for ${tournament.format.toUpperCase()} format.`
    );
  }
  const history = buildMatchupHistory(pastDebates);
  const sortedVenues = availableVenues.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const sideRule = tournament.preferences?.sideAllocationRule || "balanced";
  const sideAllocationOptions: SideAllocationOptions = {
    bpPositionCost: tournament.preferences?.bpPositionCost,
    renyiOrder: tournament.preferences?.renyiOrder,
    bpPositionCostExponent: tournament.preferences?.bpPositionCostExponent,
    bpAssignmentMethod: tournament.preferences?.bpAssignmentMethod,
    sideBalancePenalty: tournament.preferences?.sideBalancePenalty,
    maxTimesPerSide: tournament.preferences?.maxTimesPerSide,
    maxAllowedSideImbalance: tournament.preferences?.maxAllowedSideImbalance,
  };

  // Handle Manual draw: create empty debates with room ranks and venues
  if (round.drawType === "manual") {
    const numDebates = Math.ceil(totalTeams / teamsPerDebate);
    const debates: Debate[] = [];
    const sidesList: DebateSide[] = isBP ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"];

    for (let idx = 0; idx < numDebates; idx++) {
      const venue = sortedVenues[idx];
      const emptyTeamsSlot: Record<string, any> = {};
      sidesList.forEach((s) => {
        emptyTeamsSlot[s] = {
          teamId: "",
          teamName: "Unassigned",
          side: s,
        };
      });

      const debateObj: Debate = {
        id: `debate-${round.id}-${idx + 1}`,
        tournamentId: tournament.id,
        roundId: round.id,
        roundSeq: round.seq,
        breakCategoryId: round.breakCategoryIds?.length === 1 ? round.breakCategoryIds[0] : undefined,
        venueName: venue?.name || `Room ${idx + 1}`,
        bracket: 0,
        roomRank: idx + 1,
        importance: 0,
        resultStatus: "none" as DebateResultStatus,
        sidesConfirmed: false,
        flags: [],
        teams: emptyTeamsSlot as Record<DebateSide, any>,
        adjudicators: {
          panellistIds: [],
          panellistNames: [],
          traineeIds: [],
          traineeNames: [],
        },
      };

      if (venue?.id) {
        debateObj.venueId = venue.id;
      }
      debates.push(debateObj);
    }

    return [...debates, ...createByeDebates(byeTeams, debates.length, tournament, round, isBP)];
  }

  let debateDrafts: {
    bracket: number;
    teamsWithSides: Record<DebateSide, Team>;
    breakCategoryId?: string;
  }[] = [];

  if (round.stage === "elimination") {
    const categoryIds = round.breakCategoryIds || [];
    const groups = categoryIds.length > 0
      ? categoryIds.map((categoryId) => ({
          categoryId,
          teams: activeTeams.filter((team) => team.breakCategoryIds?.includes(categoryId)),
        }))
      : [{ categoryId: undefined, teams: activeTeams }];

    for (const group of groups) {
      if (group.teams.length === 0) continue;
      if (group.teams.length < teamsPerDebate || group.teams.length % teamsPerDebate !== 0) {
        throw new Error(`Break category has ${group.teams.length} eligible teams, which cannot form an elimination draw.`);
      }

      const rankedTeams = [...group.teams].sort((a, b) => {
        const rankA = standings.find((standing) => standing.teamId === a.id)?.rank ?? Number.MAX_SAFE_INTEGER;
        const rankB = standings.find((standing) => standing.teamId === b.id)?.rank ?? Number.MAX_SAFE_INTEGER;
        return rankA - rankB;
      });
      const rooms = generateEliminationDraw(
        rankedTeams.map((team, index) => ({ team, seed: index + 1 })),
        tournament.format,
        rankedTeams.length
      );

      for (const room of rooms) {
        const teamsWithSides = {} as Record<DebateSide, Team>;
        room.teams.forEach(({ team, side }) => {
          teamsWithSides[side] = team;
        });
        debateDrafts.push({ bracket: 0, teamsWithSides, breakCategoryId: group.categoryId });
      }
    }
  } else if (round.drawType === "round_robin") {
    if (isBP) {
      throw new Error("Round-robin scheduling is only supported for two-team formats.");
    }
    const rrMatchups = generateRoundRobinDraw(
      activeTeams,
      round.seq,
      history.sides,
      tournament.format,
      sideRule,
      sideAllocationOptions
    );
    debateDrafts = rrMatchups;
  } else if (
    round.drawType === "random" ||
    round.seq === 1 ||
    !standings ||
    standings.length === 0 ||
    standings.every((s) => s.points === 0 && s.totalSpeakerScore === 0)
  ) {
    // Round 1, random drawType, or no standings yet: Shuffle teams randomly
    const groups = groupRandomTeams(
      activeTeams,
      teamsPerDebate,
      tournament.preferences?.avoidSameInstitution !== false
    );

    for (const group of groups) {
      const teamsWithSides = allocateSidesForDebate(
        group,
        history.sides,
        tournament.format,
        sideRule,
        sideAllocationOptions
      );
      debateDrafts.push({
        bracket: 0,
        teamsWithSides,
      });
    }
  } else if (isBP) {
    // BP power-paired draw with full tournament preferences (pullup distribution, position cost functions, Hungarian assignment)
    const bpOptions: BPDrawOptions = {
      repeatMatchupPenalty: tournament.preferences?.repeatMatchupPenalty ?? 1000,
      institutionClashPenalty: tournament.preferences?.institutionClashPenalty ?? 200,
      avoidSameInstitution: tournament.preferences?.avoidSameInstitution,
      avoidTeamHistory: tournament.preferences?.avoidTeamHistory,
      teamInstitutionPenalty: tournament.preferences?.teamInstitutionPenalty,
      teamHistoryPenalty: tournament.preferences?.teamHistoryPenalty,
      pullupPenalty: tournament.preferences?.pullupPenalty,
      previouslySawPullupPenalty: tournament.preferences?.previouslySawPullupPenalty,
      bpPullupDistribution: tournament.preferences?.bpPullupDistribution,
      bpPositionCost: tournament.preferences?.bpPositionCost,
      renyiOrder: tournament.preferences?.renyiOrder,
      bpPositionCostExponent: tournament.preferences?.bpPositionCostExponent,
      bpAssignmentMethod: tournament.preferences?.bpAssignmentMethod,
      sideBalancePenalty: tournament.preferences?.sideBalancePenalty,
      pairingDeviationPenalty: tournament.preferences?.pairingDeviationPenalty,
      maxTimesPerSide: tournament.preferences?.maxTimesPerSide,
      maxAllowedSideImbalance: tournament.preferences?.maxAllowedSideImbalance,
    };
    const powerDraw = generatePowerPairedDraw(activeTeams, standings, history, tournament.format, sideRule, bpOptions);
    debateDrafts = powerDraw.map((p) => ({
      bracket: p.bracket,
      teamsWithSides: p.teamsWithSides,
    }));
  } else {
    // Two-team formats: full C2 pipeline (bracket by wins -> resolve odd brackets
    // -> pair -> avoid conflicts -> allocate sides), each stage configurable.
    const twoTeamDraw = generateTwoTeamDraw(activeTeams, standings, history, tournament.format, {
      pairingMethod: tournament.preferences?.pairingMethod,
      oddBracketMethod: tournament.preferences?.oddBracketMethod,
      conflictAvoidance: tournament.preferences?.conflictAvoidance,
      pullupRestriction: tournament.preferences?.pullupRestriction,
      sideRule,
      penalties: {
        repeatMatchupPenalty: tournament.preferences?.avoidTeamHistory === false
          ? 0
          : (tournament.preferences?.teamHistoryPenalty ?? tournament.preferences?.repeatMatchupPenalty ?? 1000),
        institutionClashPenalty: tournament.preferences?.avoidSameInstitution === false
          ? 0
          : (tournament.preferences?.teamInstitutionPenalty ?? tournament.preferences?.institutionClashPenalty ?? 200),
        previouslySawPullupPenalty: tournament.preferences?.previouslySawPullupPenalty ?? 0,
        sideBalancePenalty: tournament.preferences?.sideBalancePenalty ?? 0,
        pairingDeviationPenalty: tournament.preferences?.pairingDeviationPenalty ?? 0,
      },
      sideBalancePenalty: tournament.preferences?.sideBalancePenalty,
      pairingDeviationPenalty: tournament.preferences?.pairingDeviationPenalty,
      maxTimesPerSide: tournament.preferences?.maxTimesPerSide,
      maxAllowedSideImbalance: tournament.preferences?.maxAllowedSideImbalance,
      pullupPenalty: tournament.preferences?.pullupPenalty,
      previouslySawPullupPenalty: tournament.preferences?.previouslySawPullupPenalty,
      avoidSameInstitution: tournament.preferences?.avoidSameInstitution,
      avoidTeamHistory: tournament.preferences?.avoidTeamHistory,
    });
    debateDrafts = twoTeamDraw.map((p) => ({
      bracket: p.bracket,
      teamsWithSides: p.teamsWithSides,
    }));
  }

  // Map drafts to complete Debate objects with venues and adjudicator slots
  const generatedDebates = debateDrafts.map((draft, idx) => {
    const venue = sortedVenues[idx];
    const teamsSlotRecord: Record<string, any> = {};

    Object.entries(draft.teamsWithSides).forEach(([side, team]) => {
      teamsSlotRecord[side] = {
        teamId: team.id,
        teamName: team.name,
        side: side as DebateSide,
      };
    });

    const debateObj: Debate = {
      id: `debate-${round.id}-${idx + 1}`,
      tournamentId: tournament.id,
      roundId: round.id,
      roundSeq: round.seq,
      breakCategoryId: draft.breakCategoryId ?? (round.breakCategoryIds?.length === 1 ? round.breakCategoryIds[0] : undefined),
      venueName: venue?.name || `Room ${idx + 1}`,
      bracket: draft.bracket,
      roomRank: idx + 1,
      importance: 0,
      resultStatus: "none" as DebateResultStatus,
      sidesConfirmed: true,
      flags: [],
      teams: teamsSlotRecord as Record<DebateSide, any>,
      adjudicators: {
        panellistIds: [],
        panellistNames: [],
        traineeIds: [],
        traineeNames: [],
      },
    };

    if (venue?.id) {
      debateObj.venueId = venue.id;
    }

    return debateObj;
  });
  return [
    ...generatedDebates,
    ...createByeDebates(byeTeams, generatedDebates.length, tournament, round, isBP),
  ];
}

function createByeDebates(
  byeTeams: Team[],
  startingIndex: number,
  tournament: Tournament,
  round: Round,
  isBP: boolean
): Debate[] {
  const side: DebateSide = isBP ? "OG" : "AFF";
  const byeResult = tournament.preferences?.byeTeamResults ?? "absent";

  return byeTeams.map((team, index) => ({
    id: `debate-${round.id}-${startingIndex + index + 1}`,
    tournamentId: tournament.id,
    roundId: round.id,
    roundSeq: round.seq,
    breakCategoryId: round.breakCategoryIds?.length === 1 ? round.breakCategoryIds[0] : undefined,
    venueName: "Bye",
    bracket: 0,
    roomRank: startingIndex + index + 1,
    importance: 0,
    resultStatus: "confirmed",
    sidesConfirmed: true,
    flags: ["bye"],
    byeTeamId: team.id,
    byeResult,
    teams: {
      [side]: { teamId: team.id, teamName: team.name, side },
    } as Debate["teams"],
    adjudicators: {
      panellistIds: [],
      panellistNames: [],
      traineeIds: [],
      traineeNames: [],
    },
  }));
}

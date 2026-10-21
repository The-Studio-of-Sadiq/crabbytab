import {
  Tournament,
  Round,
  Team,
  Venue,
  Debate,
  DebateSide,
  DebateResultStatus,
  Institution,
  TeamStandingRow,
  BPSide,
  TwoTeamSide,
} from "@/types";
import { generatePowerPairedDraw, MatchupHistory, PairedDebateDraft } from "./powerPaired";
import { allocateSidesForDebate, SideAllocationOptions } from "./sideAllocator";
import { generateBPRoundRobinDraw, generateRoundRobinDraw } from "./roundRobin";
import { generateRandomTwoTeamDraw, generateTwoTeamDraw, orderBySeed, TwoTeamDrawConfig } from "./twoTeamDraw";
import { eliminationRoomCount, planEliminationRound, resolveBracketPositions } from "./elimination";
import { createSeededRng, randomInt, randomSeed, Rng, shuffle } from "./rng";
import { sameInstitution } from "./history";
import { allocateVenuesBestEffort, withAllocatedVenues } from "./venueAllocator";
import { isVenueAvailableForRound, type VenueConstraintContext } from "@/lib/venues/venues";
import { MANUAL_SIDES_FLAG, sidesPending } from "./manualSides";
import { isAvailableForRound } from "@/lib/roundAvailability";
import { resolveTeamPrecedence } from "@/lib/standings/precedence";
import { isPolyFormat, polySide, teamsInDebateFor, tournamentSides } from "@/lib/debateSides";

export interface GenerateDrawParams {
  tournament: Tournament;
  round: Round;
  teams: Team[];
  institutions?: Institution[];
  venues: Venue[];
  pastDebates: Debate[];
  standings: TeamStandingRow[];
  /** Seed for every random choice the draw makes; the same inputs and seed give the same draw. */
  seed?: number;
  /**
   * Round-robin rounds: the round's index in the schedule (parallel panels in one schedule slot
   * share it; see roundRobinIndex in schedule.ts). Absent = round.seq.
   */
  roundRobinIndex?: number;
  /**
   * Two-team round robin: continue a cycle begun with the legacy rotation in stored team order
   * (see legacyRoundRobinInProgress in roundRobin.ts) instead of the Berger schedule in seed order.
   */
  legacyRoundRobin?: boolean;
}

export function getEligibleTeamsForRound(teams: Team[], round: Round | null): Team[] {
  if (!round) return teams;

  // A swing team is drawn only in the preliminary rounds it was formed for.
  let eligibleTeams = teams.filter(
    (team) => !team.isSwing || (round.stage === "preliminary" && Boolean(team.swingRoundIds?.includes(round.id)))
  );
  const breakHasBeenGenerated = teams.some((team) => team.breakCategoryIds !== undefined);
  if (round.stage === "elimination" && breakHasBeenGenerated) {
    if (round.breakCategoryIds) {
      const categoryIds = new Set(round.breakCategoryIds);
      eligibleTeams = eligibleTeams.filter(
        (team) => team.breakStatus === "breaking" && team.breakCategoryIds?.some((id) => categoryIds.has(id))
      );
    } else {
      eligibleTeams = eligibleTeams.filter((team) => team.breakStatus === "breaking");
    }
  }

  return round.divisionId
    ? eligibleTeams.filter((team) => (team.divisionId || team.divisionName) === round.divisionId)
    : eligibleTeams;
}

export function getRequiredVenueCount(
  tournament: Tournament,
  round: Round,
  teams: Team[]
): number {
  const teamsPerDebate = teamsInDebateFor(tournament);
  const eligibleTeams = getEligibleTeamsForRound(teams, round).filter((team) =>
    isAvailableForRound(team, round, tournament.preferences?.checkInExpiresAfterHours)
  );
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
    if (round.stage === "elimination") {
      // Partial eliminations give the top seeds byes, so they need fewer rooms.
      return required + (eliminationRoomCount(categoryTeams.length, tournament.format) ||
        Math.ceil(categoryTeams.length / teamsPerDebate));
    }
    const byeCount = usesByes ? categoryTeams.length % teamsPerDebate : 0;
    return required + Math.ceil((categoryTeams.length - byeCount) / teamsPerDebate);
  }, 0);
}

/**
 * Tabbycat's RandomPolyDrawGenerator (N teams per room): the teams are shuffled and dealt into rooms
 * of `teamsInDebate` in order, so when the count does not divide (and no byes are taken) the last
 * room holds the remainder. No conflict avoidance or side balancing applies, as in Tabbycat.
 */
export function groupPolyRooms(teams: Team[], teamsInDebate: number, rng: Rng): Team[][] {
  if (!Number.isInteger(teamsInDebate) || teamsInDebate < 1) throw new Error("Teams per debate must be a whole number of at least 1.");
  const shuffled = shuffle(teams, rng);
  const rooms: Team[][] = [];
  for (let index = 0; index < shuffled.length; index += teamsInDebate) rooms.push(shuffled.slice(index, index + teamsInDebate));
  return rooms;
}

/** Why a round of this draw type cannot be drawn for a poly tournament, or "" when it can. */
export function polyDrawTypeProblem(round: Pick<Round, "drawType" | "stage">, teamsInDebate: number): string {
  if (round.drawType === "manual") return "";
  if (round.stage === "elimination") {
    return `Elimination draws cannot be generated for debates with ${teamsInDebate} teams. ` +
      "Set the round's draw type to manual and draw it by hand.";
  }
  if (round.drawType === "random") return "";
  return `The ${String(round.drawType).replace(/_/g, "-")} draw type cannot be used with ${teamsInDebate} teams per debate. ` +
    "Use a random or manual draw.";
}

function groupRandomTeams(
  teams: Team[],
  teamsPerDebate: number,
  avoidSameInstitution: boolean,
  rng: Rng
): Team[][] {
  const debateCount = teams.length / teamsPerDebate;
  if (!avoidSameInstitution) {
    const shuffledTeams = shuffle(teams, rng);
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
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      if (sameInstitution(teams[i], teams[j])) union(i, j);
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
    [...institutionGroups.values()].map((group) => shuffle(group, rng)),
    rng
  );
  const debates = Array.from({ length: debateCount }, () => [] as Team[]);
  let nextDebate = randomInt(rng, debateCount);
  for (const institutionGroup of orderedGroups) {
    for (const team of institutionGroup) {
      debates[nextDebate].push(team);
      nextDebate = (nextDebate + 1) % debateCount;
    }
  }

  return debates;
}

/**
 * Builds the matchup graph, side histories (oldest first) and pull-up counts
 * from past debates. Byes and postponed debates are not meetings. A debate whose sides are still to
 * be recorded on its ballot (manual-ballot sides) is a meeting but adds no side to the history:
 * pass debates through `resolveRecordedSides` first so confirmed ballots supply their sides.
 */
export function buildMatchupHistory(debates: Debate[]): MatchupHistory {
  const opponents = new Map<string, Set<string>>();
  const sides = new Map<string, DebateSide[]>();
  const meetings = new Map<string, Map<string, number>>();
  const pullups = new Map<string, number>();
  const pullupDebates = new Map<string, number>();
  const increment = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

  const ordered = [...debates].sort((a, b) => (a.roundSeq ?? 0) - (b.roundSeq ?? 0));
  for (const d of ordered) {
    if (d.postponed) continue;
    if (d.byeTeamId) continue;
    const teamSlots = Object.values(d.teams).filter((t) => t && t.teamId);
    const hasPullup = teamSlots.some((slot) => slot.pulledUp);
    const sidesKnown = !sidesPending(d);
    for (const t1 of teamSlots) {
      if (!opponents.has(t1.teamId)) opponents.set(t1.teamId, new Set());
      if (!sides.has(t1.teamId)) sides.set(t1.teamId, []);
      if (!meetings.has(t1.teamId)) meetings.set(t1.teamId, new Map());
      if (sidesKnown) sides.get(t1.teamId)!.push(t1.side);
      if (t1.pulledUp) increment(pullups, t1.teamId);
      if (hasPullup) increment(pullupDebates, t1.teamId);

      for (const t2 of teamSlots) {
        if (t2 === t1) continue;
        opponents.get(t1.teamId)!.add(t2.teamId);
        increment(meetings.get(t1.teamId)!, t2.teamId);
      }
    }
  }

  return { opponents, sides, meetings, pullups, pullupDebates };
}

/**
 * Master draw generator function for any tournament round.
 */
export function generateRoundDraw(params: GenerateDrawParams): Debate[] {
  const { tournament, round, teams, institutions = [], venues, pastDebates, standings } = params;
  const institutionsById = new Map(institutions.map((institution) => [institution.id, institution]));
  const isBP = tournament.format === "bp";
  const poly = isPolyFormat(tournament.format);
  const teamsPerDebate = teamsInDebateFor(tournament);
  if (poly) {
    // Tabbycat draws other team counts only at random or by hand (DRAW_MANAGER_CLASSES[None, ...]).
    const problem = polyDrawTypeProblem(round, teamsPerDebate);
    if (problem) throw new Error(problem);
  }
  const availableVenues = venues.filter((venue) => isVenueAvailableForRound(venue, round.id));
  // Soft room constraints of teams and their institutions (adjudicators are not allocated yet).
  const venueContext: VenueConstraintContext = { teams, institutions };
  const rng = createSeededRng(params.seed ?? randomSeed());
  // Too few rooms does not stop the draw (Tabbycat's VenueAllocator): the rooms that fit are
  // allocated and the rest are left without a venue, which the draw check reports ("no_venue").

  if (round.stage === "elimination" && (round.breakCategoryIds?.length || 0) > 1) {
    const generated: Debate[] = [];
    for (const categoryId of round.breakCategoryIds!) {
      const categoryTeams = getEligibleTeamsForRound(teams, { ...round, breakCategoryIds: [categoryId] });
      if (categoryTeams.length === 0) continue;

      const categoryDebates = generateRoundDraw({
        ...params,
        round: { ...round, breakCategoryIds: [categoryId] },
        teams: categoryTeams,
        venues: availableVenues,
      });
      categoryDebates.forEach((debate, index) => {
        const roomRank = generated.length + index + 1;
        debate.id = `debate-${round.id}-${roomRank}`;
        debate.roomRank = roomRank;
        debate.breakCategoryId = categoryId;
        generated.push(debate);
      });
    }
    return assignVenues(generated, availableVenues, venueContext);
  }

  // Filter checked-in teams (or all active if checkins aren't used)
  let activeTeams = getEligibleTeamsForRound(teams, round).filter((team) =>
    isAvailableForRound(team, round, tournament.preferences?.checkInExpiresAfterHours)
  );
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
    // A swing team was formed to debate, so it never takes the bye.
    const byeCandidates = activeTeams.filter((team) => !team.isSwing);
    if (byeMethod === "random") {
      const shuffled = shuffle(byeCandidates, rng);
      byeTeams = shuffled.slice(0, excess);
    } else if (byeMethod === "lowest_ranked") {
      const standingMap = new Map(standings.map((s) => [s.teamId, s.rank ?? 9999]));
      // Teams tied on rank (every team before round 1) are shuffled with the draw's seed first, so
      // the stable sort settles the tie at random rather than always benching the first-listed teams.
      const sorted = shuffle(byeCandidates, rng).sort(
        (a, b) => (standingMap.get(b.id) ?? 9999) - (standingMap.get(a.id) ?? 9999)
      );
      byeTeams = sorted.slice(0, excess);
    }
    const byeIds = new Set(byeTeams.map((team) => team.id));
    activeTeams = activeTeams.filter((team) => !byeIds.has(team.id));
  }

  const totalTeams = activeTeams.length;

  // Poly rooms may be short (the last random room takes the remainder, as Tabbycat's).
  const minimumTeams = poly ? 1 : teamsPerDebate;
  if (totalTeams < minimumTeams) {
    throw new Error(`At least ${minimumTeams} team${minimumTeams === 1 ? " is" : "s are"} required to generate a draw.`);
  }

  // Elimination rounds validate their own field (partial eliminations give byes).
  if (!poly && round.stage !== "elimination" && totalTeams % teamsPerDebate !== 0) {
    throw new Error(
      `Number of teams (${totalTeams}) must be divisible by ${teamsPerDebate} for ${tournament.format.toUpperCase()} format.`
    );
  }
  const history = buildMatchupHistory(pastDebates);
  const preferences = tournament.preferences;
  const sideRule = preferences?.sideAllocationRule || "balanced";
  if (sideRule === "preallocated" && (isBP || poly) && round.stage !== "elimination" && round.drawType !== "manual") {
    throw new Error(isBP
      ? "Preallocated sides are only supported for two-team formats. Choose balanced or random sides for BP."
      : "Preallocated sides are only supported for two-team formats. Choose balanced or random sides.");
  }
  // Manual-ballot sides: teams are paired without sides (the ballot records them), so no side
  // rule or side limit shapes the pairing; the debate lists its teams in the pairing's order.
  const sidesOnBallot = sideRule === "manual_ballot";
  if (sidesOnBallot && (isBP || poly)) {
    throw new Error(isBP
      ? "Sides chosen on the ballot are only supported for two-team formats. Choose balanced or random sides for BP."
      : "Sides chosen on the ballot are only supported for two-team formats. Choose balanced or random sides.");
  }
  // Rounds that are not two-team power-paired/random/seeded draws treat preallocated as balanced.
  const nonPreallocatedSideRule = sideRule === "preallocated" || sidesOnBallot ? "balanced" : sideRule;
  const sideLimits = sidesOnBallot
    ? { maxTimesPerSide: Number.POSITIVE_INFINITY, maxAllowedSideImbalance: 0 }
    : { maxTimesPerSide: preferences?.maxTimesPerSide, maxAllowedSideImbalance: preferences?.maxAllowedSideImbalance };
  const sideAllocationOptions: SideAllocationOptions = {
    bpPositionCost: preferences?.bpPositionCost,
    renyiOrder: preferences?.renyiOrder,
    bpPositionCostExponent: preferences?.bpPositionCostExponent,
    bpAssignmentMethod: preferences?.bpAssignmentMethod,
    ...sideLimits,
  };
  // Power-paired brackets are formed on the first team-standings metric (Tabbycat's
  // team.points = first precedence metric), so round weights and bye points shape the brackets.
  const bracketMetric = resolveTeamPrecedence(tournament.format, preferences)[0];
  const twoTeamConfig: Partial<TwoTeamDrawConfig> = {
    bracketMetric,
    pairingMethod: preferences?.pairingMethod,
    oddBracketMethod: preferences?.oddBracketMethod,
    conflictAvoidance: preferences?.conflictAvoidance,
    pullupRestriction: preferences?.pullupRestriction,
    sideRule: sidesOnBallot ? "balanced" : sideRule,
    preallocatedSides: round.preallocatedSides,
    penalties: {
      repeatMatchupPenalty: preferences?.avoidTeamHistory === false
        ? 0
        : (preferences?.teamHistoryPenalty ?? preferences?.repeatMatchupPenalty ?? 1000),
      institutionClashPenalty: preferences?.avoidSameInstitution === false
        ? 0
        : (preferences?.teamInstitutionPenalty ?? preferences?.institutionClashPenalty ?? 200),
    },
    sideBalancePenalty: sidesOnBallot ? 0 : preferences?.sideBalancePenalty,
    pairingDeviationPenalty: preferences?.pairingDeviationPenalty,
    previouslySawPullupPenalty: preferences?.previouslySawPullupPenalty,
    pullupPenalty: preferences?.pullupPenalty,
    ...sideLimits,
  };
  const markSidesOnBallot = (debates: Debate[]): Debate[] =>
    sidesOnBallot
      ? debates.map((debate) => ({
          ...debate,
          sidesConfirmed: false,
          flags: debate.flags.includes(MANUAL_SIDES_FLAG) ? debate.flags : [...debate.flags, MANUAL_SIDES_FLAG],
        }))
      : debates;

  // Handle Manual draw: create empty debates with room ranks and venues
  if (round.drawType === "manual") {
    const numDebates = Math.ceil(totalTeams / teamsPerDebate);
    const debates: Debate[] = [];
    const sidesList: DebateSide[] = tournamentSides(tournament);

    for (let idx = 0; idx < numDebates; idx++) {
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
        venueName: `Room ${idx + 1}`,
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

      debates.push(debateObj);
    }

    return [
      ...markSidesOnBallot(assignVenues(debates, availableVenues, venueContext)),
      ...createByeDebates(byeTeams, debates.length, tournament, round),
    ];
  }

  if (poly) {
    // Random poly draw (the only generated poly draw): rooms in deal order, positions P1, P2, ...
    const rooms = groupPolyRooms(activeTeams, teamsPerDebate, rng);
    const polyDebates = rooms.map((room, idx): Debate => ({
      id: `debate-${round.id}-${idx + 1}`,
      tournamentId: tournament.id,
      roundId: round.id,
      roundSeq: round.seq,
      breakCategoryId: round.breakCategoryIds?.length === 1 ? round.breakCategoryIds[0] : undefined,
      venueName: `Room ${idx + 1}`,
      bracket: 0,
      roomRank: idx + 1,
      importance: 0,
      resultStatus: "none",
      sidesConfirmed: true,
      flags: [],
      ...getTeamVenueRequirements(room, institutionsById),
      teams: Object.fromEntries(
        room.map((team, seat) => [polySide(seat), { teamId: team.id, teamName: team.name, side: polySide(seat) }])
      ) as Debate["teams"],
      adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    }));
    return [
      ...assignVenues(polyDebates, availableVenues, venueContext),
      ...createByeDebates(byeTeams, polyDebates.length, tournament, round),
    ];
  }

  let debateDrafts: (Pick<PairedDebateDraft, "bracket" | "teamsWithSides" | "pulledUpTeamIds" | "flags" | "teamFlags"> & {
    breakCategoryId?: string;
    bracketPositions?: Partial<Record<DebateSide, number>>;
    /** Elimination sides drawn at random and left to be confirmed (eliminationSideRule "random"). */
    sidesUnconfirmed?: boolean;
  })[] = [];
  const eliminationByes: { team: Team; position: number; breakCategoryId?: string }[] = [];

  if (round.stage === "elimination") {
    const categoryIds = round.breakCategoryIds || [];
    const groups = categoryIds.length > 0
      ? categoryIds.map((categoryId) => ({
          categoryId,
          teams: activeTeams.filter((team) => team.breakCategoryIds?.includes(categoryId)),
        }))
      : [{ categoryId: undefined, teams: activeTeams }];
    const rankByTeamId = new Map(standings.map((standing, index) => [standing.teamId, standing.rank ?? index + 1]));
    const randomEliminationSides = preferences?.eliminationSideRule === "random";
    const rankOf = (team: Team) => rankByTeamId.get(team.id) ?? Number.MAX_SAFE_INTEGER;

    for (const group of groups) {
      if (group.teams.length === 0) continue;

      // Break seeds come from every team that broke in this category, so a
      // team keeps its seed after others have been eliminated.
      const brokeInGroup = (team: Team) => group.categoryId
        ? Boolean(team.breakCategoryIds?.includes(group.categoryId))
        : (team.breakCategoryIds?.length ?? 0) > 0;
      const breakField = teams.filter(brokeInGroup);
      const seedField = breakField.length > 0 ? breakField : group.teams;
      const seedByTeamId = new Map(
        [...seedField]
          .sort((left, right) => rankOf(left) - rankOf(right) || left.name.localeCompare(right.name))
          .map((team, index) => [team.id, index + 1])
      );
      const positioned = resolveBracketPositions(
        group.teams,
        (team) => seedByTeamId.get(team.id) ?? seedField.length + rankOf(team),
        pastDebates.filter((debate) => !group.categoryId || debate.breakCategoryId === group.categoryId)
      );
      let plan;
      try {
        plan = planEliminationRound(positioned, tournament.format);
      } catch (error) {
        const categoryLabel = group.categoryId ? `Break category ${group.categoryId}` : "This elimination round";
        throw new Error(`${categoryLabel}: ${error instanceof Error ? error.message : String(error)}`);
      }

      for (const room of plan.rooms) {
        const teamsWithSides = {} as Record<DebateSide, Team>;
        const bracketPositions: Partial<Record<DebateSide, number>> = {};
        // By seed, the plan's seat order stands (top seed AFF / OG). Random, as Tabbycat's
        // elimination generators: the room's teams are shuffled over its seats with the draw's seed.
        const seats = room.teams.map(({ side }) => side);
        const seated = randomEliminationSides ? shuffle(room.teams, rng) : room.teams;
        seated.forEach(({ team, position }, index) => {
          teamsWithSides[seats[index]] = team;
          bracketPositions[seats[index]] = position;
        });
        debateDrafts.push({
          bracket: 0,
          teamsWithSides,
          breakCategoryId: group.categoryId,
          bracketPositions,
          ...(randomEliminationSides ? { sidesUnconfirmed: true } : {}),
        });
      }
      plan.byes.forEach((bye) => eliminationByes.push({ ...bye, breakCategoryId: group.categoryId }));
    }
  } else if (round.drawType === "round_robin" && isBP) {
    debateDrafts = generateBPRoundRobinDraw(activeTeams, params.roundRobinIndex ?? round.seq, history.sides, sideLimits);
  } else if (round.drawType === "round_robin") {
    debateDrafts = generateRoundRobinDraw(
      activeTeams,
      params.roundRobinIndex ?? round.seq,
      history.sides,
      tournament.format,
      nonPreallocatedSideRule,
      sideAllocationOptions,
      rng,
      params.legacyRoundRobin === true
    );
  } else if (round.drawType === "seeded" && isBP) {
    // Tabbycat's SeededDrawManager for BP: every team on 0 points (one bracket), rows in seed
    // order, rooms and positions settled by the BP assignment on position history alone.
    debateDrafts = generatePowerPairedDraw(orderBySeed(activeTeams, rng), [], history, {
      ...sideAllocationOptions,
      sideRule: nonPreallocatedSideRule,
      keepInputOrder: true,
    }, rng);
  } else if (round.drawType === "seeded") {
    debateDrafts = generateTwoTeamDraw(
      activeTeams,
      [],
      history,
      tournament.format,
      twoTeamConfig,
      rng,
      orderBySeed(activeTeams, rng)
    );
  } else if (
    round.drawType === "random" ||
    round.seq === 1 ||
    !standings ||
    standings.length === 0 ||
    standings.every((s) => s.points === 0 && s.totalSpeakerScore === 0)
  ) {
    // Random rounds, and power-paired rounds before any results exist.
    if (isBP) {
      const groups = groupRandomTeams(activeTeams, teamsPerDebate, preferences?.avoidSameInstitution !== false, rng);
      debateDrafts = groups.map((group) => ({
        bracket: 0,
        teamsWithSides: allocateSidesForDebate(
          group,
          history.sides,
          tournament.format,
          nonPreallocatedSideRule,
          sideAllocationOptions,
          rng
        ),
      }));
    } else {
      debateDrafts = generateRandomTwoTeamDraw(activeTeams, history, tournament.format, twoTeamConfig, rng);
    }
  } else if (isBP) {
    debateDrafts = generatePowerPairedDraw(activeTeams, standings, history, {
      ...sideAllocationOptions,
      pullupPenalty: preferences?.pullupPenalty,
      bpPullupDistribution: preferences?.bpPullupDistribution,
      sideRule: nonPreallocatedSideRule,
      bracketMetric,
    }, rng);
  } else {
    debateDrafts = generateTwoTeamDraw(activeTeams, standings, history, tournament.format, twoTeamConfig, rng);
  }

  // Map drafts to complete Debate objects with venues and adjudicator slots
  const generatedDebates = debateDrafts.map((draft, idx) => {
    const teamsSlotRecord: Record<string, any> = {};

    Object.entries(draft.teamsWithSides).forEach(([side, team]) => {
      const bracketPosition = draft.bracketPositions?.[side as DebateSide];
      teamsSlotRecord[side] = {
        teamId: team.id,
        teamName: team.name,
        side: side as DebateSide,
        ...(draft.pulledUpTeamIds?.includes(team.id) ? { pulledUp: true } : {}),
        ...(draft.teamFlags?.[team.id]?.length ? { flags: [...draft.teamFlags[team.id]] } : {}),
        ...(bracketPosition !== undefined ? { bracketPosition } : {}),
      };
    });
    const requirements = getTeamVenueRequirements(
      Object.values(draft.teamsWithSides),
      institutionsById
    );

    const debateObj: Debate = {
      id: `debate-${round.id}-${idx + 1}`,
      tournamentId: tournament.id,
      roundId: round.id,
      roundSeq: round.seq,
      breakCategoryId: draft.breakCategoryId ?? (round.breakCategoryIds?.length === 1 ? round.breakCategoryIds[0] : undefined),
      venueName: `Room ${idx + 1}`,
      bracket: draft.bracket,
      roomRank: idx + 1,
      importance: 0,
      resultStatus: "none" as DebateResultStatus,
      sidesConfirmed: !draft.sidesUnconfirmed,
      // Two-team ballots can record the sides taken (manual-ballot machinery); BP ballots cannot,
      // so a BP room keeps its drawn seats, which the draw editor can still swap.
      // Tabbycat's debate draw flags (one-up-one-down, max_swapped) are kept with the debate.
      flags: [...(draft.sidesUnconfirmed && !isBP ? [MANUAL_SIDES_FLAG] : []), ...(draft.flags ?? [])],
      ...requirements,
      teams: teamsSlotRecord as Record<DebateSide, any>,
      adjudicators: {
        panellistIds: [],
        panellistNames: [],
        traineeIds: [],
        traineeNames: [],
      },
    };

    return debateObj;
  });
  return [
    ...markSidesOnBallot(assignVenues(generatedDebates, availableVenues, venueContext)),
    ...createByeDebates(byeTeams, generatedDebates.length, tournament, round),
    ...createEliminationByeDebates(eliminationByes, generatedDebates.length, tournament, round),
  ];
}

export function getTeamVenueRequirements(
  teams: Team[],
  institutionsById: Map<string, Institution>
): Pick<Debate, "requiredVenueCategory" | "requiredVenueCapacity" | "requiresAccessibleVenue" | "requiresOnlineVenue" | "requiresNearTabRoom"> {
  const requirements = teams.flatMap((team) => [
    team.venueRequirements,
    team.institutionId ? institutionsById.get(team.institutionId)?.venueRequirements : undefined,
  ]).filter((item) => item !== undefined);
  const categories = [...new Set(requirements
    .map((item) => item?.category?.trim())
    .filter((category): category is string => Boolean(category)))];
  if (categories.length > 1) {
    throw new Error(`Teams in a debate require incompatible venue categories: ${categories.join(", ")}.`);
  }
  return {
    requiredVenueCategory: categories[0],
    requiredVenueCapacity: requirements.reduce(
      (capacity, item) => Math.max(capacity, item?.minimumCapacity ?? 0),
      0
    ) || undefined,
    requiresAccessibleVenue: requirements.some((item) => item?.accessible === true) || undefined,
    requiresOnlineVenue: requirements.some((item) => item?.online === true) || undefined,
    requiresNearTabRoom: requirements.some((item) => item?.nearTabRoom === true) || undefined,
  };
}

function assignVenues(debates: Debate[], venues: Venue[], context?: VenueConstraintContext): Debate[] {
  return withAllocatedVenues(debates, allocateVenuesBestEffort(debates, venues, context));
}

function createByeDebates(
  byeTeams: Team[],
  startingIndex: number,
  tournament: Tournament,
  round: Round
): Debate[] {
  const side: DebateSide = tournamentSides(tournament)[0];
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

/** Partial-elimination byes: the team advances without a ballot and keeps its bracket position. */
function createEliminationByeDebates(
  byes: { team: Team; position: number; breakCategoryId?: string }[],
  startingIndex: number,
  tournament: Tournament,
  round: Round
): Debate[] {
  const side: DebateSide = tournamentSides(tournament)[0];
  return byes.map(({ team, position, breakCategoryId }, index) => ({
    id: `debate-${round.id}-${startingIndex + index + 1}`,
    tournamentId: tournament.id,
    roundId: round.id,
    roundSeq: round.seq,
    breakCategoryId: breakCategoryId ?? (round.breakCategoryIds?.length === 1 ? round.breakCategoryIds[0] : undefined),
    venueName: "Bye",
    bracket: 0,
    roomRank: startingIndex + index + 1,
    importance: 0,
    resultStatus: "confirmed",
    sidesConfirmed: true,
    flags: ["bye", "elimination_bye"],
    byeTeamId: team.id,
    teams: {
      [side]: { teamId: team.id, teamName: team.name, side, bracketPosition: position },
    } as Debate["teams"],
    adjudicators: {
      panellistIds: [],
      panellistNames: [],
      traineeIds: [],
      traineeNames: [],
    },
  }));
}

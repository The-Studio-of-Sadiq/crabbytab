import type {
  ConflictAvoidance,
  DebateSide,
  OddBracketMethod,
  PairingMethod,
  PullupRestriction,
  Team,
  TeamStandingRow,
  TwoTeamSide,
} from "@/types";
import { MatchupHistory, sameInstitution, timesMet } from "./history";
import { allocateSidesForDebate, TWO_TEAM_SIDES, violatesSideLimits } from "./sideAllocator";
import {
  RankedTeamStats,
  SidedBracket,
  WinBracket,
  resolveOddBrackets,
  resolveOddBracketsWithSides,
} from "./oddBrackets";
import { pairAllocatedSides, pairTeams } from "./pairing";
import { ClashPenalties, DEFAULT_CLASH_PENALTIES, avoidConflicts, clashCost, oneUpOneDown } from "./conflictAvoidance";
import { minCostPairAllocatedSides, minCostPairBracket, MinCostPairingOptions } from "./minCostPairing";
import { PairedDebateDraft } from "./powerPaired";
import { singleGraphPair } from "./singleGraphPairing";
import { minCostPerfectMatching } from "./weightedMatching";
import { Rng, shuffle } from "./rng";

export interface TwoTeamDrawConfig {
  pairingMethod: PairingMethod;
  oddBracketMethod: OddBracketMethod;
  conflictAvoidance: ConflictAvoidance;
  pullupRestriction: PullupRestriction;
  penalties: ClashPenalties;
  sideRule: "balanced" | "random" | "preallocated";
  /** Team id -> side; required when sideRule is "preallocated". */
  preallocatedSides?: Record<string, TwoTeamSide>;
  /** min_cost only. */
  sideBalancePenalty?: number;
  /** min_cost only. */
  pairingDeviationPenalty?: number;
  /** min_cost only (Tabbycat's pullup_debates_penalty). */
  previouslySawPullupPenalty?: number;
  /** min_cost_with_pullups only (Tabbycat's draw_pullup_penalty): × the pulled-up team's place in the odd-bracket order. */
  pullupPenalty?: number;
  maxTimesPerSide?: number;
  maxAllowedSideImbalance?: number;
}

export const DEFAULT_TWO_TEAM_DRAW_CONFIG: TwoTeamDrawConfig = {
  pairingMethod: "fold",
  oddBracketMethod: "pullup_top",
  conflictAvoidance: "one_up_one_down",
  pullupRestriction: "none",
  penalties: DEFAULT_CLASH_PENALTIES,
  sideRule: "balanced",
};

function resolveConfig(config: Partial<TwoTeamDrawConfig>): TwoTeamDrawConfig {
  // Spreading `config` directly would let an explicit `undefined` field (e.g.
  // passed straight from optional tournament preferences) clobber its default.
  return {
    pairingMethod: config.pairingMethod ?? DEFAULT_TWO_TEAM_DRAW_CONFIG.pairingMethod,
    oddBracketMethod: config.oddBracketMethod ?? DEFAULT_TWO_TEAM_DRAW_CONFIG.oddBracketMethod,
    conflictAvoidance: config.conflictAvoidance ?? DEFAULT_TWO_TEAM_DRAW_CONFIG.conflictAvoidance,
    pullupRestriction: config.pullupRestriction ?? DEFAULT_TWO_TEAM_DRAW_CONFIG.pullupRestriction,
    penalties: config.penalties ?? DEFAULT_TWO_TEAM_DRAW_CONFIG.penalties,
    sideRule: config.sideRule ?? DEFAULT_TWO_TEAM_DRAW_CONFIG.sideRule,
    preallocatedSides: config.preallocatedSides,
    sideBalancePenalty: config.sideBalancePenalty,
    pairingDeviationPenalty: config.pairingDeviationPenalty,
    previouslySawPullupPenalty: config.previouslySawPullupPenalty,
    pullupPenalty: config.pullupPenalty,
    maxTimesPerSide: config.maxTimesPerSide,
    maxAllowedSideImbalance: config.maxAllowedSideImbalance,
  };
}

/** Whether a and b can meet with some side assignment inside the hard side limits. */
function sideLimitCheck(history: MatchupHistory, cfg: TwoTeamDrawConfig): (a: Team, b: Team) => boolean {
  const fits = (team: Team, side: DebateSide) =>
    !violatesSideLimits(history.sides.get(team.id) ?? [], side, TWO_TEAM_SIDES, cfg);
  return (a, b) => (fits(a, "AFF") && fits(b, "NEG")) || (fits(a, "NEG") && fits(b, "AFF"));
}

function minCostOptions(
  cfg: TwoTeamDrawConfig,
  history: MatchupHistory,
  wins: Map<string, number>,
  isTopBracket: boolean,
  rng: Rng,
  pairingMethod: PairingMethod = cfg.pairingMethod
): MinCostPairingOptions {
  return {
    penalties: cfg.penalties,
    pairingMethod,
    pairingDeviationPenalty: cfg.pairingDeviationPenalty ?? 0,
    sideBalancePenalty: cfg.sideRule === "balanced" ? (cfg.sideBalancePenalty ?? 0) : 0,
    previouslySawPullupPenalty: cfg.previouslySawPullupPenalty ?? 0,
    isTopBracket,
    wins,
    canMeet: cfg.sideRule === "preallocated" ? () => true : sideLimitCheck(history, cfg),
    rng,
  };
}

function hasConflict(history: MatchupHistory, penalties: ClashPenalties) {
  return (a: Team, b: Team) =>
    (penalties.institutionClashPenalty > 0 && sameInstitution(a, b)) ||
    (penalties.repeatMatchupPenalty > 0 && timesMet(history, a, b) > 0);
}

/** Every team must have exactly one preallocated side, and the two sides must balance. */
function preallocatedSideOf(teams: Team[], cfg: TwoTeamDrawConfig): Map<string, TwoTeamSide> {
  const sides = new Map<string, TwoTeamSide>();
  const missing: string[] = [];
  for (const team of teams) {
    const side = cfg.preallocatedSides?.[team.id];
    if (side === "AFF" || side === "NEG") sides.set(team.id, side);
    else missing.push(team.name);
  }
  if (missing.length > 0) {
    throw new Error(
      `Side allocation is set to preallocated, but ${missing.length} team(s) have no side for this round: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", ..." : ""}.`
    );
  }
  const affCount = [...sides.values()].filter((side) => side === "AFF").length;
  if (affCount * 2 !== teams.length) {
    throw new Error(
      `Preallocated sides must split the field evenly: ${affCount} affirmative and ${teams.length - affCount} negative teams.`
    );
  }
  return sides;
}

function draftFor(
  bracket: number,
  teamsWithSides: Record<DebateSide, Team>,
  wins: Map<string, number>
): PairedDebateDraft {
  const teams = [teamsWithSides.AFF, teamsWithSides.NEG];
  const top = Math.max(...teams.map((t) => wins.get(t.id) ?? 0));
  return {
    bracket,
    teams,
    teamsWithSides,
    pulledUpTeamIds: teams.filter((t) => (wins.get(t.id) ?? 0) < top).map((t) => t.id),
  };
}

/** Rooms of one bracket group, best first, before sides are allocated. */
export interface BracketRooms {
  bracket: number;
  rooms: Team[][];
}

/**
 * Side limits as a pairing constraint for the pairing methods and one-up-one-down, which pair
 * before sides are known. When a room's two teams cannot take opposite sides without one passing
 * maxTimesPerSide or maxAllowedSideImbalance, its bracket is re-paired by a minimum-cost matching
 * that forbids such rooms. If no pairing inside the bracket fits, the window widens to the
 * neighbouring brackets (below first, then above), one bracket at a time. In the window, a room
 * costs, in strict priority order: the win difference between its teams (so as few and as small
 * extra pull-ups as possible), its clashes, then 1 if it is not one of the rooms the pairing method
 * and conflict avoidance chose. Brackets whose rooms all fit are untouched.
 *
 * Tabbycat applies max_times_on_one_side only in its graph conflict avoidance; with
 * one-up-one-down it pairs regardless and the side allocation silently breaks the limit.
 * CrabbyTab keeps the limit hard: it changes as little of the power pairing as it must, and
 * still fails (with a clear error at side allocation) when no pairing of the field fits.
 */
export function repairSideLimits(
  groups: BracketRooms[],
  history: MatchupHistory,
  cfg: TwoTeamDrawConfig,
  wins: Map<string, number>
): BracketRooms[] {
  const canMeet = sideLimitCheck(history, cfg);
  const fits = (group: BracketRooms) => group.rooms.every(([a, b]) => canMeet(a, b));
  let current = groups;
  for (let index = 0; index < current.length; index++) {
    if (fits(current[index])) continue;
    let repaired: BracketRooms[] | null = null;
    for (let width = 1; width <= current.length && !repaired; width++) {
      // Windows containing `index`, preferring brackets below it.
      for (let start = index; start >= Math.max(0, index - width + 1) && !repaired; start--) {
        const end = start + width;
        if (end > current.length) continue;
        repaired = repairWindow(current.slice(start, end), history, cfg, wins, canMeet);
        if (repaired) current = [...current.slice(0, start), ...repaired, ...current.slice(end)];
      }
    }
    // No pairing of the field fits: leave it, and side allocation reports which limit cannot be met.
    if (!repaired) return current;
  }
  return current;
}

function repairWindow(
  window: BracketRooms[],
  history: MatchupHistory,
  cfg: TwoTeamDrawConfig,
  wins: Map<string, number>,
  canMeet: (a: Team, b: Team) => boolean
): BracketRooms[] | null {
  const rooms = window.flatMap((group) => group.rooms);
  const teams = rooms.flat();
  const index = new Map(teams.map((team, i) => [team.id, i]));
  const original = new Set(rooms.map(([a, b]) => [index.get(a.id)!, index.get(b.id)!].sort((x, y) => x - y).join(":")));
  const winsOf = (team: Team) => wins.get(team.id) ?? 0;
  const changeScale = rooms.length + 1;
  let maxClash = 0;
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) maxClash = Math.max(maxClash, clashCost(teams[i], teams[j], history, cfg.penalties));
  }
  const clashScale = changeScale;
  const winScale = (maxClash * rooms.length + 1) * clashScale;
  const pairs = minCostPerfectMatching(teams.length, (i, j) => {
    if (!canMeet(teams[i], teams[j])) return null;
    const winGap = Math.round(Math.abs(winsOf(teams[i]) - winsOf(teams[j])));
    return winGap * winScale + clashCost(teams[i], teams[j], history, cfg.penalties) * clashScale + (original.has(`${i}:${j}`) ? 0 : 1);
  });
  if (!pairs) return null;

  // Each new room is placed where its higher-ranked team's old room was, in that room's group;
  // a room whose teams differ in wins belongs to the higher team's bracket.
  const partner = new Map<number, number>();
  for (const [i, j] of pairs) {
    partner.set(i, j);
    partner.set(j, i);
  }
  const placed = new Set<number>();
  let offset = 0;
  return window.map((group) => {
    const groupRooms: Team[][] = [];
    for (let k = 0; k < group.rooms.length * 2; k++) {
      const i = offset + k;
      if (placed.has(i)) continue;
      const j = partner.get(i)!;
      placed.add(i);
      placed.add(j);
      groupRooms.push([teams[Math.min(i, j)], teams[Math.max(i, j)]]);
    }
    offset += group.rooms.length * 2;
    return { bracket: group.bracket, rooms: groupRooms };
  });
}

/**
 * Ranks teams best-first. Standings order is used, but teams sharing a
 * standings rank (or with no standing yet) are shuffled with `rng`, the way
 * Tabbycat breaks draw ties randomly rather than by an arbitrary fixed order.
 */
export function rankForDraw(teams: Team[], standings: TeamStandingRow[], rng: Rng): Team[] {
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const ranked = standings.filter((s) => teamMap.has(s.teamId));
  const groups: Team[][] = [];
  ranked.forEach((standing, index) => {
    const previous = ranked[index - 1];
    const tied = previous && standing.rank !== undefined && standing.rank === previous.rank;
    if (tied) groups[groups.length - 1].push(teamMap.get(standing.teamId)!);
    else groups.push([teamMap.get(standing.teamId)!]);
  });
  const rankedIds = new Set(ranked.map((s) => s.teamId));
  return [
    ...groups.flatMap((group) => shuffle(group, rng)),
    ...shuffle(teams.filter((t) => !rankedIds.has(t.id)), rng),
  ];
}

/**
 * Two-team power-paired draw (Tabbycat's power-paired generators): bracket by
 * wins, resolve odd brackets, pair within brackets, avoid conflicts, allocate
 * sides. `conflictAvoidance: "min_cost"` replaces the last three steps with a
 * minimum-cost matching per bracket. With preallocated sides, brackets are
 * balanced by side instead (intermediate1/intermediate2 or pull-ups).
 * Seeded draws pass `seedOrder` to rank by Team.seed in a single bracket.
 */
export function generateTwoTeamDraw(
  teams: Team[],
  standings: TeamStandingRow[],
  history: MatchupHistory,
  format: string,
  config: Partial<TwoTeamDrawConfig> = {},
  rng: Rng = Math.random,
  seedOrder?: Team[]
): PairedDebateDraft[] {
  if (teams.length % 2 !== 0) {
    throw new Error(`Number of teams (${teams.length}) must be even for a two-team draw.`);
  }
  const cfg = resolveConfig(config);
  const standingMap = new Map(standings.map((s) => [s.teamId, s]));
  const ordered = seedOrder ?? rankForDraw(teams, standings, rng);
  const wins = new Map(ordered.map((team) => [team.id, seedOrder ? 0 : (standingMap.get(team.id)?.metrics?.wins ?? 0)]));

  const statsFor = (team: Team): RankedTeamStats => {
    const m = standingMap.get(team.id)?.metrics;
    return {
      team,
      pullups: history.pullups?.get(team.id) ?? m?.pullups ?? 0,
      // Tabbycat's lowest_ds_wins restriction reads draw_strength (opponents' points).
      drawStrengthWins: m?.draw_strength ?? m?.draw_strength_wins ?? 0,
      drawStrengthSpeaks: m?.draw_strength_speaks ?? 0,
    };
  };
  const winKeys = [...new Set(wins.values())].sort((a, b) => b - a);

  const dsRankPullup = cfg.oddBracketMethod === "pullup_lowest_ds_rank" || cfg.oddBracketMethod === "pullup_lowest_ds_rank_npulls";
  // Tabbycat's graph_one with preallocated sides is its per-bracket graph generator.
  const singleGraph = cfg.conflictAvoidance === "min_cost_with_pullups" && cfg.sideRule !== "preallocated";
  if (dsRankPullup && !singleGraph) {
    throw new Error(
      "Pulling up by draw strength rank needs \"Minimum cost matching (including pull-ups)\" conflict avoidance and non-preallocated sides."
    );
  }

  if (singleGraph) {
    const entries = ordered.map((team) => ({
      team,
      wins: wins.get(team.id) ?? 0,
      pullups: statsFor(team).pullups,
      drawStrengthRank: standingMap.get(team.id)?.metrics?.draw_strength_rank,
    }));
    const rooms = singleGraphPair(entries, history, {
      ...minCostOptions(cfg, history, wins, false, rng),
      oddBracketMethod: cfg.oddBracketMethod,
      pullupPenalty: cfg.pullupPenalty ?? 0,
    });
    return rooms.map((room) => {
      const bracket = Math.max(...room.map((team) => wins.get(team.id) ?? 0));
      return draftFor(bracket, allocateSidesForDebate(room, history.sides, format, cfg.sideRule as "balanced" | "random", cfg, rng), wins);
    });
  }

  if (cfg.sideRule === "preallocated") {
    const sides = preallocatedSideOf(teams, cfg);
    const brackets: SidedBracket[] = winKeys.map((w) => {
      const inBracket = ordered.filter((t) => wins.get(t.id) === w);
      return {
        wins: w,
        aff: inBracket.filter((t) => sides.get(t.id) === "AFF").map(statsFor),
        neg: inBracket.filter((t) => sides.get(t.id) === "NEG").map(statsFor),
      };
    });
    const groups = resolveOddBracketsWithSides(brackets, cfg.oddBracketMethod, cfg.pullupRestriction, rng);
    return groups.flatMap((group, index) => {
      const isTopBracket = index === 0;
      let rooms: Team[][];
      if (cfg.conflictAvoidance === "min_cost" || cfg.conflictAvoidance === "min_cost_with_pullups") {
        rooms = minCostPairAllocatedSides(group.aff, group.neg, history, minCostOptions(cfg, history, wins, isTopBracket, rng));
      } else {
        rooms = pairAllocatedSides(group.aff, group.neg, cfg.pairingMethod, { rng, isTopBracket });
        // Swapping second teams between adjacent rooms keeps every team on its allocated side.
        if (cfg.conflictAvoidance === "one_up_one_down") rooms = oneUpOneDown(rooms, history, cfg.penalties);
      }
      return rooms.map(([aff, neg]) => draftFor(group.bracket, { AFF: aff, NEG: neg } as Record<DebateSide, Team>, wins));
    });
  }

  const brackets: WinBracket[] = winKeys.map((w) => ({
    wins: w,
    teams: ordered.filter((t) => wins.get(t.id) === w).map(statsFor),
  }));
  const groups = resolveOddBrackets(
    brackets,
    cfg.oddBracketMethod,
    cfg.pullupRestriction,
    rng,
    hasConflict(history, cfg.penalties)
  );

  if (cfg.conflictAvoidance === "min_cost") {
    return groups.flatMap((group, index) =>
      minCostPairBracket(group.teams, history, minCostOptions(cfg, history, wins, index === 0, rng)).map((room) =>
        draftFor(group.bracket, allocateSidesForDebate(room, history.sides, format, cfg.sideRule as "balanced" | "random", cfg, rng), wins)
      )
    );
  }
  const paired: BracketRooms[] = groups.map((group, index) => ({
    bracket: group.bracket,
    rooms: avoidConflicts(
      pairTeams(group.teams, cfg.pairingMethod, { rng, isTopBracket: index === 0 }),
      history,
      cfg.conflictAvoidance,
      cfg.penalties
    ),
  }));
  return repairSideLimits(paired, history, cfg, wins).flatMap((group) =>
    group.rooms.map((room) =>
      draftFor(group.bracket, allocateSidesForDebate(room, history.sides, format, cfg.sideRule as "balanced" | "random", cfg, rng), wins)
    )
  );
}

/**
 * Two-team random draw. Teams are shuffled with `rng`; unless conflict
 * avoidance is off, the shuffled field is then paired by minimum-cost matching
 * over history and institution clashes (Tabbycat's graph random generator),
 * so later random rounds avoid rematches when they can. With preallocated
 * sides, affirmative teams are matched to negative teams.
 */
export function generateRandomTwoTeamDraw(
  teams: Team[],
  history: MatchupHistory,
  format: string,
  config: Partial<TwoTeamDrawConfig> = {},
  rng: Rng = Math.random
): PairedDebateDraft[] {
  if (teams.length % 2 !== 0) {
    throw new Error(`Number of teams (${teams.length}) must be even for a two-team draw.`);
  }
  const cfg = resolveConfig(config);
  const wins = new Map(teams.map((t) => [t.id, 0]));
  const avoid = cfg.conflictAvoidance !== "off";
  const options = minCostOptions(
    { ...cfg, pairingDeviationPenalty: 0, sideBalancePenalty: 0, previouslySawPullupPenalty: 0 },
    history,
    wins,
    true,
    rng,
    "random"
  );
  if (!avoid) options.penalties = { repeatMatchupPenalty: 0, institutionClashPenalty: 0 };

  if (cfg.sideRule === "preallocated") {
    const sides = preallocatedSideOf(teams, cfg);
    const aff = shuffle(teams.filter((t) => sides.get(t.id) === "AFF"), rng);
    const neg = shuffle(teams.filter((t) => sides.get(t.id) === "NEG"), rng);
    const rooms = avoid ? minCostPairAllocatedSides(aff, neg, history, options) : aff.map((a, i) => [a, neg[i]]);
    return rooms.map(([a, n]) => draftFor(0, { AFF: a, NEG: n } as Record<DebateSide, Team>, wins));
  }

  const rooms = minCostPairBracket(shuffle(teams, rng), history, options);
  return rooms.map((room) =>
    draftFor(0, allocateSidesForDebate(room, history.sides, format, cfg.sideRule as "balanced" | "random", cfg, rng), wins)
  );
}

/**
 * Orders teams for a seeded draw as Tabbycat's SeededDrawManager: highest
 * seed first, equal seeds in random order. Every team needs a seed.
 */
export function orderBySeed(teams: Team[], rng: Rng): Team[] {
  const unseeded = teams.filter((t) => typeof t.seed !== "number" || !Number.isFinite(t.seed));
  if (unseeded.length > 0) {
    throw new Error(
      `Every team needs a seed for a seeded draw. Missing: ${unseeded.slice(0, 5).map((t) => t.name).join(", ")}${unseeded.length > 5 ? ", ..." : ""}.`
    );
  }
  return [...shuffle(teams, rng)].sort((a, b) => (b.seed as number) - (a.seed as number));
}

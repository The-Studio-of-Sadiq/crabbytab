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
import { ClashPenalties, DEFAULT_CLASH_PENALTIES, avoidConflicts, oneUpOneDown } from "./conflictAvoidance";
import { minCostPairAllocatedSides, minCostPairBracket, MinCostPairingOptions } from "./minCostPairing";
import { PairedDebateDraft } from "./powerPaired";
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
      drawStrengthWins: m?.draw_strength_wins ?? 0,
      drawStrengthSpeaks: m?.draw_strength_speaks ?? 0,
    };
  };
  const winKeys = [...new Set(wins.values())].sort((a, b) => b - a);

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
      if (cfg.conflictAvoidance === "min_cost") {
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

  return groups.flatMap((group, index) => {
    const isTopBracket = index === 0;
    const rooms = cfg.conflictAvoidance === "min_cost"
      ? minCostPairBracket(group.teams, history, minCostOptions(cfg, history, wins, isTopBracket, rng))
      : avoidConflicts(
          pairTeams(group.teams, cfg.pairingMethod, { rng, isTopBracket }),
          history,
          cfg.conflictAvoidance,
          cfg.penalties
        );
    return rooms.map((room) =>
      draftFor(group.bracket, allocateSidesForDebate(room, history.sides, format, cfg.sideRule as "balanced" | "random", cfg, rng), wins)
    );
  });
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

import type { PairingMethod, Team } from "@/types";
import { ClashPenalties, clashCost } from "./conflictAvoidance";
import { MatchupHistory } from "./history";
import { solveHungarian } from "./hungarian";
import { pairAllocatedSides } from "./pairing";
import { Rng, shuffle } from "./rng";
import { TWO_TEAM_SIDES, sideCounts } from "./sideAllocator";
import { minCostPerfectMatching } from "./weightedMatching";

export interface MinCostPairingOptions {
  penalties: ClashPenalties;
  pairingMethod: PairingMethod;
  /** Weight of deviating from `pairingMethod`. 0: the method only breaks ties between equal-clash matchings. */
  pairingDeviationPenalty: number;
  /** Tabbycat's side_penalty; pass 0 unless sides are balanced. */
  sideBalancePenalty: number;
  /** Tabbycat's pullup_debates_penalty: rooms mixing win counts cost max(pull-up debates) × this. */
  previouslySawPullupPenalty: number;
  /** For fold_top_adjacent_rest. */
  isTopBracket: boolean;
  /** Win count per team id (to detect rooms that mix brackets). */
  wins: Map<string, number>;
  /** Hard constraint: false when the two teams have no side assignment within the side limits. */
  canMeet: (a: Team, b: Team) => boolean;
  /**
   * Soft constraint, Tabbycat's `max_times_on_one_side` in graph matching: false for rooms Tabbycat
   * would not offer. Used when some pairing avoids them all; otherwise it is dropped, so it never
   * blocks a draw, and the draw check reports the side imbalance as a warning.
   */
  preferredCanMeet?: (a: Team, b: Team) => boolean;
  /**
   * Tabbycat's `subrank`: a team's rank within its own bracket on the standings metrics after the
   * first (teams tied on every metric share one), used for the pairing-deviation cost in place of
   * the position in the bracket. Undefined for a team pulled up into the bracket, which counts as
   * last (the bracket's size), as in Tabbycat. Absent: positions 1..n in the bracket.
   */
  subrankOf?: (team: Team) => number | undefined;
  rng: Rng;
}

/** Tabbycat's GraphCostMixin pairing-deviation functions; ranks are 1-based within the bracket. */
export function pairingDeviation(method: PairingMethod, a: number, b: number, size: number, isTopBracket: boolean): number {
  switch (method) {
    case "slide":
      return Math.abs(Math.abs(a - b) - Math.floor(size / 2));
    case "fold":
      return Math.abs(a + b - 1 - size) ** 2;
    case "adjacent":
      return Math.abs(a - b) - 1;
    case "fold_top_adjacent_rest":
      return pairingDeviation(isTopBracket ? "fold" : "adjacent", a, b, size, isTopBracket);
    case "random":
      return 0;
  }
}

/** Tabbycat's side_penalty: rooms where both teams lean the same way cost the median lean. */
function sideImbalanceCost(a: Team, b: Team, history: MatchupHistory): number {
  const [aAff, aNeg] = sideCounts(history.sides.get(a.id) ?? [], TWO_TEAM_SIDES);
  const [bAff, bNeg] = sideCounts(history.sides.get(b.id) ?? [], TWO_TEAM_SIDES);
  const sameLean = Math.max(0, Math.sign(aAff - aNeg) * Math.sign(bAff - bNeg));
  const magnitude = Math.floor((Math.abs(aAff - aNeg) + Math.abs(bAff - bNeg)) / 2);
  return sameLean * magnitude;
}

export function conflictCost(a: Team, b: Team, history: MatchupHistory, options: MinCostPairingOptions): number {
  let cost = clashCost(a, b, history, options.penalties);
  cost += sideImbalanceCost(a, b, history) * options.sideBalancePenalty;
  if (options.previouslySawPullupPenalty > 0 && options.wins.get(a.id) !== options.wins.get(b.id)) {
    const seen = Math.max(history.pullupDebates?.get(a.id) ?? 0, history.pullupDebates?.get(b.id) ?? 0);
    cost += seen * options.previouslySawPullupPenalty;
  }
  return Math.round(cost);
}

function noValidPairingError(teams: Team[]): Error {
  return new Error(
    `No pairing of the ${teams.length} teams in this bracket satisfies the configured side limits. Raise or clear the side limits, or edit the draw manually.`
  );
}

/**
 * Minimum-cost conflict avoidance ("min_cost", Tabbycat's "graph" option): the
 * whole bracket is paired by an exact minimum-weight perfect matching where
 * each possible room costs its history and institution clashes, side
 * imbalance, pull-up debate history, and deviation from the configured
 * pairing method.
 *
 * Differences from Tabbycat, by design: history is a weighted penalty rather
 * than a forbidden pairing (so a bracket where every pairing is a rematch
 * still draws), and with a pairing deviation penalty of 0 the pairing method
 * still decides between equally clash-free matchings instead of being ignored.
 * Random pairing shuffles the bracket with `rng` first.
 */
export function minCostPairBracket(
  ranked: Team[],
  history: MatchupHistory,
  options: MinCostPairingOptions
): Team[][] {
  const n = ranked.length;
  if (n === 0) return [];
  const teams = options.pairingMethod === "random" ? shuffle(ranked, options.rng) : ranked;
  const rank = options.subrankOf
    ? (i: number) => options.subrankOf!(teams[i]) ?? n
    : (i: number) => i + 1;

  const rawDeviation = (i: number, j: number) =>
    pairingDeviation(options.pairingMethod, rank(i), rank(j), n, options.isTopBracket);
  // Tied subranks make Tabbycat's adjacent deviation -1; every perfect matching has n/2 rooms, so
  // shifting all deviations by the same amount keeps the optimum and the costs non-negative.
  let minDeviation = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) minDeviation = Math.min(minDeviation, rawDeviation(i, j));
  const deviation = (i: number, j: number) => rawDeviation(i, j) - minDeviation;
  let maxDeviation = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) maxDeviation = Math.max(maxDeviation, deviation(i, j));

  // With no deviation penalty, scale conflicts above any possible total deviation
  // so the pairing method acts purely as a tie-break.
  const tieBreakOnly = options.pairingDeviationPenalty <= 0;
  const conflictScale = tieBreakOnly ? (maxDeviation * n) / 2 + 1 : 1;
  const deviationWeight = tieBreakOnly ? 1 : Math.round(options.pairingDeviationPenalty);

  const solve = (preferred: (a: Team, b: Team) => boolean) => minCostPerfectMatching(n, (i, j) => {
    if (!options.canMeet(teams[i], teams[j]) || !preferred(teams[i], teams[j])) return null;
    return conflictCost(teams[i], teams[j], history, options) * conflictScale + deviation(i, j) * deviationWeight;
  });
  const pairs = (options.preferredCanMeet ? solve(options.preferredCanMeet) : null) ?? solve(() => true);
  if (!pairs) throw noValidPairingError(ranked);

  return pairs
    .map(([i, j]) => [teams[Math.min(i, j)], teams[Math.max(i, j)]])
    .sort((x, y) => ranked.indexOf(x[0]) - ranked.indexOf(y[0]))
    .map((room) => (ranked.indexOf(room[0]) <= ranked.indexOf(room[1]) ? room : [room[1], room[0]]));
}

/**
 * min_cost with preallocated sides (Tabbycat's GraphAllocatedSidesMixin): a
 * bipartite assignment of affirmative to negative teams, solved with the
 * Hungarian algorithm. Pairing deviation here is whether a room differs from
 * the configured method's allocated-sides pairing.
 */
export function minCostPairAllocatedSides(
  aff: Team[],
  neg: Team[],
  history: MatchupHistory,
  options: MinCostPairingOptions
): [Team, Team][] {
  const base = pairAllocatedSides(aff, neg, options.pairingMethod, {
    rng: options.rng,
    isTopBracket: options.isTopBracket,
  });
  const baseOpponent = new Map(base.map(([a, b]) => [a.id, b.id]));
  const tieBreakOnly = options.pairingDeviationPenalty <= 0;
  const conflictScale = tieBreakOnly ? aff.length + 1 : 1;
  const deviationWeight = tieBreakOnly ? 1 : options.pairingDeviationPenalty;

  const allowed = aff.map((a) => neg.map((b) => options.canMeet(a, b)));
  const finite = aff.map((a, i) => neg.map((b, j) =>
    allowed[i][j]
      ? conflictCost(a, b, history, options) * conflictScale + (baseOpponent.get(a.id) === b.id ? 0 : deviationWeight)
      : 0
  ));
  const disallowed = finite.reduce((sum, row) => row.reduce((rowSum, c) => rowSum + c, sum), 0) + 1;
  const matrix = finite.map((row, i) => row.map((c, j) => (allowed[i][j] ? c : disallowed)));
  const assignment = solveHungarian(matrix);
  if (assignment.some((j, i) => j < 0 || !allowed[i][j])) throw noValidPairingError([...aff, ...neg]);

  const order = new Map(base.map(([a], index) => [a.id, index]));
  return aff
    .map((a, i) => [a, neg[assignment[i]]] as [Team, Team])
    .sort((x, y) => (order.get(x[0].id) ?? 0) - (order.get(y[0].id) ?? 0));
}

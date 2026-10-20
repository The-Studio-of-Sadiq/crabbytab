import type { OddBracketMethod, PairingMethod, Team } from "@/types";
import { MatchupHistory } from "./history";
import { MinCostPairingOptions, conflictCost, minCostPairBracket, pairingDeviation } from "./minCostPairing";
import { Rng, shuffle } from "./rng";
import { minCostPerfectMatching } from "./weightedMatching";

/** What graph_one needs to know about a team, beyond the team itself. */
export interface SingleGraphTeam {
  team: Team;
  /** The bracket key (wins). */
  wins: number;
  /** Times pulled up before (Tabbycat's npullups). */
  pullups: number;
  /** Mean rank of past opponents (Tabbycat's draw_strength_rank); undefined with no opponents. */
  drawStrengthRank?: number;
}

export interface SingleGraphOptions extends Omit<MinCostPairingOptions, "isTopBracket" | "pairingMethod"> {
  pairingMethod: PairingMethod;
  oddBracketMethod: OddBracketMethod;
  /** Tabbycat's draw_pullup_penalty: × the pulled-up team's place in the odd-bracket order. */
  pullupPenalty: number;
}

/** The odd-bracket methods graph_one accepts (Tabbycat's SingleGraphPowerPairedDrawGenerator). */
export const SINGLE_GRAPH_ODD_BRACKET_METHODS: OddBracketMethod[] = [
  "pullup_top",
  "pullup_bottom",
  "pullup_middle",
  "pullup_random",
  "pullup_lowest_ds_rank",
  "pullup_lowest_ds_rank_npulls",
];

type SortKey = number[];

/** Tabbycat's pull-up sort functions: the team with the smallest key is pulled up first. */
function pullupSortKey(method: OddBracketMethod, entry: SingleGraphTeam, subrank: number, size: number): SortKey {
  const dsRank: SortKey = entry.drawStrengthRank === undefined || !Number.isFinite(entry.drawStrengthRank)
    ? [0, 0] // No opponents yet: the lowest draw strength, so pulled up first.
    : [1, -entry.drawStrengthRank];
  switch (method) {
    case "pullup_top":
      return [subrank];
    case "pullup_bottom":
      return [-subrank];
    case "pullup_middle":
      return [Math.abs(Math.floor(size / 2) - subrank)];
    case "pullup_lowest_ds_rank":
      return dsRank;
    case "pullup_lowest_ds_rank_npulls":
      return [entry.pullups, ...dsRank];
    default:
      // pullup_random: every team is equal (Tabbycat returns 0).
      return [0];
  }
}

function compareKeys(a: SortKey, b: SortKey): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const isZeroKey = (key: SortKey) => key.length === 1 && key[0] === 0;

/**
 * Tabbycat's annotate_team_pullup_precedence, literally: walking each bracket in key order, a team's
 * magnitude is the counter `i`, which increases after any team whose key differs from the
 * previous key (starting from 0). So magnitudes lag by one when the first key is exactly 0
 * (pullup_middle, pullup_random). Also returns each team's dense position in that order, used as
 * a tie-break when the pull-up penalty is 0.
 */
function pullupPrecedence(
  bracket: SingleGraphTeam[],
  method: OddBracketMethod,
  rng: Rng
): Map<string, { magnitude: number; order: number }> {
  const size = bracket.length;
  const keyed = bracket.map((entry, index) => ({ entry, key: pullupSortKey(method, entry, index + 1, size) }));
  // Python's sort is stable; teams with equal keys keep bracket (standings) order.
  const sorted = keyed.map((item, index) => ({ ...item, index })).sort((a, b) => compareKeys(a.key, b.key) || a.index - b.index);
  const result = new Map<string, { magnitude: number; order: number }>();
  let counter = 0;
  let current: SortKey = [0];
  let order = 0;
  let previous: SortKey | null = null;
  for (const { entry, key } of sorted) {
    if (previous !== null && compareKeys(previous, key) !== 0) order++;
    previous = key;
    result.set(entry.team.id, { magnitude: counter, order });
    // Tabbycat compares the new key with `current_cost`, which starts as the integer 0.
    const differs = isZeroKey(current) ? !isZeroKey(key) : compareKeys(current, key) !== 0;
    if (differs) {
      current = key;
      counter++;
    }
  }
  if (method === "pullup_random") {
    // Every team ties; the tie-break order is a seeded shuffle instead.
    shuffle(bracket, rng).forEach((entry, index) => {
      result.get(entry.team.id)!.order = index;
    });
  }
  return result;
}

function noValidDrawError(count: number): Error {
  return new Error(
    `No pairing of the ${count} teams satisfies the configured side limits with pull-ups between adjacent brackets. Raise or clear the side limits, or edit the draw manually.`
  );
}

/**
 * Tabbycat's "graph_one" conflict avoidance (SingleGraphPowerPairedDrawGenerator): one
 * minimum-cost perfect matching over the whole field that chooses the pull-ups as well as the
 * pairings. Two teams may meet if they share a bracket, or if their brackets are adjacent (no
 * non-empty bracket in between); a room mixing brackets costs, on top of the clash, side and
 * pull-up-debate costs of "min_cost":
 * - the pulled-up team's place in the odd-bracket order × `pullupPenalty` (Tabbycat's
 *   pullup_magnitude), and
 * - its pairing deviation as if it were one place below the bottom of the higher bracket.
 * Pairing deviation (× pairingDeviationPenalty) uses the higher bracket's size; as in Tabbycat,
 * fold_top_adjacent_rest is scored as adjacent everywhere (graph_one passes no bracket index).
 *
 * Where Tabbycat leaves ties to the matching library, CrabbyTab breaks them deterministically,
 * below every Tabbycat cost so its choice is always one of Tabbycat's optimal draws: first the
 * fewest rooms mixing brackets, then (pullupPenalty 0) the odd-bracket order of the pulled-up
 * teams, then (pairingDeviationPenalty 0) the pairing method within each resulting bracket.
 * History is a penalty and side limits are hard, as in "min_cost".
 *
 * `entries` must be ranked best-first. Returns rooms best-first, higher-bracket team first.
 */
export function singleGraphPair(
  entries: SingleGraphTeam[],
  history: MatchupHistory,
  options: SingleGraphOptions
): Team[][] {
  const n = entries.length;
  if (n === 0) return [];
  if (!SINGLE_GRAPH_ODD_BRACKET_METHODS.includes(options.oddBracketMethod)) {
    throw new Error(
      `Intermediate brackets need one-up-one-down (or no) conflict avoidance; with minimum-cost matching including pull-ups, choose a pull-up odd bracket method.`
    );
  }
  // Tabbycat's graph_one passes no bracket index, so fold_top_adjacent_rest scores as adjacent.
  const method: PairingMethod = options.pairingMethod === "fold_top_adjacent_rest" ? "adjacent" : options.pairingMethod;

  const winLevels = [...new Set(entries.map((entry) => entry.wins))].sort((a, b) => b - a);
  const levelIndex = new Map(winLevels.map((wins, index) => [wins, index]));
  const brackets = winLevels.map((wins) => entries.filter((entry) => entry.wins === wins));
  const subrank = new Map<string, number>();
  brackets.forEach((bracket) => bracket.forEach((entry, index) => subrank.set(entry.team.id, index + 1)));
  const precedence = new Map<string, { magnitude: number; order: number }>();
  for (const bracket of brackets) {
    for (const [id, value] of pullupPrecedence(bracket, options.oddBracketMethod, options.rng)) precedence.set(id, value);
  }
  const bracketSize = (wins: number) => brackets[levelIndex.get(wins)!].length;
  const maxBracket = Math.max(...brackets.map((bracket) => bracket.length));
  const deviationWeight = Math.max(0, Math.round(options.pairingDeviationPenalty));
  const pullupPenalty = Math.max(0, Math.round(options.pullupPenalty));
  const minCostOptions: MinCostPairingOptions = { ...options, pairingMethod: method, isTopBracket: false };

  // Tabbycat's assignment cost (null = not allowed).
  const tabbycatCost = (a: SingleGraphTeam, b: SingleGraphTeam): number | null => {
    const [hi, lo] = a.wins >= b.wins ? [a, b] : [b, a];
    if (hi.wins !== lo.wins && levelIndex.get(lo.wins)! - levelIndex.get(hi.wins)! > 1) return null;
    if (!options.canMeet(a.team, b.team)) return null;
    let cost = conflictCost(a.team, b.team, history, minCostOptions);
    const size = bracketSize(hi.wins);
    if (hi.wins !== lo.wins) {
      cost += precedence.get(lo.team.id)!.magnitude * pullupPenalty;
      if (deviationWeight > 0) cost += pairingDeviation(method, subrank.get(hi.team.id)!, size + 1, size + 1, false) * deviationWeight;
    } else if (deviationWeight > 0) {
      cost += pairingDeviation(method, subrank.get(a.team.id)!, subrank.get(b.team.id)!, size, false) * deviationWeight;
    }
    return cost;
  };

  // Tie-break below every Tabbycat cost: fewest mixed rooms, then the odd-bracket order.
  const mixedRoomCost = Math.floor(n / 2) * maxBracket + 1;
  const tieBreak = (a: SingleGraphTeam, b: SingleGraphTeam): number => {
    if (a.wins === b.wins) return 0;
    const lo = a.wins < b.wins ? a : b;
    return mixedRoomCost + (pullupPenalty === 0 ? precedence.get(lo.team.id)!.order : 0);
  };
  const tieScale = Math.floor(n / 2) * (mixedRoomCost + maxBracket) + 1;
  const pairs = minCostPerfectMatching(n, (i, j) => {
    const cost = tabbycatCost(entries[i], entries[j]);
    return cost === null ? null : cost * tieScale + tieBreak(entries[i], entries[j]);
  });
  if (!pairs) throw noValidDrawError(n);

  const rooms = pairs.map(([i, j]) => (entries[i].wins >= entries[j].wins ? [entries[i], entries[j]] : [entries[j], entries[i]]));
  const order = new Map(entries.map((entry, index) => [entry.team.id, index]));
  const byRank = (room: SingleGraphTeam[]) => order.get(room[0].team.id)!;

  if (deviationWeight > 0) {
    // The pairing method was part of the cost, so the matching is final.
    return rooms.sort((x, y) => y[0].wins - x[0].wins || byRank(x) - byRank(y)).map((room) => room.map((entry) => entry.team));
  }

  // The pairing method only breaks ties: keep the chosen pull-ups, then pair each resulting
  // bracket (its own teams, then the teams pulled up into it) by min_cost, where the pairing
  // method decides between matchings of equal cost. Pulled-up teams may not meet each other, so
  // every pull-up still faces a team of the bracket it was pulled into, and no cost Tabbycat
  // counts can rise.
  const pulledUpInto = new Map<number, SingleGraphTeam[]>();
  const pulledUpIds = new Set<string>();
  for (const [hi, lo] of rooms) {
    if (hi.wins === lo.wins) continue;
    pulledUpInto.set(hi.wins, [...(pulledUpInto.get(hi.wins) ?? []), lo]);
    pulledUpIds.add(lo.team.id);
  }
  return winLevels.flatMap((wins, index) => {
    const own = brackets[index].filter((entry) => !pulledUpIds.has(entry.team.id));
    const incoming = (pulledUpInto.get(wins) ?? []).sort((a, b) => order.get(a.team.id)! - order.get(b.team.id)!);
    const group = [...own, ...incoming].map((entry) => entry.team);
    if (group.length === 0) return [];
    const canMeet = (a: Team, b: Team) => !(pulledUpIds.has(a.id) && pulledUpIds.has(b.id)) && options.canMeet(a, b);
    return minCostPairBracket(group, history, { ...minCostOptions, canMeet, pairingDeviationPenalty: 0 });
  });
}

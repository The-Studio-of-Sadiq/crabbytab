import type { PairingMethod, Team } from "@/types";
import { Rng, shuffle } from "./rng";

export { shuffle };

export interface PairTeamsOptions {
  rng?: Rng;
  /** fold_top_adjacent_rest folds only the top bracket of the draw. Defaults to true. */
  isTopBracket?: boolean;
}

/**
 * Pairs an even-length, best-first ranked bracket into rooms of 2, as
 * Tabbycat's AustralsPairingMixin (ten-team examples):
 *
 * - slide: 1 vs 6, 2 vs 7, ..., 5 vs 10
 * - fold: 1 vs 10, 2 vs 9, ..., 5 vs 6
 * - adjacent: 1 vs 2, 3 vs 4, ...
 * - fold_top_adjacent_rest: fold in the top bracket of the draw, adjacent in
 *   every other bracket
 * - random: shuffled, then split into halves
 *
 * The first team of each returned room is from the top half of the bracket.
 */
export function pairTeams(ranked: Team[], method: PairingMethod, options: PairTeamsOptions = {}): Team[][] {
  const n = ranked.length;
  if (n === 0) return [];
  if (n % 2 !== 0) {
    throw new Error(`pairTeams requires an even number of teams, got ${n}.`);
  }
  const d = n / 2;
  const zip = (top: Team[], bottom: Team[]) => top.map((team, i) => [team, bottom[i]]);

  switch (method) {
    case "slide":
      return zip(ranked.slice(0, d), ranked.slice(d));
    case "fold":
      return zip(ranked.slice(0, d), ranked.slice(d).reverse());
    case "adjacent":
      return zip(ranked.filter((_, i) => i % 2 === 0), ranked.filter((_, i) => i % 2 === 1));
    case "fold_top_adjacent_rest":
      return pairTeams(ranked, options.isTopBracket === false ? "adjacent" : "fold", options);
    case "random": {
      const shuffled = shuffle(ranked, options.rng);
      return zip(shuffled.slice(0, d), shuffled.slice(d));
    }
    default: {
      const _exhaustive: never = method;
      throw new Error(`Unknown pairing method: ${_exhaustive}`);
    }
  }
}

/**
 * Pairs a bracket whose sides are preallocated (Tabbycat's
 * AustralsPowerPairedWithAllocatedSidesDrawGenerator): affirmative and
 * negative teams are each ranked best-first and paired across the two lists.
 * Slide pairs them in rank order, fold reverses the negative list, random
 * shuffles both. Tabbycat has no adjacent variant here; adjacent behaves as
 * slide (the lists are already separate), and fold_top_adjacent_rest folds
 * the top bracket and slides the rest.
 */
export function pairAllocatedSides(
  aff: Team[],
  neg: Team[],
  method: PairingMethod,
  options: PairTeamsOptions = {}
): [Team, Team][] {
  if (aff.length !== neg.length) {
    throw new Error(`An allocated-sides bracket has ${aff.length} affirmative but ${neg.length} negative teams.`);
  }
  let affOrder = aff;
  let negOrder = neg;
  if (method === "fold" || (method === "fold_top_adjacent_rest" && options.isTopBracket !== false)) {
    negOrder = [...neg].reverse();
  } else if (method === "random") {
    affOrder = shuffle(aff, options.rng);
    negOrder = shuffle(neg, options.rng);
  }
  return affOrder.map((team, i) => [team, negOrder[i]]);
}

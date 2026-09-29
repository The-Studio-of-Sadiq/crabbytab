import type { PairingMethod, Team } from "@/types";

/** Uniform Fisher-Yates shuffle (unlike `sort(() => Math.random() - 0.5)`, which is biased). */
export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Pairs an even-length, best-first ranked list of teams into rooms of 2.
 *
 * - adjacent: 1v2, 3v4, ...
 * - slide: top half vs bottom half in rank order (1 vs n/2+1, 2 vs n/2+2, ...)
 * - fold: strongest vs weakest (1 vs n, 2 vs n-1, ...)
 * - fold_top_adjacent_rest: the single best team plays the single weakest team
 *   (fold, but only for the top room); everyone else in the bracket is paired
 *   adjacently.
 * - random: teams are shuffled, then paired adjacently.
 */
export function pairTeams(ranked: Team[], method: PairingMethod): Team[][] {
  const n = ranked.length;
  if (n === 0) return [];
  if (n % 2 !== 0) {
    throw new Error(`pairTeams requires an even number of teams, got ${n}.`);
  }
  const d = n / 2;

  switch (method) {
    case "adjacent": {
      const rooms: Team[][] = [];
      for (let i = 0; i < d; i++) rooms.push([ranked[2 * i], ranked[2 * i + 1]]);
      return rooms;
    }
    case "random": {
      const shuffled = shuffle(ranked);
      const rooms: Team[][] = [];
      for (let i = 0; i < d; i++) rooms.push([shuffled[2 * i], shuffled[2 * i + 1]]);
      return rooms;
    }
    case "slide": {
      const rooms: Team[][] = [];
      for (let i = 0; i < d; i++) rooms.push([ranked[i], ranked[d + i]]);
      return rooms;
    }
    case "fold": {
      const rooms: Team[][] = [];
      for (let i = 0; i < d; i++) rooms.push([ranked[i], ranked[n - 1 - i]]);
      return rooms;
    }
    case "fold_top_adjacent_rest": {
      const rooms: Team[][] = [[ranked[0], ranked[n - 1]]];
      const rest = ranked.slice(1, n - 1);
      for (let i = 0; i < rest.length; i += 2) rooms.push([rest[i], rest[i + 1]]);
      return rooms;
    }
    default: {
      const _exhaustive: never = method;
      throw new Error(`Unknown pairing method: ${_exhaustive}`);
    }
  }
}

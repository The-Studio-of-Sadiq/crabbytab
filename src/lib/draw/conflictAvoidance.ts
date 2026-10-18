import type { ConflictAvoidance, Team } from "@/types";
import { MatchupHistory, sameInstitution, timesMet } from "./history";

export interface ClashPenalties {
  /** Per previous meeting; 0 turns history avoidance off. */
  repeatMatchupPenalty: number;
  /** 0 turns institution avoidance off. */
  institutionClashPenalty: number;
}

export const DEFAULT_CLASH_PENALTIES: ClashPenalties = {
  repeatMatchupPenalty: 1000,
  institutionClashPenalty: 200,
};

/** Clash cost of one room: meetings × history penalty, plus the institution penalty. */
export function clashCost(a: Team, b: Team, history: MatchupHistory, penalties: ClashPenalties): number {
  let cost = 0;
  if (penalties.repeatMatchupPenalty > 0) cost += timesMet(history, a, b) * penalties.repeatMatchupPenalty;
  if (penalties.institutionClashPenalty > 0 && sameInstitution(a, b)) cost += penalties.institutionClashPenalty;
  return cost;
}

/**
 * Picks the best set of non-overlapping adjacent swaps: given the gain of
 * swapping each room with the one below (data[i] for rooms i and i+1),
 * returns the indices maximising the total gain such that no two chosen swaps
 * share a room. Negative gains are never chosen. (Tabbycat's
 * OneUpOneDownSwapper.dp, written as a standard take/skip recurrence.)
 */
export function bestSwapSet(data: number[]): number[] {
  const n = data.length;
  const best = new Array<number>(n + 2).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    best[i] = Math.max(best[i + 1], data[i] + best[i + 2]);
  }
  const chosen: number[] = [];
  for (let i = 0; i < n; ) {
    if (data[i] + best[i + 2] > best[i + 1]) {
      chosen.push(i);
      i += 2;
    } else {
      i += 1;
    }
  }
  return chosen;
}

/**
 * Australasian one-up-one-down, as Tabbycat's OneUpOneDownSwapper: each
 * pair of adjacent rooms (A1 v N1, A2 v N2) may swap their second teams to
 * become (A1 v N2, A2 v N1). The gain of a swap is the clash cost removed;
 * a swap is excluded when neither room has a clash, or when it would add
 * history conflicts. The best non-overlapping set of swaps is applied, with
 * a tiny bias towards fewer swaps and towards swaps higher in the bracket.
 */
export function oneUpOneDown(rooms: Team[][], history: MatchupHistory, penalties: ClashPenalties): Team[][] {
  const result = rooms.map((room) => [...room]);
  const meetings = (a: Team, b: Team) => (penalties.repeatMatchupPenalty > 0 ? timesMet(history, a, b) : 0);
  const institution = (a: Team, b: Team) => (penalties.institutionClashPenalty > 0 && sameInstitution(a, b) ? 1 : 0);
  const badness = (inst: number, hist: number) =>
    inst * penalties.institutionClashPenalty + hist * penalties.repeatMatchupPenalty;

  const gains = result.slice(0, -1).map(([a1, n1], i) => {
    const [a2, n2] = result[i + 1];
    const inst = institution(a1, n1) + institution(a2, n2);
    const hist = meetings(a1, n1) + meetings(a2, n2);
    if (inst === 0 && hist === 0) return -Infinity;
    const histSwapped = meetings(a1, n2) + meetings(a2, n1);
    if (histSwapped > hist) return -Infinity;
    const instSwapped = institution(a1, n2) + institution(a2, n1);
    const gain = badness(inst, hist) - badness(instSwapped, histSwapped) - 1e-3;
    return gain > 0 ? gain + (result.length - 1 - i) * 1e-6 : gain;
  });

  for (const i of bestSwapSet(gains)) {
    const [a1, n1] = result[i];
    const [a2, n2] = result[i + 1];
    result[i] = [a1, n2];
    result[i + 1] = [a2, n1];
  }
  return result;
}

/**
 * Applies post-pairing conflict avoidance to one bracket's rooms. "min_cost"
 * is not a post-processing step: it replaces the pairing itself (see
 * minCostPairing.ts), so rooms are returned unchanged here.
 */
export function avoidConflicts(
  rooms: Team[][],
  history: MatchupHistory,
  strategy: ConflictAvoidance,
  penalties: ClashPenalties = DEFAULT_CLASH_PENALTIES
): Team[][] {
  return strategy === "one_up_one_down" ? oneUpOneDown(rooms, history, penalties) : rooms;
}

import type { ConflictAvoidance, Team } from "@/types";
import { MatchupHistory, sameInstitution, timesMet } from "./history";
import { randomInt, type Rng } from "./rng";

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

/**
 * Tabbycat's one-up-one-down debate flags (powerpair.py _one_up_one_down): for every room the
 * swaps changed, "1u1d_hist" when its original pairing had met before, "1u1d_inst" when it was
 * same-institution, "1u1d_other" when it had neither (it was swapped to accommodate a neighbour).
 * Returns the flags per room index (empty for unchanged rooms).
 */
export function oneUpOneDownFlags(original: Team[][], swapped: Team[][], history: MatchupHistory): string[][] {
  return original.map((room, index) => {
    const after = swapped[index];
    if (!after || room.every((team, slot) => after[slot]?.id === team.id)) return [];
    const [a, b] = room;
    const flags: string[] = [];
    const hist = timesMet(history, a, b) > 0;
    const inst = sameInstitution(a, b);
    if (hist) flags.push("1u1d_hist");
    if (inst) flags.push("1u1d_inst");
    if (!hist && !inst) flags.push("1u1d_other");
    return flags;
  });
}

/**
 * Tabbycat's SwapRandomDrawGenerator conflict avoidance (random.py SwapRandomDrawMixin): rooms
 * of a random draw are taken in order; a room with a clash tries up to `maxAttempts` times to swap
 * its second team with that of a room chosen at random, keeping a swap that removes the clash
 * (or improves the pair without leaving the other room clashing). A room that runs out of
 * attempts is flagged "max_swapped". Clashes are yes/no: a history clash costs the history
 * penalty, an institution clash the institution penalty; a zero penalty switches that check off,
 * and with both off nothing is swapped. Second teams keep their position, so preallocated sides
 * are kept. Returns the rooms and the debate flags per room.
 */
export function swapRandomRooms(
  rooms: Team[][],
  history: MatchupHistory,
  penalties: ClashPenalties,
  rng: Rng,
  maxAttempts = 20
): { rooms: Team[][]; flags: string[][] } {
  const result = rooms.map((room) => [...room]);
  const flags: string[][] = result.map(() => []);
  const avoidHistory = penalties.repeatMatchupPenalty > 0;
  const avoidInstitution = penalties.institutionClashPenalty > 0;
  if (!avoidHistory && !avoidInstitution) return { rooms: result, flags };
  const badness = (...indices: number[]) =>
    indices.reduce((score, index) => {
      const [a, b] = result[index];
      if (avoidHistory && timesMet(history, a, b) > 0) score += penalties.repeatMatchupPenalty;
      if (avoidInstitution && sameInstitution(a, b)) score += penalties.institutionClashPenalty;
      return score;
    }, 0);
  const swapSecond = (i: number, j: number) => {
    [result[i][1], result[j][1]] = [result[j][1], result[i][1]];
  };
  result.forEach((_, index) => {
    if (badness(index) <= 0) return;
    let resolved = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const other = randomInt(rng, result.length);
      if (other === index) continue;
      const before = badness(index, other);
      swapSecond(index, other);
      const after = badness(index, other);
      if (after === 0) {
        resolved = true;
        break;
      }
      // Keep an improvement that leaves the other room clean; otherwise swap back and retry.
      if (after >= before || badness(other) > 0) swapSecond(index, other);
    }
    if (!resolved) flags[index].push("max_swapped");
  });
  return { rooms: result, flags };
}

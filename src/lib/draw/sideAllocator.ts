import { Team, DebateSide, BPSide, TwoTeamSide } from "@/types";
import { solveHungarian } from "./hungarian";

export interface TeamSideHistory {
  teamId: string;
  sides: DebateSide[];
}

export interface SideAllocationOptions {
  bpPositionCost?: "renyi_entropy" | "sum_squared_deviations";
  renyiOrder?: number;
  bpPositionCostExponent?: number;
  bpAssignmentMethod?: "hungarian" | "random";
  sideBalancePenalty?: number;
  maxTimesPerSide?: number;
  maxAllowedSideImbalance?: number;
}

const BP_SIDES: BPSide[] = ["OG", "OO", "CG", "CO"];
const TWO_TEAM_SIDES: TwoTeamSide[] = ["AFF", "NEG"];

/**
 * Calculates BP position cost using Rényi entropy or sum of squared deviations,
 * raised to bpPositionCostExponent, with side balance and hard maxTimesPerSide preference.
 */
export function computeBPSideCost(
  history: DebateSide[],
  candidateSide: BPSide,
  options?: SideAllocationOptions
): number {
  let og = 0, oo = 0, cg = 0, co = 0;
  for (const s of history) {
    if (s === "OG") og++;
    else if (s === "OO") oo++;
    else if (s === "CG") cg++;
    else if (s === "CO") co++;
  }

  if (candidateSide === "OG") og++;
  else if (candidateSide === "OO") oo++;
  else if (candidateSide === "CG") cg++;
  else if (candidateSide === "CO") co++;

  const counts = [og, oo, cg, co];
  const total = og + oo + cg + co;
  const maxTimes = options?.maxTimesPerSide ?? 5;
  const maxAllowedImbalance = options?.maxAllowedSideImbalance ?? 0;
  const balancePenaltyWeight = options?.sideBalancePenalty ?? 0;

  // Hard preference: disallow exceeding maxTimesPerSide
  const candidateCount = candidateSide === "OG" ? og : candidateSide === "OO" ? oo : candidateSide === "CG" ? cg : co;
  let hardPenalty = 0;
  if (candidateCount > maxTimes) {
    hardPenalty += 1_000_000;
  }

  // Side imbalance limit (if enabled, > 0)
  const maxCount = Math.max(...counts);
  const minCount = Math.min(...counts);
  const imbalance = maxCount - minCount;
  if (maxAllowedImbalance > 0 && imbalance > maxAllowedImbalance) {
    hardPenalty += 1_000_000;
  }

  // Base cost calculation
  let baseCost = 0;
  const costFunction = options?.bpPositionCost ?? "renyi_entropy";

  if (costFunction === "sum_squared_deviations") {
    const mean = total / 4;
    baseCost = counts.reduce((acc, c) => acc + Math.pow(c - mean, 2), 0);
  } else {
    // Rényi entropy: Shannon (alpha=1), Hartley (alpha=0), Collision (alpha=2), etc.
    const alpha = options?.renyiOrder ?? 1.0;
    const probs = counts.map((c) => c / total);

    if (Math.abs(alpha - 1.0) < 0.001) {
      let shannon = 0;
      for (const p of probs) {
        if (p > 0) shannon -= p * Math.log(p);
      }
      baseCost = Math.max(0, Math.log(4) - shannon);
    } else if (alpha === 0) {
      const nonZero = probs.filter((p) => p > 0).length;
      const h0 = Math.log(Math.max(1, nonZero));
      baseCost = Math.max(0, Math.log(4) - h0);
    } else if (Math.abs(alpha - 2.0) < 0.001) {
      const sumP2 = probs.reduce((acc, p) => acc + p * p, 0);
      const h2 = -Math.log(Math.max(1e-9, sumP2));
      baseCost = Math.max(0, Math.log(4) - h2);
    } else {
      const sumPAlpha = probs.reduce((acc, p) => acc + Math.pow(p, alpha), 0);
      const hAlpha = (1 / (1 - alpha)) * Math.log(Math.max(1e-9, sumPAlpha));
      baseCost = Math.max(0, Math.log(4) - hAlpha);
    }
  }

  const exponent = options?.bpPositionCostExponent ?? 4.0;
  let cost = Math.pow(baseCost, exponent) * 1000 + hardPenalty;

  if (balancePenaltyWeight > 0) {
    const gov = og + cg;
    const opp = oo + co;
    cost += Math.abs(gov - opp) * balancePenaltyWeight;
  }

  // Consecutive side repetition penalty
  if (history.length > 0 && history[history.length - 1] === candidateSide) {
    cost += 15;
  }

  return cost;
}

/**
 * Calculates a penalty for assigning a team to a given side based on past side history.
 * Aims to balance Gov vs Opp and Opening vs Closing (or AFF vs NEG).
 */
export function calculateSidePenalty(history: DebateSide[], candidateSide: DebateSide, format: "bp" | "uadc" | string): number {
  if (format === "bp") {
    let og = 0, oo = 0, cg = 0, co = 0;
    for (const s of history) {
      if (s === "OG") og++;
      else if (s === "OO") oo++;
      else if (s === "CG") cg++;
      else if (s === "CO") co++;
    }

    const gov = og + cg;
    const opp = oo + co;
    const opening = og + oo;
    const closing = cg + co;

    let penalty = 0;

    // Penalize same side repetition
    if (history.length > 0 && history[history.length - 1] === candidateSide) {
      penalty += 15;
    }

    // Penalize exact side imbalance
    if (candidateSide === "OG") {
      penalty += og * 10;
      if (gov > opp) penalty += 5;
      if (opening > closing) penalty += 5;
    } else if (candidateSide === "OO") {
      penalty += oo * 10;
      if (opp > gov) penalty += 5;
      if (opening > closing) penalty += 5;
    } else if (candidateSide === "CG") {
      penalty += cg * 10;
      if (gov > opp) penalty += 5;
      if (closing > opening) penalty += 5;
    } else if (candidateSide === "CO") {
      penalty += co * 10;
      if (opp > gov) penalty += 5;
      if (closing > opening) penalty += 5;
    }

    return penalty;
  } else {
    // 2-team format (AFF / NEG)
    let aff = 0, neg = 0;
    for (const s of history) {
      if (s === "AFF") aff++;
      else if (s === "NEG") neg++;
    }

    let penalty = 0;
    if (history.length > 0 && history[history.length - 1] === candidateSide) {
      penalty += 10;
    }
    if (candidateSide === "AFF") {
      penalty += aff * 15;
      if (aff > neg) penalty += 10;
    } else {
      penalty += neg * 15;
      if (neg > aff) penalty += 10;
    }
    return penalty;
  }
}

/**
 * Assigns sides to a group of 4 teams (BP) or 2 teams (2-team format) minimizing cumulative side penalties.
 */
export function allocateSidesForDebate(
  teams: Team[],
  teamHistories: Map<string, DebateSide[]>,
  format: "bp" | "uadc" | string,
  rule: "balanced" | "random" = "balanced",
  options?: SideAllocationOptions
): Record<DebateSide, Team> {
  const isBP = format === "bp";
  const sides = isBP ? BP_SIDES : TWO_TEAM_SIDES;

  if (teams.length !== sides.length) {
    throw new Error(`Expected ${sides.length} teams for side allocation, got ${teams.length}`);
  }

  if (rule === "random" || (isBP && options?.bpAssignmentMethod === "random")) {
    const shuffledSides = [...sides].sort(() => Math.random() - 0.5);
    const result: Partial<Record<DebateSide, Team>> = {};
    for (let i = 0; i < teams.length; i++) {
      result[shuffledSides[i]] = teams[i];
    }
    return result as Record<DebateSide, Team>;
  }

  if (isBP) {
    // WUDC-compliant Hungarian algorithm with preshuffling
    const shuffledSides = [...BP_SIDES].sort(() => Math.random() - 0.5);
    const costMatrix: number[][] = [];
    for (let i = 0; i < teams.length; i++) {
      const history = teamHistories.get(teams[i].id) || [];
      const row: number[] = [];
      for (let j = 0; j < shuffledSides.length; j++) {
        row.push(computeBPSideCost(history, shuffledSides[j], options));
      }
      costMatrix.push(row);
    }
    const matching = solveHungarian(costMatrix);
    const result: Partial<Record<DebateSide, Team>> = {};
    for (let i = 0; i < teams.length; i++) {
      const assignedSide = shuffledSides[matching[i]];
      result[assignedSide] = teams[i];
    }
    return result as Record<DebateSide, Team>;
  }

  // Generate all permutations of sides
  const permutations: DebateSide[][] = getPermutations(sides);
  let bestPermutation = permutations[0];
  let minPenalty = Infinity;

  for (const perm of permutations) {
    let penalty = 0;
    for (let i = 0; i < teams.length; i++) {
      const history = teamHistories.get(teams[i].id) || [];
      penalty += calculateSidePenalty(history, perm[i], format);
      const sideCount = history.filter((s) => s === perm[i]).length + 1;
      if (options?.maxTimesPerSide && sideCount > options.maxTimesPerSide) {
        penalty += 1_000_000;
      }
    }
    if (penalty < minPenalty) {
      minPenalty = penalty;
      bestPermutation = perm;
    }
  }

  const result: Partial<Record<DebateSide, Team>> = {};
  for (let i = 0; i < teams.length; i++) {
    result[bestPermutation[i]] = teams[i];
  }

  return result as Record<DebateSide, Team>;
}

function getPermutations<T>(array: T[]): T[][] {
  if (array.length <= 1) return [array];
  const result: T[][] = [];
  for (let i = 0; i < array.length; i++) {
    const current = array[i];
    const remaining = [...array.slice(0, i), ...array.slice(i + 1)];
    const perms = getPermutations(remaining);
    for (const p of perms) {
      result.push([current, ...p]);
    }
  }
  return result;
}

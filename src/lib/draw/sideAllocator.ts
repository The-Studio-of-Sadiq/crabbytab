import { Team, DebateSide, BPSide, TwoTeamSide, BPPositionCost } from "@/types";
import { shuffle } from "./pairing";

export interface TeamSideHistory {
  teamId: string;
  sides: DebateSide[];
}

export interface SideAllocationOptions {
  bpPositionCost?: BPPositionCost;
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
 * Calculates BP position cost using Rényi entropy or a squared-deviation penalty.
 * The latter sums squared differences between each side count and the mean; it is
 * an optimization cost, not a statistical standard deviation. The selected base
 * cost is raised to bpPositionCostExponent and scaled before other penalties apply.
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
  const balancePenaltyWeight = options?.sideBalancePenalty ?? 0;

  // Base cost calculation
  let baseCost = 0;
  // Keep reading persisted preferences written with the former "std_dev" value.
  const costFunction: string = options?.bpPositionCost ?? "renyi_entropy";

  if (costFunction === "sum_squared_deviations" || costFunction === "std_dev") {
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
  // Exponent and scale control optimization weight; this is not a reported statistic.
  let cost = Math.pow(baseCost, exponent) * 1000;

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

  const permutations = getPermutations(sides).filter((assignment) =>
    isSideAssignmentValid(teams, assignment, teamHistories, options)
  );
  if (permutations.length === 0) {
    throw new Error("No side assignment satisfies the configured side limits.");
  }

  const randomAssignment = rule === "random" || (isBP && options?.bpAssignmentMethod === "random");
  const candidates = shuffle(permutations);
  if (randomAssignment) {
    return makeSideAssignment(teams, candidates[0]);
  }

  let bestPermutation = candidates[0];
  let minPenalty = Infinity;

  for (const perm of candidates) {
    let penalty = 0;
    for (let i = 0; i < teams.length; i++) {
      const history = teamHistories.get(teams[i].id) || [];
      penalty += isBP
        ? computeBPSideCost(history, perm[i] as BPSide, options)
        : calculateSidePenalty(history, perm[i], format);
    }
    if (penalty < minPenalty) {
      minPenalty = penalty;
      bestPermutation = perm;
    }
  }

  return makeSideAssignment(teams, bestPermutation);
}

function isSideAssignmentValid(
  teams: Team[],
  assignment: DebateSide[],
  teamHistories: Map<string, DebateSide[]>,
  options?: SideAllocationOptions
): boolean {
  const maxTimes = options?.maxTimesPerSide ?? 5;
  const maxAllowedImbalance = options?.maxAllowedSideImbalance ?? 0;

  return teams.every((team, index) => {
    const history = teamHistories.get(team.id) ?? [];
    const side = assignment[index];
    if (history.filter((pastSide) => pastSide === side).length + 1 > maxTimes) return false;
    if (maxAllowedImbalance <= 0) return true;

    const sideCounts = assignment.length === BP_SIDES.length
      ? BP_SIDES.map((candidateSide) =>
          history.filter((pastSide) => pastSide === candidateSide).length +
          Number(candidateSide === side)
        )
      : TWO_TEAM_SIDES.map((candidateSide) =>
          history.filter((pastSide) => pastSide === candidateSide).length +
          Number(candidateSide === side)
        );
    return Math.max(...sideCounts) - Math.min(...sideCounts) <= maxAllowedImbalance;
  });
}

function makeSideAssignment(
  teams: Team[],
  assignment: DebateSide[]
): Record<DebateSide, Team> {
  const result: Partial<Record<DebateSide, Team>> = {};
  for (let i = 0; i < teams.length; i++) {
    result[assignment[i]] = teams[i];
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

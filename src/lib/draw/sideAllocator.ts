import { Team, DebateSide, BPSide, TwoTeamSide, BPPositionCost } from "@/types";
import { Rng, randomInt, shuffle } from "./rng";

export interface TeamSideHistory {
  teamId: string;
  sides: DebateSide[];
}

export interface SideAllocationOptions {
  bpPositionCost?: BPPositionCost;
  renyiOrder?: number;
  bpPositionCostExponent?: number;
  bpAssignmentMethod?: "hungarian" | "random";
  maxTimesPerSide?: number;
  maxAllowedSideImbalance?: number;
}

export const BP_SIDES: BPSide[] = ["OG", "OO", "CG", "CO"];
export const TWO_TEAM_SIDES: TwoTeamSide[] = ["AFF", "NEG"];

/** How many times the team has been in each of `sides`, in that order. */
export function sideCounts(history: DebateSide[], sides: readonly DebateSide[]): number[] {
  return sides.map((side) => history.filter((past) => past === side).length);
}

/**
 * Base BP position cost of placing a team in `side`, before the exponent,
 * following Tabbycat's BPHungarianDrawGenerator:
 *
 * - renyi_entropy: C = n·[2 − H_α(p)], where p is the team's position
 *   distribution *after* this round, n its number of rounds, and H_α the
 *   Rényi entropy of order α in bits (α = 1 Shannon, α = 0 Hartley).
 * - sum_squared_deviations: Σ (count − mean)² over the four positions after
 *   this round (4 × Tabbycat's "variance" option, which only rescales it).
 */
export function bpPositionBaseCost(
  history: DebateSide[],
  side: BPSide,
  options: Pick<SideAllocationOptions, "bpPositionCost" | "renyiOrder"> = {}
): number {
  const counts = sideCounts(history, BP_SIDES);
  counts[BP_SIDES.indexOf(side)] += 1;
  const n = counts.reduce((sum, c) => sum + c, 0);

  // "std_dev" is the pre-rename value of sum_squared_deviations in saved preferences.
  const costFunction: string = options.bpPositionCost ?? "renyi_entropy";
  if (costFunction === "sum_squared_deviations" || costFunction === "std_dev") {
    const mean = n / 4;
    return counts.reduce((sum, c) => sum + (c - mean) ** 2, 0);
  }

  const alpha = options.renyiOrder ?? 1;
  if (!Number.isFinite(alpha) || alpha < 0) {
    throw new Error(`The Rényi order can't be negative (it is ${alpha}).`);
  }
  const probs = counts.map((c) => c / n);
  let entropy: number;
  if (alpha === 1) {
    entropy = -probs.reduce((sum, p) => (p > 0 ? sum + p * Math.log2(p) : sum), 0);
  } else if (alpha === 0) {
    entropy = Math.log2(probs.filter((p) => p > 0).length);
  } else {
    entropy = Math.log2(probs.reduce((sum, p) => sum + p ** alpha, 0)) / (1 - alpha);
  }
  // Clamp float noise (e.g. -1e-16) so exponentiation stays real.
  return Math.max(0, (2 - entropy) * n);
}

/** Base cost raised to `bpPositionCostExponent` (default 4), as Tabbycat does. */
export function computeBPSideCost(
  history: DebateSide[],
  candidateSide: BPSide,
  options: SideAllocationOptions = {}
): number {
  return bpPositionBaseCost(history, candidateSide, options) ** (options.bpPositionCostExponent ?? 4);
}

/**
 * Hard side limits: placing a team in `side` must not take it past
 * `maxTimesPerSide`, nor leave its most- and least-used sides more than
 * `maxAllowedSideImbalance` apart (0 disables that limit).
 */
export function violatesSideLimits(
  history: DebateSide[],
  side: DebateSide,
  sides: readonly DebateSide[],
  options: Pick<SideAllocationOptions, "maxTimesPerSide" | "maxAllowedSideImbalance"> = {}
): boolean {
  const counts = sideCounts(history, sides);
  counts[sides.indexOf(side)] += 1;
  if (counts[sides.indexOf(side)] > (options.maxTimesPerSide ?? 5)) return true;
  const maxImbalance = options.maxAllowedSideImbalance ?? 0;
  return maxImbalance > 0 && Math.max(...counts) - Math.min(...counts) > maxImbalance;
}

export function describeSideLimits(options: Pick<SideAllocationOptions, "maxTimesPerSide" | "maxAllowedSideImbalance">): string {
  const parts = [`at most ${options.maxTimesPerSide ?? 5} times per side`];
  if ((options.maxAllowedSideImbalance ?? 0) > 0) {
    parts.push(`a side imbalance of at most ${options.maxAllowedSideImbalance}`);
  }
  return parts.join(" and ");
}

/**
 * Two-team side balance, as Tabbycat's Pairing.balance_sides: the team that
 * has been affirmative more often (relative to negative) goes negative; equal
 * imbalances are decided at random. The hard side limits are then checked, and
 * the other orientation is used only if the balanced one breaks a limit.
 */
function balanceTwoTeamSides(
  teams: Team[],
  teamHistories: Map<string, DebateSide[]>,
  random: boolean,
  options: SideAllocationOptions,
  rng: Rng
): Record<DebateSide, Team> {
  const imbalance = (team: Team) => {
    const [aff, neg] = sideCounts(teamHistories.get(team.id) ?? [], TWO_TEAM_SIDES);
    return aff - neg;
  };
  let [affTeam, negTeam] = teams;
  const firstImbalance = imbalance(teams[0]);
  const secondImbalance = imbalance(teams[1]);
  if (random || firstImbalance === secondImbalance) {
    if (randomInt(rng, 2) === 1) [affTeam, negTeam] = [negTeam, affTeam];
  } else if (secondImbalance < firstImbalance) {
    [affTeam, negTeam] = [negTeam, affTeam];
  }

  const valid = (aff: Team, neg: Team) =>
    !violatesSideLimits(teamHistories.get(aff.id) ?? [], "AFF", TWO_TEAM_SIDES, options) &&
    !violatesSideLimits(teamHistories.get(neg.id) ?? [], "NEG", TWO_TEAM_SIDES, options);
  if (!valid(affTeam, negTeam)) {
    if (!valid(negTeam, affTeam)) {
      throw new Error(
        `No side assignment for ${teams[0].name} vs ${teams[1].name} satisfies the configured side limits (${describeSideLimits(options)}).`
      );
    }
    [affTeam, negTeam] = [negTeam, affTeam];
  }
  return { AFF: affTeam, NEG: negTeam } as Record<DebateSide, Team>;
}

/**
 * Assigns sides within one already-formed room. Two-team rooms use Tabbycat's
 * balance rule; BP rooms (random-draw rounds only; power-paired BP assigns
 * rooms and positions together in powerPaired.ts) take the cheapest of the 24
 * position permutations under the configured position cost, with ties broken
 * by `rng`. `rule: "random"` ignores history but still honours the side limits.
 */
export function allocateSidesForDebate(
  teams: Team[],
  teamHistories: Map<string, DebateSide[]>,
  format: "bp" | "uadc" | string,
  rule: "balanced" | "random" = "balanced",
  options: SideAllocationOptions = {},
  rng: Rng = Math.random
): Record<DebateSide, Team> {
  const isBP = format === "bp";
  const sides = isBP ? BP_SIDES : TWO_TEAM_SIDES;

  if (teams.length !== sides.length) {
    throw new Error(`Expected ${sides.length} teams for side allocation, got ${teams.length}`);
  }
  if (!isBP) return balanceTwoTeamSides(teams, teamHistories, rule === "random", options, rng);

  const permutations = shuffle(getPermutations(BP_SIDES), rng).filter((assignment) =>
    teams.every((team, index) =>
      !violatesSideLimits(teamHistories.get(team.id) ?? [], assignment[index], BP_SIDES, options)
    )
  );
  if (permutations.length === 0) {
    throw new Error(`No side assignment satisfies the configured side limits (${describeSideLimits(options)}).`);
  }
  if (rule === "random" || options.bpAssignmentMethod === "random") {
    return makeSideAssignment(teams, permutations[0]);
  }

  let best = permutations[0];
  let bestCost = Infinity;
  for (const permutation of permutations) {
    const cost = teams.reduce(
      (sum, team, index) => sum + computeBPSideCost(teamHistories.get(team.id) ?? [], permutation[index], options),
      0
    );
    if (cost < bestCost) {
      bestCost = cost;
      best = permutation;
    }
  }
  return makeSideAssignment(teams, best);
}

function makeSideAssignment(teams: Team[], assignment: DebateSide[]): Record<DebateSide, Team> {
  const result: Partial<Record<DebateSide, Team>> = {};
  teams.forEach((team, index) => {
    result[assignment[index]] = team;
  });
  return result as Record<DebateSide, Team>;
}

function getPermutations<T>(array: T[]): T[][] {
  if (array.length <= 1) return [array];
  return array.flatMap((current, i) =>
    getPermutations([...array.slice(0, i), ...array.slice(i + 1)]).map((rest) => [current, ...rest])
  );
}

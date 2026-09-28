import { Team, DebateSide, BPSide, TwoTeamSide } from "@/types";

export interface TeamSideHistory {
  teamId: string;
  sides: DebateSide[];
}

const BP_SIDES: BPSide[] = ["OG", "OO", "CG", "CO"];
const TWO_TEAM_SIDES: TwoTeamSide[] = ["AFF", "NEG"];

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
  rule: "balanced" | "random" = "balanced"
): Record<DebateSide, Team> {
  const isBP = format === "bp";
  const sides = isBP ? BP_SIDES : TWO_TEAM_SIDES;

  if (teams.length !== sides.length) {
    throw new Error(`Expected ${sides.length} teams for side allocation, got ${teams.length}`);
  }

  if (rule === "random") {
    const shuffledSides = [...sides].sort(() => Math.random() - 0.5);
    const result: Partial<Record<DebateSide, Team>> = {};
    for (let i = 0; i < teams.length; i++) {
      result[shuffledSides[i]] = teams[i];
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

import { Team, DebateSide } from "@/types";
import { allocateSidesForDebate, SideAllocationOptions } from "./sideAllocator";

export interface RoundRobinMatchup {
  bracket: number;
  teamsWithSides: Record<DebateSide, Team>;
}

/**
 * Standard circle method for round-robin scheduling (2-team debate formats only).
 * If total number of teams N is odd, a dummy bye team is needed; however in debating
 * team count must be even (divisible by 2).
 *
 * For round k (1-indexed, seq):
 * In the circle method, team 0 stays fixed. Teams 1 to N-1 rotate.
 * Total unique rounds in full round-robin = N - 1.
 * Rotation offset for round `roundSeq` is (roundSeq - 1) % (N - 1).
 */
export function generateRoundRobinDraw(
  teams: Team[],
  roundSeq: number,
  sideHistories: Map<string, DebateSide[]>,
  format: string,
  sideRule: "balanced" | "random" = "balanced",
  sideOptions?: SideAllocationOptions
): RoundRobinMatchup[] {
  const n = teams.length;
  if (n % 2 !== 0) {
    throw new Error(`Round-robin requires an even number of teams, got ${n}.`);
  }
  if (n < 2) {
    throw new Error("At least 2 teams are required for round-robin.");
  }

  // Indices: 0 is fixed. Rest rotate: [1, 2, ..., n-1]
  const rotating = teams.slice(1);
  const offset = (roundSeq - 1) % (n - 1);

  // Rotate clockwise by offset:
  // e.g. for offset=1, [1, 2, 3] -> [3, 1, 2]
  const rotated: Team[] = [];
  for (let i = 0; i < rotating.length; i++) {
    const idx = (i - offset + rotating.length * 100) % rotating.length;
    rotated.push(rotating[idx]);
  }

  const roundOrder = [teams[0], ...rotated];
  const matchups: RoundRobinMatchup[] = [];
  const numMatches = n / 2;

  for (let i = 0; i < numMatches; i++) {
    const t1 = roundOrder[i];
    const t2 = roundOrder[n - 1 - i];
    const teamsWithSides = allocateSidesForDebate([t1, t2], sideHistories, format, sideRule, sideOptions);
    matchups.push({
      bracket: 0,
      teamsWithSides,
    });
  }

  return matchups;
}

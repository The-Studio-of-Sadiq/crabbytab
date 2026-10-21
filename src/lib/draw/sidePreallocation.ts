import type { Debate, TwoTeamSide } from "@/types";
import { createSeededRng, shuffle } from "./rng";
import { sidesPending } from "./manualSides";

/** Team id -> side, as Round.preallocatedSides. */
export type SideMap = Record<string, TwoTeamSide>;

export interface SidePreallocationRound {
  roundId: string;
  roundName: string;
  /** The teams that need a side in this round (eligible teams, swing teams included). */
  teamIds: string[];
}

/**
 * Random, balanced side pre-allocations for several preliminary rounds (Tabbycat's
 * `generatesideallocations` command), reproducible from `seed`.
 *
 * Each round gives exactly half its teams the affirmative. Tabbycat shuffles every round
 * independently, so a team can affirm in every round; here each round instead gives the
 * affirmative to the teams that have affirmed least in the earlier generated rounds, with ties
 * (every team, in the first round) settled by the seeded shuffle. Across the rounds every team's
 * affirmative count therefore stays within one of every other team's that debated the same rounds.
 *
 * Throws, naming the round, when a round has an odd number of teams (no even split exists).
 */
export function generateSidePreallocations(rounds: SidePreallocationRound[], seed: number): Record<string, SideMap> {
  const odd = rounds.find((round) => round.teamIds.length % 2 !== 0);
  if (odd) {
    throw new Error(
      `${odd.roundName} has an odd number of teams (${odd.teamIds.length}), so its sides cannot be split evenly. Add a swing team or change the field first.`
    );
  }
  const rng = createSeededRng(seed);
  const affirmed = new Map<string, number>();
  const result: Record<string, SideMap> = {};
  for (const round of rounds) {
    // Sort a sorted copy so the result does not depend on the order the caller listed teams in.
    const shuffled = shuffle([...round.teamIds].sort(), rng);
    const ordered = shuffled.sort((a, b) => (affirmed.get(a) ?? 0) - (affirmed.get(b) ?? 0));
    const half = ordered.length / 2;
    const sides: SideMap = {};
    ordered.forEach((teamId, index) => {
      const side: TwoTeamSide = index < half ? "AFF" : "NEG";
      sides[teamId] = side;
      if (side === "AFF") affirmed.set(teamId, (affirmed.get(teamId) ?? 0) + 1);
    });
    result[round.roundId] = sides;
  }
  return result;
}

export interface SidesFromRound {
  sides: SideMap;
  /** Teams of `teamIds` given a side. */
  applied: number;
  /** Teams of `teamIds` with no known side in the source round (a bye, absent, or sides still to be recorded). */
  skippedTeamIds: string[];
}

/**
 * Tabbycat's bulk "apply side pre-allocations from a previous round": each team gets the side it
 * actually took in the source round (`opposite`: the other side). Pass the source round's debates
 * with recorded sides resolved (resolveRecordedSides). Byes and debates whose sides are still to be
 * recorded on the ballot give no side, so those teams are skipped and reported, never guessed.
 */
export function sidesFromRound(
  sourceDebates: Debate[],
  teamIds: string[],
  direction: "same" | "opposite"
): SidesFromRound {
  const taken = new Map<string, TwoTeamSide>();
  for (const debate of sourceDebates) {
    if (debate.byeTeamId || debate.postponed || sidesPending(debate)) continue;
    for (const side of ["AFF", "NEG"] as const) {
      const teamId = debate.teams?.[side]?.teamId;
      if (teamId) taken.set(teamId, side);
    }
  }
  const sides: SideMap = {};
  const skippedTeamIds: string[] = [];
  for (const teamId of teamIds) {
    const side = taken.get(teamId);
    if (!side) {
      skippedTeamIds.push(teamId);
      continue;
    }
    sides[teamId] = direction === "same" ? side : side === "AFF" ? "NEG" : "AFF";
  }
  return { sides, applied: teamIds.length - skippedTeamIds.length, skippedTeamIds };
}

/** Number of teams on each side in a round's pre-allocation. */
export function sideCountsOf(sides: SideMap | undefined): { aff: number; neg: number } {
  const values = Object.values(sides ?? {});
  return {
    aff: values.filter((side) => side === "AFF").length,
    neg: values.filter((side) => side === "NEG").length,
  };
}

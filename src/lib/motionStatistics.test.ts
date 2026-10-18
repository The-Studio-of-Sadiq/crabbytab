import { describe, expect, it } from "vitest";

import type { BallotSubmission, DebateSide, Motion, TeamScoreEntry } from "@/types";
import { computeMotionStatistics } from "./motionStatistics";

const motion = (id: string): Motion => ({ id, tournamentId: "t1", text: id, rounds: [], released: true });

function score(side: DebateSide, points: number, extra: Partial<TeamScoreEntry> = {}): TeamScoreEntry {
  return { side, teamId: `${side}-team`, points, totalSpeakerScore: 0, ...extra };
}

function ballot(
  debateId: string,
  teamScores: Partial<Record<DebateSide, TeamScoreEntry>>,
  extra: Partial<BallotSubmission> = {}
): BallotSubmission {
  return {
    id: `b-${debateId}`,
    tournamentId: "t1",
    roundId: "r1",
    debateId,
    version: 1,
    confirmed: true,
    discarded: false,
    submitterType: "tabroom",
    speakerScores: {} as BallotSubmission["speakerScores"],
    teamScores: teamScores as BallotSubmission["teamScores"],
    timestamp: "2026-10-18T00:00:00.000Z",
    ...extra,
  };
}

describe("computeMotionStatistics", () => {
  it("counts two-team wins per side and excludes forfeits, unconfirmed and duplicate ballots", () => {
    const debates = [
      { id: "d1", motionId: "m1" },
      { id: "d2", motionId: "m1" },
      { id: "d3", motionId: "m1" },
      { id: "d4", motionId: "m1" },
    ];
    const ballots = [
      ballot("d1", { AFF: score("AFF", 1, { win: true }), NEG: score("NEG", 0, { win: false }) }),
      // A second confirmed ballot for the same debate must not double count.
      ballot("d1", { AFF: score("AFF", 1, { win: true }), NEG: score("NEG", 0, { win: false }) }, { id: "dup" }),
      ballot("d2", { AFF: score("AFF", 0, { win: false }), NEG: score("NEG", 1, { win: true }) }),
      ballot("d3", { AFF: score("AFF", 1, { win: true }), NEG: score("NEG", 0) }, { forfeitSide: "NEG" }),
      ballot("d4", { AFF: score("AFF", 1, { win: true }), NEG: score("NEG", 0) }, { confirmed: false }),
    ];
    const [stat] = computeMotionStatistics([motion("m1")], debates, ballots, false);
    expect(stat.debatesCounted).toBe(2);
    expect(stat.positions).toEqual([
      { side: "AFF", wins: 1, averagePoints: 0.5 },
      { side: "NEG", wins: 1, averagePoints: 0.5 },
    ]);
    expect(stat.balance.observations).toBe(2);
  });

  it("uses BP first places and average points, preferring the ballot's motion", () => {
    const bp = (debateId: string, order: [number, number, number, number], motionId?: string) =>
      ballot(
        debateId,
        { OG: score("OG", order[0]), OO: score("OO", order[1]), CG: score("CG", order[2]), CO: score("CO", order[3]) },
        motionId ? { motionId } : {}
      );
    const stats = computeMotionStatistics(
      [motion("m1"), motion("m2")],
      [{ id: "d1", motionId: "m1" }, { id: "d2" }],
      [bp("d1", [3, 2, 1, 0]), bp("d2", [0, 1, 2, 3], "m2")],
      true
    );
    expect(stats[0].positions.map((position) => position.wins)).toEqual([1, 0, 0, 0]);
    expect(stats[0].positions[0].averagePoints).toBe(3);
    expect(stats[1].positions.map((position) => position.wins)).toEqual([0, 0, 0, 1]);
  });

  it("reports motions without results as empty rather than zero-sided", () => {
    const [stat] = computeMotionStatistics([motion("m1")], [], [], false);
    expect(stat.debatesCounted).toBe(0);
    expect(stat.positions.every((position) => position.averagePoints === null)).toBe(true);
    expect(stat.balance.pValue).toBeNull();
  });
});

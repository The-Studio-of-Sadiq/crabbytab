import { describe, expect, it } from "vitest";
import type { BallotSubmission, Motion } from "@/types";
import { crossTournamentMotionStatistics, motionTextKey, type TournamentMotionData } from "./crossTournament";

const ballot = (debateId: string, winner: "AFF" | "NEG", motionId: string, extra: Partial<BallotSubmission> = {}) =>
  ({
    debateId,
    motionId,
    confirmed: true,
    discarded: false,
    teamScores: {
      AFF: { side: "AFF", teamId: "a", points: winner === "AFF" ? 1 : 0, totalSpeakerScore: 0, win: winner === "AFF" },
      NEG: { side: "NEG", teamId: "n", points: winner === "NEG" ? 1 : 0, totalSpeakerScore: 0, win: winner === "NEG" },
    },
    ...extra,
  }) as unknown as BallotSubmission;
const motion = (id: string, text: string) => ({ id, tournamentId: "t", text, rounds: [], released: true }) as Motion;

describe("cross-tournament motion statistics", () => {
  it("matches motions by normalised text", () => {
    expect(motionTextKey("  This House would, ban CARS!  ")).toBe(motionTextKey("this house would ban cars"));
  });

  it("pools the same motion across two-team tournaments and keeps BP apart", () => {
    const data: TournamentMotionData[] = [
      {
        tournament: { id: "t1", name: "Open", format: "wsdc" },
        motions: [motion("m1", "This House would ban cars.")],
        debates: [{ id: "d1", motionId: "m1" }, { id: "d2", motionId: "m1" }],
        ballots: [ballot("d1", "AFF", "m1", { vetoes: { NEG: "m1" } }), ballot("d2", "NEG", "m1")],
      },
      {
        tournament: { id: "t2", name: "Cup", format: "australs" },
        motions: [motion("x", "this house would ban cars")],
        debates: [{ id: "e1", motionId: "x" }],
        ballots: [ballot("e1", "AFF", "x")],
      },
      {
        tournament: { id: "t3", name: "BP", format: "bp" },
        motions: [motion("b", "This House would ban cars")],
        debates: [],
        ballots: [],
      },
    ];
    const [pooled, bp] = crossTournamentMotionStatistics(data);
    expect(pooled.isBP).toBe(false);
    expect(pooled.tournaments).toEqual([{ id: "t1", name: "Open", debates: 2 }, { id: "t2", name: "Cup", debates: 1 }]);
    expect(pooled.positionWins).toEqual([{ side: "AFF", wins: 2 }, { side: "NEG", wins: 1 }]);
    expect(pooled.vetoes).toBe(1);
    expect(pooled.balance.observations).toBe(3);
    expect(bp.isBP).toBe(true);
    expect(bp.debatesCounted).toBe(0);
  });
});

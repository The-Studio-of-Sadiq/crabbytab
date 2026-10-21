import { describe, expect, it } from "vitest";
import { adjudicatorRecord, debateMotion, teamRecord } from "@/lib/publicRecords";
import type { BallotSubmission, Debate, Motion, Round } from "@/types";

const rounds = [
  { id: "r1", seq: 1, name: "Round 1", resultsReleased: true, adjudicatorsRevealed: true },
  { id: "r2", seq: 2, name: "Round 2", resultsReleased: false, adjudicatorsRevealed: true },
] as Round[];
const debate = (id: string, roundId: string, motionId?: string) =>
  ({
    id,
    roundId,
    ...(motionId ? { motionId } : {}),
    teams: { AFF: { teamId: "a", teamName: "A", side: "AFF" }, NEG: { teamId: "b", teamName: "B", side: "NEG" } },
    adjudicators: { chairId: "j", panellistIds: [], traineeIds: [] },
  }) as unknown as Debate;
const motions = [
  { id: "m1", text: "THW one", reference: "One", released: true, rounds: ["r1"] },
  { id: "m2", text: "THW two", released: true, rounds: ["r1"] },
  { id: "m3", text: "THW three", released: true, rounds: ["r2"] },
  { id: "hidden", text: "THW secret", released: false, rounds: ["r1"] },
] as Motion[];
const ballot = (debateId: string, roundId: string, motionId?: string) =>
  ({
    id: `b-${debateId}`, debateId, roundId, version: 1, confirmed: true, discarded: false, motionId,
    teamScores: { AFF: { side: "AFF", teamId: "a", points: 1, win: true }, NEG: { side: "NEG", teamId: "b", points: 0, win: false } },
  }) as unknown as BallotSubmission;

describe("debateMotion", () => {
  it("prefers the ballot's motion, then the debate's, then the round's only motion", () => {
    expect(debateMotion(debate("d", "r1", "m2"), ballot("d", "r1", "m1"), motions)).toEqual({ id: "m1", text: "THW one", reference: "One" });
    expect(debateMotion(debate("d", "r1", "m2"), undefined, motions)).toEqual({ id: "m2", text: "THW two" });
    expect(debateMotion(debate("d", "r2"), undefined, motions)?.id).toBe("m3");
    // Two motions in round 1 and none chosen: unknown.
    expect(debateMotion(debate("d", "r1"), undefined, motions)).toBeUndefined();
  });

  it("never shows an unreleased motion", () => {
    expect(debateMotion(debate("d", "r1", "hidden"), ballot("d", "r1", "hidden"), motions)).toBeUndefined();
  });
});

describe("record pages with motions in results", () => {
  const debates = [debate("d1", "r1", "m1"), debate("d2", "r2", "m3")];
  const ballots = [ballot("d1", "r1"), ballot("d2", "r2")];

  it("adds the motion to rows whose results are public, only when asked", () => {
    expect(teamRecord("a", rounds, debates, ballots).every((row) => row.motion === undefined)).toBe(true);
    const rows = teamRecord("a", rounds, debates, ballots, motions);
    expect(rows.map((row) => row.motion?.id)).toEqual(["m1", undefined]);
  });

  it("does the same on adjudicator records", () => {
    expect(adjudicatorRecord("j", rounds, debates).every((row) => row.motion === undefined)).toBe(true);
    expect(adjudicatorRecord("j", rounds, debates, { ballots, motions }).map((row) => row.motion?.id)).toEqual(["m1", undefined]);
  });
});

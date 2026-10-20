import { describe, expect, it } from "vitest";
import type { Motion, Round } from "@/types";
import {
  copyMotionsToRound,
  copyPreviousRoundMotions,
  mergeMotions,
  moveRoundMotion,
  orderMotionRoundsForPublic,
  orderRoundMotions,
  previousRoundForMotions,
  removeMotionFromRound,
  reorderRoundMotions,
} from "./roundMotions";

const motion = (id: string, rounds: string[], seq?: number, roundSeq?: Record<string, number>) =>
  ({
    id,
    tournamentId: "t",
    text: id,
    rounds,
    released: false,
    ...(seq !== undefined ? { seq } : {}),
    ...(roundSeq ? { roundSeq } : {}),
  }) as Motion;
const round = (id: string, seq: number, extra: Partial<Round> = {}) => ({ id, seq, name: id, stage: "preliminary", ...extra }) as Round;

describe("round motions", () => {
  it("orders a round's motions by their order in the round, falling back to seq", () => {
    const motions = [motion("a", ["r1"], 1, { r1: 3 }), motion("b", ["r1"], 2), motion("c", ["r1", "r2"], 9, { r1: 1 }), motion("d", ["r2"], 1)];
    expect(orderRoundMotions(motions, "r1").map((item) => item.id)).toEqual(["c", "b", "a"]);
    expect(orderRoundMotions(motions, "r2").map((item) => item.id)).toEqual(["d", "c"]);
  });

  it("reorders and moves motions, returning only the changed ones", () => {
    const motions = [motion("a", ["r1"], 1), motion("b", ["r1"], 2), motion("c", ["r1"], 3)];
    const changed = reorderRoundMotions(motions, "r1", ["c", "a", "b"]);
    expect(changed.map((item) => [item.id, item.roundSeq?.r1])).toEqual([["c", 1], ["a", 2], ["b", 3]]);
    const ordered = mergeMotions(motions, changed);
    expect(reorderRoundMotions(ordered, "r1", ["c", "a", "b"])).toEqual([]);
    const moved = mergeMotions(ordered, moveRoundMotion(ordered, "r1", "b", -1));
    expect(orderRoundMotions(moved, "r1").map((item) => item.id)).toEqual(["c", "b", "a"]);
    expect(moveRoundMotion(ordered, "r1", "c", -1)).toEqual([]);
  });

  it("copies motions into a round after its own, keeping their source order and skipping repeats", () => {
    const motions = [motion("x", ["r2"], 1, { r2: 1 }), motion("a", ["r1"], 5, { r1: 2 }), motion("b", ["r1"], 6, { r1: 1 })];
    const changed = copyMotionsToRound(motions, ["a", "b", "x", "b"], "r2", "r1");
    expect(changed.map((item) => [item.id, item.rounds, item.roundSeq?.r2])).toEqual([
      ["b", ["r1", "r2"], 2],
      ["a", ["r1", "r2"], 3],
    ]);
  });

  it("copies the previous round's motions, as Tabbycat's copy-previous", () => {
    const rounds = [
      round("r1", 1),
      round("r2", 2),
      round("qf", 3, { stage: "elimination", breakCategoryIds: ["open"] }),
      round("esl", 4, { stage: "elimination", breakCategoryIds: ["esl"] }),
      round("sf", 5, { stage: "elimination", breakCategoryIds: ["open"] }),
    ];
    expect(previousRoundForMotions(rounds[4], rounds)?.id).toBe("qf");
    expect(previousRoundForMotions(rounds[3], rounds)?.id).toBe("r2");
    expect(() => copyPreviousRoundMotions([], rounds[0], rounds)).toThrow("first round");
    expect(() => copyPreviousRoundMotions([], rounds[1], rounds)).toThrow("no motions");
    expect(copyPreviousRoundMotions([motion("m", ["r1"], 1)], rounds[1], rounds).map((item) => item.rounds)).toEqual([["r1", "r2"]]);
  });

  it("removes a motion from one round without leaving undefined fields", () => {
    const removed = removeMotionFromRound(motion("m", ["r1", "r2"], 1, { r1: 1 }), "r1");
    expect(removed.rounds).toEqual(["r2"]);
    expect("roundSeq" in removed).toBe(false);
  });

  it("lists public motion rounds latest first by default", () => {
    const rounds = [{ seq: 2 }, { seq: 1 }, { seq: 3 }];
    expect(orderMotionRoundsForPublic(rounds, undefined).map((item) => item.seq)).toEqual([3, 2, 1]);
    expect(orderMotionRoundsForPublic(rounds, "forward").map((item) => item.seq)).toEqual([1, 2, 3]);
  });
});

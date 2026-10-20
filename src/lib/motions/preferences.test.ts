import { describe, expect, it } from "vitest";
import { computeMotionPreferenceStatistics, normalizeMotionPreferences, validateMotionPreferences } from "./preferences";

describe("ranked motion preferences", () => {
  it("drops blanks, unknown motions and repeats", () => {
    expect(normalizeMotionPreferences({ AFF: ["m2", "", "m9", "m2", "m1"], NEG: [""] }, ["m1", "m2"])).toEqual({ AFF: ["m2", "m1"] });
  });

  it("reports repeats, foreign motions and a first choice that was vetoed", () => {
    const problems = validateMotionPreferences({ AFF: ["m1", "m1"], NEG: ["m3"], OG: ["m2"] }, ["m1", "m2"], { OG: "m2" });
    expect(problems.map((problem) => problem.side)).toEqual(["AFF", "NEG", "OG"]);
    expect(validateMotionPreferences({ AFF: ["m1", "m2"] }, ["m1", "m2"], { AFF: "m2" })).toEqual([]);
  });

  it("counts rankings from one confirmed ballot per debate", () => {
    const stats = computeMotionPreferenceStatistics([{ id: "m1" }, { id: "m2" }, { id: "m3" }], [
      { debateId: "d1", confirmed: true, discarded: false, motionPreferences: { AFF: ["m1", "m2"], NEG: ["m2", "m1"] } },
      { debateId: "d1", confirmed: true, discarded: false, motionPreferences: { AFF: ["m3"] } },
      { debateId: "d2", confirmed: false, discarded: false, motionPreferences: { AFF: ["m3"] } },
      { debateId: "d3", confirmed: true, discarded: true, motionPreferences: { AFF: ["m3"] } },
    ]);
    expect(stats).toEqual([
      { motionId: "m1", rankings: 2, firstChoices: 1, averageRank: 1.5 },
      { motionId: "m2", rankings: 2, firstChoices: 1, averageRank: 1.5 },
      { motionId: "m3", rankings: 0, firstChoices: 0, averageRank: null },
    ]);
  });
});

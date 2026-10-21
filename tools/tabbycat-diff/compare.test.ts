import { describe, expect, it } from "vitest";
import { equalNumbers, seedVariation } from "./harness/compare";

describe("differential comparison rules", () => {
  it("never treats Tabbycat's null (no results) as CrabbyTab's 0", () => {
    expect(equalNumbers(null, 0)).toBe(false);
    expect(equalNumbers(0, null)).toBe(false);
    expect(equalNumbers(null, undefined)).toBe(true);
    expect(equalNumbers(2, 2.00001)).toBe(true);
  });

  it("does not call a systematically worse result seed variation just because the ranges overlap", () => {
    // twoteam-odd-ties r5: Tabbycat 0 rematches in every seed, CrabbyTab 0..3.
    expect(seedVariation("repeatPairings", [0, 0, 0], [1, 2, 0, 3])).toBe(false);
    // Better on average and never worse in the worst seed: variation.
    expect(seedVariation("institutionClashes", [1, 2, 1], [0, 1, 2])).toBe(true);
    // Properties without a "better" direction still accept overlapping ranges.
    expect(seedVariation("rooms", [9, 9], [9, 10])).toBe(true);
    expect(seedVariation("byes", [["T1"], ["T2"]], [["T2"]])).toBe(true);
  });
});

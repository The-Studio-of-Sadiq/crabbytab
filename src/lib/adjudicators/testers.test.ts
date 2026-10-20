import { describe, expect, it } from "vitest";
import type { Adjudicator, Debate } from "@/types";
import { isAdjudicatorTester, testedRounds } from "./testers";

const panel = (roundId: string, chairId: string, panellistIds: string[] = [], traineeIds: string[] = []) =>
  ({ roundId, adjudicators: { chairId, panellistIds, panellistNames: [], traineeIds, traineeNames: [] } }) as unknown as Debate;

describe("adjudicator testers", () => {
  it("counts the adjudication core and marked testers", () => {
    expect(isAdjudicatorTester({ adjCore: true })).toBe(true);
    expect(isAdjudicatorTester({ isTester: true })).toBe(true);
    expect(isAdjudicatorTester({})).toBe(false);
  });

  it("marks the rounds where another tester sat on the panel", () => {
    const adjudicators = [
      { id: "core" , adjCore: true },
      { id: "tester", isTester: true },
      { id: "plain" },
      { id: "trainee" },
    ] as Adjudicator[];
    const tested = testedRounds(adjudicators, [
      panel("r1", "core", ["plain"], ["trainee"]),
      panel("r2", "plain", ["tester"]),
      panel("r3", "tester"),
      panel("r4", "core", ["tester"]),
    ]);
    expect([...(tested.get("plain") ?? [])].sort()).toEqual(["r1", "r2"]);
    expect([...(tested.get("trainee") ?? [])]).toEqual(["r1"]);
    // Nobody is tested by their own presence; two testers test each other.
    expect([...(tested.get("tester") ?? [])]).toEqual(["r4"]);
    expect([...(tested.get("core") ?? [])]).toEqual(["r4"]);
  });

  it("is empty without testers", () => {
    expect(testedRounds([{ id: "a" }] as Adjudicator[], [panel("r1", "a")]).size).toBe(0);
  });
});

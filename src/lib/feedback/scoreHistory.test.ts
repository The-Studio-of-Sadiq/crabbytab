import { describe, expect, it } from "vitest";
import type { Adjudicator } from "@/types";
import { isAdjudicatorScoreChange, scoreChangesBetween, withScoreHistory } from "./scoreHistory";

const adjudicator = (overrides: Partial<Adjudicator> = {}): Adjudicator => ({
  id: "adj",
  tournamentId: "t",
  name: "Judge",
  baseScore: 5,
  trainee: false,
  independent: false,
  conflicts: [],
  ...overrides,
});
const context = { timestamp: "2026-10-20T10:00:00.000Z", actorId: "uid-1", actorName: "Tab Director", reason: " Round 2 review " };

describe("adjudicator score history", () => {
  it("records base and test changes with who, when, old, new and reason", () => {
    expect(scoreChangesBetween(adjudicator(), adjudicator({ baseScore: 6.5, testScore: 7 }), context)).toEqual([
      { field: "baseScore", previous: 5, value: 6.5, ...context, reason: "Round 2 review" },
      { field: "testScore", value: 7, ...context, reason: "Round 2 review" },
    ]);
  });

  it("records a cleared test score without a new value", () => {
    const [change] = scoreChangesBetween(adjudicator({ testScore: 7 }), adjudicator(), { timestamp: "now" });
    expect(change).toEqual({ field: "testScore", previous: 7, timestamp: "now" });
  });

  it("records nothing for unchanged scores or a new adjudicator", () => {
    expect(scoreChangesBetween(adjudicator(), adjudicator({ name: "Renamed" }), context)).toEqual([]);
    expect(scoreChangesBetween(undefined, adjudicator(), context)).toEqual([]);
  });

  it("appends to the stored history, even when edited from a stale copy", () => {
    const stored = adjudicator({
      baseScore: 6,
      scoreHistory: [{ field: "baseScore", previous: 5, value: 6, timestamp: "earlier" }],
    });
    const staleEdit = adjudicator({ baseScore: 8, scoreHistory: [] });
    const saved = withScoreHistory(stored, staleEdit, { timestamp: "later" });
    expect(saved.scoreHistory?.map((change) => `${change.previous}->${change.value}`)).toEqual(["5->6", "6->8"]);
    expect(withScoreHistory(stored, { ...stored, name: "Renamed", scoreHistory: undefined }, context).scoreHistory)
      .toBe(stored.scoreHistory);
  });

  it("checks stored entries from backups", () => {
    expect(isAdjudicatorScoreChange({ field: "baseScore", previous: 5, value: 6, timestamp: "t" })).toBe(true);
    expect(isAdjudicatorScoreChange({ field: "score", timestamp: "t" })).toBe(false);
    expect(isAdjudicatorScoreChange({ field: "testScore", value: "6", timestamp: "t" })).toBe(false);
  });
});

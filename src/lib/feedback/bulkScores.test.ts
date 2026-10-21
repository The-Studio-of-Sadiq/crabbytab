import { describe, expect, it } from "vitest";
import type { Adjudicator } from "@/types";
import { planBulkScoreUpdate } from "./bulkScores";

const adjudicator = (id: string, name: string, baseScore = 5): Adjudicator =>
  ({ id, tournamentId: "t1", name, baseScore, conflicts: [] }) as unknown as Adjudicator;

const panel = [adjudicator("a1", "Estella Brandybuck", 5), adjudicator("a2", "Pia Hermansson", 4), adjudicator("a3", "Lucas Sousa"), adjudicator("a4", "Lucas Sousa")];

describe("planBulkScoreUpdate", () => {
  it("matches adjudicators by id or exact name and lists changed scores", () => {
    const plan = planBulkScoreUpdate("estella brandybuck, 6.5\na2,4\na3,\"7\"\n\n", panel);
    expect(plan.errorCount).toBe(0);
    // Pia's score is unchanged, so only two updates.
    expect(plan.updates).toEqual([{ adjudicatorId: "a1", baseScore: 6.5 }, { adjudicatorId: "a3", baseScore: 7 }]);
  });

  it("reports row errors and applies nothing while any line is wrong", () => {
    const plan = planBulkScoreUpdate("Nobody,5\nLucas Sousa,5\na1\na2,4,extra\na1,11\na2,4\na2,4.5\na1,abc", panel);
    expect(plan.rows.map((row) => row.error)).toEqual([
      "unknownAdjudicator", "ambiguousName", "missingScore", "tooManyColumns", "invalidScore", undefined, "duplicate", "invalidScore",
    ]);
    expect(plan.updates).toEqual([]);
    expect(plan.errorCount).toBe(7);
  });

  it("handles an empty paste", () => {
    expect(planBulkScoreUpdate("  \n", panel)).toEqual({ rows: [], updates: [], errorCount: 0 });
  });
});

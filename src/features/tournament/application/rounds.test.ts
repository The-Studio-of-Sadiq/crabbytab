import { describe, expect, it } from "vitest";

import { createRoundRecord, getRoundChangeSummary } from "./rounds";

describe("createRoundRecord", () => {
  it("uses a random draw for the first power-paired preliminary round", () => {
    const round = createRoundRecord({
      tournamentId: "tournament-1",
      roundSeq: 1,
      name: "Round 1",
      abbr: "R1",
      stage: "preliminary",
      defaultDrawRule: "power_paired",
    });

    expect(round.drawType).toBe("random");
    expect(round.name).toBe("Round 1");
    expect(round.id).toBe("round-tournament-1-1");
  });

  it("keeps explicit custom draw types intact", () => {
    const round = createRoundRecord({
      tournamentId: "tournament-1",
      roundSeq: 2,
      name: "Round 2",
      abbr: "R2",
      stage: "preliminary",
      customDrawType: "round_robin",
      defaultDrawRule: "power_paired",
    });

    expect(round.drawType).toBe("round_robin");
  });
});

describe("getRoundChangeSummary", () => {
  it("tracks only the rounds fields that changed", () => {
    const previous = createRoundRecord({
      tournamentId: "tournament-1",
      roundSeq: 1,
      name: "Round 1",
      abbr: "R1",
      stage: "preliminary",
    });

    const next = {
      ...previous,
      drawStatus: "released" as const,
      resultsReleased: true,
    };

    expect(getRoundChangeSummary(previous, next)).toEqual({
      drawStatus: { from: "none", to: "released" },
      resultsReleased: { from: false, to: true },
    });
  });
});

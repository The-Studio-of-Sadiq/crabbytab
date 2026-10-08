import { describe, expect, it } from "vitest";
import { getPanelistNamesByScore } from "./adjudicators";

describe("getPanelistNamesByScore", () => {
  it("orders panellists from highest to lowest score", () => {
    const adjudicators = [
      {
        id: "low",
        tournamentId: "tournament",
        name: "Low score",
        baseScore: 5,
        trainee: false,
        independent: false,
        conflicts: [],
      },
      {
        id: "high",
        tournamentId: "tournament",
        name: "High score",
        baseScore: 9,
        trainee: false,
        independent: false,
        conflicts: [],
      },
      {
        id: "middle",
        tournamentId: "tournament",
        name: "Middle score",
        baseScore: 7,
        trainee: false,
        independent: false,
        conflicts: [],
      },
    ];
    const slot = {
      panellistIds: ["low", "high", "middle"],
      panellistNames: ["Low score", "High score", "Middle score"],
    };

    expect(getPanelistNamesByScore(slot, adjudicators)).toEqual([
      "High score",
      "Middle score",
      "Low score",
    ]);
  });
});

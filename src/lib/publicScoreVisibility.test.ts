import { describe, expect, it } from "vitest";
import { Round } from "@/types";
import { canShowAggregateTeamScores } from "./publicScoreVisibility";

function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    id: "r1",
    tournamentId: "t1",
    seq: 1,
    name: "Round 1",
    abbreviation: "R1",
    stage: "preliminary",
    drawType: "random",
    drawStatus: "none",
    feedbackWeight: 1,
    silent: false,
    motionsReleased: false,
    resultsReleased: true,
    completed: false,
    createdAt: "",
    ...overrides,
  };
}

describe("public aggregate team-score visibility", () => {
  it("hides scores until every results-visible round publishes team speaks", () => {
    expect(canShowAggregateTeamScores([makeRound()])).toBe(false);
    expect(canShowAggregateTeamScores([
      makeRound({ teamSpeaksReleased: true }),
      makeRound({ id: "r2", seq: 2 }),
    ])).toBe(false);
  });

  it("shows aggregate scores when every public results round publishes team speaks", () => {
    expect(canShowAggregateTeamScores([
      makeRound({ teamSpeaksReleased: true }),
      makeRound({ id: "r2", seq: 2, teamSpeaksReleased: true }),
    ])).toBe(true);
  });

  it("ignores silent or unpublished rounds", () => {
    expect(canShowAggregateTeamScores([
      makeRound({ teamSpeaksReleased: true }),
      makeRound({ id: "r2", seq: 2, silent: true }),
      makeRound({ id: "r3", seq: 3, resultsReleased: false }),
    ])).toBe(true);
    expect(canShowAggregateTeamScores([makeRound({ resultsReleased: false })])).toBe(false);
  });
});
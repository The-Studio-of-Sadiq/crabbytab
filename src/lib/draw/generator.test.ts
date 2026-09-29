import { describe, expect, it } from "vitest";
import { Round, Team } from "@/types";
import { getEligibleTeamsForRound } from "./generator";

const teams: Team[] = [
  {
    id: "open-team",
    tournamentId: "t1",
    name: "Open Team",
    speakers: [],
    breakCategories: [],
    speakerCategories: [],
    breakStatus: "breaking",
    breakCategoryIds: ["open"],
  },
  {
    id: "esl-team",
    tournamentId: "t1",
    name: "ESL Team",
    speakers: [],
    breakCategories: [],
    speakerCategories: [],
    breakStatus: "breaking",
    breakCategoryIds: ["esl"],
  },
  {
    id: "eliminated-team",
    tournamentId: "t1",
    name: "Eliminated Team",
    speakers: [],
    breakCategories: [],
    speakerCategories: [],
    breakStatus: "eliminated",
    breakCategoryIds: [],
  },
];

function makeRound(stage: Round["stage"], breakCategoryId?: string): Round {
  return {
    id: "r1",
    tournamentId: "t1",
    seq: 1,
    name: "Round 1",
    abbreviation: "R1",
    stage,
    drawType: "random",
    drawStatus: "none",
    feedbackWeight: 1,
    silent: false,
    motionsReleased: false,
    resultsReleased: false,
    completed: false,
    createdAt: "",
    breakCategoryId,
  };
}

describe("Round draw eligibility", () => {
  it("uses only the selected category's qualifiers for category elimination rounds", () => {
    expect(getEligibleTeamsForRound(teams, makeRound("elimination", "open")).map((team) => team.id))
      .toEqual(["open-team"]);
  });

  it("uses all qualified teams for uncategorized elimination rounds", () => {
    expect(getEligibleTeamsForRound(teams, makeRound("elimination")).map((team) => team.id))
      .toEqual(["open-team", "esl-team"]);
  });

  it("keeps preliminary and legacy draw eligibility unchanged", () => {
    expect(getEligibleTeamsForRound(teams, makeRound("preliminary"))).toEqual(teams);
    const legacyTeams = teams.map(({ breakStatus, breakCategoryIds, ...team }) => team);
    expect(getEligibleTeamsForRound(legacyTeams, makeRound("elimination"))).toEqual(legacyTeams);
  });
});
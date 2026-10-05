import { describe, expect, it } from "vitest";
import { Round, Team, Tournament } from "@/types";
import { generateRoundDraw, getEligibleTeamsForRound } from "./generator";

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

function makeRound(stage: Round["stage"], breakCategoryIds?: string[]): Round {
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
    breakCategoryIds,
  };
}

describe("Round draw eligibility", () => {
  it("uses only the selected category's qualifiers for category elimination rounds", () => {
    expect(getEligibleTeamsForRound(teams, makeRound("elimination", ["open"])).map((team) => team.id))
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

  it("does not assign venues marked unavailable", () => {
    const drawTeams = Array.from({ length: 4 }, (_, index) => ({
      ...teams[0],
      id: `team-${index}`,
      name: `Team ${index}`,
    }));
    const tournament = {
      id: "t1",
      format: "bp",
      preferences: { teamsInDebate: 4, sideAllocationRule: "balanced" },
    } as Tournament;
    const round = { ...makeRound("preliminary"), drawType: "random" as const };

    const draw = generateRoundDraw({
      tournament,
      round,
      teams: drawTeams,
      venues: [
        { id: "unavailable", tournamentId: "t1", name: "Unavailable Room", priority: 100, available: false },
        { id: "available", tournamentId: "t1", name: "Available Room", priority: 1, available: true },
      ],
      pastDebates: [],
      standings: [],
    });

    expect(draw).toHaveLength(1);
    expect(draw[0].venueId).toBe("available");
    expect(draw[0].venueName).toBe("Available Room");
  });

  it("draws multiple categories separately within the same pre-created round", () => {
    const categoryTeams = [
      ...Array.from({ length: 4 }, (_, index) => ({
        ...teams[0], id: `open-${index}`, name: `Open ${index}`, breakCategoryIds: ["open"],
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        ...teams[1], id: `esl-${index}`, name: `ESL ${index}`, breakCategoryIds: ["esl"],
      })),
    ];
    const round = { ...makeRound("elimination", ["open", "esl"]), drawType: "elimination" as const };
    const tournament = {
      id: "t1",
      format: "bp",
      preferences: { teamsInDebate: 4, sideAllocationRule: "balanced" },
    } as Tournament;
    const standings = categoryTeams.map((team, index) => ({ teamId: team.id, rank: index + 1 } as any));

    const draw = generateRoundDraw({
      tournament,
      round,
      teams: categoryTeams,
      venues: [],
      pastDebates: [],
      standings,
    });

    expect(draw).toHaveLength(2);
    expect(draw.map((debate) => debate.breakCategoryId).sort()).toEqual(["esl", "open"]);
    expect(draw.every((debate) => {
      const ids = Object.values(debate.teams).map((slot) => slot.teamId);
      return ids.every((id) => id.startsWith(debate.breakCategoryId!));
    })).toBe(true);
  });
});
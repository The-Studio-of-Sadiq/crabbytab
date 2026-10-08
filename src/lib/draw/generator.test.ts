import { describe, expect, it } from "vitest";
import { Round, Team, Tournament } from "@/types";
import {
  buildMatchupHistory,
  generateRoundDraw,
  getEligibleTeamsForRound,
  getRequiredVenueCount,
} from "./generator";

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

  it("keeps Round 1 randomized while avoiding possible same-institution matchups", () => {
    const drawTeams = Array.from({ length: 8 }, (_, index) => ({
      ...teams[0],
      id: `team-${index}`,
      name: `Team ${index}`,
      institutionId: index < 4 ? "institution-a" : "institution-b",
      institutionName: index < 4 ? "Institution A" : "Institution B",
    }));
    const tournament = {
      id: "t1",
      format: "uadc",
      preferences: {
        teamsInDebate: 2,
        sideAllocationRule: "random",
        avoidSameInstitution: true,
      },
    } as Tournament;
    const round = {
      ...makeRound("preliminary"),
      drawType: "power_paired" as const,
    };
    const draw = generateRoundDraw({
      tournament,
      round,
      teams: drawTeams,
      venues: Array.from({ length: 4 }, (_, index) => ({
        id: `venue-${index}`,
        tournamentId: "t1",
        name: `Room ${index}`,
        priority: 0,
      })),
      pastDebates: [],
      standings: [],
    });

    expect(draw).toHaveLength(4);
    for (const debate of draw) {
      const institutionIds = Object.values(debate.teams).map((slot) =>
        drawTeams.find((team) => team.id === slot.teamId)?.institutionId
      );
      expect(new Set(institutionIds).size).toBe(2);
    }
  });

  it("requires one available venue for every debate room", () => {
    const twoTeamTournament = {
      id: "t1",
      format: "uadc",
      preferences: { teamsInDebate: 2 },
    } as Tournament;
    const drawTeams = Array.from({ length: 132 }, (_, index) => ({
      ...teams[0],
      id: `team-${index}`,
      name: `Team ${index}`,
    }));
    const round = makeRound("preliminary");
    const availableVenues = Array.from({ length: 70 }, (_, index) => ({
      id: `venue-${index}`,
      tournamentId: "t1",
      name: `Venue ${index}`,
      priority: 100 - index,
      available: true,
    }));

    expect(getRequiredVenueCount(twoTeamTournament, round, drawTeams)).toBe(66);
    const drawWithEnoughVenues = generateRoundDraw({
      tournament: twoTeamTournament,
      round,
      teams: drawTeams,
      venues: availableVenues,
      pastDebates: [],
      standings: [],
    });
    expect(drawWithEnoughVenues).toHaveLength(66);
    expect(drawWithEnoughVenues.every((debate, index) => debate.venueId === `venue-${index}`)).toBe(true);
    expect(() => generateRoundDraw({
      tournament: twoTeamTournament,
      round,
      teams: drawTeams,
      venues: availableVenues.slice(0, 65),
      pastDebates: [],
      standings: [],
    })).toThrow("Not enough available venues: 66 required, but only 65 available.");
  });

  it("persists the selected lowest-ranked team as a confirmed bye", () => {
    const drawTeams = Array.from({ length: 3 }, (_, index) => ({
      ...teams[0],
      id: `team-${index + 1}`,
      name: `Team ${index + 1}`,
    }));
    const tournament = {
      id: "t1",
      format: "uadc",
      preferences: {
        teamsInDebate: 2,
        byeTeamSelectionMethod: "lowest_ranked",
        byeTeamResults: "win",
      },
    } as Tournament;
    const draw = generateRoundDraw({
      tournament,
      round: makeRound("preliminary"),
      teams: drawTeams,
      venues: [{ id: "v1", tournamentId: "t1", name: "Room 1", priority: 10 }],
      pastDebates: [],
      standings: drawTeams.map((team, index) => ({ teamId: team.id, rank: index + 1 } as any)),
    });

    expect(draw).toHaveLength(2);
    const bye = draw.find((debate) => debate.byeTeamId);
    expect(bye).toMatchObject({
      byeTeamId: "team-3",
      byeResult: "win",
      resultStatus: "confirmed",
      venueName: "Bye",
    });
    expect(Object.values(bye!.teams).map((slot) => slot.teamId)).toEqual(["team-3"]);
    expect(buildMatchupHistory([bye!]).sides.size).toBe(0);
  });

  it("records each BP remainder team as a bye and keeps them out of debate rooms", () => {
    const drawTeams = Array.from({ length: 6 }, (_, index) => ({
      ...teams[0],
      id: `team-${index + 1}`,
      name: `Team ${index + 1}`,
    }));
    const tournament = {
      id: "t1",
      format: "bp",
      preferences: {
        teamsInDebate: 4,
        byeTeamSelectionMethod: "random",
        byeTeamResults: "absent",
      },
    } as Tournament;
    const draw = generateRoundDraw({
      tournament,
      round: makeRound("preliminary"),
      teams: drawTeams,
      venues: [{ id: "v1", tournamentId: "t1", name: "Room 1", priority: 10 }],
      pastDebates: [],
      standings: [],
    });

    expect(draw.filter((debate) => debate.byeTeamId)).toHaveLength(2);
    expect(draw.filter((debate) => !debate.byeTeamId)).toHaveLength(1);
    expect(draw.filter((debate) => debate.byeTeamId).every((debate) =>
      debate.byeResult === "absent" && debate.adjudicators.panellistIds.length === 0
    )).toBe(true);
  });

  it("rejects a BP field too small to form a debate, rather than assigning everyone a bye", () => {
    const tournament = {
      id: "t1",
      format: "bp",
      preferences: { teamsInDebate: 4, byeTeamSelectionMethod: "random" },
    } as Tournament;
    expect(() => generateRoundDraw({
      tournament,
      round: makeRound("preliminary"),
      teams: teams,
      venues: [
        { id: "v1", tournamentId: "t1", name: "Room 1", priority: 10 },
        { id: "v2", tournamentId: "t1", name: "Room 2", priority: 9 },
      ],
      pastDebates: [],
      standings: [],
    })).toThrow("At least 4 teams are required");
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
      venues: [
        { id: "v1", tournamentId: "t1", name: "Room 1", priority: 10 },
        { id: "v2", tournamentId: "t1", name: "Room 2", priority: 9 },
      ],
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
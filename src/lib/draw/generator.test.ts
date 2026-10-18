import { describe, expect, it } from "vitest";
import { Debate, Round, Team, Tournament } from "@/types";
import {
  buildMatchupHistory,
  generateRoundDraw,
  getEligibleTeamsForRound,
  getRequiredVenueCount,
  getTeamVenueRequirements,
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
  it("combines team and institution standing venue requirements", () => {
    const requirements = getTeamVenueRequirements(
      [{
        ...teams[0],
        institutionId: "institution-a",
        venueRequirements: { minimumCapacity: 20, accessible: true },
      }],
      new Map([["institution-a", {
        id: "institution-a",
        tournamentId: "t1",
        name: "Institution A",
        code: "A",
        venueRequirements: { category: "quiet", nearTabRoom: true },
      }]])
    );
    expect(requirements).toEqual({
      requiredVenueCategory: "quiet",
      requiredVenueCapacity: 20,
      requiresAccessibleVenue: true,
      requiresOnlineVenue: undefined,
      requiresNearTabRoom: true,
    });
  });

  it("rejects incompatible standing venue categories rather than weakening them", () => {
    expect(() => getTeamVenueRequirements([
      { ...teams[0], venueRequirements: { category: "quiet" } },
      { ...teams[1], venueRequirements: { category: "large" } },
    ], new Map())).toThrow("incompatible venue categories");
  });

  it("uses only the selected category's qualifiers for category elimination rounds", () => {
    expect(getEligibleTeamsForRound(teams, makeRound("elimination", ["open"])).map((team) => team.id))
      .toEqual(["open-team"]);
  });

  it("limits a round draw to its selected division", () => {
    const dividedTeams = [
      { ...teams[0], id: "west-1", divisionId: "west" },
      { ...teams[1], id: "east-1", divisionId: "east" },
    ];
    expect(getEligibleTeamsForRound(dividedTeams, { ...makeRound("preliminary"), divisionId: "east" })
      .map((team) => team.id)).toEqual(["east-1"]);
    const nameOnlyTeam = { ...teams[0], id: "north-1", divisionName: "north" };
    expect(getEligibleTeamsForRound([nameOnlyTeam], {
      ...makeRound("preliminary"),
      divisionId: "north",
    })).toEqual([nameOnlyTeam]);
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

  it("uses the selected round's team availability override", () => {
    const drawTeams = Array.from({ length: 5 }, (_, index) => ({
      ...teams[0],
      id: `team-${index}`,
      name: `Team ${index}`,
      roundAvailability: index === 0 ? { r1: false, r2: true } : undefined,
    }));
    const tournament = {
      id: "t1",
      format: "uadc",
      preferences: { teamsInDebate: 2, sideAllocationRule: "balanced" },
    } as Tournament;
    const round = makeRound("preliminary");
    const debates = generateRoundDraw({
      tournament,
      round,
      teams: drawTeams,
      venues: [
        { id: "room-1", tournamentId: "t1", name: "Room 1", priority: 1 },
        { id: "room-2", tournamentId: "t1", name: "Room 2", priority: 1 },
      ],
      pastDebates: [],
      standings: [],
    });

    expect(debates).toHaveLength(2);
    expect(debates.flatMap((debate) => Object.values(debate.teams).map((slot) => slot.teamId)))
      .not.toContain("team-0");
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

  it("allocates venues globally across categories rather than reusing a priority-sorted venue", () => {
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

    const draw = generateRoundDraw({
      tournament,
      round,
      teams: categoryTeams,
      venues: [
        { id: "lower-priority", tournamentId: "t1", name: "Room A", priority: 1 },
        { id: "higher-priority", tournamentId: "t1", name: "Room B", priority: 10 },
      ],
      pastDebates: [],
      standings: [],
    });

    expect(draw).toHaveLength(2);
    expect(draw.map((debate) => debate.venueId).sort()).toEqual([
      "higher-priority",
      "lower-priority",
    ]);
  });
});
describe("Draw generation parity (step 5)", () => {
  const venues = Array.from({ length: 6 }, (_, index) => ({
    id: `venue-${index}`,
    tournamentId: "t1",
    name: `Room ${index}`,
    priority: 0,
  }));
  const fieldTeams = (count: number): Team[] =>
    Array.from({ length: count }, (_, index) => ({
      id: `team-${index}`,
      tournamentId: "t1",
      name: `Team ${index}`,
      seed: count - index,
      speakers: [],
      breakCategories: [],
      speakerCategories: [],
    }));
  const tournamentFor = (format: "bp" | "uadc", preferences: Partial<Tournament["preferences"]> = {}) =>
    ({ id: "t1", format, preferences: { teamsInDebate: format === "bp" ? 4 : 2, ...preferences } }) as Tournament;
  const standingsFor = (draftTeams: Team[], winsOf: (index: number) => number) =>
    draftTeams.map((team, index) => ({
      rank: index + 1,
      teamId: team.id,
      teamName: team.name,
      points: winsOf(index),
      totalSpeakerScore: 100,
      averageSpeakerScore: 50,
      breakCategories: [],
      roundResults: [],
      metrics: { wins: winsOf(index), points: winsOf(index) } as never,
    }));
  const round2 = { ...makeRound("preliminary"), id: "r2", seq: 2, drawType: "power_paired" as const };
  const pairsOf = (debates: ReturnType<typeof generateRoundDraw>) =>
    debates.map((debate) => Object.entries(debate.teams).map(([side, slot]) => `${side}:${slot.teamId}`).join(","));

  it("produces the same draw for the same seed", () => {
    const drawTeams = fieldTeams(12);
    const params = {
      tournament: tournamentFor("uadc"),
      round: round2,
      teams: drawTeams,
      venues,
      pastDebates: [],
      standings: standingsFor(drawTeams, (index) => (index < 5 ? 1 : 0)),
    };
    expect(pairsOf(generateRoundDraw({ ...params, seed: 123 }))).toEqual(pairsOf(generateRoundDraw({ ...params, seed: 123 })));
    const bp = { ...params, tournament: tournamentFor("bp") };
    expect(pairsOf(generateRoundDraw({ ...bp, seed: 9 }))).toEqual(pairsOf(generateRoundDraw({ ...bp, seed: 9 })));
  });

  it("persists pulled-up teams on their debate slots", () => {
    const drawTeams = fieldTeams(8);
    const debates = generateRoundDraw({
      tournament: tournamentFor("uadc", { oddBracketMethod: "pullup_top", pairingMethod: "fold", conflictAvoidance: "off" }),
      round: round2,
      teams: drawTeams,
      venues,
      pastDebates: [],
      standings: standingsFor(drawTeams, (index) => (index < 3 ? 1 : 0)),
      seed: 1,
    });
    const pulled = debates.flatMap((debate) => Object.values(debate.teams).filter((slot) => slot.pulledUp).map((slot) => slot.teamId));
    expect(pulled).toEqual(["team-3"]);

    const bpTeams = fieldTeams(8);
    const bpDebates = generateRoundDraw({
      tournament: tournamentFor("bp"),
      round: round2,
      teams: bpTeams,
      venues,
      pastDebates: [],
      standings: standingsFor(bpTeams, (index) => (index < 3 ? 3 : 1)),
      seed: 1,
    });
    expect(bpDebates.flatMap((debate) => Object.values(debate.teams).filter((slot) => slot.pulledUp))).toHaveLength(1);
  });

  it("feeds recorded pull-ups back into the matchup history", () => {
    const debate: Debate = {
      id: "d1",
      tournamentId: "t1",
      roundId: "r1",
      roundSeq: 1,
      bracket: 1,
      roomRank: 1,
      importance: 0,
      resultStatus: "confirmed" as const,
      sidesConfirmed: true,
      flags: [],
      teams: {
        AFF: { teamId: "a", teamName: "A", side: "AFF" as const },
        NEG: { teamId: "b", teamName: "B", side: "NEG" as const, pulledUp: true },
      } as Debate["teams"],
      adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    };
    const history = buildMatchupHistory([debate, { ...debate, id: "d2", roundId: "r2", roundSeq: 2 }]);
    expect(history.pullups?.get("b")).toBe(2);
    expect(history.pullups?.get("a")).toBeUndefined();
    expect(history.pullupDebates?.get("a")).toBe(2);
    expect(history.meetings?.get("a")?.get("b")).toBe(2);
    expect(history.sides.get("b")).toEqual(["NEG", "NEG"]);
  });

  it("draws a seeded round from Team.seed and rejects it for BP", () => {
    const drawTeams = fieldTeams(4);
    const seededRound = { ...makeRound("preliminary"), drawType: "seeded" as const };
    const debates = generateRoundDraw({
      tournament: tournamentFor("uadc", { pairingMethod: "fold", conflictAvoidance: "off" }),
      round: seededRound,
      teams: drawTeams,
      venues,
      pastDebates: [],
      standings: [],
      seed: 4,
    });
    const roomsOf = debates.map((debate) => Object.values(debate.teams).map((slot) => slot.teamId).sort().join(" v "));
    expect(roomsOf.sort()).toEqual(["team-0 v team-3", "team-1 v team-2"]);

    expect(() => generateRoundDraw({
      tournament: tournamentFor("bp"),
      round: seededRound,
      teams: drawTeams,
      venues,
      pastDebates: [],
      standings: [],
    })).toThrow(/only supported for two-team/);
  });

  it("uses the round's preallocated sides and rejects them for BP", () => {
    const drawTeams = fieldTeams(4);
    const preallocatedSides = { "team-0": "AFF", "team-1": "AFF", "team-2": "NEG", "team-3": "NEG" } as const;
    const debates = generateRoundDraw({
      tournament: tournamentFor("uadc", { sideAllocationRule: "preallocated" }),
      round: { ...makeRound("preliminary"), drawType: "random", preallocatedSides },
      teams: drawTeams,
      venues,
      pastDebates: [],
      standings: [],
      seed: 2,
    });
    for (const debate of debates) {
      expect(preallocatedSides[debate.teams.AFF.teamId as keyof typeof preallocatedSides]).toBe("AFF");
      expect(preallocatedSides[debate.teams.NEG.teamId as keyof typeof preallocatedSides]).toBe("NEG");
    }
    expect(() => generateRoundDraw({
      tournament: tournamentFor("bp", { sideAllocationRule: "preallocated" }),
      round: { ...makeRound("preliminary"), drawType: "random" },
      teams: drawTeams,
      venues,
      pastDebates: [],
      standings: [],
    })).toThrow(/only supported for two-team formats/);
  });
});

import { describe, expect, it } from "vitest";

import type { Debate, DebateSide, Round, Team } from "@/types";
import { makeAdjudicators, makeRound, makeTeams, makeTournament, makeVenues } from "@/test/tournamentFixtures";
import { drawErrors, validateDraw, type DrawIssueCode, type ValidateDrawInput } from "./validateDraw";

const twoTeam = makeTournament("wsdc");
const bp = makeTournament("bp");

function debate(round: Round, roomRank: number, sides: Partial<Record<DebateSide, string>>, extra: Partial<Debate> = {}): Debate {
  return {
    id: `d-${round.id}-${roomRank}`,
    tournamentId: round.tournamentId,
    roundId: round.id,
    roundSeq: round.seq,
    bracket: 0,
    roomRank,
    importance: 0,
    resultStatus: "none",
    sidesConfirmed: true,
    flags: [],
    venueName: `Room ${roomRank}`,
    teams: Object.fromEntries(
      Object.entries(sides).map(([side, teamId]) => [side, { teamId, teamName: teamId, side }])
    ) as Debate["teams"],
    adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    ...extra,
  };
}

function setup(teamCount = 4) {
  const round = makeRound(twoTeam.id, 2);
  const teams = makeTeams(teamCount, { tournamentId: twoTeam.id, institutionCount: 4 });
  const adjudicators = makeAdjudicators(4, { tournamentId: twoTeam.id });
  const venues = makeVenues(4, twoTeam.id);
  const base: ValidateDrawInput = {
    tournament: twoTeam,
    round,
    debates: [
      debate(round, 1, { AFF: "team-1", NEG: "team-2" }, { venueId: "venue-1" }),
      debate(round, 2, { AFF: "team-3", NEG: "team-4" }, { venueId: "venue-2" }),
    ],
    teams,
    adjudicators,
    venues,
    now: Date.parse("2026-10-01T10:00:00.000Z"),
  };
  return { round, teams, adjudicators, venues, base };
}

const codes = (input: ValidateDrawInput): DrawIssueCode[] => validateDraw(input).map((issue) => issue.code);

describe("validateDraw", () => {
  it("accepts a complete, valid draw", () => {
    expect(validateDraw(setup().base)).toEqual([]);
  });

  it("reports a team placed in two debates and the team left out", () => {
    const { round, base } = setup();
    const issues = validateDraw({
      ...base,
      debates: [
        debate(round, 1, { AFF: "team-1", NEG: "team-2" }, { venueId: "venue-1" }),
        debate(round, 2, { AFF: "team-1", NEG: "team-4" }, { venueId: "venue-2" }),
      ],
    });
    expect(issues.map((issue) => issue.code)).toEqual(["team_in_multiple_debates", "team_not_placed"]);
    expect(issues[0].message).toBe("Team 01 is placed 2 times: Room 1 and Room 2.");
    expect(issues[1].message).toBe("Team 03 is checked in but has no debate or bye in Round 2.");
  });

  it("treats a bye as a placement and reports a team given a bye and a debate", () => {
    const { round, base, teams } = setup(5);
    const bye = debate(round, 3, { AFF: "team-5" }, { byeTeamId: "team-5", flags: ["bye"], venueName: "Bye" });
    expect(codes({ ...base, teams, debates: [...base.debates, bye] })).toEqual([]);
    const doubled = debate(round, 3, { AFF: "team-1" }, { byeTeamId: "team-1", flags: ["bye"] });
    expect(codes({ ...base, teams, debates: [...base.debates, doubled] })).toEqual(["team_in_multiple_debates", "team_not_placed"]);
  });

  it("reports missing, unassigned, duplicated and unregistered teams", () => {
    const { round, base } = setup();
    expect(codes({ ...base, debates: [base.debates[0], debate(round, 2, { AFF: "team-3" }, { venueId: "venue-2" })] }))
      .toEqual(["missing_side", "team_not_placed"]);
    expect(codes({ ...base, debates: [base.debates[0], debate(round, 2, { AFF: "team-3", NEG: "" }, { venueId: "venue-2" })] }))
      .toEqual(["unassigned_side", "team_not_placed"]);
    expect(codes({ ...base, debates: [base.debates[0], debate(round, 2, { AFF: "team-3", NEG: "team-3" }, { venueId: "venue-2" })] }))
      .toEqual(["team_twice_in_debate", "team_not_placed"]);
    expect(codes({ ...base, debates: [base.debates[0], debate(round, 2, { AFF: "team-3", NEG: "ghost" }, { venueId: "venue-2" })] }))
      .toEqual(["unknown_team", "team_not_placed"]);
  });

  it("reports teams that are unavailable, eliminated or from another division", () => {
    const { base, teams } = setup();
    const withdrawn = teams.map((team) => team.id === "team-2" ? { ...team, checkedIn: false } : team);
    expect(validateDraw({ ...base, teams: withdrawn })[0]).toMatchObject({
      code: "team_unavailable",
      message: "Team 02 is not checked in for Round 2.",
    });

    const elimination = makeRound(twoTeam.id, 5, { stage: "elimination", drawType: "elimination", name: "Final" });
    const broke = teams.map((team): Team => ({
      ...team,
      breakStatus: team.id === "team-4" ? "eliminated" : "breaking",
      breakCategoryIds: team.id === "team-4" ? [] : ["open"],
    }));
    const finalDebates = base.debates.map((item) => ({ ...item, roundId: elimination.id, roundSeq: 5 }));
    expect(validateDraw({ ...base, round: elimination, teams: broke, debates: finalDebates })[0]).toMatchObject({
      code: "team_ineligible",
      message: "Team 04 did not qualify for Final.",
    });

    const division = { ...base.round, divisionId: "north" };
    const divided = teams.map((team) => ({ ...team, divisionId: team.id === "team-1" ? "south" : "north" }));
    expect(codes({ ...base, round: division, teams: divided })).toEqual(["team_ineligible"]);
  });

  it("reports side limits and preallocated sides using earlier rounds", () => {
    const { round, base } = setup();
    const r1 = makeRound(twoTeam.id, 1);
    const history = [debate(r1, 1, { AFF: "team-1", NEG: "team-3" }), debate(r1, 2, { AFF: "team-2", NEG: "team-4" })];
    const strict = { ...twoTeam, preferences: { ...twoTeam.preferences, maxTimesPerSide: 1 } };
    const issues = validateDraw({ ...base, tournament: strict, rounds: [r1, round], debates: [...history, ...base.debates] });
    expect(issues.filter((issue) => issue.code === "side_limit").map((issue) => issue.message)).toEqual([
      "Team 01 would be AFF for the 2nd time, which breaks the side limits (at most 1 times per side).",
      "Team 04 would be NEG for the 2nd time, which breaks the side limits (at most 1 times per side).",
    ]);

    const preallocated = { ...twoTeam, preferences: { ...twoTeam.preferences, sideAllocationRule: "preallocated" as const } };
    const sides = { ...round, preallocatedSides: { "team-1": "NEG" as const, "team-2": "AFF" as const } };
    expect(validateDraw({ ...base, tournament: preallocated, round: sides }).map((issue) => issue.message)).toEqual([
      "Team 01 is AFF in Room 1, but its preallocated side is NEG.",
      "Team 02 is NEG in Room 1, but its preallocated side is AFF.",
    ]);
  });

  it("warns about repeat matchups and same-institution teams without blocking the draw", () => {
    const { round, base, teams } = setup();
    const r1 = makeRound(twoTeam.id, 1);
    const sameInstitution = teams.map((team) => team.id === "team-2" ? { ...team, institutionId: "inst-1" } : team);
    const issues = validateDraw({
      ...base,
      teams: sameInstitution,
      rounds: [r1, round],
      debates: [debate(r1, 1, { AFF: "team-2", NEG: "team-1" }), debate(r1, 2, { AFF: "team-4", NEG: "team-3" }), ...base.debates],
    });
    expect(drawErrors(issues)).toEqual([]);
    expect(issues.map((issue) => issue.code)).toEqual(["repeat_matchup", "same_institution", "repeat_matchup"]);
    expect(issues[0].message).toBe("Team 01 and Team 02 have already met once.");
  });

  it("reports double-booked, unregistered, unavailable and conflicted adjudicators", () => {
    const { base, adjudicators } = setup();
    const panel = (chairId: string, panellistIds: string[] = []) => ({
      chairId, chairName: chairId, panellistIds, panellistNames: panellistIds, traineeIds: [], traineeNames: [],
    });
    const doubled = [
      { ...base.debates[0], adjudicators: panel("adj-1") },
      { ...base.debates[1], adjudicators: panel("adj-2", ["adj-1"]) },
    ];
    expect(validateDraw({ ...base, debates: doubled })[0]).toMatchObject({
      code: "adjudicator_in_multiple_debates",
      message: "Adjudicator 01 is allocated to 2 debates: Room 1 and Room 2.",
    });
    const twiceOnPanel = [{ ...base.debates[0], adjudicators: panel("adj-1", ["adj-1"]) }, { ...base.debates[1], adjudicators: panel("adj-2") }];
    expect(validateDraw({ ...base, debates: twiceOnPanel })[0].message).toBe("Adjudicator 01 holds more than one place on the panel in Room 1.");
    const unknown = [{ ...base.debates[0], adjudicators: panel("nobody") }, { ...base.debates[1], adjudicators: panel("adj-2") }];
    expect(codes({ ...base, debates: unknown })).toEqual(["unknown_adjudicator"]);

    const absent = adjudicators.map((adj) => adj.id === "adj-2" ? { ...adj, checkedIn: false } : adj);
    const allocated = [{ ...base.debates[0], adjudicators: panel("adj-1") }, { ...base.debates[1], adjudicators: panel("adj-2") }];
    expect(codes({ ...base, adjudicators: absent, debates: allocated })).toEqual(["adjudicator_unavailable"]);
    const skip = { ...twoTeam, preferences: { ...twoTeam.preferences, skipAdjCheckins: true } };
    expect(codes({ ...base, tournament: skip, adjudicators: absent, debates: allocated })).toEqual([]);

    const conflicted = adjudicators.map((adj) => {
      if (adj.id === "adj-1") return { ...adj, institutionId: "inst-1", institutionName: "Institution 1", independent: false };
      if (adj.id === "adj-2") return { ...adj, conflicts: [{ teamId: "team-4", type: "personal" as const }] };
      if (adj.id === "adj-3") return { ...adj, conflicts: [{ adjudicatorId: "adj-2", type: "personal" as const }] };
      return adj;
    });
    const conflictDraw = [
      { ...base.debates[0], adjudicators: panel("adj-1") },
      { ...base.debates[1], adjudicators: panel("adj-2", ["adj-3"]) },
    ];
    expect(validateDraw({ ...base, adjudicators: conflicted, debates: conflictDraw }).map((issue) => issue.message)).toEqual([
      "Adjudicator 01 in Room 1: Institutional clash with Team 01 (Institution 1).",
      "Adjudicator 02 in Room 2: Personal clash with team \"Team 04\"; Personal clash with adjudicator \"Adjudicator 03\".",
    ]);
  });

  it("warns about adjudicators who judged a team before and debates without a chair", () => {
    const { round, base } = setup();
    const r1 = makeRound(twoTeam.id, 1);
    const earlier = debate(r1, 1, { AFF: "team-1", NEG: "team-3" });
    earlier.adjudicators = { chairId: "adj-1", panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] };
    const current = [
      { ...base.debates[0], adjudicators: { ...earlier.adjudicators } },
      base.debates[1],
    ];
    const issues = validateDraw({ ...base, rounds: [r1, round], debates: [earlier, debate(r1, 2, { AFF: "team-2", NEG: "team-4" }), ...current] });
    expect(drawErrors(issues)).toEqual([]);
    expect(issues.map((issue) => issue.message)).toEqual([
      "Adjudicator 01 has already judged Team 01.",
      "Room 2 has no chair.",
    ]);
  });

  it("reports shared, unknown, unavailable and unsuitable venues", () => {
    const { round, base, venues } = setup();
    const shared = [base.debates[0], { ...base.debates[1], venueId: "venue-1" }];
    expect(validateDraw({ ...base, debates: shared })[0].message).toBe("Room A hosts 2 debates at once.");
    expect(codes({ ...base, debates: [base.debates[0], { ...base.debates[1], venueId: "nowhere" }] })).toEqual(["unknown_venue"]);
    const closed = venues.map((venue) => venue.id === "venue-2" ? { ...venue, available: false } : venue);
    expect(codes({ ...base, venues: closed })).toEqual(["venue_unavailable"]);
    const needsAccess = [base.debates[0], { ...base.debates[1], requiresAccessibleVenue: true, requiredVenueCapacity: 30 }];
    expect(validateDraw({ ...base, debates: needsAccess })[0].message)
      .toBe("Room B does not suit this debate: it requires capacity of at least 30 and requires an accessible venue.");
    expect(codes({ ...base, debates: [base.debates[0], { ...base.debates[1], venueId: undefined }] })).toEqual(["no_venue"]);
    expect(round.id).toBe(base.round.id);
  });

  it("checks BP rooms for all four positions", () => {
    const round = makeRound(bp.id, 1);
    const teams = makeTeams(4, { tournamentId: bp.id, speakersPerTeam: 2 });
    const room = debate(round, 1, { OG: "team-1", OO: "team-2", CG: "team-3" });
    expect(validateDraw({ tournament: bp, round, debates: [room], teams, adjudicators: [], venues: [] }).map((issue) => issue.message))
      .toEqual(["Room 1 has no CO team.", "Team 04 is checked in but has no debate or bye in Round 1."]);
  });

  it("lists errors before warnings and reports nothing for a round without a draw", () => {
    const { base } = setup();
    expect(validateDraw({ ...base, debates: [] })).toEqual([]);
    const issues = validateDraw({ ...base, debates: [base.debates[0], { ...base.debates[1], venueId: undefined, teams: { ...base.debates[1].teams, NEG: { teamId: "team-3", teamName: "", side: "NEG" } } }] });
    expect(issues.map((issue) => issue.severity)).toEqual(["error", "error", "warning"]);
  });
});

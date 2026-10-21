import { describe, expect, it } from "vitest";
import type { BallotSubmission, Debate, DebateSide, Round, Team } from "@/types";
import { makeRound, makeTeams, makeTournament, makeVenues } from "@/test/tournamentFixtures";
import { generateRoundDraw, getRequiredVenueCount, groupPolyRooms, polyDrawTypeProblem } from "./generator";
import { createSeededRng } from "./rng";
import { validateDraw } from "./validateDraw";
import { getAdvancingTeamIds, validateEliminationField } from "./elimination";

/** Tabbycat's Public Speaking tournament: six teams per room, one speaker each. */
function polyTournament(overrides: Parameters<typeof makeTournament>[1] = {}) {
  return makeTournament("poly", { teamsInDebate: 6, substantiveSpeakers: 1, replyScoresEnabled: false, drawRule: "random", ...overrides });
}

function draw(teamCount: number, options: { seed?: number; round?: Partial<Round>; overrides?: Parameters<typeof makeTournament>[1] } = {}) {
  const tournament = polyTournament(options.overrides);
  const teams = makeTeams(teamCount, { tournamentId: tournament.id, speakersPerTeam: 1, institutionCount: 3 });
  const round = makeRound(tournament.id, 1, { drawType: "random", ...options.round });
  const debates = generateRoundDraw({
    tournament,
    round,
    teams,
    venues: makeVenues(10, tournament.id),
    pastDebates: [],
    standings: [],
    seed: options.seed ?? 7,
  });
  return { tournament, teams, round, debates };
}

const teamIdsOf = (debates: Debate[]) =>
  debates.flatMap((debate) => Object.values(debate.teams).map((slot) => slot?.teamId).filter(Boolean)).sort();

describe("random poly draw (Tabbycat RandomPolyDrawGenerator)", () => {
  it("deals the teams into rooms of N, the remainder in the last room, every team exactly once", () => {
    const { teams, debates } = draw(14);
    expect(debates.map((debate) => Object.keys(debate.teams).sort())).toEqual([
      ["P1", "P2", "P3", "P4", "P5", "P6"],
      ["P1", "P2", "P3", "P4", "P5", "P6"],
      ["P1", "P2"],
    ]);
    expect(teamIdsOf(debates)).toEqual(teams.map((team) => team.id).sort());
    for (const debate of debates) {
      for (const [side, slot] of Object.entries(debate.teams)) expect(slot?.side).toBe(side);
      expect(debate.sidesConfirmed).toBe(true);
      expect(debate.flags).toEqual([]);
    }
    // Every room gets its own venue.
    expect(new Set(debates.map((debate) => debate.venueId)).size).toBe(3);
  });

  it("is reproducible with the same seed and changes with another", () => {
    const first = draw(18, { seed: 11 }).debates;
    const again = draw(18, { seed: 11 }).debates;
    const other = draw(18, { seed: 12 }).debates;
    const rooms = (debates: Debate[]) => debates.map((debate) => Object.values(debate.teams).map((slot) => slot?.teamId));
    expect(rooms(again)).toEqual(rooms(first));
    expect(rooms(other)).not.toEqual(rooms(first));
  });

  it("gives byes to the teams that do not fill a room when byes are on", () => {
    const { debates } = draw(14, { overrides: { byeTeamSelectionMethod: "random", byeTeamResults: "win" } });
    const byes = debates.filter((debate) => debate.byeTeamId);
    expect(byes).toHaveLength(2);
    expect(byes.every((debate) => Object.keys(debate.teams)[0] === "P1" && debate.byeResult === "win")).toBe(true);
    expect(debates.filter((debate) => !debate.byeTeamId).map((debate) => Object.keys(debate.teams).length)).toEqual([6, 6]);
  });

  it("accepts any team count of at least one, and refuses none", () => {
    expect(draw(1).debates.map((debate) => Object.keys(debate.teams))).toEqual([["P1"]]);
    expect(() => draw(0)).toThrow(/At least 1 team is required/);
  });

  it("works for other team counts, e.g. three per room", () => {
    const { debates } = draw(7, { overrides: { teamsInDebate: 3 } });
    expect(debates.map((debate) => Object.keys(debate.teams).length)).toEqual([3, 3, 1]);
  });

  it("deals rooms in shuffle order with no side or conflict preferences", () => {
    const rooms = groupPolyRooms(makeTeams(5, { tournamentId: "t" }), 2, createSeededRng(3));
    expect(rooms.map((room) => room.length)).toEqual([2, 2, 1]);
    expect(() => groupPolyRooms([], 0, createSeededRng(1))).toThrow(/at least 1/);
  });

  it("counts the rooms a round needs, short room included", () => {
    const tournament = polyTournament();
    const teams = makeTeams(14, { tournamentId: tournament.id });
    expect(getRequiredVenueCount(tournament, makeRound(tournament.id, 1, { drawType: "random" }), teams)).toBe(3);
    const withByes = polyTournament({ byeTeamSelectionMethod: "random" });
    expect(getRequiredVenueCount(withByes, makeRound(withByes.id, 1, { drawType: "random" }), teams)).toBe(2);
  });
});

describe("draw types Tabbycat refuses for N teams per room", () => {
  it("refuses power-paired, round-robin and seeded draws with a clear error", () => {
    for (const drawType of ["power_paired", "round_robin", "seeded"] as const) {
      expect(() => draw(12, { round: { drawType } })).toThrow(/cannot be used with 6 teams per debate\. Use a random or manual draw/);
    }
    expect(polyDrawTypeProblem({ drawType: "random", stage: "preliminary" }, 6)).toBe("");
  });

  it("refuses generated elimination draws but allows manual ones", () => {
    expect(() => draw(12, { round: { stage: "elimination", drawType: "elimination" } })).toThrow(/Elimination draws cannot be generated/);
    expect(() => draw(12, { round: { stage: "elimination", drawType: "random" } })).toThrow(/Elimination draws cannot be generated/);
    expect(validateEliminationField(8, "poly")).toMatch(/draw it by hand/);
    const manual = draw(12, { round: { stage: "elimination", drawType: "manual" } }).debates;
    expect(manual).toHaveLength(2);
  });

  it("refuses side rules that need two teams", () => {
    expect(() => draw(12, { overrides: { sideAllocationRule: "preallocated" } })).toThrow(/Preallocated sides are only supported for two-team formats/);
    expect(() => draw(12, { overrides: { sideAllocationRule: "manual_ballot" } })).toThrow(/Sides chosen on the ballot are only supported/);
  });
});

describe("manual poly draw", () => {
  it("creates empty rooms of N positions", () => {
    const { debates } = draw(14, { round: { drawType: "manual" } });
    expect(debates).toHaveLength(3);
    expect(Object.keys(debates[0].teams)).toEqual(["P1", "P2", "P3", "P4", "P5", "P6"]);
    expect(Object.values(debates[0].teams).every((slot) => slot?.teamId === "")).toBe(true);
  });
});

describe("draw checks for poly rooms", () => {
  const setup = (rooms: Array<Record<string, string>>) => {
    const tournament = polyTournament();
    const teams = makeTeams(14, { tournamentId: tournament.id, speakersPerTeam: 1 });
    const round = makeRound(tournament.id, 1, { drawType: "manual" });
    const debates: Debate[] = rooms.map((room, index) => ({
      id: `d${index}`,
      tournamentId: tournament.id,
      roundId: round.id,
      roundSeq: 1,
      bracket: 0,
      roomRank: index + 1,
      importance: 0,
      resultStatus: "none",
      sidesConfirmed: true,
      flags: [],
      teams: Object.fromEntries(Object.entries(room).map(([side, teamId]) => [side, { teamId, teamName: teamId, side }])) as Debate["teams"],
      adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    }));
    return validateDraw({ tournament, round, debates, teams, adjudicators: [], venues: [] });
  };
  const ids = (from: number, count: number, offset = 0) =>
    Object.fromEntries(Array.from({ length: count }, (_, index) => [`P${index + 1 + offset}`, `team-${from + index}`]));

  it("accepts full rooms and a short last room, and leaves empty trailing slots alone", () => {
    const issues = setup([ids(1, 6), ids(7, 6), { ...ids(13, 2), P3: "", P4: "" }]);
    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("reports a gap and a room with more teams than the format allows", () => {
    const gap = setup([ids(1, 6), { P1: "team-7", P3: "team-8" }, ids(9, 6)]);
    expect(gap.some((issue) => issue.code === "missing_side" && /no P2 team/.test(issue.message))).toBe(true);
    const tooMany = setup([ids(1, 7), ids(8, 6)]);
    expect(tooMany.some((issue) => issue.code === "missing_side" && /more than 6 teams/.test(issue.message))).toBe(true);
  });
});

describe("advancing from manually drawn poly elimination rooms", () => {
  const debate: Debate = {
    id: "e1",
    tournamentId: "t",
    roundId: "r",
    roundSeq: 5,
    bracket: 0,
    roomRank: 1,
    importance: 0,
    resultStatus: "confirmed",
    sidesConfirmed: true,
    flags: [],
    teams: Object.fromEntries(["P1", "P2", "P3"].map((side, index) => [side, { teamId: `t${index}`, teamName: `T${index}`, side }])) as Debate["teams"],
    adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
  };
  const ballot = (teamScores: Record<string, Partial<BallotSubmission["teamScores"][DebateSide]>>): BallotSubmission => ({
    id: "b",
    tournamentId: "t",
    roundId: "r",
    debateId: "e1",
    version: 1,
    confirmed: true,
    discarded: false,
    submitterType: "tabroom",
    speakerScores: {} as BallotSubmission["speakerScores"],
    teamScores: Object.fromEntries(
      Object.entries(teamScores).map(([side, score], index) => [side, { side, teamId: `t${index}`, points: 0, totalSpeakerScore: 0, ...score }])
    ) as BallotSubmission["teamScores"],
    timestamp: "",
  });

  it("advances declared teams, or the top two (top one in the final) of a scored ballot", () => {
    const declared = ballot({ P1: { win: true }, P2: { win: false }, P3: { win: true } });
    expect([...getAdvancingTeamIds([debate], [declared], "poly")].sort()).toEqual(["t0", "t2"]);
    const ranked = ballot({ P1: { rank: 3, points: 0 }, P2: { rank: 1, points: 2 }, P3: { rank: 2, points: 1 } });
    expect([...getAdvancingTeamIds([debate], [ranked], "poly")].sort()).toEqual(["t1", "t2"]);
    expect([...getAdvancingTeamIds([debate], [ranked], "poly", true)]).toEqual(["t1"]);
  });

  it("refuses a score-only ballot, which decides nobody", () => {
    const scoresOnly = ballot({ P1: {}, P2: {}, P3: {} });
    expect(() => getAdvancingTeamIds([debate], [scoresOnly], "poly")).toThrow(/records scores only/);
  });
});

describe("two-team and BP draws keep their shape", () => {
  it("still draws AFF/NEG and OG/OO/CG/CO rooms and refuses uneven fields", () => {
    for (const [format, size, sides] of [["uadc", 2, ["AFF", "NEG"]], ["bp", 4, ["CG", "CO", "OG", "OO"]]] as const) {
      const tournament = makeTournament(format, { drawRule: "random" });
      const teams: Team[] = makeTeams(size * 3, { tournamentId: tournament.id });
      const debates = generateRoundDraw({
        tournament,
        round: makeRound(tournament.id, 1, { drawType: "random" }),
        teams,
        venues: makeVenues(5, tournament.id),
        pastDebates: [],
        standings: [],
        seed: 5,
      });
      expect(debates).toHaveLength(3);
      expect(debates.every((debate) => JSON.stringify(Object.keys(debate.teams).sort()) === JSON.stringify(sides))).toBe(true);
      expect(() =>
        generateRoundDraw({
          tournament,
          round: makeRound(tournament.id, 1, { drawType: "random" }),
          teams: teams.slice(1),
          venues: makeVenues(5, tournament.id),
          pastDebates: [],
          standings: [],
          seed: 5,
        })
      ).toThrow(/must be divisible/);
    }
  });
});

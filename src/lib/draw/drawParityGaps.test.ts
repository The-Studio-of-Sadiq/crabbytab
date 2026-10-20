import { describe, expect, it } from "vitest";
import type { Adjudicator, Debate, PreformedPanel, Team, TeamStandingRow, TournamentPreferences } from "@/types";
import { makeRound, makeTournament, makeVenues } from "@/test/tournamentFixtures";
import { generateRoundDraw } from "./generator";
import { MANUAL_SIDES_FLAG } from "./manualSides";
import { BP_ROUND_ROBIN_TABLES } from "./roundRobin";
import { getAllocationWeights, placePreformedPanels } from "./allocator";
import { generateSidePreallocations, sidesFromRound } from "./sidePreallocation";

const TID = "t-parity";

function team(index: number, overrides: Partial<Team> = {}): Team {
  return {
    id: `team-${index}`,
    tournamentId: TID,
    name: `Team ${index}`,
    speakers: [],
    breakCategories: [],
    speakerCategories: [],
    checkedIn: true,
    ...overrides,
  };
}

const field = (count: number, overrides: (index: number) => Partial<Team> = () => ({})) =>
  Array.from({ length: count }, (_, index) => team(index + 1, overrides(index + 1)));

function standing(teamId: string, rank: number, metrics: Partial<TeamStandingRow["metrics"]>, points = 0): TeamStandingRow {
  return {
    rank,
    teamId,
    teamName: teamId,
    breakCategories: [],
    points,
    totalSpeakerScore: 100,
    averageSpeakerScore: 50,
    roundResults: [],
    metrics: metrics as TeamStandingRow["metrics"],
  };
}

const roomsOf = (debates: Debate[]) =>
  debates.filter((debate) => !debate.byeTeamId).map((debate) => Object.values(debate.teams).map((slot) => slot.teamId));
const pairsOf = (debates: Debate[]) => roomsOf(debates).map((ids) => [...ids].sort().join(" v ")).sort();

describe("elimination side rule", () => {
  const breaking = field(8, () => ({ breakStatus: "breaking", breakCategoryIds: ["open"] }));
  const standings = breaking.map((item, index) => standing(item.id, index + 1, {}));
  const round = makeRound(TID, 6, { stage: "elimination", drawType: "elimination", breakCategoryIds: ["open"] });
  const draw = (preferences: Partial<TournamentPreferences>, format: "uadc" | "bp", seed: number) =>
    generateRoundDraw({
      tournament: makeTournament(format, preferences, TID),
      round,
      teams: breaking,
      venues: makeVenues(4, TID),
      pastDebates: [],
      standings,
      seed,
    });

  it("by seed (default): the higher seed affirms and sides are confirmed", () => {
    const debates = draw({}, "uadc", 1);
    expect(debates).toHaveLength(4);
    for (const debate of debates) {
      expect(debate.sidesConfirmed).toBe(true);
      expect(debate.flags).not.toContain(MANUAL_SIDES_FLAG);
      const aff = Number(debate.teams.AFF.teamId.split("-")[1]);
      const neg = Number(debate.teams.NEG.teamId.split("-")[1]);
      expect(aff).toBeLessThan(neg);
    }
  });

  it("random: same pairings, sides drawn with the seed and left to the ballot", () => {
    const bySeed = draw({}, "uadc", 1);
    const random = draw({ eliminationSideRule: "random" }, "uadc", 7);
    expect(pairsOf(random)).toEqual(pairsOf(bySeed));
    for (const debate of random) {
      expect(debate.sidesConfirmed).toBe(false);
      expect(debate.flags).toContain(MANUAL_SIDES_FLAG);
      // Bracket positions travel with the team, whichever side it is on.
      for (const slot of Object.values(debate.teams)) {
        expect(slot.bracketPosition).toBe(Number(slot.teamId.split("-")[1]));
      }
    }
    // Reproducible from the seed.
    expect(roomsOf(draw({ eliminationSideRule: "random" }, "uadc", 7))).toEqual(roomsOf(random));
    // And actually random: across seeds some top seed takes the negative.
    const lowerSeedAffirms = Array.from({ length: 20 }, (_, seed) => draw({ eliminationSideRule: "random" }, "uadc", seed))
      .some((debates) => debates.some((debate) =>
        Number(debate.teams.AFF.teamId.split("-")[1]) > Number(debate.teams.NEG.teamId.split("-")[1])));
    expect(lowerSeedAffirms).toBe(true);
  });

  it("random in BP: seats shuffled, unconfirmed, without the two-team ballot side choice", () => {
    const debates = draw({ eliminationSideRule: "random" }, "bp", 3);
    expect(debates).toHaveLength(2);
    for (const debate of debates) {
      expect(debate.sidesConfirmed).toBe(false);
      expect(debate.flags).not.toContain(MANUAL_SIDES_FLAG);
      expect(Object.keys(debate.teams).sort()).toEqual(["CG", "CO", "OG", "OO"]);
    }
    expect(roomsOf(draw({ eliminationSideRule: "random" }, "bp", 3))).toEqual(roomsOf(debates));
  });
});

describe("power-pairing brackets use the first standings metric", () => {
  // Wins and points disagree (round weights / bye points): A and C lead on points, A and B on wins.
  const teams = [team(1, { name: "A" }), team(2, { name: "B" }), team(3, { name: "C" }), team(4, { name: "D" })];
  const standings = [
    standing("team-1", 1, { wins: 1, points: 1 }, 1),
    standing("team-3", 2, { wins: 0, points: 1 }, 1),
    standing("team-2", 3, { wins: 1, points: 0 }, 0),
    standing("team-4", 4, { wins: 0, points: 0 }, 0),
  ];
  const draw = (preferences: Partial<TournamentPreferences>, seed = 5) =>
    generateRoundDraw({
      tournament: makeTournament("uadc", { conflictAvoidance: "off", pairingMethod: "fold", ...preferences }, TID),
      round: makeRound(TID, 2, { drawType: "power_paired" }),
      teams,
      venues: makeVenues(2, TID),
      pastDebates: [],
      standings,
      seed,
    });

  it("brackets on points when points lead the precedence (the default)", () => {
    expect(pairsOf(draw({}))).toEqual(["team-1 v team-3", "team-2 v team-4"]);
    expect(pairsOf(draw({}))).toEqual(pairsOf(draw({})));
  });

  it("brackets on wins when wins lead the precedence", () => {
    expect(pairsOf(draw({ teamStandingsPrecedence: ["wins", "speaks_sum"] }))).toEqual(["team-1 v team-2", "team-3 v team-4"]);
  });

  it("brackets BP rooms on the first metric too", () => {
    const bpTeams = field(8);
    // Points put teams 1, 2, 5 and 6 on top; firsts would put 1-4 on top.
    const onPoints = new Set(["team-1", "team-2", "team-5", "team-6"]);
    const bpStandings = bpTeams.map((item, index) => {
      const points = onPoints.has(item.id) ? 3 : 0;
      return standing(item.id, index + 1, { points, firsts: index < 4 ? 1 : 0 }, points);
    });
    const bpDraw = (precedence?: TournamentPreferences["teamStandingsPrecedence"]) =>
      generateRoundDraw({
        tournament: makeTournament("bp", { teamStandingsPrecedence: precedence }, TID),
        round: makeRound(TID, 2, { drawType: "power_paired" }),
        teams: bpTeams,
        venues: makeVenues(2, TID),
        pastDebates: [],
        standings: bpStandings,
        seed: 9,
      });
    const top = (debates: Debate[]) => roomsOf(debates).find((ids) => ids.includes("team-1"))!.sort();
    expect(top(bpDraw())).toEqual(["team-1", "team-2", "team-5", "team-6"]);
    expect(top(bpDraw(["firsts", "points"]))).toEqual(["team-1", "team-2", "team-3", "team-4"]);
  });
});

describe("round robin through the generator", () => {
  it("two-team: errors past the end of the schedule instead of wrapping", () => {
    const params = {
      tournament: makeTournament("uadc", {}, TID),
      round: makeRound(TID, 4, { drawType: "round_robin" }),
      teams: field(4, (index) => ({ seed: index })),
      venues: makeVenues(2, TID),
      pastDebates: [],
      standings: [],
      seed: 1,
    };
    expect(() => generateRoundDraw({ ...params, roundRobinIndex: 4 })).toThrow(/expected between 1 and 3/);
    expect(pairsOf(generateRoundDraw({ ...params, roundRobinIndex: 3 }))).toEqual(["team-1 v team-4", "team-2 v team-3"]);
  });

  it("two-team: refuses unseeded teams", () => {
    expect(() => generateRoundDraw({
      tournament: makeTournament("uadc", {}, TID),
      round: makeRound(TID, 1, { drawType: "round_robin" }),
      teams: field(4),
      venues: makeVenues(2, TID),
      pastDebates: [],
      standings: [],
      roundRobinIndex: 1,
    })).toThrow(/must have a seed/);
  });

  it("BP: draws the preset table round with its seats", () => {
    const debates = generateRoundDraw({
      tournament: makeTournament("bp", {}, TID),
      round: makeRound(TID, 2, { drawType: "round_robin" }),
      teams: field(16, (index) => ({ seed: index })),
      venues: makeVenues(4, TID),
      pastDebates: [],
      standings: [],
      seed: 1,
      roundRobinIndex: 2,
    });
    const seats = debates.map((debate) => (["OG", "OO", "CG", "CO"] as const).map((side) => Number(debate.teams[side].teamId.split("-")[1])));
    expect(seats).toEqual(BP_ROUND_ROBIN_TABLES[16][1]);
  });
});

describe("BP seeded draw", () => {
  const params = (seed: number, teams = field(8, (index) => ({ seed: index }))) => ({
    tournament: makeTournament("bp", {}, TID),
    round: makeRound(TID, 1, { drawType: "seeded" }),
    teams,
    venues: makeVenues(2, TID),
    pastDebates: [],
    standings: [],
    seed,
  });

  it("places every team once and is reproducible from the seed", () => {
    const debates = generateRoundDraw(params(11));
    expect(debates).toHaveLength(2);
    expect(new Set(roomsOf(debates).flat()).size).toBe(8);
    expect(roomsOf(generateRoundDraw(params(11)))).toEqual(roomsOf(debates));
  });

  it("refuses unseeded teams", () => {
    expect(() => generateRoundDraw(params(1, field(8)))).toThrow(/needs a seed/);
  });
});

describe("direct preformed-panel placement", () => {
  const adj = (id: string): Adjudicator => ({ id, tournamentId: TID, name: id, baseScore: 5, checkedIn: true } as Adjudicator);
  const adjudicators = ["a", "b", "c", "d"].map(adj);
  const debate = (id: string, roomRank: number) => ({ id, roomRank, teams: {} } as unknown as Debate);
  const input = {
    adjById: new Map(adjudicators.map((item) => [item.id, item])),
    adjScores: new Map<string, number>(),
    priorityOf: (item: Debate) => 10 - item.roomRank,
    teamsOf: () => [],
    pastAdjTeams: new Map<string, Set<string>>(),
    options: {
      panelSize: 1,
      balancePanels: true,
      respectInstitutionConflicts: true,
      respectPersonalConflicts: true,
      respectHistoryConflicts: true,
    },
    weights: getAllocationWeights(),
    includePanellists: true,
    includeTrainees: true,
    placement: "direct" as const,
  };
  const panel = (id: string, chairId: string, roomRank?: number, importance = 0): PreformedPanel =>
    ({ id, chairId, panellistIds: [], traineeIds: [], importance, roomRank });

  it("pairs panels and debates in room-rank order, ignoring importance", () => {
    const placements = placePreformedPanels(
      [panel("p-room2", "a", 2, 10), panel("p-room1", "b", 1, 0), panel("p-manual", "c", undefined, 10)],
      [debate("d-low", 3), debate("d-top", 1), debate("d-mid", 2)],
      input
    );
    expect(placements.get("d-top")?.id).toBe("p-room1");
    expect(placements.get("d-mid")?.id).toBe("p-room2");
    expect(placements.get("d-low")?.id).toBe("p-manual");
  });

  it("leaves extra panels unplaced and skips panels with no available voting member", () => {
    const placements = placePreformedPanels(
      [panel("p1", "a", 1), panel("gone", "absent", 2), panel("p3", "b", 3)],
      [debate("d1", 1), debate("d2", 2)],
      input
    );
    expect([...placements.entries()].map(([debateId, item]) => `${debateId}:${item.id}`)).toEqual(["d1:p1", "d2:p3"]);
  });
});

describe("random side pre-allocation for every preliminary round", () => {
  const rounds = [1, 2, 3, 4, 5].map((seq) => ({
    roundId: `r${seq}`,
    roundName: `Round ${seq}`,
    teamIds: Array.from({ length: 10 }, (_, index) => `team-${index + 1}`),
  }));

  it("splits every round evenly and keeps each team's affirmatives within one of the others'", () => {
    const sides = generateSidePreallocations(rounds, 123);
    for (const round of rounds) {
      const values = Object.values(sides[round.roundId]);
      expect(values.filter((side) => side === "AFF")).toHaveLength(5);
      expect(values).toHaveLength(10);
    }
    const affirmed = rounds[0].teamIds.map((teamId) => rounds.filter((round) => sides[round.roundId][teamId] === "AFF").length);
    expect(Math.max(...affirmed) - Math.min(...affirmed)).toBeLessThanOrEqual(1);
  });

  it("is reproducible from the seed and independent of the order teams are listed in", () => {
    const first = generateSidePreallocations(rounds, 77);
    const reordered = rounds.map((round) => ({ ...round, teamIds: [...round.teamIds].reverse() }));
    expect(generateSidePreallocations(reordered, 77)).toEqual(first);
    expect(generateSidePreallocations(rounds, 78)).not.toEqual(first);
  });

  it("refuses a round with an odd number of teams", () => {
    expect(() => generateSidePreallocations([{ roundId: "r1", roundName: "Round 1", teamIds: ["a", "b", "c"] }], 1))
      .toThrow(/Round 1 has an odd number of teams/);
  });
});

describe("side pre-allocation from a previous round", () => {
  const slot = (teamId: string, side: "AFF" | "NEG") => ({ teamId, teamName: teamId, side });
  const debates = [
    { id: "d1", teams: { AFF: slot("a", "AFF"), NEG: slot("b", "NEG") }, flags: [], sidesConfirmed: true },
    { id: "d2", teams: { AFF: slot("c", "AFF"), NEG: slot("d", "NEG") }, flags: [MANUAL_SIDES_FLAG], sidesConfirmed: false },
    { id: "bye", teams: { AFF: slot("e", "AFF") }, flags: ["bye"], byeTeamId: "e", sidesConfirmed: true },
  ] as unknown as Debate[];

  it("copies the sides taken, or their opposites, and reports teams without a known side", () => {
    expect(sidesFromRound(debates, ["a", "b", "c", "d", "e", "f"], "same")).toEqual({
      sides: { a: "AFF", b: "NEG" },
      applied: 2,
      skippedTeamIds: ["c", "d", "e", "f"],
    });
    expect(sidesFromRound(debates, ["a", "b"], "opposite").sides).toEqual({ a: "NEG", b: "AFF" });
  });
});

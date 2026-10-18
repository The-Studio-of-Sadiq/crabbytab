import { describe, expect, it } from "vitest";

import type { BallotSubmission, Debate, Round, Team, TeamStandingRow, Tournament, Venue } from "@/types";
import {
  applyEliminationAdvancement,
  eliminationByeCount,
  eliminationRoomCount,
  generateEliminationDraw,
  getAdvancingTeamIds,
  isFullEliminationField,
  planEliminationRound,
  resolveBracketPositions,
  validateEliminationField,
  type PositionedTeam,
} from "./elimination";
import { generateRoundDraw, getRequiredVenueCount } from "./generator";
import { eliminationRoundCount, validateBreakSize } from "@/lib/setup/presets";

function team(seed: number, overrides: Partial<Team> = {}): Team {
  return {
    id: `team-${seed}`,
    tournamentId: "t1",
    name: `Seed ${seed}`,
    speakers: [],
    breakCategories: [],
    speakerCategories: [],
    breakStatus: "breaking",
    breakCategoryIds: ["open"],
    ...overrides,
  };
}

function positioned(count: number): PositionedTeam[] {
  return Array.from({ length: count }, (_, index) => ({ team: team(index + 1), position: index + 1 }));
}

const seedsOf = (plan: ReturnType<typeof planEliminationRound>) =>
  plan.rooms.map((room) => room.teams.map((slot) => slot.seed));

describe("elimination field sizes", () => {
  it("recognises full fields", () => {
    expect([2, 4, 8, 16].every((count) => isFullEliminationField(count, "uadc"))).toBe(true);
    expect([4, 8, 16, 32].every((count) => isFullEliminationField(count, "bp"))).toBe(true);
    expect(isFullEliminationField(12, "uadc")).toBe(false);
    expect(isFullEliminationField(12, "bp")).toBe(false);
    expect(isFullEliminationField(2, "bp")).toBe(false);
  });

  it("counts byes and rooms for partial fields", () => {
    expect(eliminationByeCount(12, "uadc")).toBe(4);
    expect(eliminationRoomCount(12, "uadc")).toBe(4);
    expect(eliminationByeCount(3, "uadc")).toBe(1);
    expect(eliminationByeCount(24, "bp")).toBe(8);
    expect(eliminationRoomCount(24, "bp")).toBe(4);
    expect(eliminationByeCount(6, "bp")).toBe(2);
    expect(eliminationRoomCount(6, "bp")).toBe(1);
    expect(eliminationByeCount(16, "bp")).toBe(0);
    expect(eliminationRoomCount(16, "bp")).toBe(4);
  });

  it("explains fields that cannot be drawn", () => {
    expect(validateEliminationField(1, "uadc")).toMatch(/at least 2/);
    expect(validateEliminationField(10, "bp")).toBe("");
    expect(validateEliminationField(9, "bp")).toMatch(/even number/);
    expect(validateEliminationField(2, "bp")).toMatch(/at least 4/);
    expect(eliminationRoomCount(9, "bp")).toBe(0);
  });

  it("counts elimination rounds, adding a partial round for uneven breaks", () => {
    expect(eliminationRoundCount(12, 2)).toBe(4); // partial, QF, SF, GF
    expect(eliminationRoundCount(3, 2)).toBe(2);
    expect(eliminationRoundCount(16, 2)).toBe(4);
    expect(eliminationRoundCount(24, 4)).toBe(4); // partial, QF, SF, GF
    expect(eliminationRoundCount(6, 4)).toBe(2);
    expect(eliminationRoundCount(16, 4)).toBe(3);
    expect(eliminationRoundCount(5, 4)).toBe(0);
    expect(validateBreakSize(5, 4)).toMatch(/even/);
    expect(validateBreakSize(12, 2)).toBe("");
  });

  it("throws instead of returning an empty full bracket", () => {
    const breaking = Array.from({ length: 12 }, (_, index) => ({ team: team(index + 1), seed: index + 1 }));
    expect(() => generateEliminationDraw(breaking, "bp", 12)).toThrow(/cannot be built for 12 teams/);
    expect(() => generateEliminationDraw(breaking, "uadc", 12)).toThrow(/cannot be built for 12 teams/);
  });
});

describe("planEliminationRound", () => {
  it("gives the top seeds byes in a two-team partial elimination", () => {
    const plan = planEliminationRound(positioned(12), "uadc");
    expect(plan.byes.map((entry) => entry.position)).toEqual([1, 2, 3, 4]);
    expect(seedsOf(plan)).toEqual([[5, 12], [6, 11], [7, 10], [8, 9]]);
    expect(plan.rooms[0].teams.map((slot) => slot.side)).toEqual(["AFF", "NEG"]);
  });

  it("builds BP partial rooms whose advancers fill the next full round", () => {
    const plan = planEliminationRound(positioned(24), "bp");
    expect(plan.byes).toHaveLength(8);
    expect(seedsOf(plan)).toEqual([
      [9, 16, 17, 24],
      [10, 15, 18, 23],
      [11, 14, 19, 22],
      [12, 13, 20, 21],
    ]);
    const allSeeds = [...plan.byes.map((entry) => entry.position), ...seedsOf(plan).flat()].sort((a, b) => a - b);
    expect(allSeeds).toEqual(Array.from({ length: 24 }, (_, index) => index + 1));
  });

  it("uses the standard bracket for a full field and keeps positions on slots", () => {
    const plan = planEliminationRound(positioned(8), "uadc");
    expect(plan.byes).toEqual([]);
    expect(seedsOf(plan)).toEqual([[1, 8], [4, 5], [2, 7], [3, 6]]);
    expect(plan.rooms[0].teams.map((slot) => slot.position)).toEqual([1, 8]);
  });

  it("orders by position rather than by input order", () => {
    const shuffled = [...positioned(4)].reverse();
    expect(seedsOf(planEliminationRound(shuffled, "uadc"))).toEqual([[1, 4], [2, 3]]);
  });

  it("rejects invalid fields and duplicated positions with clear errors", () => {
    expect(() => planEliminationRound(positioned(7), "bp")).toThrow(/even number/);
    expect(() => planEliminationRound(positioned(1), "uadc")).toThrow(/at least 2/);
    const duplicated = positioned(4).map((entry, index) => (index === 3 ? { ...entry, position: 1 } : entry));
    expect(() => planEliminationRound(duplicated, "uadc")).toThrow(/bracket position 1/);
  });
});

describe("resolveBracketPositions", () => {
  it("lets the winner inherit the room's best position and byes keep their seed", () => {
    const debate = {
      id: "d1",
      roundSeq: 5,
      teams: {
        AFF: { teamId: "team-3", teamName: "Seed 3", side: "AFF", bracketPosition: 3 },
        NEG: { teamId: "team-6", teamName: "Seed 6", side: "NEG", bracketPosition: 6 },
      },
    } as unknown as Debate;
    const survivors = [team(1), team(6)];
    const result = resolveBracketPositions(survivors, (item) => Number(item.id.split("-")[1]), [debate]);
    expect(result.map((entry) => [entry.team.id, entry.position])).toEqual([
      ["team-1", 1],
      ["team-6", 3],
    ]);
  });

  it("gives BP advancers the two best positions in their room", () => {
    const debate = {
      id: "d1",
      roundSeq: 5,
      teams: {
        OG: { teamId: "a", side: "OG", bracketPosition: 9 },
        OO: { teamId: "b", side: "OO", bracketPosition: 16 },
        CG: { teamId: "c", side: "CG", bracketPosition: 17 },
        CO: { teamId: "d", side: "CO", bracketPosition: 24 },
      },
    } as unknown as Debate;
    const survivors = [team(0, { id: "d" }), team(0, { id: "b" })];
    const result = resolveBracketPositions(survivors, () => 99, [debate]);
    expect(result.map((entry) => [entry.team.id, entry.position])).toEqual([
      ["d", 16],
      ["b", 9],
    ]);
  });
});

describe("partial eliminations through generateRoundDraw", () => {
  const tournament = {
    id: "t1",
    format: "uadc",
    preferences: { teamsInDebate: 2, sideAllocationRule: "balanced" },
  } as Tournament;
  const venues: Venue[] = Array.from({ length: 4 }, (_, index) => ({
    id: `v${index + 1}`,
    tournamentId: "t1",
    name: `Room ${index + 1}`,
    priority: 10 - index,
  }));
  const standings = Array.from({ length: 6 }, (_, index) => ({
    teamId: `team-${index + 1}`,
    rank: index + 1,
  })) as TeamStandingRow[];
  const round = (id: string, seq: number): Round => ({
    id,
    tournamentId: "t1",
    seq,
    name: id,
    abbreviation: id,
    stage: "elimination",
    drawType: "elimination",
    drawStatus: "none",
    feedbackWeight: 1,
    silent: false,
    motionsReleased: false,
    resultsReleased: false,
    completed: false,
    createdAt: "",
    breakCategoryIds: ["open"],
  });

  it("draws byes, advances them without ballots and keeps bracket position after an upset", () => {
    const breakingTeams = Array.from({ length: 6 }, (_, index) => team(index + 1));
    const partialRound = round("partial", 6);
    expect(getRequiredVenueCount(tournament, partialRound, breakingTeams)).toBe(2);

    const partial = generateRoundDraw({
      tournament,
      round: partialRound,
      teams: breakingTeams,
      venues,
      pastDebates: [],
      standings,
    });
    const byeDebates = partial.filter((debate) => debate.byeTeamId);
    const contested = partial.filter((debate) => !debate.byeTeamId);
    expect(byeDebates.map((debate) => debate.byeTeamId)).toEqual(["team-1", "team-2"]);
    expect(byeDebates.every((debate) => debate.flags.includes("elimination_bye"))).toBe(true);
    expect(contested.map((debate) => [debate.teams.AFF.teamId, debate.teams.NEG.teamId])).toEqual([
      ["team-3", "team-6"],
      ["team-4", "team-5"],
    ]);
    expect(contested[0].teams.AFF.bracketPosition).toBe(3);

    // Seed 6 upsets seed 3; seed 4 beats seed 5.
    const winnerBySide = { [contested[0].id]: "NEG", [contested[1].id]: "AFF" } as const;
    const ballots = contested.map((debate) => ({
      id: `b-${debate.id}`,
      debateId: debate.id,
      roundId: debate.roundId,
      confirmed: true,
      discarded: false,
      teamScores: {
        AFF: { side: "AFF", teamId: debate.teams.AFF.teamId, points: winnerBySide[debate.id] === "AFF" ? 1 : 0, win: winnerBySide[debate.id] === "AFF", totalSpeakerScore: 0 },
        NEG: { side: "NEG", teamId: debate.teams.NEG.teamId, points: winnerBySide[debate.id] === "NEG" ? 1 : 0, win: winnerBySide[debate.id] === "NEG", totalSpeakerScore: 0 },
      },
    })) as unknown as BallotSubmission[];
    const advancing = getAdvancingTeamIds(partial, ballots, "uadc");
    expect([...advancing].sort()).toEqual(["team-1", "team-2", "team-4", "team-6"]);
    const afterPartial = applyEliminationAdvancement(breakingTeams, partial, advancing, partialRound.id);

    const semis = generateRoundDraw({
      tournament,
      round: round("semis", 7),
      teams: afterPartial,
      venues,
      pastDebates: partial,
      standings,
    });
    // Positions 1 v 4 and 2 v 3: seed 6 holds position 3, so it meets seed 2, not seed 1.
    expect(semis.map((debate) => [debate.teams.AFF.teamId, debate.teams.NEG.teamId])).toEqual([
      ["team-1", "team-4"],
      ["team-2", "team-6"],
    ]);
    expect(semis.some((debate) => debate.byeTeamId)).toBe(false);
  });

  it("throws a clear error when the eligible field cannot be drawn", () => {
    const bpTournament = { ...tournament, format: "bp", preferences: { teamsInDebate: 4 } } as Tournament;
    expect(() =>
      generateRoundDraw({
        tournament: bpTournament,
        round: round("bp-elim", 6),
        teams: Array.from({ length: 7 }, (_, index) => team(index + 1)),
        venues,
        pastDebates: [],
        standings,
      })
    ).toThrow(/even number of teams/);
  });
});

import { describe, expect, it } from "vitest";
import type { BreakCategory, Round, Team, Tournament } from "@/types";
import {
  calculateBreakLiveness,
  categoryLiveThresholds,
  debateLiveness,
  importanceByLiveness,
  livenessStatus,
  roundBreakLiveness,
} from "./liveness";

/*
 * Hand-checked against Tabbycat breakqual/liveness.py.
 *
 * Two-team, 16 teams, 3 preliminary rounds: C(3, i) = 1, 3, 3, 1, scaled by 16 / 2^3 = 2, 6, 6, 2.
 * Running sums (ceil and floor alike) 2, 8, 14, 16. For an open break of 4: the first sum above 4
 * is at index 1, so safe = 3 - (1 - 1) = 3 and the highest non-breaking score is 3 - 1 = 2;
 * dead = 2 - (rounds to go) - 1.
 */
const twoTeam = { teamsPerDebate: 2 as const, totalTeams: 16, totalPrelimRounds: 3 };

function team(id: string, breakCategories: string[] = [], extra: Partial<Team> = {}): Team {
  return { id, tournamentId: "t", name: id, speakers: [], breakCategories, speakerCategories: [], ...extra };
}

function category(id: string, breakSize: number, isGeneral: boolean, priority: number): BreakCategory {
  return { id, tournamentId: "t", name: id, slug: id, seq: priority, breakSize, reserveSize: 0, isGeneral, priority };
}

describe("categoryLiveThresholds", () => {
  it("general category: safe and dead from the team and round counts", () => {
    // Before round 3: one round to go, dead = 2 - 1 - 1 = 0.
    expect(categoryLiveThresholds({ ...twoTeam, isGeneral: true, roundSeq: 3, breakSize: 4 })).toEqual({ safe: 3, dead: 0 });
    // Before round 2: two rounds to go, nobody can be dead yet (dead = 2 - 2 - 1 = -1).
    expect(categoryLiveThresholds({ ...twoTeam, isGeneral: true, roundSeq: 2, breakSize: 4 })).toEqual({ safe: 3, dead: -1 });
  });

  it("non-general category: the category's own scores lower safe and set dead", () => {
    // ESL break of 2, scores after two rounds 2, 2, 0, 0, 0, 0; one round to go.
    // safe = min(3, scores[2] + 1 + 1) = 2; dead = scores[1] - 1 - 1 = 0.
    expect(
      categoryLiveThresholds({ ...twoTeam, isGeneral: false, roundSeq: 3, breakSize: 2, categoryScores: [2, 2, 0, 0, 0, 0] })
    ).toEqual({ safe: 2, dead: 0 });
    // Scores 2, 1, 1, 0, 0, 0: the third team (on 1) can still catch the second, so safe stays 3;
    // dead = 1 - 1 - 1 = -1, nobody is dead.
    expect(
      categoryLiveThresholds({ ...twoTeam, isGeneral: false, roundSeq: 3, breakSize: 2, categoryScores: [2, 1, 1, 0, 0, 0] })
    ).toEqual({ safe: 3, dead: -1 });
  });

  it("non-general category: more rounds remaining loosen both bounds", () => {
    // After round 1 (scores 1, 1, 0, 0, 0, 0), two rounds to go:
    // safe = min(3, 0 + 2 + 1) = 3; dead = 1 - 2 - 1 = -2.
    expect(
      categoryLiveThresholds({ ...twoTeam, isGeneral: false, roundSeq: 2, breakSize: 2, categoryScores: [1, 1, 0, 0, 0, 0] })
    ).toEqual({ safe: 3, dead: -2 });
  });

  it("everyone is safe when a category has no more teams than its break", () => {
    expect(
      categoryLiveThresholds({ ...twoTeam, isGeneral: false, roundSeq: 2, breakSize: 2, categoryScores: [1, 0] })
    ).toEqual({ safe: 0, dead: -1 });
    expect(
      categoryLiveThresholds({ teamsPerDebate: 4, totalTeams: 16, totalPrelimRounds: 3, isGeneral: false, roundSeq: 2, breakSize: 4, categoryScores: [3, 2] })
    ).toEqual({ safe: -1, dead: -1 });
  });

  it("returns null for a break of one team or less (Tabbycat shows no status)", () => {
    expect(categoryLiveThresholds({ ...twoTeam, isGeneral: true, roundSeq: 2, breakSize: 1 })).toBeNull();
  });

  it("British Parliamentary general category", () => {
    // 3 rounds: quadrinomial row 1, 3, 6, 10, 12, 12, 10, 6, 3, 1 (sum 64). 16 teams / 64 = 1/4:
    // ceil sums 1, 2, 4, 7 -> first above 4 at index 3, safe = 9 - 2 = 7;
    // floor sums 0, 0, 1, 3, 6 -> first above 4 at index 4, highest non-breaking = 5;
    // before round 3 (3 points to go) dead = 5 - 3 - 1 = 1.
    expect(
      categoryLiveThresholds({ teamsPerDebate: 4, totalTeams: 16, totalPrelimRounds: 3, isGeneral: true, roundSeq: 3, breakSize: 4 })
    ).toEqual({ safe: 7, dead: 1 });
  });
});

describe("livenessStatus", () => {
  it("is safe at or above safe, dead at or below dead, live in between", () => {
    const thresholds = { safe: 3, dead: 0 };
    expect(livenessStatus(thresholds, 3)).toBe("safe");
    expect(livenessStatus(thresholds, 2)).toBe("live");
    expect(livenessStatus(thresholds, 1)).toBe("live");
    expect(livenessStatus(thresholds, 0)).toBe("dead");
    expect(livenessStatus(thresholds, undefined)).toBe("dead");
  });
});

describe("calculateBreakLiveness across several categories", () => {
  // 16 teams; ESL teams e1-e6. Before round 3 of 3: open break 4, ESL break 2.
  const eslIds = ["e1", "e2", "e3", "e4", "e5", "e6"];
  const others = Array.from({ length: 10 }, (_, index) => `o${index + 1}`);
  const teams = [
    ...eslIds.map((id) => team(id, ["esl"])),
    ...others.map((id) => team(id)),
    team("swing", [], { isSwing: true }),
  ];
  const points = new Map<string, number>([
    ["e1", 2], ["e2", 2], ["e3", 0], ["e4", 0], ["e5", 0], ["e6", 0],
    ["o1", 2], ["o2", 2], ["o3", 1], ["o4", 1], ["o5", 1], ["o6", 1], ["o7", 0],
  ]);
  const categories = [category("open", 4, true, 10), category("esl", 2, false, 5)];
  const liveness = calculateBreakLiveness({ teamsPerDebate: 2, categories, teams, pointsByTeam: points, roundSeq: 3, totalPrelimRounds: 3 });

  it("computes thresholds per category", () => {
    expect(liveness.thresholds.get("open")).toEqual({ safe: 3, dead: 0 });
    expect(liveness.thresholds.get("esl")).toEqual({ safe: 2, dead: 0 });
  });

  it("gives each team a status in every category it belongs to", () => {
    // e1 on 2: live for the open break (2 < 3) but already safe for ESL (2 >= 2).
    expect(liveness.byTeam.get("e1")).toEqual([
      { categoryId: "open", status: "live" },
      { categoryId: "esl", status: "safe" },
    ]);
    // e3 on 0: dead in both.
    expect(liveness.byTeam.get("e3")).toEqual([
      { categoryId: "open", status: "dead" },
      { categoryId: "esl", status: "dead" },
    ]);
    // o3 on 1 is only in the open category; o8 has no results (0 points) and is dead.
    expect(liveness.byTeam.get("o3")).toEqual([{ categoryId: "open", status: "live" }]);
    expect(liveness.byTeam.get("o8")).toEqual([{ categoryId: "open", status: "dead" }]);
    expect(liveness.byTeam.has("swing")).toBe(false);
  });

  it("leaves a team the director marked ineligible out of a general category", () => {
    const open = { ...category("open", 4, true, 10), teamOverrides: { o1: "ineligible" as const } };
    const result = calculateBreakLiveness({ teamsPerDebate: 2, categories: [open], teams, pointsByTeam: points, roundSeq: 3, totalPrelimRounds: 3 });
    expect(result.byTeam.has("o1")).toBe(false);
  });

  it("counts a debate's live (team, category) pairs", () => {
    // e1 (live open, safe ESL) + o3 (live open) = 2; e3 v o7 (all dead) = 0.
    expect(debateLiveness(["e1", "o3"], liveness)).toBe(2);
    expect(debateLiveness(["e3", "o7"], liveness)).toBe(0);
  });
});

describe("importanceByLiveness", () => {
  it("marks safe rooms neutral, dead rooms unimportant and every other room important", () => {
    const points = new Map([["a", 3], ["b", 3], ["c", 2], ["d", 1], ["e", 0], ["f", 0]]);
    const importance = importanceByLiveness(
      [
        { id: "safe", teamIds: ["a", "b"] },
        { id: "live", teamIds: ["c", "d"] },
        { id: "dead", teamIds: ["e", "f"] },
        // Tabbycat: neither the lowest team safe nor the highest team dead, so it is important.
        { id: "mixed", teamIds: ["a", "e"] },
      ],
      points,
      { safe: 3, dead: 0 }
    );
    expect(Object.fromEntries(importance)).toEqual({ safe: 7, live: 10, dead: 0, mixed: 10 });
  });
});

describe("roundBreakLiveness", () => {
  const teams = Array.from({ length: 16 }, (_, index) => team(`t${index + 1}`));
  const round = (id: string, seq: number, extra: Partial<Round> = {}) =>
    ({ id, seq, name: id, stage: "preliminary", ...extra }) as Round;
  const rounds = [
    round("r1", 1, { completed: true }),
    round("r2", 2, { cancelled: true }),
    round("r3", 3, { completed: true }),
    round("r4", 4),
    round("final", 5, { stage: "elimination" }),
  ];
  const source = {
    tournament: { id: "t", format: "australs", preferences: {} } as unknown as Tournament,
    rounds,
    teams,
    debates: [],
    ballots: [],
    breakCategories: [category("open", 4, true, 10)],
  };

  it("defaults to the next preliminary round, counting only non-cancelled preliminary rounds", () => {
    const result = roundBreakLiveness(source)!;
    // r4 is the third of three preliminary rounds (r2 is cancelled): one round to go.
    expect(result.roundSeq).toBe(3);
    expect(result.thresholds.get("open")).toEqual({ safe: 3, dead: 0 });
    // No results yet, so every team is on 0 points: dead with one round to go.
    expect(result.byTeam.get("t1")).toEqual([{ categoryId: "open", status: "dead" }]);
  });

  it("reads raw points, not round-weighted points, as Tabbycat's Sum(points)", () => {
    const weighted = rounds.map((item) => (item.id === "r3" ? ({ ...item, weight: 3 } as Round) : item));
    const debate = {
      id: "d3",
      tournamentId: "t",
      roundId: "r3",
      roundSeq: 3,
      teams: { AFF: { teamId: "t1", teamName: "t1", side: "AFF" }, NEG: { teamId: "t2", teamName: "t2", side: "NEG" } },
      adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    } as unknown as import("@/types").Debate;
    const ballot = {
      id: "b3",
      tournamentId: "t",
      roundId: "r3",
      debateId: "d3",
      version: 1,
      confirmed: true,
      discarded: false,
      submitterType: "tabroom",
      timestamp: "",
      speakerScores: { AFF: [], NEG: [] },
      teamScores: {
        AFF: { side: "AFF", teamId: "t1", points: 1, win: true, totalSpeakerScore: 0 },
        NEG: { side: "NEG", teamId: "t2", points: 0, totalSpeakerScore: 0 },
      },
    } as unknown as import("@/types").BallotSubmission;
    const result = roundBreakLiveness({ ...source, rounds: weighted, debates: [debate], ballots: [ballot] })!;
    expect(result.pointsByTeam.get("t1")).toBe(1);
  });

  it("is null for an elimination round and once there are no break categories", () => {
    expect(roundBreakLiveness(source, rounds[4])).toBeNull();
    expect(roundBreakLiveness({ ...source, breakCategories: [] })).toBeNull();
  });
});

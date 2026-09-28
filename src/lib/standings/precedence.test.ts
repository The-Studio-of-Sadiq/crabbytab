import { describe, it, expect } from "vitest";
import { calculateStandings } from "./calculator";
import { resolveTeamPrecedence, resolveSpeakerPrecedence, compareByPrecedence } from "./precedence";
import { DEFAULT_TEAM_PRECEDENCE, DEFAULT_SPEAKER_PRECEDENCE, TEAM_METRIC_DIRECTION } from "./metrics";
import { Tournament, Round, Team, Debate, BallotSubmission, DebateSide } from "@/types";

function tournament(format: "bp" | "uadc", overrides: Partial<Tournament["preferences"]> = {}): Tournament {
  return {
    id: "tourn-test",
    name: "Test Tournament",
    shortName: "Test",
    slug: "test",
    format,
    active: true,
    ownerId: "director",
    admins: {},
    preferences: {
      teamsInDebate: format === "bp" ? 4 : 2,
      substantiveSpeakers: format === "bp" ? 2 : 3,
      replyScoresEnabled: format !== "bp",
      minSpeakerScore: 68,
      maxSpeakerScore: 84,
      stepSpeakerScore: 1,
      minReplyScore: 34,
      maxReplyScore: 42,
      drawRule: "power_paired",
      sideAllocationRule: "balanced",
      ballotDoubleEntry: false,
      publicDraw: true,
      publicResults: true,
      publicStandings: true,
      publicMotions: true,
      feedbackEnabled: true,
      feedbackMinScore: 1,
      feedbackMaxScore: 10,
      ...overrides,
    },
    createdAt: "",
    updatedAt: "",
  };
}

function team(id: string, name: string, speakers: { id: string; name: string }[] = []): Team {
  return { id, tournamentId: "tourn-test", name, speakers, breakCategories: [], speakerCategories: [] };
}

const round: Round = {
  id: "r1",
  tournamentId: "tourn-test",
  seq: 1,
  name: "Round 1",
  abbreviation: "R1",
  stage: "preliminary",
  drawType: "random",
  drawStatus: "confirmed",
  feedbackWeight: 1,
  silent: false,
  motionsReleased: true,
  resultsReleased: true,
  completed: true,
  createdAt: "",
};

function bpDebate(id: string, roundSeq: number, teams: Record<DebateSide, string>): Debate {
  return {
    id,
    tournamentId: "tourn-test",
    roundId: round.id,
    roundSeq,
    bracket: 0,
    roomRank: 1,
    importance: 0,
    resultStatus: "confirmed",
    sidesConfirmed: true,
    flags: [],
    teams: {
      OG: { teamId: teams.OG, teamName: teams.OG, side: "OG" },
      OO: { teamId: teams.OO, teamName: teams.OO, side: "OO" },
      CG: { teamId: teams.CG, teamName: teams.CG, side: "CG" },
      CO: { teamId: teams.CO, teamName: teams.CO, side: "CO" },
    } as any,
    adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
  };
}

function bpBallot(id: string, debateId: string, points: Record<DebateSide, number>, speaks: Record<DebateSide, number>): BallotSubmission {
  const mk = (side: DebateSide, s1: number, s2: number) => [
    { speakerId: `${side}-1`, speakerName: `${side}-1`, position: 1, score: s1 },
    { speakerId: `${side}-2`, speakerName: `${side}-2`, position: 2, score: s2 },
  ];
  return {
    id,
    tournamentId: "tourn-test",
    roundId: round.id,
    debateId,
    version: 1,
    confirmed: true,
    discarded: false,
    submitterType: "tabroom",
    timestamp: "",
    speakerScores: {
      OG: mk("OG" as any, speaks.OG / 2, speaks.OG / 2),
      OO: mk("OO" as any, speaks.OO / 2, speaks.OO / 2),
      CG: mk("CG" as any, speaks.CG / 2, speaks.CG / 2),
      CO: mk("CO" as any, speaks.CO / 2, speaks.CO / 2),
    } as any,
    teamScores: {
      OG: { side: "OG", teamId: "", points: points.OG, totalSpeakerScore: speaks.OG },
      OO: { side: "OO", teamId: "", points: points.OO, totalSpeakerScore: speaks.OO },
      CG: { side: "CG", teamId: "", points: points.CG, totalSpeakerScore: speaks.CG },
      CO: { side: "CO", teamId: "", points: points.CO, totalSpeakerScore: speaks.CO },
    } as any,
  };
}

describe("resolveTeamPrecedence / resolveSpeakerPrecedence", () => {
  it("falls back to the exact legacy default chain when unset", () => {
    expect(resolveTeamPrecedence("bp", {})).toEqual(DEFAULT_TEAM_PRECEDENCE.bp);
    expect(resolveTeamPrecedence("uadc", {})).toEqual(DEFAULT_TEAM_PRECEDENCE.two_team);
    expect(resolveSpeakerPrecedence({})).toEqual(DEFAULT_SPEAKER_PRECEDENCE);
  });

  it("uses a custom precedence, deduplicated and capped at 8", () => {
    const p = resolveTeamPrecedence("bp", {
      teamStandingsPrecedence: ["speaks_sum", "points", "speaks_sum", "wins", "points", "firsts", "seconds", "thirds", "pullups"],
    } as any);
    expect(p).toEqual(["speaks_sum", "points", "wins", "firsts", "seconds", "thirds", "pullups"].slice(0, 8));
    expect(p.length).toBeLessThanOrEqual(8);
  });

  it("ignores unknown metric ids", () => {
    const p = resolveTeamPrecedence("bp", { teamStandingsPrecedence: ["not_a_metric", "points"] as any });
    expect(p).toEqual(["points"]);
  });
});

describe("compareByPrecedence", () => {
  it("orders speaks_stddev ascending (lower ranks higher) while everything else is descending", () => {
    const a = { speaks_stddev: 2 } as any;
    const b = { speaks_stddev: 5 } as any;
    expect(compareByPrecedence(a, b, ["speaks_stddev"], TEAM_METRIC_DIRECTION)).toBeLessThan(0); // a ranks first
  });
});

describe("calculateStandings: BP default precedence reproduces legacy order exactly", () => {
  it("points, then speaks_sum, then firsts/seconds/thirds", () => {
    const t = tournament("bp");
    const teams = [team("t1", "A"), team("t2", "B"), team("t3", "C"), team("t4", "D")];
    const debate = bpDebate("d1", 1, { OG: "t1", OO: "t2", CG: "t3", CO: "t4" });
    const ballot = bpBallot("b1", "d1", { OG: 3, OO: 2, CG: 1, CO: 0 }, { OG: 157, OO: 153, CG: 150, CO: 147 });

    const result = calculateStandings(t, [round], teams, [debate], [ballot]);
    expect(result.teams.map((r) => r.teamId)).toEqual(["t1", "t2", "t3", "t4"]);
    expect(result.teams.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(result.teams[0].metrics.points).toBe(3);
    expect(result.teams[0].metrics.firsts).toBe(1);
  });

  it("breaks a points tie with speaks_sum, matching the pre-existing tiebreak", () => {
    const t = tournament("bp");
    const teams = [team("t1", "A"), team("t2", "B"), team("t3", "C"), team("t4", "D")];
    // Two rounds: t1 and t2 both end with 3 points total, but t2 has more speaks.
    const d1 = bpDebate("d1", 1, { OG: "t1", OO: "t2", CG: "t3", CO: "t4" });
    const b1 = bpBallot("b1", "d1", { OG: 3, OO: 0, CG: 2, CO: 1 }, { OG: 150, OO: 145, CG: 150, CO: 145 });
    const d2 = bpDebate("d2", 2, { OG: "t2", OO: "t1", CG: "t4", CO: "t3" });
    const b2 = bpBallot("b2", "d2", { OG: 3, OO: 0, CG: 2, CO: 1 }, { OG: 160, OO: 150, CG: 145, CO: 140 });

    const result = calculateStandings(t, [round, { ...round, id: "r2", seq: 2 }], teams, [d1, d2], [b1, b2]);
    const t1 = result.teams.find((r) => r.teamId === "t1")!;
    const t2 = result.teams.find((r) => r.teamId === "t2")!;
    expect(t1.metrics.points).toBe(t2.metrics.points); // both 3 total points
    expect(t2.metrics.speaks_sum).toBeGreaterThan(t1.metrics.speaks_sum);
    expect(t2.rank).toBeLessThan(t1.rank); // t2 ranks above t1 on speaks_sum
  });
});

describe("calculateStandings: custom precedence changes the order", () => {
  it("ranking purely by speaks_sum overrides the points-first default", () => {
    const t = tournament("bp", { teamStandingsPrecedence: ["speaks_sum"] } as any);
    const teams = [team("t1", "A"), team("t2", "B"), team("t3", "C"), team("t4", "D")];
    // t4 has the fewest points but the highest speaks.
    const debate = bpDebate("d1", 1, { OG: "t1", OO: "t2", CG: "t3", CO: "t4" });
    const ballot = bpBallot("b1", "d1", { OG: 3, OO: 2, CG: 1, CO: 0 }, { OG: 100, OO: 110, CG: 120, CO: 200 });

    const result = calculateStandings(t, [round], teams, [debate], [ballot]);
    expect(result.teams[0].teamId).toBe("t4");
    expect(result.teams.map((r) => r.teamId)).toEqual(["t4", "t3", "t2", "t1"]);
  });

  it("draw_strength_wins ranks a team above an equal-points team that beat weaker opposition", () => {
    const t = tournament("uadc", { teamStandingsPrecedence: ["wins", "draw_strength_wins"] } as any);
    // Round 1: t1 beats t2 (strong opponent, who then wins round 2); t3 beats t4 (weak opponent, who then loses round 2).
    const teams = ["t1", "t2", "t3", "t4"].map((id) => team(id, id));
    const r1 = round;
    const r2: Round = { ...round, id: "r2", seq: 2 };

    const twoTeamDebate = (id: string, roundSeq: number, aff: string, neg: string): Debate => ({
      id,
      tournamentId: "tourn-test",
      roundId: roundSeq === 1 ? r1.id : r2.id,
      roundSeq,
      bracket: 0,
      roomRank: 1,
      importance: 0,
      resultStatus: "confirmed",
      sidesConfirmed: true,
      flags: [],
      teams: {
        AFF: { teamId: aff, teamName: aff, side: "AFF" },
        NEG: { teamId: neg, teamName: neg, side: "NEG" },
      } as any,
      adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    });
    const twoTeamBallot = (id: string, debateId: string, affWin: boolean): BallotSubmission => ({
      id,
      tournamentId: "tourn-test",
      roundId: "r",
      debateId,
      version: 1,
      confirmed: true,
      discarded: false,
      submitterType: "tabroom",
      timestamp: "",
      speakerScores: { AFF: [], NEG: [] } as any,
      teamScores: {
        AFF: { side: "AFF", teamId: "", points: affWin ? 1 : 0, totalSpeakerScore: 0, win: affWin },
        NEG: { side: "NEG", teamId: "", points: affWin ? 0 : 1, totalSpeakerScore: 0, win: !affWin },
      } as any,
    });

    const d1 = twoTeamDebate("d1", 1, "t1", "t2"); // t1 beats t2
    const d2 = twoTeamDebate("d2", 1, "t3", "t4"); // t3 beats t4
    const d3 = twoTeamDebate("d3", 2, "t2", "?"); // placeholder, replaced below
    const debates = [
      d1,
      d2,
      // Round 2: t2 (t1's beaten opponent) wins; t4 (t3's beaten opponent) loses.
      twoTeamDebate("d3", 2, "t2", "x"),
      twoTeamDebate("d4", 2, "t4", "y"),
    ];
    const ballots = [
      twoTeamBallot("b1", "d1", true),
      twoTeamBallot("b2", "d2", true),
      twoTeamBallot("b3", "d3", true), // t2 wins round 2
      twoTeamBallot("b4", "d4", false), // t4 loses round 2
    ];
    const allTeams = [...teams, team("x", "x"), team("y", "y")];

    const result = calculateStandings(t, [r1, r2], allTeams, debates, ballots);
    const t1 = result.teams.find((r) => r.teamId === "t1")!;
    const t3 = result.teams.find((r) => r.teamId === "t3")!;
    expect(t1.metrics.wins).toBe(t3.metrics.wins); // both 1-0 after round 1
    expect(t1.metrics.draw_strength_wins).toBeGreaterThan(t3.metrics.draw_strength_wins);
    expect(t1.rank).toBeLessThan(t3.rank);
  });
});

describe("calculateStandings: pullups metric", () => {
  it("counts a team as pulled up only when its debate slot says so", () => {
    const t = tournament("bp");
    const teams = [team("t1", "A"), team("t2", "B"), team("t3", "C"), team("t4", "D")];
    const debate: Debate = {
      ...bpDebate("d1", 1, { OG: "t1", OO: "t2", CG: "t3", CO: "t4" }),
    };
    debate.teams.OG.pulledUp = true;
    const ballot = bpBallot("b1", "d1", { OG: 3, OO: 2, CG: 1, CO: 0 }, { OG: 150, OO: 150, CG: 150, CO: 150 });

    const result = calculateStandings(t, [round], teams, [debate], [ballot]);
    expect(result.teams.find((r) => r.teamId === "t1")!.metrics.pullups).toBe(1);
    expect(result.teams.find((r) => r.teamId === "t2")!.metrics.pullups).toBe(0);
  });
});

describe("calculateStandings: speaker precedence and trimmed mean", () => {
  it("default speaker precedence (speaks_sum then speaks_avg) matches the old sort", () => {
    const t = tournament("bp");
    const teams = [team("t1", "A", [{ id: "s1", name: "Alice" }, { id: "s2", name: "Bob" }])];
    const debate = bpDebate("d1", 1, { OG: "t1", OO: "t1", CG: "t1", CO: "t1" }); // not realistic, only need speaker scores
    const ballot: BallotSubmission = {
      id: "b1",
      tournamentId: "tourn-test",
      roundId: round.id,
      debateId: "d1",
      version: 1,
      confirmed: true,
      discarded: false,
      submitterType: "tabroom",
      timestamp: "",
      speakerScores: {
        OG: [
          { speakerId: "s1", speakerName: "Alice", position: 1, score: 80 },
          { speakerId: "s2", speakerName: "Bob", position: 2, score: 70 },
        ],
      } as any,
      teamScores: {} as any,
    };
    const result = calculateStandings(t, [round], teams, [debate], [ballot]);
    expect(result.speakers[0].speakerId).toBe("s1");
    expect(result.speakers[0].metrics.speaks_sum).toBe(80);
  });

  it("speaks_trimmed_mean drops the configured number of lowest scores", () => {
    const t = tournament("bp", { speakerTrim: 1 } as any);
    const teams = [team("t1", "A", [{ id: "s1", name: "Alice" }])];
    const rounds = [1, 2, 3].map((n) => ({ ...round, id: `r${n}`, seq: n }));
    const debates = rounds.map((r) => bpDebate(`d${r.seq}`, r.seq, { OG: "t1", OO: "t1", CG: "t1", CO: "t1" }));
    const scores = [60, 70, 80]; // trim 1 lowest (60) -> mean of [70, 80] = 75
    const ballots = debates.map((d, i) => ({
      id: `b${i}`,
      tournamentId: "tourn-test",
      roundId: d.roundId,
      debateId: d.id,
      version: 1,
      confirmed: true,
      discarded: false,
      submitterType: "tabroom" as const,
      timestamp: "",
      speakerScores: { OG: [{ speakerId: "s1", speakerName: "Alice", position: 1, score: scores[i] }] } as any,
      teamScores: {} as any,
    }));

    const result = calculateStandings(t, rounds, teams, debates, ballots);
    expect(result.speakers[0].metrics.speaks_trimmed_mean).toBe(75);
    expect(result.speakers[0].metrics.speaks_sum).toBe(210);
  });
});

describe("calculateStandings: ties still share rank with no data", () => {
  it("two teams with nothing played share rank 1", () => {
    const t = tournament("bp");
    const teams = [team("t1", "Alpha"), team("t2", "Beta")];
    const result = calculateStandings(t, [], teams, [], []);
    expect(result.teams[0].rank).toBe(1);
    expect(result.teams[1].rank).toBe(1);
  });
});

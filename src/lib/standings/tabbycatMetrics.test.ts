import { describe, expect, it } from "vitest";
import type { BallotSubmission, Debate, Round, SpeakerScoreEntry, Team, TeamStandingRow, Tournament, TournamentPreferences } from "@/types";
import { calculateStandings } from "./calculator";
import { TEAM_METRIC_DIRECTION, trimmedMean } from "./metrics";
import { annotateWhoBeatWhom, compareTeamsByPrecedence, resolveTeamExtra, resolveTeamPrecedence } from "./precedence";

/* Golden cases for the Tabbycat 2.x standings rules added in wave 2 (#8). */

function tournament(preferences: Partial<TournamentPreferences> = {}): Tournament {
  return {
    id: "t",
    name: "T",
    shortName: "T",
    slug: "t",
    format: "australs",
    active: true,
    ownerId: "o",
    admins: {},
    preferences: {
      teamsInDebate: 2,
      substantiveSpeakers: 3,
      replyScoresEnabled: false,
      minSpeakerScore: 60,
      maxSpeakerScore: 80,
      stepSpeakerScore: 1,
      minReplyScore: 30,
      maxReplyScore: 40,
      drawRule: "power_paired",
      sideAllocationRule: "balanced",
      ballotDoubleEntry: false,
      publicDraw: true,
      publicResults: true,
      publicStandings: true,
      publicMotions: true,
      feedbackEnabled: false,
      feedbackMinScore: 1,
      feedbackMaxScore: 10,
      ...preferences,
    },
    createdAt: "",
    updatedAt: "",
  };
}

function team(id: string, speakerIds: string[] = [`${id}1`, `${id}2`, `${id}3`]): Team {
  return {
    id,
    tournamentId: "t",
    name: id,
    speakers: speakerIds.map((speakerId) => ({ id: speakerId, name: speakerId })),
    breakCategories: [],
    speakerCategories: [],
  };
}

function round(seq: number): Round {
  return {
    id: `r${seq}`,
    tournamentId: "t",
    seq,
    name: `Round ${seq}`,
    abbreviation: `R${seq}`,
    stage: "preliminary",
    drawType: "power_paired",
    drawStatus: "confirmed",
    feedbackWeight: 0,
    silent: false,
    motionsReleased: true,
    resultsReleased: true,
    completed: true,
    createdAt: "",
  };
}

function debate(id: string, seq: number, aff: string, neg: string): Debate {
  return {
    id,
    tournamentId: "t",
    roundId: `r${seq}`,
    roundSeq: seq,
    bracket: 0,
    roomRank: 1,
    importance: 0,
    resultStatus: "confirmed",
    sidesConfirmed: true,
    flags: [],
    teams: {
      AFF: { teamId: aff, teamName: aff, side: "AFF" },
      NEG: { teamId: neg, teamName: neg, side: "NEG" },
    },
    adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
  } as unknown as Debate;
}

const speeches = (scores: [string, number][]): SpeakerScoreEntry[] =>
  scores.map(([speakerId, score], index) => ({ speakerId, speakerName: speakerId, position: index + 1, score }));

/** A two-team ballot: each side's speeches; the side with `winner` wins. `votes` makes it a voting ballot. */
function ballot(
  d: Debate,
  winner: "AFF" | "NEG",
  aff: [string, number][],
  neg: [string, number][],
  votes?: { AFF: number; NEG: number }
): BallotSubmission {
  const total = (list: [string, number][]) => list.reduce((sum, [, score]) => sum + score, 0);
  const side = (s: "AFF" | "NEG", list: [string, number][]) => ({
    side: s,
    teamId: d.teams[s]!.teamId,
    points: s === winner ? 1 : 0,
    win: s === winner,
    totalSpeakerScore: total(list),
    margin: s === "AFF" ? total(aff) - total(neg) : total(neg) - total(aff),
    ...(votes ? { votes: votes[s] } : {}),
  });
  return {
    id: `b-${d.id}`,
    tournamentId: "t",
    roundId: d.roundId,
    debateId: d.id,
    version: 1,
    confirmed: true,
    discarded: false,
    submitterType: "tabroom",
    timestamp: "",
    speakerScores: { AFF: speeches(aff), NEG: speeches(neg) },
    teamScores: { AFF: side("AFF", aff), NEG: side("NEG", neg) },
    ...(votes
      ? { sheets: Array.from({ length: votes.AFF + votes.NEG }, (_, index) => ({ adjudicatorId: `adj${index}`, speakerScores: {} })) }
      : {}),
  } as unknown as BallotSubmission;
}

/** Three speeches of the same score for a team's three speakers. */
const flat = (teamId: string, score: number): [string, number][] =>
  [1, 2, 3].map((n) => [`${teamId}${n}`, score] as [string, number]);

describe("trimmed mean (Tabbycat's high-low drop)", () => {
  it("drops the highest and lowest score", () => {
    expect(trimmedMean([60, 70, 80, 90], 1)).toBe(75);
    expect(trimmedMean([70, 71, 72, 80, 60], 1)).toBe(71);
  });

  it("is the plain mean when too few scores remain to trim", () => {
    expect(trimmedMean([60, 80], 1)).toBe(70); // Tabbycat: count <= 2 -> plain mean
    expect(trimmedMean([60, 70, 80, 90], 2)).toBe(75);
    expect(trimmedMean([], 1)).toBe(0);
  });

  it("drops N from each end when speakerTrim is N, and nothing when it is 0", () => {
    expect(trimmedMean([50, 60, 70, 80, 99], 2)).toBe(70);
    expect(trimmedMean([60, 70, 80, 90], 0)).toBe(75);
    expect(trimmedMean([60, 61, 90], 0)).toBeCloseTo(70.333, 3);
  });

  it("defaults to dropping one of each in the speaker tab when speakerTrim is unset", () => {
    const teams = [team("A"), team("B")];
    const rounds = [1, 2, 3].map(round);
    const debates = rounds.map((r) => debate(`d${r.seq}`, r.seq, "A", "B"));
    const a1 = [60, 70, 95];
    const ballots = debates.map((d, index) =>
      ballot(d, "AFF", [["A1", a1[index]], ["A2", 70], ["A3", 70]], flat("B", 65))
    );
    const result = calculateStandings(tournament(), rounds, teams, debates, ballots);
    expect(result.speakers.find((row) => row.speakerId === "A1")?.metrics.speaks_trimmed_mean).toBe(70);
  });
});

describe("who-beat-whom", () => {
  // R1: A beats B, C beats D. R2: C beats A, B beats D. A and B both have one win; B has more speaks.
  const teams = [team("A"), team("B"), team("C"), team("D")];
  const rounds = [round(1), round(2)];
  const d = [debate("d1", 1, "A", "B"), debate("d2", 1, "C", "D"), debate("d3", 2, "A", "C"), debate("d4", 2, "B", "D")];
  const ballots = [
    ballot(d[0], "AFF", flat("A", 70), flat("B", 69)),
    ballot(d[1], "AFF", flat("C", 75), flat("D", 74)),
    ballot(d[2], "NEG", flat("A", 70), flat("C", 75)),
    ballot(d[3], "AFF", flat("B", 79), flat("D", 70)),
  ];

  it("ranks the winner of the head-to-head first when exactly two teams are tied", () => {
    const withoutWbw = calculateStandings(
      tournament({ teamStandingsPrecedence: ["wins", "speaks_sum"] }), rounds, teams, d, ballots
    );
    expect(withoutWbw.teams.map((row) => row.teamId)).toEqual(["C", "B", "A", "D"]);

    const withWbw = calculateStandings(
      tournament({ teamStandingsPrecedence: ["wins", "wbw", "speaks_sum"] }), rounds, teams, d, ballots
    );
    expect(withWbw.teams.map((row) => row.teamId)).toEqual(["C", "A", "B", "D"]);
    expect(withWbw.teams.map((row) => row.rank)).toEqual([1, 2, 3, 4]);
    const byId = new Map(withWbw.teams.map((row) => [row.teamId, row]));
    expect(byId.get("A")!.whoBeatWhom).toEqual([1]);
    expect(byId.get("B")!.whoBeatWhom).toEqual([0]);
    // C (2 wins) and D (0 wins) are alone in their groups: n/a.
    expect(byId.get("C")!.whoBeatWhom).toEqual([null]);
    expect(byId.get("D")!.whoBeatWhom).toEqual([null]);
  });

  it("is n/a for three or more tied teams, and teams that never met score 0", () => {
    const rows = ["P", "Q", "R"].map((id) => ({ teamId: id, metrics: { wins: 1 } } as unknown as TeamStandingRow));
    annotateWhoBeatWhom(rows, ["wins", "wbw"], () => 1);
    expect(rows.map((row) => row.whoBeatWhom)).toEqual([[null], [null], [null]]);

    const pair = ["P", "Q"].map((id) => ({ teamId: id, metrics: { wins: 1 } } as unknown as TeamStandingRow));
    annotateWhoBeatWhom(pair, ["wins", "wbw"], () => 0);
    expect(pair.map((row) => row.whoBeatWhom)).toEqual([[0], [0]]);
    expect(compareTeamsByPrecedence(pair[0], pair[1], ["wins", "wbw"])).toBe(0);
  });

  it("evaluates each repeated who-beat-whom against every metric before it", () => {
    // Three teams tied on wins (first wbw n/a); speaks split off R, leaving P and Q for the second.
    const rows = [
      { teamId: "P", metrics: { wins: 1, speaks_sum: 200 } },
      { teamId: "Q", metrics: { wins: 1, speaks_sum: 200 } },
      { teamId: "R", metrics: { wins: 1, speaks_sum: 210 } },
    ] as unknown as TeamStandingRow[];
    const points: Record<string, number> = { "Q>P": 1, "P>Q": 0 };
    const precedence = resolveTeamPrecedence("australs", { teamStandingsPrecedence: ["wins", "wbw", "speaks_sum", "wbw"] });
    expect(precedence).toEqual(["wins", "wbw", "speaks_sum", "wbw"]);
    annotateWhoBeatWhom(rows, precedence, (teamId, otherId) => points[`${teamId}>${otherId}`] ?? 0);
    expect(rows.map((row) => row.whoBeatWhom)).toEqual([[null, 0], [null, 1], [null, null]]);
    const order = [...rows].sort((a, b) => compareTeamsByPrecedence(a, b, precedence)).map((row) => row.teamId);
    expect(order).toEqual(["R", "Q", "P"]);
  });

  it("may repeat in the precedence but is never an extra column", () => {
    expect(resolveTeamPrecedence("australs", { teamStandingsPrecedence: ["wins", "wbw", "wins", "wbw"] }))
      .toEqual(["wins", "wbw", "wbw"]);
    expect(resolveTeamExtra({ teamStandingsExtra: ["wbw", "num_adjs"] })).toEqual(["num_adjs"]);
  });
});

describe("votes / ballots carried (num_adjs)", () => {
  it("normalises each voting ballot to a panel of three and gives consensus ballots none", () => {
    const teams = [team("A"), team("B")];
    const rounds = [round(1), round(2), round(3)];
    const d = [debate("d1", 1, "A", "B"), debate("d2", 2, "A", "B"), debate("d3", 3, "A", "B")];
    const ballots = [
      ballot(d[0], "AFF", flat("A", 72), flat("B", 70), { AFF: 2, NEG: 1 }),
      ballot(d[1], "NEG", flat("A", 70), flat("B", 72), { AFF: 1, NEG: 4 }),
      ballot(d[2], "AFF", flat("A", 72), flat("B", 70)),
    ];
    const result = calculateStandings(tournament(), rounds, teams, d, ballots);
    const byId = new Map(result.teams.map((row) => [row.teamId, row.metrics.num_adjs]));
    // A: 2/3·3 + 1/5·3 + 0 = 2.6; B: 1/3·3 + 4/5·3 + 0 = 3.4
    expect(byId.get("A")).toBeCloseTo(2.6, 9);
    expect(byId.get("B")).toBeCloseTo(3.4, 9);
    expect(TEAM_METRIC_DIRECTION.num_adjs).toBe(1);
  });
});

describe("iron-person speeches (num_iron)", () => {
  it("counts debates with a duplicate speech, and fewer ranks higher", () => {
    const teams = [team("A"), team("B")];
    const rounds = [round(1), round(2)];
    const d = [debate("d1", 1, "A", "B"), debate("d2", 2, "B", "A")];
    const ballots = [
      // A1 speaks twice in round 1 (an iron-person speech); B is complete.
      ballot(d[0], "AFF", [["A1", 70], ["A2", 70], ["A1", 70]], flat("B", 69)),
      ballot(d[1], "AFF", flat("B", 70), flat("A", 69)),
    ];
    const result = calculateStandings(
      tournament({ teamStandingsPrecedence: ["wins", "num_iron"] }), rounds, teams, d, ballots
    );
    const byId = new Map(result.teams.map((row) => [row.teamId, row.metrics.num_iron]));
    expect(byId.get("A")).toBe(1);
    expect(byId.get("B")).toBe(0);
    // Both have one win; B has fewer iron-person speeches.
    expect(result.teams.map((row) => row.teamId)).toEqual(["B", "A"]);
    expect(TEAM_METRIC_DIRECTION.num_iron).toBe(-1);
  });
});

describe("speaker standings eligibility (Tabbycat's speeches missable)", () => {
  // Three rounds with results and a fourth drawn but without results.
  const teams = [team("A", ["A1", "A2", "A3", "A4"]), team("B")];
  const rounds = [1, 2, 3, 4].map(round);
  const d = rounds.map((r) => debate(`d${r.seq}`, r.seq, "A", "B"));
  const ballots = [
    ballot(d[0], "AFF", [["A1", 79], ["A2", 70], ["A3", 70]], flat("B", 69)),
    ballot(d[1], "AFF", [["A4", 78], ["A2", 70], ["A3", 70]], flat("B", 69)),
    ballot(d[2], "AFF", [["A4", 78], ["A2", 70], ["A1", 70]], flat("B", 69)),
  ];

  it("ranks everyone when there is no limit (the default)", () => {
    const result = calculateStandings(tournament(), rounds, teams, d, ballots);
    expect(result.speakers.every((row) => !row.ineligible && row.rank > 0)).toBe(true);
  });

  it("lists speakers who missed too many speeches last, unranked", () => {
    // 3 rounds have results; missing 1 allowed -> at least 2 speeches. A3 gave 2, A1 2, A4 2: all fine.
    // With 0 missable every speaker needs 3: only A2 and the B speakers qualify.
    const result = calculateStandings(
      tournament({ standingsMissedDebates: 0, speakerStandingsPrecedence: ["speaks_avg"] }), rounds, teams, d, ballots
    );
    const eligible = result.speakers.filter((row) => !row.ineligible).map((row) => row.speakerId);
    const ineligible = result.speakers.filter((row) => row.ineligible).map((row) => row.speakerId);
    expect(eligible).toEqual(["A2", "B1", "B2", "B3"]);
    expect(eligible.map((id) => result.speakers.find((row) => row.speakerId === id)!.rank)).toEqual([1, 2, 2, 2]);
    // Ineligible speakers follow in precedence order (A4 avg 78, A1 avg 74.5, A3 70) with no rank.
    expect(ineligible).toEqual(["A4", "A1", "A3"]);
    expect(result.speakers.filter((row) => row.ineligible).every((row) => row.rank === 0)).toBe(true);

    const lenient = calculateStandings(tournament({ standingsMissedDebates: 1 }), rounds, teams, d, ballots);
    expect(lenient.speakers.some((row) => row.ineligible)).toBe(false);
  });

  it("applies the replies limit to the replies tab", () => {
    const replyTournament = tournament({ replyScoresEnabled: true, standingsMissedReplies: 0 });
    const replies = (score: number, speakerId: string): [string, number][] =>
      [["A1", 70], ["A2", 70], ["A3", 70], [speakerId, score]];
    const replyBallots = [
      ballot(d[0], "AFF", replies(36, "A1"), flat("B", 69)),
      ballot(d[1], "AFF", replies(37, "A1"), flat("B", 69)),
      ballot(d[2], "AFF", replies(38, "A2"), flat("B", 69)),
    ];
    const result = calculateStandings(replyTournament, rounds, teams, d, replyBallots);
    expect(result.replies.map((row) => [row.speakerId, row.ineligible ?? false])).toEqual([
      ["A1", true],
      ["A2", true],
    ]);
  });
});

describe("wave 4/5 team metrics (Tabbycat standings/teams.py)", () => {
  // R1 (weight 1): A beats B; C beats D, with D pulled up. R2 (weight 2): A beats D; C beats B.
  const teams = ["A", "B", "C", "D"].map((id) => team(id));
  const rounds = [round(1), { ...round(2), weight: 2 } as Round];
  const r1a = debate("d1", 1, "A", "B");
  const r1b = debate("d2", 1, "C", "D");
  (r1b.teams.NEG as { pulledUp?: boolean }).pulledUp = true;
  const r2a = debate("d3", 2, "A", "D");
  const r2b = debate("d4", 2, "C", "B");
  const ballots = [
    ballot(r1a, "AFF", flat("A", 75), flat("B", 70)),
    ballot(r1b, "AFF", flat("C", 74), flat("D", 69)),
    ballot(r2a, "AFF", flat("A", 75), flat("D", 69)),
    ballot(r2b, "AFF", flat("C", 74), flat("B", 70)),
  ];
  const result = calculateStandings(
    tournament({ teamStandingsPrecedence: ["points", "speaks_sum"] }),
    rounds,
    teams,
    [r1a, r1b, r2a, r2b],
    ballots
  );
  const metric = (id: string) => result.teams.find((row) => row.teamId === id)!.metrics;

  it("draw_strength sums opponents' round-weighted points; draw_strength_wins counts their wins", () => {
    // Weighted points: A 1 + 2 = 3, C 1 + 2 = 3, B and D 0. B met A and C; D met C and A.
    expect(metric("B").draw_strength).toBe(6);
    expect(metric("D").draw_strength).toBe(6);
    expect(metric("A").draw_strength).toBe(0);
    expect(metric("B").draw_strength_wins).toBe(4);
  });

  it("pullup_debates counts every team in a debate with a pulled-up team", () => {
    expect([metric("C").pullup_debates, metric("D").pullup_debates, metric("A").pullup_debates]).toEqual([1, 1, 0]);
    expect([metric("C").pullups, metric("D").pullups]).toEqual([0, 1]);
  });

  it("draw_strength_rank is the mean rank of the opponents, lower meaning a harder draw", () => {
    // Ranks: A 1, C 2, B 3, D 4.
    expect(result.teams.map((row) => row.teamId)).toEqual(["A", "C", "B", "D"]);
    expect(metric("A").draw_strength_rank).toBe(3.5);
    expect(metric("B").draw_strength_rank).toBe(1.5);
    expect(TEAM_METRIC_DIRECTION.draw_strength_rank).toBe(-1);
  });

  it("draw_strength_rank can only be displayed, never ranked on", () => {
    expect(resolveTeamPrecedence("australs", { teamStandingsPrecedence: ["draw_strength_rank", "points"] })).toEqual(["points"]);
    expect(resolveTeamExtra({ teamStandingsExtra: ["draw_strength_rank"] })).toEqual(["draw_strength_rank"]);
  });
});

describe("wave 4/5 speaker metrics (Tabbycat standings/speakers.py)", () => {
  const teams = [team("A"), team("B")];
  const rounds = [round(1), round(2), round(3)];
  const debates = rounds.map((r) => debate(`d${r.seq}`, r.seq, "A", "B"));
  // A wins R1 and R2 on 2-1 votes; B wins R3 on 2-1. A1 replies in R1 (35) and R2 (37); A2 in R3 (36).
  const replies: [string, number][] = [["A1", 35], ["A1", 37], ["A2", 36]];
  const ballots = debates.map((d, index) => {
    const affWins = index < 2;
    return ballot(d, affWins ? "AFF" : "NEG", [...flat("A", 72), replies[index]], flat("B", affWins ? 70 : 74), {
      AFF: affWins ? 2 : 1,
      NEG: affWins ? 1 : 2,
    });
  });
  const result = calculateStandings(tournament({ replyScoresEnabled: true }), rounds, teams, debates, ballots);
  const speaker = (id: string) => result.speakers.find((row) => row.speakerId === id)!.metrics;

  it("gives every speaker their team's points, wins and votes", () => {
    expect([speaker("A1").team_points, speaker("A1").team_wins, speaker("B1").team_wins]).toEqual([2, 2, 1]);
    // Votes normalised to a panel of three: A carried 2 + 2 + 1, B 1 + 1 + 2.
    expect(speaker("A3").num_adjs).toBe(5);
    expect(speaker("B2").num_adjs).toBe(4);
    expect([speaker("A1").firsts, speaker("A1").seconds, speaker("A1").thirds]).toEqual([0, 0, 0]);
  });

  it("counts replies and their (population) standard deviation", () => {
    expect([speaker("A1").reply_count, speaker("A1").reply_stddev]).toEqual([2, 1]);
    expect(speaker("A2").reply_count).toBe(1);
    expect(speaker("B1").reply_count).toBe(0);
    const reply = result.replies.find((row) => row.speakerId === "A1")!.metrics;
    expect([reply.speaks_sum, reply.reply_count]).toEqual([72, 2]);
  });
});

import { describe, expect, it } from "vitest";
import type { BallotSubmission, BPSide, Debate, Round, Team, Tournament } from "@/types";
import { calculateStandings } from "./calculator";

/** BP: Tabbycat records no wins in preliminary rounds and its draw strength sums opponents' points. */

const SIDES: BPSide[] = ["OG", "OO", "CG", "CO"];

const tournament: Tournament = {
  id: "t",
  name: "T",
  shortName: "T",
  slug: "t",
  format: "bp",
  active: true,
  ownerId: "o",
  admins: {},
  preferences: {
    teamsInDebate: 4,
    substantiveSpeakers: 2,
    replyScoresEnabled: false,
    minSpeakerScore: 50,
    maxSpeakerScore: 100,
    stepSpeakerScore: 1,
    minReplyScore: 25,
    maxReplyScore: 50,
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
    teamStandingsPrecedence: ["points", "speaks_sum", "firsts", "seconds", "draw_strength"],
  },
  createdAt: "",
  updatedAt: "",
};

const team = (id: string): Team => ({
  id,
  tournamentId: "t",
  name: id,
  speakers: [1, 2].map((n) => ({ id: `${id}${n}`, name: `${id}${n}` })),
  breakCategories: [],
  speakerCategories: [],
});

const round = (seq: number): Round => ({
  id: `r${seq}`,
  tournamentId: "t",
  seq,
  name: `R${seq}`,
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
});

/** One room; `order` lists the teams in OG, OO, CG, CO and `finish` their points (3 = 1st). */
function room(id: string, seq: number, order: string[], finish: number[]): { debate: Debate; ballot: BallotSubmission } {
  const debate = {
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
    teams: Object.fromEntries(SIDES.map((side, i) => [side, { teamId: order[i], teamName: order[i], side }])),
    adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
  } as unknown as Debate;
  const ballot = {
    id: `b-${id}`,
    tournamentId: "t",
    roundId: `r${seq}`,
    debateId: id,
    version: 1,
    confirmed: true,
    discarded: false,
    submitterType: "tabroom",
    timestamp: "",
    speakerScores: Object.fromEntries(
      SIDES.map((side, i) => [
        side,
        [1, 2].map((n) => ({ speakerId: `${order[i]}${n}`, speakerName: `${order[i]}${n}`, position: n, score: 70 + finish[i] })),
      ])
    ),
    teamScores: Object.fromEntries(
      SIDES.map((side, i) => [side, { side, teamId: order[i], points: finish[i], totalSpeakerScore: 2 * (70 + finish[i]) }])
    ),
  } as unknown as BallotSubmission;
  return { debate, ballot };
}

describe("BP standings metrics", () => {
  const teams = ["P", "Q", "R", "S", "W", "X", "Y", "Z"].map(team);
  const rooms = [
    room("d1", 1, ["P", "Q", "R", "S"], [3, 2, 1, 0]),
    room("d2", 1, ["W", "X", "Y", "Z"], [3, 2, 1, 0]),
    room("d3", 2, ["P", "W", "Q", "X"], [0, 1, 2, 3]),
    room("d4", 2, ["R", "Y", "S", "Z"], [3, 2, 1, 0]),
  ];
  const result = calculateStandings(
    tournament,
    [round(1), round(2)],
    teams,
    rooms.map((r) => r.debate),
    rooms.map((r) => r.ballot)
  );
  const metric = (id: string) => result.teams.find((row) => row.teamId === id)!.metrics;

  it("records no wins, so wins and opponents' wins stay 0", () => {
    expect(teams.map((t) => metric(t.id).wins)).toEqual(Array(8).fill(0));
    expect(metric("P").draw_strength_wins).toBe(0);
  });

  it("sums every opponent's points as draw strength", () => {
    // Points: P 3, Q 4, R 4, S 1, W 4, X 5, Y 3, Z 0. P met Q, R, S, then W, Q, X.
    expect(metric("P").draw_strength).toBe(4 + 4 + 1 + 4 + 4 + 5);
    // Z met W, X, Y, then R, Y, S.
    expect(metric("Z").draw_strength).toBe(4 + 5 + 3 + 4 + 3 + 1);
  });

  it("gives speakers their team's 1sts, 2nds and 3rds", () => {
    const speaker = result.speakers.find((row) => row.speakerId === "Q1")!.metrics;
    expect([speaker.team_points, speaker.firsts, speaker.seconds, speaker.thirds, speaker.team_wins]).toEqual([4, 0, 2, 0, 0]);
  });
});

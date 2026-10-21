import { describe, expect, it } from "vitest";
import type { BallotSubmission, Debate, Round, Team, Tournament, TournamentPreferences } from "@/types";
import { buildBallotResult, type BallotRules } from "@/lib/ballots/result";
import { calculateStandings } from "./calculator";

/**
 * Standings effects of the wave 5 results settings, as Tabbycat v2.12.1 computes them:
 * points × Round.weight (standings/teams.py PointsMetricAnnotator), speaker metrics and team
 * speaks skip ballots without speaker scores (no SpeakerScore rows, TeamScore.score null), and
 * srank is the sum of a speaker's speech ranks, lower first (standings/speakers.py).
 */

const prefs: TournamentPreferences = {
  teamsInDebate: 2,
  substantiveSpeakers: 2,
  replyScoresEnabled: false,
  minSpeakerScore: 15,
  maxSpeakerScore: 40,
  stepSpeakerScore: 1,
  minReplyScore: 10,
  maxReplyScore: 20,
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
};

function tournament(extra: Partial<TournamentPreferences> = {}): Tournament {
  return {
    id: "t", name: "T", shortName: "T", slug: "t", format: "custom_2team", active: true, ownerId: "o", admins: {},
    preferences: { ...prefs, ...extra }, createdAt: "", updatedAt: "",
  };
}

function round(seq: number, weight?: number): Round {
  return {
    id: `r${seq}`, tournamentId: "t", seq, name: `R${seq}`, abbreviation: `R${seq}`, stage: "preliminary",
    drawType: "random", drawStatus: "released", feedbackWeight: 0, silent: false, motionsReleased: true,
    resultsReleased: true, completed: true, createdAt: "", ...(weight !== undefined ? { weight } : {}),
  };
}

const teams: Team[] = ["A", "B", "C", "D"].map((name) => ({
  id: name, tournamentId: "t", name, breakCategories: [], speakerCategories: [],
  speakers: [{ id: `${name}1`, name: `${name}1` }, { id: `${name}2`, name: `${name}2` }],
}));

function debate(id: string, roundSeq: number, aff: string, neg: string): Debate {
  return {
    id, tournamentId: "t", roundId: `r${roundSeq}`, roundSeq, bracket: 0, roomRank: 1, importance: 0,
    resultStatus: "confirmed", sidesConfirmed: true, flags: [],
    teams: {
      AFF: { teamId: aff, teamName: aff, side: "AFF" },
      NEG: { teamId: neg, teamName: neg, side: "NEG" },
    } as Debate["teams"],
    adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
  };
}

function ballot(
  d: Debate,
  rules: BallotRules,
  winner: "AFF" | "NEG",
  scores?: { aff: number[]; neg: number[]; affRanks?: number[]; negRanks?: number[] }
): BallotSubmission {
  const speeches = (team: string, values: number[], ranks?: number[]) =>
    values.map((score, index) => ({ speakerId: `${team}${index + 1}`, speakerName: `${team}${index + 1}`, position: index + 1, score, ...(ranks ? { rank: ranks[index] } : {}) }));
  const result = buildBallotResult(
    {
      speakerScores: scores
        ? { AFF: speeches(d.teams.AFF.teamId, scores.aff, scores.affRanks), NEG: speeches(d.teams.NEG.teamId, scores.neg, scores.negRanks) }
        : {},
      ranks: winner === "AFF" ? { AFF: 1, NEG: 2 } : { AFF: 2, NEG: 1 },
    },
    { AFF: d.teams.AFF.teamId, NEG: d.teams.NEG.teamId },
    undefined,
    rules
  );
  return {
    id: `b-${d.id}`, tournamentId: "t", roundId: d.roundId, debateId: d.id, version: 1, confirmed: true, discarded: false,
    submitterType: "tabroom", timestamp: "", ...result,
  };
}

describe("round weights", () => {
  it("multiplies points (not wins) by the round's weight", () => {
    const t = tournament();
    const rules: BallotRules = { format: "custom_2team", preferences: t.preferences };
    const d1 = debate("d1", 1, "A", "B");
    const d2 = debate("d2", 2, "B", "A");
    const ballots = [
      ballot(d1, rules, "AFF", { aff: [30, 30], neg: [29, 29] }),
      ballot(d2, rules, "AFF", { aff: [30, 30], neg: [29, 29] }),
    ];
    const standings = calculateStandings(t, [round(1), round(2, 3)], teams.slice(0, 2), [d1, d2], ballots);
    const byId = Object.fromEntries(standings.teams.map((row) => [row.teamId, row]));
    expect(byId.A.points).toBe(1);
    expect(byId.B.points).toBe(3);
    expect(byId.B.metrics.points).toBe(3);
    expect(byId.B.metrics.wins).toBe(1);
    expect(standings.teams[0].teamId).toBe("B");
  });
});

describe("results-only rounds", () => {
  it("counts the result but leaves speaks, margins and speaker tabs alone", () => {
    const t = tournament({ speakersInBallots: "never" });
    const scored: BallotRules = { format: "custom_2team", preferences: { ...t.preferences, speakersInBallots: "always" } };
    const scoreless: BallotRules = { format: "custom_2team", preferences: t.preferences };
    const d1 = debate("d1", 1, "A", "B");
    const d2 = debate("d2", 2, "A", "B");
    const ballots = [
      ballot(d1, scored, "AFF", { aff: [30, 30], neg: [28, 28] }),
      ballot(d2, scoreless, "NEG"),
    ];
    expect(ballots[1].noSpeakerScores).toBe(true);
    const standings = calculateStandings(
      { ...t, preferences: { ...t.preferences, standingsMissedDebates: 0 } },
      [round(1), round(2)], teams.slice(0, 2), [d1, d2], ballots
    );
    const a = standings.teams.find((row) => row.teamId === "A")!;
    expect(a.metrics.wins).toBe(1);
    expect(a.metrics.points).toBe(1);
    expect(a.metrics.speaks_sum).toBe(60);
    // Average over the one scored debate, not (60 + 0) / 2.
    expect(a.metrics.speaks_avg).toBe(60);
    expect(a.metrics.margin_avg).toBe(4);
    const speaker = standings.speakers.find((row) => row.speakerId === "A1")!;
    expect(speaker.speechesCount).toBe(1);
    // Only the scored round counts towards "speeches missable", so nobody becomes ineligible.
    expect(speaker.ineligible).toBeFalsy();
  });
});

describe("srank", () => {
  it("sums speech ranks, lower ranking higher", () => {
    const t = tournament({ speakerRanks: "any", speakerStandingsPrecedence: ["srank"] });
    const rules: BallotRules = { format: "custom_2team", preferences: t.preferences };
    const d1 = debate("d1", 1, "A", "B");
    const d2 = debate("d2", 2, "A", "B");
    const ballots = [
      ballot(d1, rules, "AFF", { aff: [30, 29], neg: [28, 27], affRanks: [3, 1], negRanks: [2, 4] }),
      ballot(d2, rules, "AFF", { aff: [30, 29], neg: [28, 27], affRanks: [1, 4], negRanks: [2, 3] }),
    ];
    const standings = calculateStandings(t, [round(1), round(2)], teams.slice(0, 2), [d1, d2], ballots);
    const metrics = Object.fromEntries(standings.speakers.map((row) => [row.speakerId, row.metrics.srank]));
    expect(metrics).toEqual({ A1: 4, A2: 5, B1: 4, B2: 7 });
    expect(standings.speakers.map((row) => [row.speakerId, row.rank])).toEqual([["A1", 1], ["B1", 1], ["A2", 3], ["B2", 4]]);
  });
});

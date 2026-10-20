import { describe, expect, it } from "vitest";
import { hashPublicPassword, parsePublicSubmission, publicPasswordProblem, verifyPublicPassword } from "@/lib/publicForms";
import {
  ballotSubmitters,
  buildPublicBallotRecord,
  buildPublicFeedbackRecord,
  canUsePublicBallot,
  feedbackSources,
  publicFormRounds,
  ranksFromTotals,
} from "@/lib/publicFormEntries";
import { buildPrivateBallot } from "@/lib/privateBallot";
import { MANUAL_SIDES_FLAG } from "@/lib/draw/manualSides";
import type { Adjudicator, Debate, Round, Team, Tournament } from "@/types";

describe("public form password", () => {
  it("stores a salted hash and verifies in constant time", () => {
    const stored = hashPublicPassword(" letmein ", new Date("2026-10-20T00:00:00Z"), "salt");
    expect(stored).not.toHaveProperty("password");
    expect(JSON.stringify(stored)).not.toContain("letmein");
    expect(verifyPublicPassword(stored, "letmein")).toBe(true);
    expect(verifyPublicPassword(stored, " letmein")).toBe(true);
    expect(verifyPublicPassword(stored, "letmeout")).toBe(false);
    expect(verifyPublicPassword(stored, undefined)).toBe(false);
    expect(verifyPublicPassword(undefined, "letmein")).toBe(false);
    expect(hashPublicPassword("letmein").salt).not.toBe(hashPublicPassword("letmein").salt);
  });

  it("rejects passwords that are too short or too long", () => {
    expect(publicPasswordProblem("abc")).toMatch(/at least/);
    expect(publicPasswordProblem("x".repeat(200))).toMatch(/at most/);
    expect(publicPasswordProblem(42)).toBeTruthy();
    expect(publicPasswordProblem("good one")).toBeNull();
  });
});

describe("parsePublicSubmission", () => {
  const valid = { kind: "ballot", participantType: "adjudicator", participantId: "adj-1", record: { id: "ballot-x" }, website: "", startedAt: 1 };

  it("accepts a well-formed submission and keeps the spam signals", () => {
    expect(parsePublicSubmission(valid)).toMatchObject({ kind: "ballot", participantId: "adj-1", honeypot: "", startedAt: 1 });
  });

  it("refuses malformed submissions", () => {
    expect(parsePublicSubmission(null)).toHaveProperty("error");
    expect(parsePublicSubmission({ ...valid, kind: "results" })).toHaveProperty("error");
    expect(parsePublicSubmission({ ...valid, participantType: "team" })).toHaveProperty("error");
    expect(parsePublicSubmission({ ...valid, participantId: "a/b" })).toHaveProperty("error");
    expect(parsePublicSubmission({ ...valid, record: { id: "" } })).toHaveProperty("error");
    expect(parsePublicSubmission({ ...valid, password: 7 })).toHaveProperty("error");
    expect(parsePublicSubmission({ ...valid, kind: "feedback", participantType: "team" })).not.toHaveProperty("error");
  });
});

const round = (extra: Partial<Round>): Round => ({
  id: "r1", tournamentId: "t1", seq: 1, name: "R1", abbreviation: "R1", stage: "preliminary", drawType: "random",
  drawStatus: "released", feedbackWeight: 0.5, silent: false, motionsReleased: false, resultsReleased: false,
  completed: false, createdAt: "", adjudicatorsRevealed: true, ...extra,
});

const debate: Debate = {
  id: "d1", tournamentId: "t1", roundId: "r1", roundSeq: 1, bracket: 0, roomRank: 1, importance: 0,
  teams: {
    AFF: { teamId: "ta", teamName: "Alpha", side: "AFF" },
    NEG: { teamId: "tb", teamName: "Beta", side: "NEG" },
  },
  adjudicators: {
    chairId: "adj-1", chairName: "Chair", panellistIds: ["adj-2"], panellistNames: ["Wing"], traineeIds: ["adj-3"], traineeNames: ["Trainee"],
  },
} as Debate;

const team = (id: string, prefix: string): Team => ({
  id, tournamentId: "t1", name: id, breakCategories: [], speakerCategories: [],
  speakers: [1, 2, 3].map((n) => ({ id: `${prefix}${n}`, name: `${prefix.toUpperCase()}${n}` })),
});

describe("public form entries", () => {
  it("offers rounds with released draws and announced panels only", () => {
    const rounds = [
      round({ id: "r1", seq: 1 }),
      round({ id: "r2", seq: 2, adjudicatorsRevealed: false }),
      { ...round({ id: "r3", seq: 3 }), drawPublic: false } as Round,
      round({ id: "r4", seq: 4 }),
    ];
    expect(publicFormRounds(rounds).map((item) => item.id)).toEqual(["r4", "r1"]);
  });

  it("lists voting adjudicators for ballots and everyone for feedback", () => {
    expect(ballotSubmitters([debate], "r1").map((item) => item.id)).toEqual(["adj-1", "adj-2"]);
    expect(feedbackSources([debate], "r1").map((item) => `${item.type}:${item.id}`)).toEqual([
      "adjudicator:adj-1", "adjudicator:adj-3", "adjudicator:adj-2", "team:ta", "team:tb",
    ]);
    // Redacted people have no public name and cannot be picked.
    const redacted = { ...debate, adjudicators: { ...debate.adjudicators, chairName: "" } } as Debate;
    expect(ballotSubmitters([redacted], "r1").map((item) => item.id)).toEqual(["adj-2"]);
  });

  it("derives ranks from totals and asks on ties", () => {
    expect(ranksFromTotals({ AFF: 225, NEG: 230 }, ["AFF", "NEG"])).toEqual({ NEG: 1, AFF: 2 });
    expect(ranksFromTotals({ AFF: 225, NEG: 225 }, ["AFF", "NEG"])).toBeNull();
    expect(ranksFromTotals({ AFF: 225 }, ["AFF", "NEG"])).toBeNull();
  });

  it("refuses debates whose sides are chosen on the ballot", () => {
    expect(canUsePublicBallot(debate)).toBe(true);
    expect(canUsePublicBallot({ ...debate, flags: [MANUAL_SIDES_FLAG] } as Debate)).toBe(false);
  });

  it("builds a ballot the server's ballot rules accept", () => {
    const teamsById = new Map([["ta", team("ta", "a")], ["tb", team("tb", "b")]]);
    const record = buildPublicBallotRecord({
      debate,
      adjudicatorId: "adj-2",
      sides: ["AFF", "NEG"],
      teamsById,
      scores: { AFF: [75, 75, 75], NEG: [74, 74, 74] },
      replies: { AFF: { speakerId: "a1", score: 37.5 }, NEG: { speakerId: "b2", score: 37 } },
      ranks: { AFF: 1, NEG: 2 },
      nonce: "n1",
    });
    const tournament = {
      id: "t1", format: "australs",
      preferences: { substantiveSpeakers: 3, replyScoresEnabled: true, minSpeakerScore: 70, maxSpeakerScore: 80, stepSpeakerScore: 1, minReplyScore: 35, maxReplyScore: 40 },
    } as unknown as Tournament;
    const ballot = buildPrivateBallot(record, {
      tournament,
      adjudicator: { id: "adj-2", name: "Wing", trainee: false } as Adjudicator,
      debate,
      teams: teamsById,
      tournamentId: "t1",
    });
    expect(ballot.teamScores.AFF).toMatchObject({ win: true, totalSpeakerScore: 262.5 });
    expect(ballot.speakerScores.NEG.map((entry) => entry.speakerId)).toEqual(["b1", "b2", "b3", "b2"]);
  });

  it("builds feedback attributed to the chosen participant", () => {
    expect(buildPublicFeedbackRecord({
      debateId: "d1",
      source: { type: "team", id: "ta" },
      targetAdjudicatorId: "adj-1",
      score: 8,
      comments: "  clear  ",
      nonce: "n2",
    })).toEqual({
      id: "feedback-public-n2",
      debateId: "d1",
      targetType: "adjudicator",
      targetAdjudicatorId: "adj-1",
      sourceType: "team",
      sourceId: "ta",
      score: 8,
      comments: "clear",
    });
  });
});

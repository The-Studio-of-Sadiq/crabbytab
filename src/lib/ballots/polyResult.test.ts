import { describe, expect, it } from "vitest";
import type { AdjudicatorSheet, BallotSubmission, DebateSide, Speaker, SpeakerScoreEntry, TournamentPreferences } from "@/types";
import {
  buildBallotResult,
  consensusTeamScores,
  debateBallotRules,
  diffBallots,
  polyAdvancingCount,
  polyBallotProblem,
  rulesSides,
  validateBallotEntry,
  type BallotRules,
  type BallotValidationContext,
} from "./result";

/** Tabbycat's Public Speaking shape: one speech per team, 50-99. */
const POLY_PREFS: Partial<TournamentPreferences> = {
  teamsInDebate: 6,
  substantiveSpeakers: 1,
  replyScoresEnabled: false,
  minSpeakerScore: 50,
  maxSpeakerScore: 99,
  stepSpeakerScore: 1,
  ballotMode: "consensus",
};

function rules(preferences: Partial<TournamentPreferences> = {}, extra: Partial<BallotRules> = {}): BallotRules {
  return { format: "poly", preferences: { ...POLY_PREFS, ...preferences }, ...extra };
}

const speaker = (side: string): Speaker => ({ id: `${side}-s1`, name: `${side} speaker` });
const speech = (side: string, score: number): SpeakerScoreEntry => ({
  speakerId: `${side}-s1`,
  speakerName: `${side} speaker`,
  position: 1,
  score,
});

function context(sides: DebateSide[], base: BallotRules): BallotValidationContext {
  return { ...base, rosters: Object.fromEntries(sides.map((side) => [side, [speaker(side)]])) };
}

function scores(totals: Record<string, number>): Record<DebateSide, SpeakerScoreEntry[]> {
  return Object.fromEntries(Object.entries(totals).map(([side, score]) => [side, [speech(side, score)]])) as Record<
    DebateSide,
    SpeakerScoreEntry[]
  >;
}

const teamIds = (sides: DebateSide[]) => Object.fromEntries(sides.map((side) => [side, `team-${side}`]));

describe("poly consensus ballots with scores (Tabbycat PolyScoresheet)", () => {
  const base = rules();
  const sides = rulesSides(base);
  const totals = { P1: 70, P2: 80, P3: 65, P4: 90, P5: 75, P6: 60 };

  it("ranks teams on their totals and gives N - rank points, with no winner and no margin", () => {
    const entry = { speakerScores: scores(totals) };
    expect(validateBallotEntry(entry, context(sides, base))).toEqual([]);
    const result = buildBallotResult(entry, teamIds(sides), undefined, base);
    const summary = Object.fromEntries(sides.map((side) => [side, [result.teamScores[side].rank, result.teamScores[side].points]]));
    expect(summary).toEqual({ P1: [4, 2], P2: [2, 4], P3: [5, 1], P4: [1, 5], P5: [3, 3], P6: [6, 0] });
    for (const side of sides) {
      expect(result.teamScores[side].win).toBe(false);
      expect(result.teamScores[side].margin).toBeUndefined();
      expect(result.teamScores[side].teamId).toBe(`team-${side}`);
    }
  });

  it("ignores entered ranks and declared-winner modes: ranks always follow the totals", () => {
    const lowPoints = rules({ winnersInBallots: "low-points" });
    const entry = { speakerScores: scores(totals), ranks: { P1: 1, P2: 2, P3: 3, P4: 4, P5: 5, P6: 6 } };
    expect(validateBallotEntry(entry, context(sides, lowPoints))).toEqual([]);
    const result = buildBallotResult(entry, teamIds(sides), undefined, lowPoints);
    expect(result.teamScores.P4.rank).toBe(1);
    expect(result.teamScores.P6.rank).toBe(6);
  });

  it("refuses tied totals, as Tabbycat's PolyScoresheet is then invalid", () => {
    const entry = { speakerScores: scores({ ...totals, P6: 70 }) };
    const errors = validateBallotEntry(entry, context(sides, base));
    expect(errors.some((error) => /same total/.test(error))).toBe(true);
  });

  it("checks every team's speeches and scores", () => {
    const entry = { speakerScores: scores({ ...totals, P3: 120 }) };
    expect(validateBallotEntry(entry, context(sides, base)).join(" ")).toMatch(/Team 3/);
    const missing = { speakerScores: scores({ P1: 70, P2: 80 }) };
    expect(validateBallotEntry(missing, context(sides, base)).join(" ")).toMatch(/Team 3: enter exactly 1 substantive/);
  });

  it("scores a short room on its own teams: points are teams in the room - rank", () => {
    const short = rules({}, { sides: ["P1", "P2", "P3"] });
    const shortSides = rulesSides(short);
    expect(shortSides).toEqual(["P1", "P2", "P3"]);
    const entry = { speakerScores: scores({ P1: 70, P2: 80, P3: 75 }) };
    expect(validateBallotEntry(entry, context(shortSides, short))).toEqual([]);
    const result = buildBallotResult(entry, teamIds(shortSides), undefined, short);
    expect(Object.keys(result.teamScores).sort()).toEqual(["P1", "P2", "P3"]);
    expect([result.teamScores.P2.points, result.teamScores.P3.points, result.teamScores.P1.points]).toEqual([2, 1, 0]);
  });

  it("refuses forfeits, which are two-team only", () => {
    const errors = validateBallotEntry({ speakerScores: {}, forfeitSide: "P1" }, context(sides, rules({ enableForfeits: true })));
    expect(errors).toEqual(["Forfeits are not enabled for this tournament."]);
  });
});

describe("poly ballots without speaker scores (Tabbycat PolyEliminationScoresheet)", () => {
  const elim = rules({ speakersInBallots: "prelim" }, { stage: "elimination" });
  const sides = rulesSides(elim);

  it("needs exactly two advancing teams, or one in the tournament's last round", () => {
    expect(polyAdvancingCount(elim)).toBe(2);
    expect(validateBallotEntry({ speakerScores: {}, winners: ["P1"] }, context(sides, elim))).toEqual(["Choose the 2 teams that advance."]);
    expect(validateBallotEntry({ speakerScores: {}, winners: ["P1", "P4"] }, context(sides, elim))).toEqual([]);
    const final = { ...elim, lastRound: true };
    expect(validateBallotEntry({ speakerScores: {}, winners: ["P1", "P4"] }, context(sides, final))).toEqual(["Choose the team that advances."]);
    expect(validateBallotEntry({ speakerScores: {}, winners: ["P2"] }, context(sides, final))).toEqual([]);
    expect(validateBallotEntry({ speakerScores: {}, winners: ["P1", "P9"] }, context(sides, elim))[0]).toMatch(/not in this debate/);
  });

  it("refuses a room too small for the advancing teams", () => {
    const tiny = { ...elim, sides: ["P1"] as DebateSide[] };
    expect(validateBallotEntry({ speakerScores: {}, winners: ["P1"] }, context(["P1"], tiny))[0]).toMatch(/has 1 team, but 2 must advance/);
  });

  it("records the advancing teams as winners, with no points, ranks or speeches", () => {
    const result = buildBallotResult({ speakerScores: {}, winners: ["P2", "P5"] }, teamIds(sides), undefined, elim);
    expect(result.noSpeakerScores).toBe(true);
    expect(sides.filter((side) => result.teamScores[side].win)).toEqual(["P2", "P5"]);
    for (const side of sides) {
      expect(result.teamScores[side].points).toBe(0);
      expect(result.teamScores[side].rank).toBeUndefined();
      expect(result.speakerScores[side]).toEqual([]);
    }
  });

  it("works out the last round from the tournament's rounds", () => {
    const tournament = { format: "poly" as const, preferences: POLY_PREFS };
    const rounds = [{ seq: 1 }, { seq: 2 }, { seq: 3 }];
    expect(debateBallotRules(tournament, { stage: "elimination", seq: 3 }, null, rounds).lastRound).toBe(true);
    expect(debateBallotRules(tournament, { stage: "elimination", seq: 2 }, null, rounds).lastRound).toBeUndefined();
    // Two-team and BP rules are unchanged by the poly-only fields.
    expect(debateBallotRules({ format: "bp", preferences: {} }, { stage: "elimination", seq: 3 }, null, rounds)).toEqual({
      format: "bp",
      preferences: {},
      stage: "elimination",
    });
  });
});

describe("poly voting ballots (Tabbycat PolyNoWinScoresheet)", () => {
  const voting = rules({ ballotMode: "voting", marginIncludesDissenters: true, scoreAggregation: "mean" });
  const sides: DebateSide[] = ["P1", "P2", "P3"];
  const roomRules = { ...voting, sides };
  const sheet = (adjudicatorId: string, totals: Record<string, number>): AdjudicatorSheet => ({
    adjudicatorId,
    adjudicatorName: adjudicatorId,
    speakerScores: scores(totals),
  });

  it("needs margins to include dissenters, as Tabbycat's get_result_class", () => {
    const strict = rules({ ballotMode: "voting", marginIncludesDissenters: false });
    expect(polyBallotProblem(strict)).toMatch(/margins include dissenters/);
    expect(validateBallotEntry({ speakerScores: {}, sheets: [] }, context(sides, strict))).toEqual([
      expect.stringMatching(/margins include dissenters/),
    ]);
    expect(() => buildBallotResult({ speakerScores: {}, sheets: [] }, {}, undefined, strict)).toThrow(/margins include dissenters/);
    expect(polyBallotProblem(rules({ ballotMode: "voting", marginIncludesDissenters: true, speakersInBallots: "never" }))).toMatch(
      /must ask for speaker scores/
    );
  });

  it("averages every sheet and records scores only: ties allowed, no ranks, points or winner", () => {
    const sheets = [sheet("a", { P1: 70, P2: 80, P3: 80 }), sheet("b", { P1: 72, P2: 81, P3: 79 })];
    expect(validateBallotEntry({ speakerScores: {}, sheets }, context(sides, roomRules))).toEqual([]);
    const result = buildBallotResult({ speakerScores: {}, sheets }, teamIds(sides), "a", roomRules);
    expect(result.sheets).toHaveLength(2);
    expect(result.speakerScores.P1[0].score).toBe(71);
    expect(result.teamScores.P2.totalSpeakerScore).toBe(80.5);
    expect(result.teamScores.P3.totalSpeakerScore).toBe(79.5);
    for (const side of sides) {
      expect(result.teamScores[side]).toEqual({
        side,
        teamId: `team-${side}`,
        points: 0,
        totalSpeakerScore: result.teamScores[side].totalSpeakerScore,
      });
    }
  });

  it("takes the median per speech when the tournament aggregates by median", () => {
    const median = { ...roomRules, preferences: { ...roomRules.preferences, scoreAggregation: "median" as const } };
    const sheets = [sheet("a", { P1: 70, P2: 80, P3: 60 }), sheet("b", { P1: 72, P2: 81, P3: 61 }), sheet("c", { P1: 90, P2: 50, P3: 62 })];
    const result = buildBallotResult({ speakerScores: {}, sheets }, teamIds(sides), "a", median);
    expect(result.speakerScores.P1[0].score).toBe(72);
    expect(result.speakerScores.P2[0].score).toBe(80);
  });

  it("validates each adjudicator's own sheet without ranking it (private-URL sheets)", () => {
    const own = { ...rules(), sides, polyScoresOnly: true };
    const entry = { speakerScores: scores({ P1: 70, P2: 70, P3: 75 }) };
    expect(validateBallotEntry(entry, context(sides, own))).toEqual([]);
    const result = buildBallotResult(entry, teamIds(sides), undefined, own);
    expect(result.teamScores.P1).toEqual({ side: "P1", teamId: "team-P1", points: 0, totalSpeakerScore: 70 });
    expect(result.teamScores.P3.rank).toBeUndefined();
  });
});

describe("double-entry comparison of poly ballots", () => {
  it("compares ranks and advancing teams of the sides either ballot has", () => {
    const base = rules({}, { sides: ["P1", "P2", "P3"] });
    const make = (totals: Record<string, number>) => {
      const result = buildBallotResult({ speakerScores: scores(totals) }, teamIds(["P1", "P2", "P3"]), undefined, base);
      return { speakerScores: result.speakerScores, teamScores: result.teamScores } as Pick<BallotSubmission, "speakerScores" | "teamScores">;
    };
    const first = make({ P1: 70, P2: 80, P3: 75 });
    const second = make({ P1: 85, P2: 80, P3: 75 });
    const differences = diffBallots(first, second, "poly");
    expect(differences.find((item) => item.field === "P1 result")).toEqual({ field: "P1 result", first: "rank 3", second: "rank 1" });
    expect(differences.some((item) => item.field === "P1 speech 1")).toBe(true);
    expect(diffBallots(first, first, "poly")).toEqual([]);
  });
});

describe("two-team and BP results are unchanged", () => {
  it("scores a BP consensus ballot 3/2/1/0 with the top two winning", () => {
    const bp: BallotRules = { format: "bp", preferences: { substantiveSpeakers: 2 } };
    const speakerScores = {
      OG: [speech("OG", 75), speech("OG", 75)],
      OO: [speech("OO", 70), speech("OO", 70)],
      CG: [speech("CG", 80), speech("CG", 80)],
      CO: [speech("CO", 65), speech("CO", 65)],
    } as Record<DebateSide, SpeakerScoreEntry[]>;
    const result = consensusTeamScores(speakerScores, { OG: 2, OO: 3, CG: 1, CO: 4 }, { OG: "a", OO: "b", CG: "c", CO: "d" }, bp);
    expect(result).toEqual({
      OG: { side: "OG", teamId: "a", points: 2, totalSpeakerScore: 150, rank: 2, win: true },
      OO: { side: "OO", teamId: "b", points: 1, totalSpeakerScore: 140, rank: 3, win: false },
      CG: { side: "CG", teamId: "c", points: 3, totalSpeakerScore: 160, rank: 1, win: true },
      CO: { side: "CO", teamId: "d", points: 0, totalSpeakerScore: 130, rank: 4, win: false },
    });
  });

  it("scores a two-team consensus ballot with a win, a loss and margins", () => {
    const two: BallotRules = { format: "uadc", preferences: { substantiveSpeakers: 1, replyScoresEnabled: false } };
    const result = consensusTeamScores(scores({ AFF: 75, NEG: 72 }), { AFF: 1, NEG: 2 }, { AFF: "a", NEG: "b" }, two);
    expect(result).toEqual({
      AFF: { side: "AFF", teamId: "a", points: 1, totalSpeakerScore: 75, rank: 1, win: true, margin: 3 },
      NEG: { side: "NEG", teamId: "b", points: 0, totalSpeakerScore: 72, rank: 2, win: false, margin: -3 },
    });
    expect(rulesSides(two)).toEqual(["AFF", "NEG"]);
    expect(rulesSides({ format: "bp", sides: ["P1"] })).toEqual(["OG", "OO", "CG", "CO"]);
  });
});

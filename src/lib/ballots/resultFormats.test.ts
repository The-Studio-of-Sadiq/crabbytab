import { describe, expect, it } from "vitest";
import type { AdjudicatorSheet, DebateSide, ScoreCriterion, Speaker, SpeakerScoreEntry, TournamentPreferences } from "@/types";
import {
  aggregateScoreValues,
  ballotsHaveSpeakerScores,
  replyScoreStep,
  roundWeight,
  validateScoreCriteria,
  winnerDeclarationFor,
} from "@/lib/ballots/ballotRules";
import {
  aggregateVotingSheets,
  buildBallotResult,
  sheetOutcome,
  validateBallotEntry,
  type BallotRules,
  type BallotValidationContext,
} from "@/lib/ballots/result";
import { validateReplyScore } from "@/lib/scoring/validator";
import { sideLabel } from "@/lib/sideNames";

/**
 * Golden cases for the wave 5 results settings, each taken from Tabbycat v2.12.1 behaviour
 * (results/result.py, results/scoresheet.py, results/forms.py, options/preferences.py).
 */

const base: Partial<TournamentPreferences> = {
  substantiveSpeakers: 3,
  replyScoresEnabled: false,
  minSpeakerScore: 50,
  maxSpeakerScore: 100,
  stepSpeakerScore: 1,
};
const rules = (preferences: Partial<TournamentPreferences> = {}, stage?: "preliminary" | "elimination"): BallotRules => ({
  format: "custom_2team",
  preferences: { ...base, ...preferences },
  ...(stage ? { stage } : {}),
});

const aff: Speaker[] = [{ id: "a1", name: "Ana" }, { id: "a2", name: "Ben" }, { id: "a3", name: "Cai" }];
const neg: Speaker[] = [{ id: "n1", name: "Dee" }, { id: "n2", name: "Eli" }, { id: "n3", name: "Fay" }];
const teamIds = { AFF: "t-aff", NEG: "t-neg" };

function speeches(roster: Speaker[], scores: number[], ranks?: number[]): SpeakerScoreEntry[] {
  return scores.map((score, index) => ({
    speakerId: roster[index].id,
    speakerName: roster[index].name,
    position: index + 1,
    score,
    ...(ranks ? { rank: ranks[index] } : {}),
  }));
}

function sheet(id: string, a: number[], n: number[], declaredWinner?: DebateSide): AdjudicatorSheet {
  return {
    adjudicatorId: id,
    adjudicatorName: id,
    speakerScores: { AFF: speeches(aff, a), NEG: speeches(neg, n) } as Record<DebateSide, SpeakerScoreEntry[]>,
    ...(declaredWinner ? { declaredWinner } : {}),
  };
}

const context = (preferences: Partial<TournamentPreferences> = {}, stage?: "preliminary" | "elimination"): BallotValidationContext => ({
  ...rules(preferences, stage),
  rosters: { AFF: aff, NEG: neg },
});

describe("median aggregation (median_or_rounded_up_mean)", () => {
  it("takes the median of an odd panel and the mean rounded up for an even one", () => {
    expect(aggregateScoreValues([70, 75, 71], "median")).toBe(71);
    expect(aggregateScoreValues([75, 76], "median")).toBe(76);
    expect(aggregateScoreValues([75.5, 76], "median")).toBe(76);
    expect(aggregateScoreValues([74, 76], "median")).toBe(75);
    expect(aggregateScoreValues([70, 75, 71], "mean")).toBeCloseTo(72, 9);
  });

  it("aggregates speeches by median but keeps team totals as the mean of sheet totals", () => {
    const sheets = [sheet("chair", [80, 70, 70], [60, 60, 60]), sheet("p1", [70, 70, 70], [60, 60, 60]), sheet("p2", [72, 70, 70], [60, 60, 60])];
    const result = aggregateVotingSheets(sheets, "chair", teamIds, rules({ scoreAggregation: "median" }));
    expect(result.speakerScores.AFF[0].score).toBe(72);
    // Tabbycat's TeamScore.score is mean(per-adjudicator totals) whatever the aggregation.
    expect(result.teamScores.AFF.totalSpeakerScore).toBeCloseTo((220 + 210 + 212) / 3, 9);
  });

  it("averages over the whole panel, dissenters included, when marginIncludesDissenters is on", () => {
    const sheets = [sheet("chair", [75, 75, 75], [70, 70, 70]), sheet("p1", [74, 74, 74], [72, 72, 72]), sheet("p2", [70, 70, 70], [76, 76, 76])];
    const majorityOnly = aggregateVotingSheets(sheets, "chair", teamIds, rules());
    const wholePanel = aggregateVotingSheets(sheets, "chair", teamIds, rules({ marginIncludesDissenters: true }));
    expect(majorityOnly.speakerScores.AFF[0].score).toBe(74.5);
    expect(wholePanel.speakerScores.AFF[0].score).toBe(73);
    expect(wholePanel.teamScores.AFF.totalSpeakerScore).toBe(219);
  });
});

describe("declared winners (winners_in_ballots)", () => {
  it("migrates allowLowPointWins", () => {
    expect(winnerDeclarationFor({})).toBe("none");
    expect(winnerDeclarationFor({ allowLowPointWins: true })).toBe("low-points");
    expect(winnerDeclarationFor({ allowLowPointWins: true, winnersInBallots: "tied-points" })).toBe("tied-points");
  });

  it("follows Tabbycat's scoresheet classes for a sheet's vote", () => {
    const tied = sheet("a", [70, 70, 70], [70, 70, 70], "NEG");
    const lowAff = sheet("a", [70, 70, 69], [70, 70, 70], "AFF");
    expect(sheetOutcome(tied, rules()).winner).toBeUndefined();
    expect(sheetOutcome(tied, rules({ winnersInBallots: "high-points" })).winner).toBeUndefined();
    expect(sheetOutcome(tied, rules({ winnersInBallots: "tied-points" })).winner).toBe("NEG");
    expect(sheetOutcome(lowAff, rules({ winnersInBallots: "tied-points" })).winner).toBeUndefined();
    expect(sheetOutcome(lowAff, rules({ winnersInBallots: "low-points" })).winner).toBe("AFF");
    // high-points ignores the declaration when counting the vote; validation checks it.
    expect(sheetOutcome(lowAff, rules({ winnersInBallots: "high-points" })).winner).toBe("NEG");
  });

  it("validates consensus winners per mode", () => {
    const tiedScores = { AFF: speeches(aff, [70, 70, 70]), NEG: speeches(neg, [70, 70, 70]) };
    const lowScores = { AFF: speeches(aff, [70, 70, 69]), NEG: speeches(neg, [70, 70, 70]) };
    const affWins = { AFF: 1, NEG: 2 };
    expect(validateBallotEntry({ speakerScores: tiedScores, ranks: affWins }, context()).join(" ")).toMatch(/tied/);
    expect(validateBallotEntry({ speakerScores: tiedScores, ranks: affWins }, context({ winnersInBallots: "high-points" })).join(" ")).toMatch(/cannot be drawn/);
    expect(validateBallotEntry({ speakerScores: tiedScores, ranks: affWins }, context({ winnersInBallots: "tied-points" }))).toEqual([]);
    expect(validateBallotEntry({ speakerScores: lowScores, ranks: affWins }, context({ winnersInBallots: "tied-points" })).join(" ")).toMatch(/Low-point wins/);
    expect(validateBallotEntry({ speakerScores: lowScores, ranks: affWins }, context({ winnersInBallots: "low-points" }))).toEqual([]);
  });

  it("requires and checks a declared winner on voting sheets", () => {
    const voting = { ballotMode: "voting" as const, winnersInBallots: "high-points" as const };
    const undeclared = validateBallotEntry({ speakerScores: {}, sheets: [sheet("chair", [75, 75, 75], [70, 70, 70])] }, context(voting));
    expect(undeclared.join(" ")).toMatch(/choose the winning team/i);
    const wrong = validateBallotEntry({ speakerScores: {}, sheets: [sheet("chair", [75, 75, 75], [70, 70, 70], "NEG")] }, context(voting));
    expect(wrong.join(" ")).toMatch(/Neg is declared the winner with a lower total/);
    const lowPoint = { ballotMode: "voting" as const, winnersInBallots: "low-points" as const };
    const sheets = [sheet("chair", [75, 75, 75], [70, 70, 70], "NEG"), sheet("p1", [75, 75, 75], [70, 70, 70], "NEG"), sheet("p2", [75, 75, 75], [70, 70, 70], "AFF")];
    expect(validateBallotEntry({ speakerScores: {}, sheets }, context(lowPoint))).toEqual([]);
    const result = buildBallotResult({ speakerScores: {}, sheets }, teamIds, "chair", rules(lowPoint));
    expect(result.teamScores.NEG).toMatchObject({ win: true, votes: 2 });
  });

  it("rejects tied BP totals unless tied-points, as Tabbycat's PolyScoresheet", () => {
    const bpRules: BallotValidationContext = {
      format: "bp",
      preferences: { substantiveSpeakers: 2, minSpeakerScore: 50, maxSpeakerScore: 100, stepSpeakerScore: 1 },
      rosters: {
        OG: [{ id: "og1", name: "A" }, { id: "og2", name: "B" }],
        OO: [{ id: "oo1", name: "C" }, { id: "oo2", name: "D" }],
        CG: [{ id: "cg1", name: "E" }, { id: "cg2", name: "F" }],
        CO: [{ id: "co1", name: "G" }, { id: "co2", name: "H" }],
      },
    };
    const two = (side: string, a: number, b: number) => [
      { speakerId: `${side}1`, speakerName: "x", position: 1, score: a },
      { speakerId: `${side}2`, speakerName: "y", position: 2, score: b },
    ];
    const entry = {
      speakerScores: { OG: two("og", 75, 75), OO: two("oo", 75, 75), CG: two("cg", 70, 70), CO: two("co", 65, 65) },
      ranks: { OG: 1, OO: 2, CG: 3, CO: 4 },
    };
    expect(validateBallotEntry(entry, bpRules).join(" ")).toMatch(/same total/);
    expect(validateBallotEntry(entry, { ...bpRules, preferences: { ...bpRules.preferences, winnersInBallots: "tied-points" } })).toEqual([]);
  });
});

describe("ballots without speaker scores (speakers_in_ballots)", () => {
  it("drops scores by stage", () => {
    expect(ballotsHaveSpeakerScores({}, "elimination")).toBe(true);
    expect(ballotsHaveSpeakerScores({ speakersInBallots: "prelim" }, "preliminary")).toBe(true);
    expect(ballotsHaveSpeakerScores({ speakersInBallots: "prelim" }, "elimination")).toBe(false);
    expect(ballotsHaveSpeakerScores({ speakersInBallots: "never" }, "preliminary")).toBe(false);
  });

  it("records a consensus result without scores or margin", () => {
    const never = rules({ speakersInBallots: "never" });
    expect(validateBallotEntry({ speakerScores: {}, ranks: { AFF: 2, NEG: 1 } }, context({ speakersInBallots: "never" }))).toEqual([]);
    const result = buildBallotResult({ speakerScores: {}, ranks: { AFF: 2, NEG: 1 } }, teamIds, undefined, never);
    expect(result.noSpeakerScores).toBe(true);
    expect(result.speakerScores).toEqual({ AFF: [], NEG: [] });
    expect(result.teamScores.NEG).toMatchObject({ win: true, points: 1, totalSpeakerScore: 0 });
    expect(result.teamScores.NEG.margin).toBeUndefined();
  });

  it("takes each adjudicator's declared winner on a scoreless voting ballot", () => {
    const voting = { ballotMode: "voting" as const, speakersInBallots: "prelim" as const };
    const sheets = [
      { adjudicatorId: "chair", speakerScores: {} as Record<DebateSide, SpeakerScoreEntry[]>, declaredWinner: "AFF" as DebateSide },
      { adjudicatorId: "p1", speakerScores: {} as Record<DebateSide, SpeakerScoreEntry[]>, declaredWinner: "NEG" as DebateSide },
      { adjudicatorId: "p2", speakerScores: {} as Record<DebateSide, SpeakerScoreEntry[]> },
    ];
    expect(validateBallotEntry({ speakerScores: {}, sheets }, context(voting, "elimination")).join(" ")).toMatch(/p2|Adjudicator — choose/);
    sheets[2].declaredWinner = "NEG";
    const result = buildBallotResult({ speakerScores: {}, sheets }, teamIds, "chair", rules(voting, "elimination"));
    expect(result).toMatchObject({ noSpeakerScores: true });
    expect(result.teamScores.NEG).toMatchObject({ win: true, votes: 2, totalSpeakerScore: 0 });
  });
});

describe("speech ranks (speaker_ranks)", () => {
  const scores = (affRanks: number[], negRanks: number[]) => ({
    AFF: speeches(aff, [75, 74, 73], affRanks),
    NEG: speeches(neg, [72, 71, 70], negRanks),
  });

  it("requires untied ranks for every substantive speech", () => {
    const any = context({ speakerRanks: "any" });
    expect(validateBallotEntry({ speakerScores: scores([1, 2, 3], [4, 5, 6]), ranks: { AFF: 1, NEG: 2 } }, any)).toEqual([]);
    expect(validateBallotEntry({ speakerScores: scores([1, 1, 3], [4, 5, 6]), ranks: { AFF: 1, NEG: 2 } }, any).join(" ")).toMatch(/tied/);
    expect(validateBallotEntry({ speakerScores: scores([1, 2, 3], [4, 5, 7]), ranks: { AFF: 1, NEG: 2 } }, any).join(" ")).toMatch(/1 to 6/);
    // "any": ranks need not follow scores.
    expect(validateBallotEntry({ speakerScores: scores([6, 2, 3], [4, 5, 1]), ranks: { AFF: 1, NEG: 2 } }, any)).toEqual([]);
  });

  it("makes ranks follow scores with high-points, allowing either order for equal scores", () => {
    const high = context({ speakerRanks: "high-points" });
    expect(validateBallotEntry({ speakerScores: scores([6, 2, 3], [4, 5, 1]), ranks: { AFF: 1, NEG: 2 } }, high).join(" "))
      .toMatch(/follow the speaker scores/);
    const equal = { AFF: speeches(aff, [75, 75, 73], [2, 1, 3]), NEG: speeches(neg, [72, 71, 70], [4, 5, 6]) };
    expect(validateBallotEntry({ speakerScores: equal, ranks: { AFF: 1, NEG: 2 } }, high)).toEqual([]);
  });

  it("stores ranks only when ranks are in use", () => {
    const entry = { speakerScores: scores([1, 2, 3], [4, 5, 6]), ranks: { AFF: 1, NEG: 2 } };
    expect(buildBallotResult(entry, teamIds, undefined, rules({ speakerRanks: "any" })).speakerScores.AFF[0].rank).toBe(1);
    expect(buildBallotResult(entry, teamIds, undefined, rules()).speakerScores.AFF[0].rank).toBeUndefined();
  });
});

describe("score criteria", () => {
  // Tabbycat's WSDC preset: weights 1, step 0.5.
  const criteria: ScoreCriterion[] = [
    { id: "style", name: "Style", seq: 1, speechType: "substantive", weight: 1, minScore: 24, maxScore: 32, step: 0.5, required: true },
    { id: "content", name: "Content", seq: 2, speechType: "substantive", weight: 1, minScore: 24, maxScore: 32, step: 0.5, required: true },
    { id: "strategy", name: "Strategy", seq: 3, speechType: "substantive", weight: 1, minScore: 12, maxScore: 16, step: 0.5, required: true },
    { id: "pois", name: "POIs", seq: 4, speechType: "substantive", weight: 1, minScore: -2, maxScore: 2, step: 0.5, required: false },
    { id: "r-style", name: "Style", seq: 5, speechType: "reply", weight: 1, minScore: 12, maxScore: 16, step: 0.5, required: true },
  ];
  const criteriaSpeeches = (roster: Speaker[], values: Record<string, number>[]) =>
    values.map((criteria, index) => ({ speakerId: roster[index].id, speakerName: roster[index].name, position: index + 1, score: 0, criteria }));

  it("derives each speech score as the weighted sum and validates each criterion", () => {
    const prefs = { scoreCriteria: criteria };
    const affScores = criteriaSpeeches(aff, [
      { style: 28, content: 28, strategy: 14, pois: 1 },
      { style: 27, content: 27, strategy: 13.5 },
      { style: 26, content: 26, strategy: 13 },
    ]);
    const negScores = criteriaSpeeches(neg, [
      { style: 26, content: 26, strategy: 13 },
      { style: 26, content: 26, strategy: 13 },
      { style: 26, content: 26, strategy: 13 },
    ]);
    const entry = { speakerScores: { AFF: affScores, NEG: negScores }, ranks: { AFF: 1, NEG: 2 } };
    expect(validateBallotEntry(entry, context(prefs))).toEqual([]);
    const result = buildBallotResult(entry, teamIds, undefined, rules(prefs));
    expect(result.speakerScores.AFF.map((speech) => speech.score)).toEqual([71, 67.5, 65]);
    expect(result.teamScores.AFF.totalSpeakerScore).toBe(203.5);

    const bad = { ...entry, speakerScores: { ...entry.speakerScores, AFF: criteriaSpeeches(aff, [{ style: 33, content: 28 }, affScores[1].criteria, affScores[2].criteria]) } };
    const errors = validateBallotEntry(bad, context(prefs)).join(" ");
    expect(errors).toMatch(/Style: 33 is outside 24–32/);
    expect(errors).toMatch(/Strategy: enter a score/);
  });

  it("aggregates each criterion separately on voting ballots (medians do not add up)", () => {
    const prefs = { scoreCriteria: criteria.slice(0, 2), ballotMode: "voting" as const, scoreAggregation: "median" as const };
    const make = (id: string, styles: number[], contents: number[]): AdjudicatorSheet => ({
      adjudicatorId: id,
      speakerScores: {
        AFF: criteriaSpeeches(aff, styles.map((style, index) => ({ style, content: contents[index] }))),
        NEG: criteriaSpeeches(neg, [{ style: 24, content: 24 }, { style: 24, content: 24 }, { style: 24, content: 24 }]),
      } as Record<DebateSide, SpeakerScoreEntry[]>,
    });
    const sheets = [make("chair", [30, 30, 30], [24, 24, 24]), make("p1", [24, 24, 24], [30, 30, 30]), make("p2", [27, 27, 27], [26, 26, 26])];
    const result = buildBallotResult({ speakerScores: {}, sheets }, teamIds, "chair", rules(prefs));
    // Median style 27 + median content 26 = 53, whereas the median of the sheet scores (54, 54, 53) is 54.
    expect(result.speakerScores.AFF[0]).toMatchObject({ score: 53, criteria: { style: 27, content: 26 } });
  });

  it("checks criteria definitions", () => {
    expect(validateScoreCriteria(criteria)).toEqual([]);
    expect(validateScoreCriteria([{ ...criteria[0], weight: 0, minScore: 5, maxScore: 5 }]).length).toBe(2);
  });
});

describe("margins, replies, side names and weights", () => {
  it("enforces the maximum margin per scoresheet", () => {
    const entry = { speakerScores: { AFF: speeches(aff, [80, 80, 80]), NEG: speeches(neg, [74, 74, 74]) }, ranks: { AFF: 1, NEG: 2 } };
    expect(validateBallotEntry(entry, context({ maximumMargin: 15 })).join(" ")).toMatch(/margin \(18\) exceeds the maximum allowed margin \(15\)/);
    expect(validateBallotEntry(entry, context({ maximumMargin: 18 }))).toEqual([]);
    expect(validateBallotEntry(entry, context({ maximumMargin: 0 }))).toEqual([]);
  });

  it("uses an independent reply step, falling back to half the substantive step", () => {
    expect(replyScoreStep({ stepSpeakerScore: 1 })).toBe(0.5);
    expect(replyScoreStep({ stepSpeakerScore: 1, stepReplyScore: 1 })).toBe(1);
    expect(validateReplyScore(37.5, { minReplyScore: 35, maxReplyScore: 40, stepReplyScore: 1 }).valid).toBe(false);
    expect(validateReplyScore(37.5, { minReplyScore: 35, maxReplyScore: 40, stepSpeakerScore: 1 }).valid).toBe(true);
  });

  it("lets any non-last speaker reply when a substantive speech is not required", () => {
    const roster = [...aff, { id: "a4", name: "Dan" }];
    const reply = (id: string) => [...speeches(aff, [75, 74, 73]), { speakerId: id, speakerName: id, position: 4, score: 37 }];
    const withReplies = (preferences: Partial<TournamentPreferences>): BallotValidationContext => ({
      ...context({ replyScoresEnabled: true, minReplyScore: 30, maxReplyScore: 40, ...preferences }),
      rosters: { AFF: roster, NEG: neg },
    });
    const entry = (id: string) => ({
      speakerScores: { AFF: reply(id), NEG: [...speeches(neg, [70, 70, 70]), { speakerId: "n1", speakerName: "Dee", position: 4, score: 35 }] },
      ranks: { AFF: 1, NEG: 2 },
    });
    expect(validateBallotEntry(entry("a4"), withReplies({})).join(" ")).toMatch(/first 2 speakers/);
    expect(validateBallotEntry(entry("a4"), withReplies({ requireSubstantiveForReply: false }))).toEqual([]);
    expect(validateBallotEntry(entry("a3"), withReplies({ requireSubstantiveForReply: false })).join(" ")).toMatch(/last substantive speaker/);
  });

  it("names sides by the tournament's side names", () => {
    expect(sideLabel("AFF", {})).toBe("Aff");
    expect(sideLabel("AFF", { sideNames: "gov-opp" }, "full")).toBe("Government");
    expect(sideLabel("NEG", { sideNames: "prop-opp" })).toBe("Opp");
    expect(sideLabel("NEG", { sideNames: "1-2" }, "full")).toBe("Team 2");
    expect(sideLabel("CO", { sideNames: "gov-opp" }, "full")).toBe("Closing Opposition");
  });

  it("reads round weights, defaulting to 1", () => {
    expect(roundWeight({})).toBe(1);
    expect(roundWeight({ weight: 2 })).toBe(2);
    expect(roundWeight({ weight: 1.5 })).toBe(1);
    expect(roundWeight(undefined)).toBe(1);
  });
});

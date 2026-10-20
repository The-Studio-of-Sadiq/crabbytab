import { describe, expect, it } from "vitest";
import type { Debate, FeedbackPathConfig, FeedbackSubmission } from "@/types";
import { describeFeedbackPaths, isFeedbackPathAllowed, isFeedbackPathConfig, isFeedbackPathExpected } from "./paths";
import { expectedFeedbackForDebate, feedbackTargetsForSource, roundFeedbackProgress, unexpectedFeedback } from "./progress";
import { filterFeedbackSubmissions, isImportantFeedback } from "./filters";
import { defaultFeedbackScore, feedbackScoreStep, validateFeedbackScore } from "@/lib/scoring/validator";

const base: FeedbackPathConfig = {
  teams: "chair",
  chairOnPanellists: false,
  chairOnTrainees: false,
  panellistsOnChair: false,
  traineesOnChair: false,
  adjudicatorsOnEachOther: false,
  onTeams: false,
};

const debate = {
  id: "d1",
  tournamentId: "t1",
  roundId: "r1",
  roundSeq: 1,
  bracket: 0,
  roomRank: 1,
  importance: 0,
  resultStatus: "none",
  sidesConfirmed: true,
  flags: [],
  teams: { AFF: { teamId: "aff", teamName: "Aff", side: "AFF" }, NEG: { teamId: "neg", teamName: "Neg", side: "NEG" } },
  adjudicators: { chairId: "c", panellistIds: ["p1", "p2"], panellistNames: [], traineeIds: ["t"], traineeNames: [] },
} as unknown as Debate;

function submission(sourceType: "team" | "adjudicator", sourceId: string, target: string, overrides: Partial<FeedbackSubmission> = {}): FeedbackSubmission {
  return {
    id: `${sourceId}-${target}`,
    tournamentId: "t1",
    roundId: "r1",
    debateId: "d1",
    targetType: "adjudicator",
    targetAdjudicatorId: target,
    sourceType,
    sourceId,
    sourceName: sourceId,
    score: 7,
    confirmed: true,
    timestamp: "2026-10-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("team feedback modes (Tabbycat feedback_from_teams)", () => {
  it("separates who may be rated from who is owed", () => {
    const cases: Array<[FeedbackPathConfig["teams"], string[], string[]]> = [
      ["chair", ["chair"], ["chair"]],
      ["orallist", ["chair", "panellist"], ["chair"]],
      ["voting_allowed", ["chair", "panellist"], ["chair"]],
      ["all_allowed", ["chair", "panellist", "trainee"], ["chair"]],
      ["all_voting", ["chair", "panellist"], ["chair", "panellist"]],
      ["all_adjudicators", ["chair", "panellist", "trainee"], ["chair", "panellist", "trainee"]],
      ["none", [], []],
    ];
    for (const [teams, allowed, expected] of cases) {
      const config = { ...base, teams };
      expect(isFeedbackPathConfig(config)).toBe(true);
      expect((["chair", "panellist", "trainee"] as const).filter((role) => isFeedbackPathAllowed(config, "team", role))).toEqual(allowed);
      expect((["chair", "panellist", "trainee"] as const).filter((role) => isFeedbackPathExpected(config, "team", role))).toEqual(expected);
    }
  });

  it("lets a team rate any allowed adjudicator but owes one submission in orallist modes", () => {
    const config = { ...base, teams: "all_allowed" as const };
    expect(feedbackTargetsForSource(debate, { sourceType: "team", sourceId: "aff" }, config).map((target) => target.targetAdjudicatorId))
      .toEqual(["c", "p1", "p2", "t"]);
    expect(expectedFeedbackForDebate(debate, config)).toHaveLength(2);
    // A team that rated the panellist who gave the oral has paid its debt; a second one is unexpected.
    const submissions = [
      submission("team", "aff", "p1"),
      submission("team", "aff", "t", { timestamp: "2026-10-20T11:00:00.000Z" }),
    ];
    const progress = roundFeedbackProgress({ id: "r1", stage: "preliminary" }, [debate], submissions, config);
    expect(progress).toMatchObject({ expected: 2, submitted: 1 });
    expect(progress.outstanding.map((item) => item.sourceId)).toEqual(["neg"]);
    expect(unexpectedFeedback({ id: "r1" }, [debate], submissions, config).map((item) => item.targetAdjudicatorId)).toEqual(["t"]);
  });

  it("describes the new modes", () => {
    expect(describeFeedbackPaths({ ...base, teams: "orallist" })).toContain("orallist");
  });
});

describe("panellists on each other (Tabbycat with-p-on-p)", () => {
  it("adds panellist-on-panellist feedback without trainees", () => {
    const config = { ...base, panellistsOnEachOther: true };
    expect(isFeedbackPathAllowed(config, "panellist", "panellist")).toBe(true);
    expect(isFeedbackPathAllowed(config, "trainee", "panellist")).toBe(false);
    expect(isFeedbackPathAllowed(config, "panellist", "trainee")).toBe(false);
    const expected = expectedFeedbackForDebate(debate, config).filter((item) => item.sourceType === "adjudicator");
    expect(expected.map((item) => `${item.sourceId}>${item.targetAdjudicatorId}`)).toEqual(["p1>p2", "p2>p1"]);
    expect(isFeedbackPathConfig({ ...config, panellistsOnEachOther: "yes" })).toBe(false);
  });
});

describe("feedback score step and important feedback", () => {
  it("validates scores on the step and starts forms on a step", () => {
    const preferences = { feedbackMinScore: 1, feedbackMaxScore: 5, feedbackScoreStep: 0.5 };
    expect(validateFeedbackScore(3.5, preferences).valid).toBe(true);
    expect(validateFeedbackScore(3.25, preferences).valid).toBe(false);
    expect(validateFeedbackScore(3.25, { feedbackMinScore: 1, feedbackMaxScore: 5 }).valid).toBe(false);
    expect(feedbackScoreStep({ feedbackScoreStep: -1 })).toBe(1);
    expect(defaultFeedbackScore(preferences)).toBe(3);
    expect(defaultFeedbackScore({ feedbackMinScore: 1, feedbackMaxScore: 10, feedbackScoreStep: 0.5 })).toBe(5.5);
  });

  it("flags feedback far from the base score", () => {
    const baseScores = new Map([["c", 4]]);
    expect(isImportantFeedback({ score: 7, targetAdjudicatorId: "c" }, baseScores)).toBe(true);
    expect(isImportantFeedback({ score: 6, targetAdjudicatorId: "c" }, baseScores)).toBe(false);
    expect(isImportantFeedback({ score: 1, targetAdjudicatorId: "c", targetType: "team" }, baseScores)).toBe(false);
    const all = [submission("team", "aff", "c", { score: 9 }), submission("team", "neg", "c", { score: 5 })];
    expect(filterFeedbackSubmissions(all, { important: true }, { baseScores, importantThreshold: 3 }).map((item) => item.sourceId)).toEqual(["aff"]);
  });
});

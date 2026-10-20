import { describe, expect, it } from "vitest";
import type { Debate, FeedbackPathConfig, FeedbackSubmission, Round } from "@/types";
import {
  LEGACY_FEEDBACK_PATHS,
  feedbackPathsForRound,
  isFeedbackPathAllowed,
  isFeedbackPathConfig,
  toFeedbackPathConfig,
} from "./paths";
import { canSubmitParticipantFeedback } from "./questions";
import { expectedFeedbackForDebate, feedbackSourcesForTarget, feedbackTargetsForSource, roundFeedbackProgress } from "./progress";

const none: FeedbackPathConfig = {
  teams: "none",
  chairOnPanellists: false,
  chairOnTrainees: false,
  panellistsOnChair: false,
  traineesOnChair: false,
  adjudicatorsOnEachOther: false,
  onTeams: false,
};

const debate: Debate = {
  id: "d1",
  tournamentId: "t",
  roundId: "r1",
  roundSeq: 1,
  bracket: 0,
  roomRank: 1,
  importance: 0,
  resultStatus: "none",
  sidesConfirmed: true,
  flags: [],
  teams: {
    AFF: { teamId: "aff", teamName: "Aff", side: "AFF" },
    NEG: { teamId: "neg", teamName: "Neg", side: "NEG" },
  } as Debate["teams"],
  adjudicators: {
    chairId: "chair",
    panellistIds: ["wing"],
    panellistNames: [],
    traineeIds: ["trainee"],
    traineeNames: [],
  },
};

const pairs = (config: FeedbackPathConfig) =>
  expectedFeedbackForDebate(debate, config).map((item) => `${item.sourceId}>${item.targetAdjudicatorId}`);

describe("feedback path resolution", () => {
  it("maps the legacy presets and falls back to two-way", () => {
    expect(feedbackPathsForRound({}, undefined)).toEqual(LEGACY_FEEDBACK_PATHS.two_way);
    expect(feedbackPathsForRound({ feedbackPath: "chairs_to_panel" }, undefined)).toEqual(LEGACY_FEEDBACK_PATHS.chairs_to_panel);
    expect(toFeedbackPathConfig("bogus" as never)).toEqual(LEGACY_FEEDBACK_PATHS.two_way);
  });

  it("prefers explicit paths and uses elimination paths only in elimination rounds", () => {
    const prelim = { ...none, teams: "all_adjudicators" as const };
    const elim = { ...none, teams: "chair" as const, chairOnPanellists: true };
    const preferences = { feedbackPath: "everyone" as const, feedbackPaths: prelim, eliminationFeedbackPaths: elim };
    expect(feedbackPathsForRound(preferences, { stage: "preliminary" })).toEqual(prelim);
    expect(feedbackPathsForRound(preferences, { stage: "elimination" })).toEqual(elim);
    expect(feedbackPathsForRound({ feedbackPaths: prelim }, { stage: "elimination" })).toEqual(prelim);
  });

  it("ignores malformed stored configs", () => {
    expect(isFeedbackPathConfig({ ...none, teams: "judges" })).toBe(false);
    expect(isFeedbackPathConfig({ ...none, onTeams: "yes" })).toBe(false);
    expect(feedbackPathsForRound({ feedbackPaths: { teams: "chair" } as never }, undefined)).toEqual(LEGACY_FEEDBACK_PATHS.two_way);
  });
});

describe("each feedback path", () => {
  it("teams on the chair only, or on every adjudicator", () => {
    expect(pairs({ ...none, teams: "chair" })).toEqual(["aff>chair", "neg>chair"]);
    expect(pairs({ ...none, teams: "all_adjudicators" })).toEqual([
      "aff>chair", "aff>wing", "aff>trainee", "neg>chair", "neg>wing", "neg>trainee",
    ]);
    expect(pairs(none)).toEqual([]);
  });

  it("separates chair on panellists, chair on trainees, panellists on chair and trainees on chair", () => {
    expect(pairs({ ...none, chairOnPanellists: true })).toEqual(["chair>wing"]);
    expect(pairs({ ...none, chairOnTrainees: true })).toEqual(["chair>trainee"]);
    expect(pairs({ ...none, panellistsOnChair: true })).toEqual(["wing>chair"]);
    expect(pairs({ ...none, traineesOnChair: true })).toEqual(["trainee>chair"]);
  });

  it("everyone on everyone covers all six adjudicator pairs but never self-feedback", () => {
    expect(pairs({ ...none, adjudicatorsOnEachOther: true })).toEqual([
      "chair>wing", "chair>trainee", "wing>chair", "wing>trainee", "trainee>chair", "trainee>wing",
    ]);
    expect(isFeedbackPathAllowed({ ...none, adjudicatorsOnEachOther: true }, "panellist", "trainee")).toBe(true);
  });

  it("lists what one participant owes", () => {
    expect(feedbackTargetsForSource(debate, { sourceType: "adjudicator", sourceId: "chair" }, LEGACY_FEEDBACK_PATHS.two_way))
      .toEqual([
        { targetAdjudicatorId: "wing", targetRole: "panellist" },
        { targetAdjudicatorId: "trainee", targetRole: "trainee" },
      ]);
  });
});

describe("portal permission follows the same paths", () => {
  const base = { sourceType: "adjudicator" as const, targetType: "adjudicator" as const };

  it("tells trainees from panellists when roles are given", () => {
    const config = { ...none, panellistsOnChair: true };
    expect(canSubmitParticipantFeedback({
      ...base, sourceId: "wing", sourceIsChair: false, sourceRole: "panellist",
      targetId: "chair", targetIsChair: true, targetRole: "chair", path: config,
    })).toBe(true);
    expect(canSubmitParticipantFeedback({
      ...base, sourceId: "trainee", sourceIsChair: false, sourceRole: "trainee",
      targetId: "chair", targetIsChair: true, targetRole: "chair", path: config,
    })).toBe(false);
  });

  it("allows feedback on teams only when the paths say so, and never on oneself", () => {
    const team = { sourceType: "team" as const, sourceIsChair: false, targetType: "team" as const, targetIsChair: false };
    expect(canSubmitParticipantFeedback({ ...team, sourceId: "aff", targetId: "neg", path: none })).toBe(false);
    expect(canSubmitParticipantFeedback({ ...team, sourceId: "aff", targetId: "neg", path: { ...none, onTeams: true } })).toBe(true);
    expect(canSubmitParticipantFeedback({ ...team, sourceId: "aff", targetId: "aff", path: { ...none, onTeams: true } })).toBe(false);
  });

  it("keeps the tab-room source list, progress and portals in step", () => {
    const config = { ...none, teams: "chair" as const, panellistsOnChair: true };
    expect(feedbackSourcesForTarget(debate, "chair", config).map((item) => item.sourceId)).toEqual(["aff", "neg", "wing"]);
    expect(feedbackSourcesForTarget(debate, "wing", config)).toEqual([]);
  });
});

describe("progress counts per path", () => {
  const round = { id: "r1", stage: "preliminary" } as Round;
  const submission = (sourceType: "team" | "adjudicator", sourceId: string, target: string): FeedbackSubmission => ({
    id: `${sourceId}-${target}`,
    tournamentId: "t",
    roundId: "r1",
    debateId: "d1",
    targetAdjudicatorId: target,
    sourceType,
    sourceId,
    sourceName: sourceId,
    score: 5,
    confirmed: false,
    timestamp: "",
  });
  const submissions = [submission("team", "aff", "chair"), submission("team", "aff", "wing"), submission("adjudicator", "chair", "wing")];

  it.each([
    [{ ...none, teams: "chair" as const }, 2, 1],
    [{ ...none, teams: "all_adjudicators" as const }, 6, 2],
    [{ ...LEGACY_FEEDBACK_PATHS.chairs_to_panel }, 4, 2],
    [{ ...none, adjudicatorsOnEachOther: true }, 6, 1],
  ])("expects and counts per path %#", (config, expected, submitted) => {
    expect(roundFeedbackProgress(round, [debate], submissions, config)).toMatchObject({ expected, submitted });
  });
});

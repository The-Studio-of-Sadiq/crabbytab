import { describe, expect, it } from "vitest";
import type { Debate, FeedbackSubmission, Round } from "@/types";
import { expectedFeedbackForDebate, feedbackSourcesForTarget, roundFeedbackProgress } from "./progress";

const debate = (overrides: Partial<Debate> = {}): Debate => ({
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
  ...overrides,
});

const pairs = (items: ReturnType<typeof expectedFeedbackForDebate>) =>
  items.map((item) => `${item.sourceId}>${item.targetAdjudicatorId}`);

describe("expected feedback", () => {
  it("has teams rate the chair and adjudicators follow the feedback path", () => {
    expect(pairs(expectedFeedbackForDebate(debate(), "chairs_to_panel"))).toEqual([
      "aff>chair", "neg>chair", "chair>wing", "chair>trainee",
    ]);
    expect(pairs(expectedFeedbackForDebate(debate(), "two_way"))).toEqual([
      "aff>chair", "neg>chair", "chair>wing", "chair>trainee", "wing>chair", "trainee>chair",
    ]);
    // "everyone": both teams on all three adjudicators, and six adjudicator pairs.
    expect(expectedFeedbackForDebate(debate(), "everyone")).toHaveLength(12);
  });

  it("expects nothing from byes, postponed debates or a debate without adjudicators", () => {
    expect(expectedFeedbackForDebate(debate({ byeTeamId: "aff" }), "two_way")).toEqual([]);
    expect(expectedFeedbackForDebate(debate({ postponed: true }), "two_way")).toEqual([]);
    expect(expectedFeedbackForDebate(debate({
      adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    }), "two_way")).toEqual([]);
  });
});

describe("round feedback progress", () => {
  const round = { id: "r1", stage: "preliminary" } as Round;
  const submission = (sourceId: string, target: string, extra: Partial<FeedbackSubmission> = {}): FeedbackSubmission => ({
    id: `${sourceId}-${target}`,
    tournamentId: "t",
    roundId: "r1",
    debateId: "d1",
    targetAdjudicatorId: target,
    sourceType: sourceId === "aff" || sourceId === "neg" ? "team" : "adjudicator",
    sourceId,
    sourceName: sourceId,
    score: 5,
    confirmed: true,
    timestamp: "",
    ...extra,
  });

  it("counts submissions, including ignored ones, and lists who still owes feedback", () => {
    const progress = roundFeedbackProgress(
      round,
      [debate()],
      [
        submission("aff", "chair", { ignored: true }),
        submission("chair", "wing"),
        submission("neg", "chair", { roundId: "r2" }),
      ],
      "chairs_to_panel"
    );
    expect(progress).toMatchObject({ enabled: true, expected: 4, submitted: 2 });
    expect(progress.outstanding).toEqual([
      { sourceType: "team", sourceId: "neg", sourceRole: "team", debateId: "d1", owed: [{ targetAdjudicatorId: "chair", targetRole: "chair" }] },
      { sourceType: "adjudicator", sourceId: "chair", sourceRole: "chair", debateId: "d1", owed: [{ targetAdjudicatorId: "trainee", targetRole: "trainee" }] },
    ]);
  });

  it("expects nothing when feedback is off for the round", () => {
    const progress = roundFeedbackProgress({ ...round, feedbackEnabled: false }, [debate()], [], "two_way");
    expect(progress).toEqual({ roundId: "r1", enabled: false, expected: 0, submitted: 0, outstanding: [] });
  });
});

describe("feedback sources for admin entry", () => {
  it("offers the debate's teams and the adjudicators the path allows", () => {
    expect(feedbackSourcesForTarget(debate(), "chair", "chairs_to_panel").map((item) => item.sourceId))
      .toEqual(["aff", "neg"]);
    expect(feedbackSourcesForTarget(debate(), "chair", "two_way").map((item) => item.sourceId))
      .toEqual(["aff", "neg", "wing", "trainee"]);
    // Teams rate only the chair under the presets other than "everyone".
    expect(feedbackSourcesForTarget(debate(), "wing", "chairs_to_panel").map((item) => item.sourceId))
      .toEqual(["chair"]);
    expect(feedbackSourcesForTarget(debate(), "stranger", "everyone")).toEqual([]);
  });
});

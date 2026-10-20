import { describe, expect, it } from "vitest";
import type { Adjudicator, Debate, FeedbackSubmission, Round } from "@/types";
import {
  adjudicatorScoreHistory,
  blendAdjudicatorScore,
  calculateFeedbackSummaries,
  feedbackWeightKey,
  isFeedbackCountedForScore,
  scaleFeedbackScore,
} from "./scores";

const panelDebate = (id: string, roundId: string): Pick<Debate, "id" | "roundId" | "adjudicators"> => ({
  id,
  roundId,
  adjudicators: {
    chairId: "chair",
    panellistIds: ["wing"],
    panellistNames: [],
    traineeIds: ["trainee"],
    traineeNames: [],
  },
});

function submission(overrides: Partial<FeedbackSubmission>): FeedbackSubmission {
  return {
    id: "fb",
    tournamentId: "t",
    roundId: "r1",
    debateId: "d1",
    targetAdjudicatorId: "chair",
    sourceType: "team",
    sourceId: "team-a",
    sourceName: "Team A",
    score: 5,
    confirmed: true,
    timestamp: "",
    ...overrides,
  };
}

describe("feedback scores", () => {
  it("excludes ignored, unconfirmed and team-targeted feedback", () => {
    expect(isFeedbackCountedForScore(submission({}))).toBe(true);
    expect(isFeedbackCountedForScore(submission({ ignored: true }))).toBe(false);
    expect(isFeedbackCountedForScore(submission({ confirmed: false }))).toBe(false);
    expect(isFeedbackCountedForScore(submission({ targetType: "team", targetAdjudicatorId: undefined }))).toBe(false);
  });

  it("scales feedback onto the 1-10 adjudicator range", () => {
    expect(scaleFeedbackScore(1, 1, 5)).toBe(1);
    expect(scaleFeedbackScore(5, 1, 5)).toBe(10);
    expect(scaleFeedbackScore(3, 1, 5)).toBe(5.5);
    expect(scaleFeedbackScore(7, 1, 10)).toBe(7);
    expect(scaleFeedbackScore(12, 1, 10)).toBe(10);
  });

  it("derives source and target roles from the debate panel", () => {
    const debate = panelDebate("d1", "r1");
    expect(feedbackWeightKey(submission({}), debate)).toBe("team_on_chair");
    expect(
      feedbackWeightKey(submission({ sourceType: "adjudicator", sourceId: "wing" }), debate)
    ).toBe("panellist_on_chair");
    expect(
      feedbackWeightKey(
        submission({ sourceType: "adjudicator", sourceId: "chair", targetAdjudicatorId: "trainee" }),
        debate
      )
    ).toBe("chair_on_trainee");
    expect(feedbackWeightKey(submission({}), undefined)).toBeUndefined();
  });

  it("weights submissions by source and leaves ignored ones out", () => {
    const debates = [panelDebate("d1", "r1")];
    const summaries = calculateFeedbackSummaries(
      [
        submission({ id: "1", score: 4 }),
        submission({ id: "2", score: 10, sourceType: "adjudicator", sourceId: "wing" }),
        submission({ id: "3", score: 1, ignored: true }),
      ],
      debates,
      { feedbackMinScore: 1, feedbackMaxScore: 10, feedbackSourceWeights: { panellist_on_chair: 2 } }
    );
    const chair = summaries.get("chair")!;
    expect(chair.count).toBe(2);
    expect(chair.average).toBe(8); // (4 * 1 + 10 * 2) / 3
    expect(chair.scaledAverage).toBe(8);
  });

  it("treats a zero total weight as no feedback", () => {
    const summaries = calculateFeedbackSummaries([submission({})], [panelDebate("d1", "r1")], {
      feedbackSourceWeights: { team_on_chair: 0 },
    });
    expect(summaries.has("chair")).toBe(false);
  });

  it("blends with the round weight and keeps the test score when there is no feedback", () => {
    expect(blendAdjudicatorScore({ baseScore: 4 }, 8, 0.25)).toBe(5);
    expect(blendAdjudicatorScore({ baseScore: 4, testScore: 6 }, undefined, 1)).toBe(6);
    expect(blendAdjudicatorScore({ baseScore: 4 }, 8, 7)).toBe(8); // weight clamped to 1
  });

  it("builds a per-round history with a running blended score", () => {
    const adjudicator = { id: "chair", baseScore: 5 } as Adjudicator;
    const rounds = [
      { id: "r1", name: "Round 1", seq: 1, feedbackWeight: 0.5 },
      { id: "r2", name: "Round 2", seq: 2, feedbackWeight: 1 },
      { id: "r3", name: "Round 3", seq: 3, feedbackWeight: 1, cancelled: true },
    ] as Round[];
    const debates = [panelDebate("d1", "r1"), panelDebate("d2", "r2")] as Debate[];
    const history = adjudicatorScoreHistory(
      adjudicator,
      rounds,
      debates,
      [
        submission({ id: "1", score: 9 }),
        submission({ id: "2", roundId: "r2", debateId: "d2", score: 7 }),
        submission({ id: "3", roundId: "r2", debateId: "d2", score: 1, ignored: true }),
      ]
    );
    expect(history.map((row) => row.roundId)).toEqual(["r1", "r2"]);
    expect(history[0]).toMatchObject({ role: "chair", received: 1, cumulativeScore: 7 });
    expect(history[1]).toMatchObject({ received: 2, cumulativeScore: 8 });
    expect(history[1].summary?.count).toBe(1);
  });
});

describe("question answers and the feedback score", () => {
  it("uses only the overall score; numeric answers never change it", () => {
    const debates = [panelDebate("d1", "r1")];
    const plain = [submission({ score: 6 })];
    const withAnswers = [submission({ score: 6, answers: { clarity: 1, minutes: 99.5, scale: 10, oral: true } })];
    expect(calculateFeedbackSummaries(withAnswers, debates).get("chair"))
      .toEqual(calculateFeedbackSummaries(plain, debates).get("chair"));
  });

  it("still leaves out unconfirmed and ignored feedback", () => {
    const debates = [panelDebate("d1", "r1")];
    const summaries = calculateFeedbackSummaries([
      submission({ id: "a", score: 8 }),
      submission({ id: "b", score: 1, confirmed: false, answers: { clarity: 5 } }),
      submission({ id: "c", score: 1, ignored: true, answers: { clarity: 5 } }),
    ], debates);
    expect(summaries.get("chair")).toMatchObject({ count: 1, average: 8 });
  });
});

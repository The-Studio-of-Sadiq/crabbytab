import type {
  Adjudicator,
  Debate,
  FeedbackSourceRole,
  FeedbackSubmission,
  FeedbackTargetRole,
  FeedbackWeightKey,
  Round,
  TournamentPreferences,
} from "@/types";

/** Adjudicator base and test scores use this range (see the adjudicator editor). */
export const ADJ_SCORE_MIN = 1;
export const ADJ_SCORE_MAX = 10;

export const FEEDBACK_SOURCE_ROLES: FeedbackSourceRole[] = ["team", "chair", "panellist", "trainee"];
export const FEEDBACK_TARGET_ROLES: FeedbackTargetRole[] = ["chair", "panellist", "trainee"];

type FeedbackScorePreferences = Pick<
  TournamentPreferences,
  "feedbackMinScore" | "feedbackMaxScore" | "feedbackSourceWeights"
>;

/** Confirmed, not ignored, rates an adjudicator, and has a usable score. */
export function isFeedbackCountedForScore(submission: FeedbackSubmission): boolean {
  return (
    submission.confirmed &&
    !submission.ignored &&
    Number.isFinite(submission.score) &&
    (!submission.targetType || submission.targetType === "adjudicator") &&
    Boolean(submission.targetAdjudicatorId)
  );
}

/** Maps a score from the feedback scale linearly onto the adjudicator score range. */
export function scaleFeedbackScore(score: number, feedbackMin = 1, feedbackMax = 10): number {
  if (!(feedbackMax > feedbackMin)) return score;
  const fraction = (score - feedbackMin) / (feedbackMax - feedbackMin);
  const clamped = Math.min(1, Math.max(0, fraction));
  return ADJ_SCORE_MIN + clamped * (ADJ_SCORE_MAX - ADJ_SCORE_MIN);
}

/** The adjudicator's score before feedback: the test score when one was set, else the base score. */
export function preFeedbackScore(adjudicator: Pick<Adjudicator, "baseScore" | "testScore">): number {
  if (adjudicator.testScore !== undefined && Number.isFinite(adjudicator.testScore)) {
    return adjudicator.testScore;
  }
  return Number.isFinite(adjudicator.baseScore) ? adjudicator.baseScore : 5;
}

/** Fallback when a round has no usable feedback weight (the historical fixed 60% blend). */
export const LEGACY_FEEDBACK_WEIGHT = 0.6;

export function normalizeFeedbackWeight(weight: number | undefined): number {
  if (weight === undefined || !Number.isFinite(weight)) return LEGACY_FEEDBACK_WEIGHT;
  return Math.min(1, Math.max(0, weight));
}

/**
 * Tabbycat-style blend: (1 - w) * pre-feedback score + w * feedback average.
 * Without feedback the pre-feedback score is used unchanged.
 */
export function blendAdjudicatorScore(
  adjudicator: Pick<Adjudicator, "baseScore" | "testScore">,
  scaledFeedbackAverage: number | undefined,
  feedbackWeight?: number
): number {
  const base = preFeedbackScore(adjudicator);
  if (scaledFeedbackAverage === undefined) return base;
  const weight = normalizeFeedbackWeight(feedbackWeight);
  return base * (1 - weight) + scaledFeedbackAverage * weight;
}

export function adjudicatorRoleInDebate(
  debate: Pick<Debate, "adjudicators"> | undefined,
  adjudicatorId: string
): FeedbackTargetRole | undefined {
  const panel = debate?.adjudicators;
  if (!panel) return undefined;
  if (panel.chairId === adjudicatorId) return "chair";
  if (panel.panellistIds?.includes(adjudicatorId)) return "panellist";
  if (panel.traineeIds?.includes(adjudicatorId)) return "trainee";
  return undefined;
}

/** Source/target roles of a submission, or undefined when the debate no longer shows them. */
export function feedbackWeightKey(
  submission: FeedbackSubmission,
  debate: Pick<Debate, "adjudicators"> | undefined
): FeedbackWeightKey | undefined {
  if (!submission.targetAdjudicatorId) return undefined;
  const targetRole = adjudicatorRoleInDebate(debate, submission.targetAdjudicatorId);
  if (!targetRole) return undefined;
  const sourceRole: FeedbackSourceRole | undefined =
    submission.sourceType === "team" ? "team" : adjudicatorRoleInDebate(debate, submission.sourceId);
  return sourceRole ? `${sourceRole}_on_${targetRole}` : undefined;
}

export function feedbackSubmissionWeight(
  submission: FeedbackSubmission,
  debate: Pick<Debate, "adjudicators"> | undefined,
  weights: FeedbackScorePreferences["feedbackSourceWeights"]
): number {
  const key = feedbackWeightKey(submission, debate);
  const weight = key ? weights?.[key] : undefined;
  return weight !== undefined && Number.isFinite(weight) && weight >= 0 ? weight : 1;
}

export interface AdjudicatorFeedbackSummary {
  /** Counted submissions (confirmed and not ignored). */
  count: number;
  /** Weighted average on the feedback scale. */
  average: number;
  /** Weighted average mapped onto the adjudicator score range. */
  scaledAverage: number;
}

function summarize(
  submissions: FeedbackSubmission[],
  debatesById: Map<string, Pick<Debate, "adjudicators">>,
  preferences?: Partial<FeedbackScorePreferences>
): AdjudicatorFeedbackSummary | undefined {
  let weightedTotal = 0;
  let weightTotal = 0;
  let count = 0;
  for (const submission of submissions) {
    const weight = feedbackSubmissionWeight(
      submission,
      debatesById.get(submission.debateId),
      preferences?.feedbackSourceWeights
    );
    count += 1;
    weightedTotal += submission.score * weight;
    weightTotal += weight;
  }
  if (count === 0 || weightTotal === 0) return undefined;
  const average = weightedTotal / weightTotal;
  return {
    count,
    average,
    scaledAverage: scaleFeedbackScore(average, preferences?.feedbackMinScore, preferences?.feedbackMaxScore),
  };
}

/** Weighted feedback summary per adjudicator; ignored and unconfirmed submissions are left out. */
export function calculateFeedbackSummaries(
  submissions: FeedbackSubmission[],
  debates: Array<Pick<Debate, "id" | "adjudicators">>,
  preferences?: Partial<FeedbackScorePreferences>
): Map<string, AdjudicatorFeedbackSummary> {
  const debatesById = new Map(debates.map((debate) => [debate.id, debate]));
  const byAdjudicator = new Map<string, FeedbackSubmission[]>();
  for (const submission of submissions) {
    if (!isFeedbackCountedForScore(submission)) continue;
    const list = byAdjudicator.get(submission.targetAdjudicatorId!) ?? [];
    list.push(submission);
    byAdjudicator.set(submission.targetAdjudicatorId!, list);
  }
  const summaries = new Map<string, AdjudicatorFeedbackSummary>();
  for (const [adjudicatorId, list] of byAdjudicator) {
    const summary = summarize(list, debatesById, preferences);
    if (summary) summaries.set(adjudicatorId, summary);
  }
  return summaries;
}

/** Scaled weighted feedback averages, the input the allocator blends with base scores. */
export function calculateScaledFeedbackScores(
  submissions: FeedbackSubmission[],
  debates: Array<Pick<Debate, "id" | "adjudicators">>,
  preferences?: Partial<FeedbackScorePreferences>
): Map<string, number> {
  return new Map(
    [...calculateFeedbackSummaries(submissions, debates, preferences)].map(([id, summary]) => [
      id,
      summary.scaledAverage,
    ])
  );
}

export interface AdjudicatorRoundHistory {
  roundId: string;
  roundName: string;
  roundSeq: number;
  debateId?: string;
  role?: FeedbackTargetRole;
  /** All submissions about this adjudicator in the round, including ignored ones. */
  received: number;
  summary?: AdjudicatorFeedbackSummary;
  /** Score after this round's feedback, using this round's feedback weight. */
  cumulativeScore: number;
}

/**
 * Per-round role and feedback for one adjudicator, plus the running blended score
 * after each round (all counted feedback up to and including that round).
 */
export function adjudicatorScoreHistory(
  adjudicator: Adjudicator,
  rounds: Round[],
  debates: Debate[],
  submissions: FeedbackSubmission[],
  preferences?: Partial<FeedbackScorePreferences>
): AdjudicatorRoundHistory[] {
  const debatesById = new Map(debates.map((debate) => [debate.id, debate]));
  const about = submissions.filter(
    (submission) =>
      submission.targetAdjudicatorId === adjudicator.id &&
      (!submission.targetType || submission.targetType === "adjudicator")
  );
  const ordered = [...rounds].filter((round) => !round.cancelled).sort((a, b) => a.seq - b.seq);
  const counted: FeedbackSubmission[] = [];

  return ordered.map((round) => {
    const debate = debates.find(
      (item) => item.roundId === round.id && adjudicatorRoleInDebate(item, adjudicator.id) !== undefined
    );
    const inRound = about.filter((submission) => submission.roundId === round.id);
    const countedInRound = inRound.filter(isFeedbackCountedForScore);
    counted.push(...countedInRound);
    const runningSummary = summarize(counted, debatesById, preferences);
    return {
      roundId: round.id,
      roundName: round.name,
      roundSeq: round.seq,
      debateId: debate?.id,
      role: debate ? adjudicatorRoleInDebate(debate, adjudicator.id) : undefined,
      received: inRound.length,
      summary: summarize(countedInRound, debatesById, preferences),
      cumulativeScore: blendAdjudicatorScore(adjudicator, runningSummary?.scaledAverage, round.feedbackWeight),
    };
  });
}

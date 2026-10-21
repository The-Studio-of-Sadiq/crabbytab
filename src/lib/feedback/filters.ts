import type { FeedbackSubmission } from "@/types";

export interface FeedbackFilters {
  roundId?: string;
  targetAdjudicatorId?: string;
  sourceType?: "team" | "adjudicator";
  sourceId?: string;
  /** counted = confirmed and not ignored. */
  status?: "counted" | "unconfirmed" | "ignored";
  /** Tabbycat's "important feedback": the score differs from the target's base score by more than the threshold. */
  important?: boolean;
}

/** Context some filters need: adjudicator base scores and the importance threshold. */
export interface FeedbackFilterContext {
  baseScores?: ReadonlyMap<string, number>;
  importantThreshold?: number;
}

/** Whether a submission is "important": far from the rated adjudicator's base score. */
export function isImportantFeedback(
  submission: Pick<FeedbackSubmission, "score" | "targetAdjudicatorId" | "targetType">,
  baseScores: ReadonlyMap<string, number>,
  threshold = 2
): boolean {
  if (submission.targetType === "team" || !submission.targetAdjudicatorId) return false;
  const base = baseScores.get(submission.targetAdjudicatorId);
  return typeof base === "number" && Math.abs(submission.score - base) > threshold;
}

export function filterFeedbackSubmissions(
  submissions: FeedbackSubmission[],
  filters: FeedbackFilters,
  context: FeedbackFilterContext = {}
): FeedbackSubmission[] {
  return submissions.filter((submission) => {
    if (filters.important && !isImportantFeedback(submission, context.baseScores ?? new Map(), context.importantThreshold)) return false;
    if (filters.roundId && submission.roundId !== filters.roundId) return false;
    if (filters.targetAdjudicatorId && submission.targetAdjudicatorId !== filters.targetAdjudicatorId) return false;
    if (filters.sourceType && submission.sourceType !== filters.sourceType) return false;
    if (filters.sourceId && submission.sourceId !== filters.sourceId) return false;
    if (filters.status === "ignored" && !submission.ignored) return false;
    if (filters.status === "unconfirmed" && (submission.confirmed || submission.ignored)) return false;
    if (filters.status === "counted" && (!submission.confirmed || submission.ignored)) return false;
    return true;
  });
}

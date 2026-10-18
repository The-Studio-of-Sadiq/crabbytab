import type { FeedbackSubmission } from "@/types";

export interface FeedbackFilters {
  roundId?: string;
  targetAdjudicatorId?: string;
  sourceType?: "team" | "adjudicator";
  sourceId?: string;
  /** counted = confirmed and not ignored. */
  status?: "counted" | "unconfirmed" | "ignored";
}

export function filterFeedbackSubmissions(
  submissions: FeedbackSubmission[],
  filters: FeedbackFilters
): FeedbackSubmission[] {
  return submissions.filter((submission) => {
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

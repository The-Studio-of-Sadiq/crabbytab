import type { FeedbackSubmission, Round, TournamentPreferences } from "@/types";
import { feedbackPathsForRound } from "@/lib/feedback/paths";

/**
 * Feedback versions (Tabbycat AdjudicatorFeedback, a versioned Submission): feedback is unique per
 * target, source and debate, and saving a confirmed submission unconfirms every earlier confirmed
 * one with the same key, so a participant who submits again replaces their feedback instead of
 * counting twice. As Tabbycat, when teams owe one submission on the orallist ("orallist"), a team's
 * new submission replaces its earlier one on any adjudicator of that debate.
 */

type VersionedFeedback = Pick<
  FeedbackSubmission,
  "id" | "debateId" | "sourceType" | "sourceId" | "targetType" | "targetAdjudicatorId" | "targetTeamId" | "confirmed" | "timestamp"
>;

export interface FeedbackVersionOptions {
  /** Teams give one submission, on the orallist (Tabbycat feedback_from_teams "orallist"). */
  teamsOnOrallistOnly?: boolean;
}

/** The versioning options for feedback in `round`, from the tournament's feedback paths. */
export function feedbackVersionOptions(
  preferences: Partial<Pick<TournamentPreferences, "feedbackPath" | "feedbackPaths" | "eliminationFeedbackPaths">> | undefined,
  round: Pick<Round, "stage"> | undefined
): FeedbackVersionOptions {
  return { teamsOnOrallistOnly: feedbackPathsForRound(preferences, round).teams === "orallist" };
}

/** The key a feedback submission is versioned under. */
export function feedbackVersionKey(feedback: VersionedFeedback, options: FeedbackVersionOptions = {}): string {
  const target = feedback.sourceType === "team" && options.teamsOnOrallistOnly && (feedback.targetType ?? "adjudicator") === "adjudicator"
    ? "orallist"
    : (feedback.targetType ?? "adjudicator") === "team"
      ? `team:${feedback.targetTeamId ?? ""}`
      : `adjudicator:${feedback.targetAdjudicatorId ?? ""}`;
  return [feedback.debateId, feedback.sourceType, feedback.sourceId, target].join("|");
}

/**
 * Ids of the confirmed submissions in `existing` that confirmed `incoming` submissions replace:
 * those with the same key that are not themselves incoming. Within `incoming`, a later submission
 * (by order) replaces an earlier one with the same key as well.
 */
export function supersededFeedbackIds(
  incoming: readonly VersionedFeedback[],
  existing: readonly VersionedFeedback[],
  options: FeedbackVersionOptions = {}
): string[] {
  const incomingIds = new Set(incoming.map((feedback) => feedback.id));
  const confirmedIncomingIds = new Set(incoming.filter((feedback) => feedback.confirmed).map((feedback) => feedback.id));
  const lastIncomingByKey = new Map<string, string>();
  for (const feedback of incoming) {
    if (feedback.confirmed) lastIncomingByKey.set(feedbackVersionKey(feedback, options), feedback.id);
  }
  const superseded = new Set<string>();
  for (const feedback of existing) {
    if (!feedback.confirmed || incomingIds.has(feedback.id)) continue;
    if (lastIncomingByKey.has(feedbackVersionKey(feedback, options))) superseded.add(feedback.id);
  }
  for (const feedback of incoming) {
    if (!confirmedIncomingIds.has(feedback.id)) continue;
    if (lastIncomingByKey.get(feedbackVersionKey(feedback, options)) !== feedback.id) superseded.add(feedback.id);
  }
  return [...superseded];
}

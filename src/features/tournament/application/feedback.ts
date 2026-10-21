import type { AuditCategory, Debate, FeedbackQuestion, FeedbackSubmission } from "@/types";
import { validateFeedbackAnswers } from "@/lib/feedback/questions";
import { supersededFeedbackIds, type FeedbackVersionOptions } from "@/lib/feedback/versions";

export interface FeedbackAuditEvent {
  action: string;
  category: AuditCategory;
  summary: string;
  roundId?: string;
  debateId?: string;
  details?: Record<string, unknown>;
}

export async function addFeedbackCommand(
  data: Omit<FeedbackSubmission, "id" | "tournamentId" | "timestamp">,
  input: {
    tournamentId: string;
    feedback: FeedbackSubmission[];
    questions?: FeedbackQuestion[];
    privatePasscode?: string;
    privateUrlKey?: string;
    teams: Array<{ id: string; privateUrlKey?: string }>;
    adjudicators: Array<{ id: string; privateUrlKey?: string }>;
    repository: { saveFeedback(feedback: FeedbackSubmission[]): void };
    queuePrivateRecord(
      feedback: FeedbackSubmission,
      privateUrlKey?: string,
      passcode?: string
    ): Promise<void>;
    recordAuditEvent(event: FeedbackAuditEvent): Promise<void>;
    /** The new record's id; absent = `fb-<time>`. The audit event names the same id. */
    createId?(): string;
    /** How feedback is versioned in the record's round (teams on the orallist); see feedback/versions. */
    versionOptions?: FeedbackVersionOptions;
  }
): Promise<void> {
  const answerError = validateFeedbackAnswers(input.questions ?? [], data.answers ?? {});
  if (answerError) throw new Error(answerError);

  const feedback: FeedbackSubmission = {
    ...data,
    id: input.createId ? input.createId() : `fb-${Date.now()}`,
    tournamentId: input.tournamentId,
    timestamp: new Date().toISOString(),
  };
  // As Tabbycat, confirmed feedback replaces the source's earlier confirmed feedback on the same
  // target in the same debate (it is kept, unconfirmed), so nothing is counted twice.
  const superseded = new Set(supersededFeedbackIds([feedback], input.feedback, input.versionOptions));
  input.repository.saveFeedback([
    ...input.feedback.map((item) => (superseded.has(item.id) ? { ...item, confirmed: false } : item)),
    feedback,
  ]);
  if (input.privatePasscode) {
    const privateUrlKey = input.privateUrlKey || (
      feedback.sourceType === "adjudicator"
        ? input.adjudicators.find((item) => item.id === feedback.sourceId)?.privateUrlKey
        : input.teams.find((item) => item.id === feedback.sourceId)?.privateUrlKey
    );
    await input.queuePrivateRecord(feedback, privateUrlKey, input.privatePasscode);
  }
  await input.recordAuditEvent({
    action: "feedback.submitted",
    category: "feedback",
    summary: `Feedback submitted for ${feedback.targetAdjudicatorName || feedback.targetTeamName || "participant"}`,
    roundId: feedback.roundId,
    debateId: feedback.debateId,
    details: {
      feedbackId: feedback.id,
      targetType: feedback.targetType || "adjudicator",
      targetAdjudicatorId: feedback.targetAdjudicatorId,
      targetAdjudicatorName: feedback.targetAdjudicatorName,
      targetTeamId: feedback.targetTeamId,
      targetTeamName: feedback.targetTeamName,
      sourceType: feedback.sourceType,
      score: feedback.score,
      confirmed: feedback.confirmed,
      ...(superseded.size > 0 ? { supersededFeedbackIds: [...superseded] } : {}),
    },
  });
}
export interface FeedbackReviewChange {
  confirmed?: boolean;
  ignored?: boolean;
}

/** Confirms/unconfirms or ignores/restores one submission; ignored feedback stays on record. */
export async function reviewFeedbackCommand(
  feedbackId: string,
  change: FeedbackReviewChange,
  input: {
    feedback: FeedbackSubmission[];
    repository: { saveFeedback(feedback: FeedbackSubmission[]): void };
    recordAuditEvent(event: FeedbackAuditEvent): Promise<void>;
  }
): Promise<void> {
  const previous = input.feedback.find((item) => item.id === feedbackId);
  if (!previous) throw new Error("That feedback submission no longer exists.");
  const updated: FeedbackSubmission = { ...previous, ...change };
  if (updated.confirmed === previous.confirmed && Boolean(updated.ignored) === Boolean(previous.ignored)) return;

  input.repository.saveFeedback(input.feedback.map((item) => (item.id === feedbackId ? updated : item)));
  await input.recordAuditEvent({
    action: "feedback.reviewed",
    category: "feedback",
    summary: `Feedback on ${updated.targetAdjudicatorName || updated.targetTeamName || "participant"} ${
      updated.ignored ? "ignored" : updated.confirmed ? "confirmed" : "unconfirmed"
    }`,
    roundId: updated.roundId,
    debateId: updated.debateId,
    details: {
      feedbackId,
      previous: { confirmed: previous.confirmed, ignored: Boolean(previous.ignored) },
      current: { confirmed: updated.confirmed, ignored: Boolean(updated.ignored) },
    },
  });
}

/**
 * Removes one submission (Tabbycat's feedback DELETE). The record leaves the working copy; cloud
 * repositories keep it recoverable (the API soft-deletes it and archives the version).
 */
export async function deleteFeedbackCommand(
  feedbackId: string,
  input: {
    feedback: FeedbackSubmission[];
    repository: { saveFeedback(feedback: FeedbackSubmission[]): void };
    recordAuditEvent(event: FeedbackAuditEvent): Promise<void>;
  }
): Promise<void> {
  const previous = input.feedback.find((item) => item.id === feedbackId);
  if (!previous) throw new Error("That feedback submission no longer exists.");
  input.repository.saveFeedback(input.feedback.filter((item) => item.id !== feedbackId));
  await input.recordAuditEvent({
    action: "feedback.deleted",
    category: "feedback",
    summary: `Feedback on ${previous.targetAdjudicatorName || previous.targetTeamName || "participant"} from ${previous.sourceName || previous.sourceId} deleted`,
    roundId: previous.roundId,
    debateId: previous.debateId,
    details: { feedbackId, sourceType: previous.sourceType, sourceId: previous.sourceId, score: previous.score },
  });
}

/**
 * Checks that tab-room feedback names a real debate in the round, an adjudicator who sat
 * on it, and a source who took part in it. Returns an error message or null.
 */
export function adminFeedbackLinkError(
  data: Pick<FeedbackSubmission, "roundId" | "debateId" | "targetAdjudicatorId" | "sourceType" | "sourceId">,
  debates: Debate[]
): string | null {
  const debate = debates.find((item) => item.id === data.debateId);
  if (!debate || debate.roundId !== data.roundId) return "Choose a debate from the selected round.";
  const panel = [debate.adjudicators?.chairId, ...(debate.adjudicators?.panellistIds ?? []), ...(debate.adjudicators?.traineeIds ?? [])];
  if (!data.targetAdjudicatorId || !panel.includes(data.targetAdjudicatorId)) {
    return "The adjudicator did not sit on that debate.";
  }
  const sourceInDebate = data.sourceType === "team"
    ? Object.values(debate.teams ?? {}).some((slot) => slot?.teamId === data.sourceId)
    : panel.includes(data.sourceId);
  if (!sourceInDebate) return "The source did not take part in that debate.";
  if (data.sourceType === "adjudicator" && data.sourceId === data.targetAdjudicatorId) {
    return "An adjudicator cannot give feedback on themselves.";
  }
  return null;
}

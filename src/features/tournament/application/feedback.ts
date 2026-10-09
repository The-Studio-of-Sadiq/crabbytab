import type { AuditCategory, FeedbackSubmission } from "@/types";

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
  }
): Promise<void> {
  const feedback: FeedbackSubmission = {
    ...data,
    id: `fb-${Date.now()}`,
    tournamentId: input.tournamentId,
    timestamp: new Date().toISOString(),
  };
  input.repository.saveFeedback([...input.feedback, feedback]);
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
    },
  });
}
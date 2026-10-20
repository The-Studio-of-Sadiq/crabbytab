import type { DocumentReference, DocumentSnapshot, Firestore, QuerySnapshot } from "firebase-admin/firestore";
import type { Adjudicator, BallotSubmission, Debate, FeedbackSubmission, Round, Team, Tournament } from "@/types";
import { buildPrivateBallot } from "@/lib/privateBallot";
import { planPrivateBallotWrites, selectAssignedDebates, supersededBallotUpdate } from "@/lib/privateSync";
import { filterTeamVisibleDebates } from "@/lib/privatePortalBallots";
import { loadParticipantDebates, loadTeamsById } from "@/lib/privateParticipantData";
import { isRoundLockedForPortalBallots } from "@/features/tournament/application/stateGuards";
import { validateFeedbackScore } from "@/lib/scoring/validator";
import {
  canSubmitParticipantFeedback,
  isFeedbackAnswerRecord,
  isFeedbackEnabledForRound,
  questionsForFeedbackSource,
  validateFeedbackAnswers,
} from "@/lib/feedback/questions";
import { feedbackPathsForRound } from "@/lib/feedback/paths";
import { adjudicatorRoleInDebate } from "@/lib/feedback/scores";

/**
 * Validates and writes ballots and feedback submitted by one participant (an adjudicator or a team)
 * for debates they are assigned to. Shared by the private-portal sync (identity from the private
 * URL and passcode) and the public forms (identity chosen on the form, optionally behind the
 * tournament's public password), so both apply exactly the same rules.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validDocumentId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("/");
}

export interface ParticipantAssignments {
  roundById: Map<string, Round>;
  /** The participant's debates in rounds whose draw is published. */
  assignedDebates: Map<string, Debate>;
  /** Teams in those debates. */
  teams: Map<string, Team>;
}

/** Reads one participant's debates (through the debates' participant index), the rounds and their teams. */
export async function loadParticipantAssignments(
  tournamentRef: DocumentReference,
  actorType: "adjudicator" | "team",
  actorId: string
): Promise<ParticipantAssignments> {
  const [{ debates: participantDebates }, roundsSnapshot] = await Promise.all([
    loadParticipantDebates(tournamentRef, actorId),
    tournamentRef.collection("rounds").get(),
  ]);
  const roundById = new Map(
    roundsSnapshot.docs
      .filter((document) => typeof document.data().deletedAt !== "string")
      .map((document) => [document.id, { ...document.data(), id: document.id } as Round])
  );
  // The index only narrows the read; assignment is checked from the debates themselves.
  const actorDebates = selectAssignedDebates(participantDebates, actorType, actorId);
  // Participants never see (or submit for) debates from unpublished draws.
  const assignedDebates = new Map(
    filterTeamVisibleDebates(actorDebates.values(), roundById).map((debate) => [debate.id, debate])
  );
  const teams = await loadTeamsById(
    tournamentRef,
    [...assignedDebates.values()].flatMap((debate) =>
      Object.values(debate.teams || {}).flatMap((slot) => (slot?.teamId ? [slot.teamId] : []))
    )
  );
  return { roundById, assignedDebates, teams };
}

export type ParticipantSubmissionResult =
  | { ok: true; uploadedCount: number; writtenBallots: BallotSubmission[] }
  | { ok: false; status: number; error: string };

export interface ParticipantSubmissionInput {
  firestore: Firestore;
  tournamentRef: DocumentReference;
  tournament: Tournament;
  tournamentId: string;
  actorType: "adjudicator" | "team";
  actorDocument: Pick<DocumentSnapshot, "id">;
  actor: Record<string, unknown> & { name: string; trainee?: boolean };
  /** The participant's debates in rounds whose draw is public to them. */
  assignedDebates: Map<string, Debate>;
  teams: Map<string, Team>;
  roundById: Map<string, Round>;
  pending: unknown[];
}

export interface ParticipantSubmissionOptions {
  /** Public forms: ballots are left for the tab room to confirm. */
  adjustBallot?: (ballot: BallotSubmission) => BallotSubmission;
  /** Absent = confirmed (the private-portal behaviour). */
  feedbackConfirmed?: boolean;
}

export async function applyParticipantSubmissions(
  {
    firestore,
    tournamentRef,
    tournament,
    tournamentId,
    actorType,
    actorDocument,
    actor,
    assignedDebates,
    teams,
    roundById,
    pending,
  }: ParticipantSubmissionInput,
  options: ParticipantSubmissionOptions = {}
): Promise<ParticipantSubmissionResult> {
  const batch = firestore.batch();
  let uploadedCount = 0;
  const ballotSubmissions: BallotSubmission[] = [];
  for (const item of pending) {
    if (!isRecord(item) || !isRecord(item.record)) {
      return { ok: false, status: 400, error: "An offline submission is invalid." };
    }
    const collectionName = item.collection;
    const record = item.record;
    const debateId = record.debateId;
    if (
      (collectionName !== "ballots" && collectionName !== "feedback") ||
      !validDocumentId(record.id) ||
      typeof debateId !== "string" ||
      !assignedDebates.has(debateId)
    ) {
      return { ok: false, status: 403, error: "An offline submission is not valid for this adjudicator." };
    }

    if (collectionName === "ballots") {
      if (actorType !== "adjudicator") {
        return { ok: false, status: 403, error: "Teams cannot submit ballots." };
      }
      const debate = assignedDebates.get(debateId)!;
      const canVote =
        !actor.trainee &&
        (debate.adjudicators?.chairId === actorDocument.id ||
          debate.adjudicators?.panellistIds?.includes(actorDocument.id));
      if (!canVote) {
        return { ok: false, status: 403, error: "Only the chair or a voting panellist may submit a ballot." };
      }
      let ballot: BallotSubmission;
      try {
        ballot = buildPrivateBallot(record, {
          tournament,
          adjudicator: { ...actor, id: actorDocument.id } as Adjudicator,
          debate,
          teams,
          tournamentId,
        });
      } catch (error) {
        return { ok: false, status: 400, error: error instanceof Error ? error.message : "The ballot is invalid." };
      }
      ballotSubmissions.push(options.adjustBallot ? options.adjustBallot(ballot) : ballot);
    } else {
      const debate = assignedDebates.get(debateId)!;
      const panel = debate.adjudicators;
      const targetType = record.targetType === undefined
        ? "adjudicator"
        : record.targetType === "adjudicator" || record.targetType === "team"
          ? record.targetType
          : undefined;
      if (!targetType) {
        return { ok: false, status: 400, error: "Feedback target type is invalid." };
      }
      const targetAdjudicatorId = typeof record.targetAdjudicatorId === "string"
        ? record.targetAdjudicatorId
        : undefined;
      const targetTeamId = typeof record.targetTeamId === "string"
        ? record.targetTeamId
        : undefined;
      const score = record.score;
      const answers = record.answers === undefined ? {} : record.answers;
      const targetAdjudicatorIsAssigned =
        typeof targetAdjudicatorId === "string" &&
        (panel.chairId === targetAdjudicatorId ||
          panel.panellistIds?.includes(targetAdjudicatorId) ||
          panel.traineeIds?.includes(targetAdjudicatorId));
      const targetTeamSlot = typeof targetTeamId === "string"
        ? Object.values(debate.teams || {}).find((slot) => slot?.teamId === targetTeamId)
        : undefined;
      const sourceIsAuthorized =
        record.sourceType === actorType &&
        record.sourceId === actorDocument.id &&
        (actorType === "adjudicator" || Object.values(debate.teams || {}).some((slot) => slot?.teamId === actorDocument.id));
      const panelVisibleToActor =
        actorType === "adjudicator" || roundById.get(debate.roundId)?.adjudicatorsRevealed === true;
      const targetIsAuthorized = targetType === "adjudicator"
        ? targetAdjudicatorIsAssigned && panelVisibleToActor && targetAdjudicatorId !== actorDocument.id
        : targetType === "team" && Boolean(targetTeamSlot) &&
          (actorType !== "team" || targetTeamId !== actorDocument.id);
      const targetId = targetType === "adjudicator" ? targetAdjudicatorId : targetTeamId;
      const targetIsChair = Boolean(targetAdjudicatorId && panel.chairId === targetAdjudicatorId);
      const round = roundById.get(debate.roundId);
      const sourceRole = actorType === "adjudicator" ? adjudicatorRoleInDebate(debate, actorDocument.id) : "team";
      const targetRole = targetAdjudicatorId ? adjudicatorRoleInDebate(debate, targetAdjudicatorId) : undefined;
      const feedbackAllowed = Boolean(sourceRole) && canSubmitParticipantFeedback({
        sourceType: actorType,
        sourceId: actorDocument.id,
        sourceIsChair: sourceRole === "chair",
        sourceRole,
        targetType,
        targetId: targetId || "",
        targetIsChair,
        targetRole,
        path: feedbackPathsForRound(tournament.preferences, round),
      });
      if (
        !sourceIsAuthorized ||
        !targetIsAuthorized ||
        !feedbackAllowed ||
        tournament.preferences?.feedbackEnabled === false ||
        !isFeedbackEnabledForRound(
          debate,
          round,
          tournament.preferences?.feedbackInEliminationRounds !== false
        )
      ) {
        return { ok: false, status: 403, error: "Feedback does not match this participant or debate." };
      }
      if (
        typeof score !== "number" ||
        !validateFeedbackScore(score, tournament.preferences).valid ||
        (record.comments !== undefined &&
          (typeof record.comments !== "string" || record.comments.length > 5000)) ||
        (record.agreeWithDecision !== undefined && typeof record.agreeWithDecision !== "boolean") ||
        !isFeedbackAnswerRecord(answers) ||
        Boolean(validateFeedbackAnswers(
          questionsForFeedbackSource(actorType, tournament.preferences),
          answers
        ))
      ) {
        return { ok: false, status: 400, error: "Feedback contains invalid details." };
      }
      const feedback: FeedbackSubmission = {
        id: record.id,
        tournamentId,
        roundId: debate.roundId,
        debateId: debate.id,
        targetType,
        ...(targetType === "adjudicator" ? {
          targetAdjudicatorId: targetAdjudicatorId!,
          targetAdjudicatorName:
            panel.chairId === targetAdjudicatorId
              ? panel.chairName || ""
              : panel.panellistIds?.includes(targetAdjudicatorId as string)
                ? panel.panellistNames?.[panel.panellistIds.indexOf(targetAdjudicatorId as string)] || ""
                : panel.traineeNames?.[panel.traineeIds?.indexOf(targetAdjudicatorId as string) ?? -1] || "",
        } : {
          targetTeamId: targetTeamId!,
          targetTeamName: teams.get(targetTeamId as string)?.name || targetTeamSlot?.teamName || "",
        }),
        sourceType: actorType,
        sourceId: actorDocument.id,
        sourceName: actor.name,
        score,
        ...(typeof record.agreeWithDecision === "boolean"
          ? { agreeWithDecision: record.agreeWithDecision }
          : {}),
        ...(typeof record.comments === "string" ? { comments: record.comments } : {}),
        ...(Object.keys(answers).length > 0 ? { answers } : {}),
        confirmed: options.feedbackConfirmed ?? true,
        timestamp: new Date().toISOString(),
      };
      const feedbackRef = tournamentRef.collection("feedback").doc(feedback.id);
      const existingFeedback = await feedbackRef.get();
      if (
        existingFeedback.exists &&
        existingFeedback.data()?.sourceId !== actorDocument.id
      ) {
        return { ok: false, status: 403, error: "The feedback identifier is already in use." };
      }
      batch.set(feedbackRef, feedback);
    }
    uploadedCount += 1;
  }

  let writtenBallots: BallotSubmission[] = [];
  if (ballotSubmissions.length > 0) {
    const ballotCollection = tournamentRef.collection("ballots");
    const committed = await firestore.runTransaction(async (transaction) => {
      const debateIds = [...new Set(ballotSubmissions.map((ballot) => ballot.debateId))];
      const existingBallotsByDebate = new Map<string, QuerySnapshot>();
      for (const debateId of debateIds) {
        const snapshot = await transaction.get(
          ballotCollection.where("debateId", "==", debateId)
        );
        existingBallotsByDebate.set(debateId, snapshot);
      }
      const existingSubmissions = await Promise.all(
        ballotSubmissions.map((ballot) => transaction.get(ballotCollection.doc(ballot.id)))
      );
      if (existingSubmissions.some(
        (snapshot) => snapshot.exists && snapshot.data()?.submitterId !== actorDocument.id
      )) {
        return false;
      }

      const plan = planPrivateBallotWrites(
        ballotSubmissions,
        new Map(debateIds.map((debateId) => [
          debateId,
          existingBallotsByDebate.get(debateId)!.docs.map((document) => ({
            id: document.id,
            data: document.data() as Partial<BallotSubmission>,
          })),
        ])),
        // Completed, published or advanced rounds keep their result: a late chair's ballot waits for the tab room.
        new Set(debateIds.filter((debateId) =>
          isRoundLockedForPortalBallots(roundById.get(assignedDebates.get(debateId)?.roundId ?? ""))
        ))
      );
      const existingById = new Map(
        [...existingBallotsByDebate.values()].flatMap((snapshot) =>
          snapshot.docs.map((document) => [document.id, document.data() as Partial<BallotSubmission>] as const)
        )
      );
      for (const id of plan.discardExistingIds) {
        transaction.update(ballotCollection.doc(id), supersededBallotUpdate(existingById.get(id) ?? {}));
      }
      for (const ballot of plan.writes) {
        transaction.set(ballotCollection.doc(ballot.id), ballot);
      }
      writtenBallots = plan.writes;
      return true;
    });
    if (!committed) {
      return { ok: false, status: 403, error: "This ballot identifier belongs to another adjudicator." };
    }
  }

  if (uploadedCount > 0) await batch.commit();
  return { ok: true, uploadedCount, writtenBallots };
}

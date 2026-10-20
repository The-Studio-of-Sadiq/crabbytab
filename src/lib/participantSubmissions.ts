import type { BallotSubmission, Debate, FeedbackSubmission, Round, Team, Tournament } from "@/types";
import { isRoundLockedForPortalBallots } from "@/features/tournament/application/stateGuards";
import {
  canSubmitParticipantFeedback,
  isFeedbackAnswerRecord,
  isFeedbackEnabledForRound,
  questionsForFeedbackSource,
  validateFeedbackAnswers,
} from "@/lib/feedback/questions";
import { feedbackPathsForRound } from "@/lib/feedback/paths";
import { adjudicatorRoleInDebate } from "@/lib/feedback/scores";
import { planIndividualBallotWrites } from "@/lib/privateIndividualBallots";
import { isDrawVisibleToAdjudicators } from "@/lib/privatePortalBallots";
import { planPrivateBallotWrites, type ExistingBallotRecord, type PrivateBallotWritePlan } from "@/lib/privateSync";
import { validateFeedbackScore } from "@/lib/scoring/validator";

/**
 * What a participant (private URL key + passcode) may submit, shared by the private portal's sync
 * route (src/app/api/private/sync/route.ts) and the v1 API, so both apply exactly the same rules.
 */

export type ParticipantType = "adjudicator" | "team";

export interface ParticipantIdentity {
  type: ParticipantType;
  id: string;
  name: string;
}

export type FeedbackCheck =
  | { ok: true; feedback: FeedbackSubmission }
  | { ok: false; status: 400 | 403; error: string };

/**
 * Validates one feedback record a participant submits for a debate they took part in (a debate
 * they can see): who they may rate under the tournament's feedback paths, whether feedback is on
 * for the round, the score range and the answers to their questions. Returns the record to store.
 */
export function checkParticipantFeedback(
  record: Record<string, unknown>,
  input: {
    tournament: Tournament;
    tournamentId: string;
    participant: ParticipantIdentity;
    debate: Debate;
    round: Round | undefined;
    teams: ReadonlyMap<string, Team>;
    id: string;
    timestamp: string;
  }
): FeedbackCheck {
  const { tournament, participant, debate, round, teams } = input;
  const actorType = participant.type;
  const panel = debate.adjudicators;
  const targetType = record.targetType === undefined
    ? "adjudicator"
    : record.targetType === "adjudicator" || record.targetType === "team"
      ? record.targetType
      : undefined;
  if (!targetType) return { ok: false, status: 400, error: "Feedback target type is invalid." };
  const targetAdjudicatorId = typeof record.targetAdjudicatorId === "string" ? record.targetAdjudicatorId : undefined;
  const targetTeamId = typeof record.targetTeamId === "string" ? record.targetTeamId : undefined;
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
    record.sourceId === participant.id &&
    (actorType === "adjudicator" || Object.values(debate.teams || {}).some((slot) => slot?.teamId === participant.id));
  const panelVisibleToActor =
    actorType === "adjudicator" || (round?.adjudicatorsRevealed === true && isDrawVisibleToAdjudicators(round));
  const targetIsAuthorized = targetType === "adjudicator"
    ? targetAdjudicatorIsAssigned && panelVisibleToActor && targetAdjudicatorId !== participant.id
    : targetType === "team" && Boolean(targetTeamSlot) && (actorType !== "team" || targetTeamId !== participant.id);
  const targetId = targetType === "adjudicator" ? targetAdjudicatorId : targetTeamId;
  const targetIsChair = Boolean(targetAdjudicatorId && panel.chairId === targetAdjudicatorId);
  const sourceRole = actorType === "adjudicator" ? adjudicatorRoleInDebate(debate, participant.id) : "team";
  const targetRole = targetAdjudicatorId ? adjudicatorRoleInDebate(debate, targetAdjudicatorId) : undefined;
  const feedbackAllowed = Boolean(sourceRole) && canSubmitParticipantFeedback({
    sourceType: actorType,
    sourceId: participant.id,
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
    !isFeedbackEnabledForRound(debate, round, tournament.preferences?.feedbackInEliminationRounds !== false)
  ) {
    return { ok: false, status: 403, error: "Feedback does not match this participant or debate." };
  }
  if (
    typeof score !== "number" ||
    !validateFeedbackScore(score, tournament.preferences).valid ||
    (record.comments !== undefined && (typeof record.comments !== "string" || record.comments.length > 5000)) ||
    (record.agreeWithDecision !== undefined && typeof record.agreeWithDecision !== "boolean") ||
    !isFeedbackAnswerRecord(answers) ||
    Boolean(validateFeedbackAnswers(questionsForFeedbackSource(actorType, tournament.preferences), answers))
  ) {
    return { ok: false, status: 400, error: "Feedback contains invalid details." };
  }
  const feedback: FeedbackSubmission = {
    id: input.id,
    tournamentId: input.tournamentId,
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
    sourceId: participant.id,
    sourceName: participant.name,
    score,
    ...(typeof record.agreeWithDecision === "boolean" ? { agreeWithDecision: record.agreeWithDecision } : {}),
    ...(typeof record.comments === "string" ? { comments: record.comments } : {}),
    ...(Object.keys(answers).length > 0 ? { answers } : {}),
    confirmed: true,
    timestamp: input.timestamp,
  };
  return { ok: true, feedback };
}

/**
 * How private-URL ballots are stored next to a debate's existing ballots: consensus ballots
 * supersede earlier versions (unless the tab room confirmed the result or the round is locked),
 * individual sheets wait for the panel and merge (lib/privateIndividualBallots.ts).
 */
export function planParticipantBallotWrites(input: {
  submissions: readonly BallotSubmission[];
  existingByDebate: ReadonlyMap<string, readonly ExistingBallotRecord[]>;
  debates: ReadonlyMap<string, Debate>;
  roundById: ReadonlyMap<string, Round>;
  tournament: Tournament;
  timestamp: string;
}): PrivateBallotWritePlan {
  const { submissions, existingByDebate, debates, roundById, tournament } = input;
  const debateIds = [...new Set(submissions.map((ballot) => ballot.debateId))];
  // Completed, published or advanced rounds keep their result: a late chair's ballot waits for the tab room.
  const lockedDebateIds = new Set(debateIds.filter((debateId) =>
    isRoundLockedForPortalBallots(roundById.get(debates.get(debateId)?.roundId ?? ""))
  ));
  const individual = submissions.filter((ballot) => ballot.singleAdjudicator === true);
  const consensus = submissions.filter((ballot) => ballot.singleAdjudicator !== true);
  const consensusPlan = planPrivateBallotWrites(consensus, existingByDebate, lockedDebateIds);
  const individualPlan = planIndividualBallotWrites({
    submissions: individual,
    existingByDebate,
    lockedDebateIds,
    debates,
    rulesFor: (debate) => ({
      format: tournament.format,
      preferences: tournament.preferences,
      stage: roundById.get(debate.roundId)?.stage,
    }),
    autoConfirm: tournament.preferences?.privateBallotConfirmation !== "tab_room",
    timestamp: input.timestamp,
  });
  return {
    discardExistingIds: [...new Set([...consensusPlan.discardExistingIds, ...individualPlan.discardExistingIds])],
    writes: [...consensusPlan.writes, ...individualPlan.writes],
  };
}

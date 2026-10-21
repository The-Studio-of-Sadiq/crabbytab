import type {
  Adjudicator,
  Debate,
  FeedbackAnswer,
  FeedbackSubmission,
  Motion,
  Round,
  Team,
  TournamentPreferences,
} from "@/types";
import { currentDrawRoundId } from "@/lib/publicFeatures";
import { motionsVisible } from "@/features/tournament/application/motionRelease";
import { isDrawVisibleToAdjudicators } from "@/lib/privatePortalBallots";
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
import type { PublicNamer } from "@/lib/publicView/names";

/**
 * Public (non-private-URL) participant forms: Tabbycat's `participant_ballots = public` and
 * `participant_feedback = public` (results/views.py PublicBallotSubmissionIndexView /
 * BasePublicNewBallotSetView, adjfeedback/views.py PublicAddFeedbackIndexView /
 * PublicAddFeedbackByIdUrlView). Participants pick themselves from a public list instead of opening
 * a private link; when `publicFormsUsePassword` is on they also type the tournament password, whose
 * hash lives server-side (src/lib/publicFormsPassword.ts). Everything here is pure so the server
 * route and the publish-time directory share it; docs/public-pages-and-notifications.md.
 */

export type PublicFormKind = "ballot" | "feedback";
export type PublicFormSourceType = "adjudicator" | "team";

type FormPreferences = Partial<Pick<
  TournamentPreferences,
  "publicBallotForm" | "publicFeedbackForm" | "publicFormsUsePassword" | "feedbackEnabled" | "currentRoundId"
>> | null | undefined;

/** Whether the public form of this kind is switched on (absent = off, Tabbycat's default). */
export function isPublicFormEnabled(preferences: FormPreferences, kind: PublicFormKind): boolean {
  if (kind === "ballot") return preferences?.publicBallotForm === true;
  return preferences?.publicFeedbackForm === true && preferences?.feedbackEnabled !== false;
}

/** Whether submissions need the tournament password (only meaningful with a public form on). */
export function publicFormsRequirePassword(preferences: FormPreferences): boolean {
  return preferences?.publicFormsUsePassword === true;
}

/** An error the route reports to the participant as written, with an HTTP status. */
export class PublicFormError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
    this.name = "PublicFormError";
  }
}

// ---------------------------------------------------------------------------------------------
// Ballots
// ---------------------------------------------------------------------------------------------

/**
 * The round public ballots are taken for: the current round (the tab room's explicit current round,
 * else the newest non-cancelled round whose draw is released, as on the public draw page). Tabbycat
 * takes public ballots for its current round only; the draw must also be released (checked by
 * selectPublicBallotDebate).
 */
export function publicBallotRound<R extends Pick<Round, "id" | "seq" | "cancelled" | "drawStatus">>(
  rounds: readonly R[],
  currentRoundId?: string | null
): R | undefined {
  const id = currentDrawRoundId([...rounds], currentRoundId);
  return id ? rounds.find((round) => round.id === id) : undefined;
}

/** Whether adjudicators may see the round's draw (a plain boolean, unlike the type guard it wraps). */
function isDrawReleasedForBallots(round: Round): boolean {
  return isDrawVisibleToAdjudicators(round);
}

/** Tabbycat refuses ballots until the motions are out when the round has motions. */
export function publicBallotMotionsPending(
  round: Pick<Round, "id" | "motionsStatus" | "motionsReleased">,
  roundHasMotions: boolean
): boolean {
  return roundHasMotions && !motionsVisible(round);
}

/** Whether any motion is assigned to the round. */
export function roundHasMotions(round: Pick<Round, "id">, motions: ReadonlyArray<Pick<Motion, "rounds">>): boolean {
  return motions.some((motion) => Array.isArray(motion.rounds) && motion.rounds.includes(round.id));
}

/** Voting members of a panel (chair and panellists), the people who may submit a ballot. */
export function votingAdjudicatorIds(debate: Pick<Debate, "adjudicators">): string[] {
  const panel = debate.adjudicators;
  if (!panel) return [];
  return [panel.chairId, ...(panel.panellistIds || [])].filter((id): id is string => Boolean(id));
}

/**
 * The debate an adjudicator submits a public ballot for, with Tabbycat's refusals: no open round,
 * motions not released, no debate this round, more than one debate, no chair. Trainees cannot
 * submit (as on private URLs).
 */
export function selectPublicBallotDebate(input: {
  round: Pick<Round, "id" | "motionsStatus" | "motionsReleased" | "cancelled" | "drawStatus"> | undefined;
  roundHasMotions: boolean;
  adjudicator: Pick<Adjudicator, "id"> & { trainee?: boolean };
  /** Debates that may involve the adjudicator (filtered here by round and panel). */
  debates: Iterable<Debate>;
}): Debate {
  const { round, adjudicator } = input;
  if (!round) throw new PublicFormError("No round is open for ballots right now.", 409);
  if (!isDrawVisibleToAdjudicators(round as Round)) {
    throw new PublicFormError("The draw for this round hasn't been released yet.", 409);
  }
  if (publicBallotMotionsPending(round, input.roundHasMotions)) {
    throw new PublicFormError("The motions for this round haven't been released yet.", 409);
  }
  const mine = [...input.debates].filter(
    (debate) => debate.roundId === round.id && adjudicatorRoleInDebate(debate, adjudicator.id) !== undefined
  );
  if (mine.length === 0) throw new PublicFormError("It looks like you don't have a debate this round.", 404);
  if (mine.length > 1) {
    throw new PublicFormError(
      "It looks like you're assigned to two or more debates this round. Please contact a tab room official.",
      409
    );
  }
  const debate = mine[0];
  if (!debate.adjudicators?.chairId) {
    throw new PublicFormError(
      "Your debate doesn't have a chair, so you can't enter results for it. Please contact a tab room official.",
      409
    );
  }
  if (adjudicator.trainee === true || !votingAdjudicatorIds(debate).includes(adjudicator.id)) {
    throw new PublicFormError("Only the chair or a voting panellist may submit a ballot.", 403);
  }
  return debate;
}

// ---------------------------------------------------------------------------------------------
// Publish-time directory (who appears in the public pickers)
// ---------------------------------------------------------------------------------------------

export interface PublicFormsPerson {
  id: string;
  /** Public name ("" for anonymous participants; the page shows a placeholder). */
  name: string;
}

export interface PublicBallotDirectory {
  /** The open round, or null when no round takes ballots. */
  roundId: string | null;
  roundName?: string;
  /** Why the round takes no ballots yet. */
  closedReason?: "no_round" | "draw_not_released" | "motions_not_released";
  adjudicators: Array<PublicFormsPerson & { venueName?: string }>;
}

export interface PublicFormsDirectory {
  usePassword: boolean;
  ballot?: PublicBallotDirectory;
  feedback?: { teams: PublicFormsPerson[]; adjudicators: PublicFormsPerson[] };
}

function byName(left: PublicFormsPerson, right: PublicFormsPerson): number {
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

/**
 * The public pickers, built at publish time from the raw records (so they cost the public pages no
 * extra Firestore reads). Ballots: the voting adjudicators of the open round, with their room only
 * once the round's panels are public. Feedback: every team and adjudicator, as in Tabbycat.
 * Absent when neither form is on.
 */
export function buildPublicFormsDirectory(input: {
  preferences: FormPreferences;
  rounds: Round[];
  debates: Debate[];
  teams: Array<Pick<Team, "id" | "name">>;
  adjudicators: Array<Pick<Adjudicator, "id" | "name">>;
  motions: Array<Pick<Motion, "rounds">>;
  namer: PublicNamer;
  revealedRoundIds: ReadonlySet<string>;
}): PublicFormsDirectory | undefined {
  const ballotOn = isPublicFormEnabled(input.preferences, "ballot");
  const feedbackOn = isPublicFormEnabled(input.preferences, "feedback");
  if (!ballotOn && !feedbackOn) return undefined;
  const directory: PublicFormsDirectory = { usePassword: publicFormsRequirePassword(input.preferences) };

  if (ballotOn) {
    const round = publicBallotRound(
      input.rounds.filter((candidate) => typeof (candidate as { deletedAt?: unknown }).deletedAt !== "string"),
      input.preferences?.currentRoundId
    );
    if (!round) {
      directory.ballot = { roundId: null, closedReason: "no_round", adjudicators: [] };
    } else if (!isDrawReleasedForBallots(round)) {
      directory.ballot = { roundId: round.id, roundName: round.name, closedReason: "draw_not_released", adjudicators: [] };
    } else if (publicBallotMotionsPending(round, roundHasMotions(round, input.motions))) {
      directory.ballot = { roundId: round.id, roundName: round.name, closedReason: "motions_not_released", adjudicators: [] };
    } else {
      const showVenue = input.revealedRoundIds.has(round.id);
      const seen = new Set<string>();
      const adjudicators: PublicBallotDirectory["adjudicators"] = [];
      for (const debate of input.debates) {
        if (debate.roundId !== round.id || !debate.adjudicators?.chairId) continue;
        for (const id of votingAdjudicatorIds(debate)) {
          if (seen.has(id)) continue;
          seen.add(id);
          adjudicators.push({
            id,
            name: input.namer.adjudicator(id),
            ...(showVenue && debate.venueName ? { venueName: debate.venueName } : {}),
          });
        }
      }
      directory.ballot = { roundId: round.id, roundName: round.name, adjudicators: adjudicators.sort(byName) };
    }
  }

  if (feedbackOn) {
    directory.feedback = {
      teams: input.teams.map((team) => ({ id: team.id, name: input.namer.team(team.id, team.name) })).sort(byName),
      adjudicators: input.adjudicators.map((adjudicator) => ({ id: adjudicator.id, name: input.namer.adjudicator(adjudicator.id) })).sort(byName),
    };
  }
  return directory;
}

// ---------------------------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------------------------

export interface PublicFeedbackOption {
  debateId: string;
  roundId: string;
  roundName: string;
  roundSeq: number;
  targetType: "adjudicator" | "team";
  targetId: string;
  targetName: string;
  /** The target's role on the panel (adjudicator targets). */
  targetRole?: "chair" | "panellist" | "trainee";
}

interface FeedbackContext {
  preferences: Partial<TournamentPreferences> | undefined;
  sourceType: PublicFormSourceType;
  sourceId: string;
  /** Debates that may involve the source (filtered here). */
  debates: Iterable<Debate>;
  roundsById: ReadonlyMap<string, Round>;
  /** Team names for team targets (falls back to the name on the draw). */
  teamName: (teamId: string, drawnName: string | undefined) => string;
}

function panelName(debate: Debate, adjudicatorId: string): string {
  const panel = debate.adjudicators;
  if (!panel) return "";
  if (panel.chairId === adjudicatorId) return panel.chairName || "";
  const panellist = panel.panellistIds?.indexOf(adjudicatorId) ?? -1;
  if (panellist >= 0) return panel.panellistNames?.[panellist] || "";
  const trainee = panel.traineeIds?.indexOf(adjudicatorId) ?? -1;
  return trainee >= 0 ? panel.traineeNames?.[trainee] || "" : "";
}

/** Whether the source took part in the debate (a team on the draw, or an adjudicator on the panel). */
function sourceRoleIn(debate: Debate, sourceType: PublicFormSourceType, sourceId: string) {
  if (sourceType === "team") {
    return Object.values(debate.teams || {}).some((slot) => slot?.teamId === sourceId) ? "team" as const : undefined;
  }
  return adjudicatorRoleInDebate(debate, sourceId);
}

/**
 * Who the source may give feedback on: the same checks as private-URL feedback (feedback paths,
 * per-round and elimination switches, panels hidden from teams until revealed), over debates in
 * rounds whose draw is published (Tabbycat: released draws only).
 */
export function publicFeedbackOptions(context: FeedbackContext): PublicFeedbackOption[] {
  const { preferences, sourceType, sourceId } = context;
  if (preferences?.feedbackEnabled === false) return [];
  const inElims = preferences?.feedbackInEliminationRounds !== false;
  const options: PublicFeedbackOption[] = [];
  for (const debate of context.debates) {
    const round = context.roundsById.get(debate.roundId);
    // Public forms need the full release; a teams-only release is for private portals only.
    if (!isDrawVisibleToAdjudicators(round)) continue;
    const sourceRole = sourceRoleIn(debate, sourceType, sourceId);
    if (!sourceRole || !isFeedbackEnabledForRound(debate, round, inElims)) continue;
    const path = feedbackPathsForRound(preferences, round);
    const panel = debate.adjudicators;
    const panelVisible = sourceType === "adjudicator" || round.adjudicatorsRevealed === true;
    const base = { debateId: debate.id, roundId: round.id, roundName: round.name, roundSeq: round.seq };
    if (panel && panelVisible) {
      const ids = [panel.chairId, ...(panel.panellistIds || []), ...(panel.traineeIds || [])].filter(
        (id): id is string => Boolean(id)
      );
      for (const targetId of [...new Set(ids)]) {
        const targetRole = adjudicatorRoleInDebate(debate, targetId);
        if (targetId === sourceId) continue;
        if (!canSubmitParticipantFeedback({
          sourceType,
          sourceId,
          sourceIsChair: sourceRole === "chair",
          sourceRole,
          targetType: "adjudicator",
          targetId,
          targetIsChair: panel.chairId === targetId,
          targetRole,
          path,
        })) continue;
        options.push({ ...base, targetType: "adjudicator", targetId, targetName: panelName(debate, targetId), ...(targetRole ? { targetRole } : {}) });
      }
    }
    for (const slot of Object.values(debate.teams || {})) {
      const targetId = slot?.teamId;
      if (!targetId || (sourceType === "team" && targetId === sourceId)) continue;
      if (!canSubmitParticipantFeedback({
        sourceType,
        sourceId,
        sourceIsChair: sourceRole === "chair",
        sourceRole,
        targetType: "team",
        targetId,
        targetIsChair: false,
        path,
      })) continue;
      options.push({ ...base, targetType: "team", targetId, targetName: context.teamName(targetId, slot?.teamName) });
    }
  }
  return options.sort(
    (left, right) =>
      right.roundSeq - left.roundSeq ||
      left.targetType.localeCompare(right.targetType) ||
      left.targetName.localeCompare(right.targetName) ||
      left.targetId.localeCompare(right.targetId)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validates a public feedback submission and builds the record to store, with the same checks and
 * the same stored shape as private-URL feedback (src/app/api/private/sync/route.ts). The id and
 * timestamp come from the server; the target must be one of `publicFeedbackOptions`.
 */
export function buildPublicFeedback(
  input: unknown,
  context: FeedbackContext & { tournamentId: string; sourceName: string; id: string; timestamp: string }
): FeedbackSubmission {
  if (!isRecord(input)) throw new PublicFormError("Feedback contains invalid details.");
  const targetType = input.targetType === undefined
    ? "adjudicator"
    : input.targetType === "adjudicator" || input.targetType === "team" ? input.targetType : undefined;
  if (!targetType) throw new PublicFormError("Feedback target type is invalid.");
  const debates = [...context.debates];
  const option = publicFeedbackOptions({ ...context, debates }).find(
    (candidate) =>
      candidate.debateId === input.debateId &&
      candidate.targetType === targetType &&
      candidate.targetId === input.targetId
  );
  if (!option) throw new PublicFormError("Feedback does not match this participant or debate.", 403);

  const score = input.score;
  const answers = input.answers === undefined ? {} : input.answers;
  if (
    typeof score !== "number" ||
    !validateFeedbackScore(score, context.preferences).valid ||
    (input.comments !== undefined && (typeof input.comments !== "string" || input.comments.length > 5000)) ||
    (input.agreeWithDecision !== undefined && typeof input.agreeWithDecision !== "boolean") ||
    !isFeedbackAnswerRecord(answers) ||
    Boolean(validateFeedbackAnswers(questionsForFeedbackSource(context.sourceType, context.preferences), answers))
  ) {
    throw new PublicFormError("Feedback contains invalid details.");
  }
  const typedAnswers = answers as Record<string, FeedbackAnswer>;
  return {
    id: context.id,
    tournamentId: context.tournamentId,
    roundId: option.roundId,
    debateId: option.debateId,
    targetType,
    ...(targetType === "adjudicator"
      ? { targetAdjudicatorId: option.targetId, targetAdjudicatorName: option.targetName }
      : { targetTeamId: option.targetId, targetTeamName: option.targetName }),
    sourceType: context.sourceType,
    sourceId: context.sourceId,
    sourceName: context.sourceName,
    score,
    ...(typeof input.agreeWithDecision === "boolean" ? { agreeWithDecision: input.agreeWithDecision } : {}),
    ...(typeof input.comments === "string" ? { comments: input.comments } : {}),
    ...(Object.keys(typedAnswers).length > 0 ? { answers: typedAnswers } : {}),
    // Tabbycat confirms public feedback on submission, as CrabbyTab does for private URLs; the tab
    // room can unconfirm or ignore it on the feedback page.
    confirmed: true,
    timestamp: context.timestamp,
  };
}

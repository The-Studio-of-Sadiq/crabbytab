import type { BallotSubmission, Debate, DebateResultStatus, TournamentPreferences } from "@/types";
import { validateFeedbackScore, validateReplyScore, validateSpeakerScore } from "@/lib/scoring/validator";
import { isFeedbackAnswerRecord, questionsForFeedbackSource, validateFeedbackAnswers } from "@/lib/feedback/questions";

/**
 * Field whitelists for records a data-entry assistant may sync. Assistants
 * enter participants, check-ins, ballots, feedback and paper-ballot receipts; they never set break
 * status, seeds, adjudicator scores or confirmation state.
 */
export const DATA_ENTRY_FIELDS = {
  teams: [
    "id", "tournamentId", "name", "codeName", "institutionId", "institutionName", "speakers",
    "emoji", "checkedIn", "checkedInAt", "roundAvailability", "roundAvailabilityAt", "checkInHistory",
  ],
  adjudicators: [
    "id", "tournamentId", "name", "institutionId", "institutionName", "trainee", "independent",
    "checkedIn", "checkedInAt", "roundAvailability", "roundAvailabilityAt", "checkInHistory", "gender",
  ],
  institutions: ["id", "tournamentId", "name", "code", "region"],
  ballots: [
    "id", "tournamentId", "roundId", "debateId", "version", "motionId", "motionText", "speakerScores",
    "teamScores", "timestamp",
  ],
  feedback: [
    "id", "tournamentId", "roundId", "debateId", "targetType", "targetAdjudicatorId",
    "targetAdjudicatorName", "targetTeamId", "targetTeamName", "sourceType", "sourceId", "sourceName", "score",
    "agreeWithDecision", "comments", "answers", "timestamp",
  ],
  // Who received a sheet is stamped by the server from the signed-in assistant.
  ballotIntake: ["id", "tournamentId", "roundId", "debateId", "sheetCode", "adjudicatorId", "receivedAt"],
} as const;

/**
 * What firestore.rules lets a data-entry assistant write directly to the live collections (see
 * docs/live-collaboration.md): their own unconfirmed ballots, and check-in fields of teams and
 * adjudicators. The rules hold the same lists (assistantLiveBallotFields /
 * assistantLiveCheckInFields); a test keeps them in step.
 */
export const ASSISTANT_LIVE_BALLOT_FIELDS = [
  ...DATA_ENTRY_FIELDS.ballots,
  "confirmed", "discarded", "submitterType", "submitterId", "submitterName", "chairId", "syncVersion",
] as const;
export const ASSISTANT_LIVE_CHECK_IN_FIELDS = [
  "checkedIn", "checkedInAt", "roundAvailability", "roundAvailabilityAt", "checkInHistory", "syncVersion",
] as const;

/** Fields an assistant may supply only when creating a record (e.g. a CSV import). */
export const DATA_ENTRY_CREATE_ONLY_FIELDS: Partial<Record<DataEntryCollection, readonly string[]>> = {
  teams: ["breakCategories", "speakerCategories"],
  adjudicators: ["baseScore", "testScore"],
};

export type DataEntryCollection = keyof typeof DATA_ENTRY_FIELDS;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validDataEntryId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function pickFields(value: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.filter((field) => value[field] !== undefined).map((field) => [field, value[field]])
  );
}

export interface SanitizedDataEntryRecord {
  /** Fields that may be written whether or not the record exists. */
  record: Record<string, unknown>;
  /** Fields applied only when the record does not exist yet. */
  createOnly: Record<string, unknown>;
}

export function sanitizeDataEntryRecord(
  collectionName: DataEntryCollection,
  value: unknown,
  tournamentId: string
): SanitizedDataEntryRecord {
  if (!isRecord(value) || !validDataEntryId(value.id) || value.tournamentId !== tournamentId) {
    throw new Error(`Invalid ${collectionName} record.`);
  }
  const record = pickFields(value, DATA_ENTRY_FIELDS[collectionName]);
  const createOnly = pickFields(value, DATA_ENTRY_CREATE_ONLY_FIELDS[collectionName] ?? []);
  if (collectionName === "teams") {
    record.speakers = Array.isArray(value.speakers)
      ? value.speakers.filter(isRecord).map((speaker) =>
          pickFields(speaker, ["id", "name", "categories", "roundAvailability", "checkInHistory"]))
      : [];
  }
  if (collectionName === "adjudicators") {
    for (const field of ["baseScore", "testScore"] as const) {
      const score = createOnly[field];
      if (score !== undefined && (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 100)) {
        throw new Error("Invalid adjudicator score.");
      }
    }
  }
  return { record, createOnly };
}

function debateSides(debate: Debate): string[] {
  return Object.entries(debate.teams || {})
    .filter(([, slot]) => Boolean(slot?.teamId))
    .map(([side]) => side);
}

function isLiveDebate(debate: (Debate & { deletedAt?: unknown }) | undefined): debate is Debate {
  return debate !== undefined && typeof debate.deletedAt !== "string";
}

export interface AssistantActor {
  uid: string;
  name: string;
}

/**
 * Validates an assistant-entered ballot against its debate and the
 * tournament's score rules, and stamps it as an unconfirmed tab-room entry
 * submitted by the signed-in assistant.
 */
export function prepareAssistantBallot(
  record: Record<string, unknown>,
  context: {
    debate: (Debate & { deletedAt?: unknown }) | undefined;
    preferences?: Partial<TournamentPreferences>;
    actor: AssistantActor;
  }
): BallotSubmission {
  const { debate, preferences, actor } = context;
  if (!isLiveDebate(debate) || record.debateId !== debate.id) {
    throw new Error(`Ballot ${String(record.id)} refers to a debate that does not exist.`);
  }
  if (record.roundId !== debate.roundId) {
    throw new Error(`Ballot ${String(record.id)} does not match its debate's round.`);
  }
  const sides = debateSides(debate);
  const speakerScores = record.speakerScores;
  const teamScores = record.teamScores;
  if (
    !isRecord(speakerScores) ||
    !isRecord(teamScores) ||
    sides.length === 0 ||
    Object.keys(teamScores).sort().join() !== [...sides].sort().join() ||
    Object.keys(speakerScores).some((side) => !sides.includes(side))
  ) {
    throw new Error(`Ballot ${String(record.id)} must contain scores for every debate side.`);
  }

  const usedRanks = new Set<number>();
  for (const side of sides) {
    const score = teamScores[side];
    const slot = debate.teams[side as keyof Debate["teams"]];
    if (
      !isRecord(score) ||
      score.teamId !== slot?.teamId ||
      typeof score.points !== "number" ||
      !Number.isFinite(score.points) ||
      (score.rank !== undefined &&
        (typeof score.rank !== "number" || !Number.isInteger(score.rank) || score.rank < 1 ||
          score.rank > sides.length || usedRanks.has(score.rank)))
    ) {
      throw new Error(`Ballot ${String(record.id)} contains an invalid team result.`);
    }
    if (typeof score.rank === "number") usedRanks.add(score.rank);

    const entries = speakerScores[side] ?? [];
    if (!Array.isArray(entries) || entries.length > 8) {
      throw new Error(`Ballot ${String(record.id)} contains invalid speaker scores.`);
    }
    for (const entry of entries) {
      if (
        !isRecord(entry) ||
        typeof entry.speakerId !== "string" ||
        typeof entry.position !== "number" ||
        !Number.isInteger(entry.position) ||
        entry.position < 1 ||
        entry.position > 4 ||
        typeof entry.score !== "number"
      ) {
        throw new Error(`Ballot ${String(record.id)} contains invalid speaker scores.`);
      }
      const isReply = entry.position === 4 && preferences?.replyScoresEnabled === true;
      const check = isReply
        ? validateReplyScore(entry.score, preferences)
        : validateSpeakerScore(entry.score, preferences);
      if (!check.valid) {
        throw new Error(`Ballot ${String(record.id)}: ${check.error}`);
      }
    }
  }

  return {
    ...(pickFields(record, DATA_ENTRY_FIELDS.ballots) as unknown as BallotSubmission),
    version: typeof record.version === "number" && Number.isInteger(record.version) &&
      record.version > 0 && record.version <= 1000 ? record.version : 1,
    confirmed: false,
    discarded: false,
    submitterType: "tabroom",
    submitterId: actor.uid,
    submitterName: actor.name,
    ...(debate.adjudicators?.chairId !== undefined ? { chairId: debate.adjudicators.chairId } : {}),
  };
}

/** Assistants may only overwrite their own unconfirmed, non-discarded ballots. */
export function canAssistantOverwriteBallot(
  current: Partial<BallotSubmission>,
  actorUid: string
): boolean {
  return current.submitterId === actorUid && current.confirmed !== true && current.discarded !== true;
}

function isPanelMember(debate: Debate, adjudicatorId: unknown): boolean {
  if (typeof adjudicatorId !== "string") return false;
  const panel = debate.adjudicators;
  return (
    panel?.chairId === adjudicatorId ||
    panel?.panellistIds?.includes(adjudicatorId) === true ||
    panel?.traineeIds?.includes(adjudicatorId) === true
  );
}

function isDebateTeam(debate: Debate, teamId: unknown): boolean {
  return typeof teamId === "string" && Object.values(debate.teams || {}).some((slot) => slot?.teamId === teamId);
}

/** Checks that assistant-entered feedback names a real source and target in its debate. */
export function validateAssistantFeedback(
  record: Record<string, unknown>,
  debate: (Debate & { deletedAt?: unknown }) | undefined,
  preferences?: Partial<TournamentPreferences>
): void {
  const label = `Feedback ${String(record.id)}`;
  if (!isLiveDebate(debate) || record.debateId !== debate.id || record.roundId !== debate.roundId) {
    throw new Error(`${label} refers to a debate that does not exist.`);
  }
  const sourceValid = record.sourceType === "adjudicator"
    ? isPanelMember(debate, record.sourceId)
    : record.sourceType === "team" && isDebateTeam(debate, record.sourceId);
  const targetType = record.targetType ?? "adjudicator";
  const targetValid = targetType === "adjudicator"
    ? isPanelMember(debate, record.targetAdjudicatorId) && record.targetAdjudicatorId !== record.sourceId
    : targetType === "team" && isDebateTeam(debate, record.targetTeamId) && record.targetTeamId !== record.sourceId;
  if (!sourceValid || !targetValid) {
    throw new Error(`${label} does not match the participants of its debate.`);
  }
  if (typeof record.score !== "number" || !validateFeedbackScore(record.score, preferences).valid) {
    throw new Error(`${label} has an invalid score.`);
  }
  if (record.comments !== undefined && (typeof record.comments !== "string" || record.comments.length > 5000)) {
    throw new Error(`${label} has invalid comments.`);
  }
  const answers = record.answers ?? {};
  if (!isFeedbackAnswerRecord(answers)) throw new Error(`${label} has invalid answers.`);
  const answerError = validateFeedbackAnswers(
    questionsForFeedbackSource(record.sourceType === "adjudicator" ? "adjudicator" : "team", preferences),
    answers
  );
  if (answerError) throw new Error(`${label}: ${answerError}`);
}

/**
 * Assistants can only move a debate from "none" to "draft" (a ballot was
 * entered). Confirmation and result points are set by the tab room.
 */
export function nextAssistantResultStatus(
  current: unknown,
  incoming: unknown
): DebateResultStatus {
  const currentStatus: DebateResultStatus =
    current === "draft" || current === "confirmed" ? current : "none";
  if (currentStatus === "none" && (incoming === "draft" || incoming === "confirmed")) return "draft";
  return currentStatus;
}

/**
 * Hides parts of a debate a data-entry assistant must not see yet: the panel
 * until adjudicators are revealed and the motion until motions are released.
 */
export function redactAssistantDebate(
  debate: Record<string, unknown>,
  round: { adjudicatorsRevealed?: boolean; motionsReleased?: boolean } | undefined
): Record<string, unknown> {
  const { adjudicators, motionId, motionText, ...rest } = debate;
  return {
    ...rest,
    adjudicators: round?.adjudicatorsRevealed === true && adjudicators !== undefined
      ? adjudicators
      : { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    ...(round?.motionsReleased === true && motionId !== undefined ? { motionId } : {}),
    ...(round?.motionsReleased === true && motionText !== undefined ? { motionText } : {}),
  };
}

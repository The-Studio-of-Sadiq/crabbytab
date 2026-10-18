import type { BallotSubmission, Debate } from "@/types";

export type PrivateActorType = "adjudicator" | "team";

/**
 * Debates in Firestore carry `participantIds` (every team and adjudicator in the room), so a private
 * portal can query `array-contains` its own id instead of reading every debate. It is derived from
 * the debate, written by the cloud writers and ignored by sync hashing; the device's working copy
 * never needs it. `data/participantIndex` records that every debate of a tournament has it.
 */
export const PARTICIPANT_IDS_FIELD = "participantIds";
export const PARTICIPANT_INDEX_DOCUMENT = "participantIndex";
export const PARTICIPANT_INDEX_VERSION = 1;

export function debateParticipantIds(debate: Pick<Debate, "teams" | "adjudicators">): string[] {
  const ids = new Set<string>();
  for (const slot of Object.values(debate.teams || {})) if (slot?.teamId) ids.add(slot.teamId);
  const panel = debate.adjudicators;
  if (panel?.chairId) ids.add(panel.chairId);
  for (const id of panel?.panellistIds || []) ids.add(id);
  for (const id of panel?.traineeIds || []) ids.add(id);
  return [...ids].sort();
}

/** The index is up to date when it holds exactly the debate's participants. */
export function hasCurrentParticipantIds(record: Record<string, unknown>): boolean {
  const stored = record[PARTICIPANT_IDS_FIELD];
  const expected = debateParticipantIds(record as unknown as Debate);
  return Array.isArray(stored) && stored.length === expected.length && stored.every((id, index) => id === expected[index]);
}

export function withoutParticipantIds<T extends object>(record: T): T {
  if (!(PARTICIPANT_IDS_FIELD in record)) return record;
  const { [PARTICIPANT_IDS_FIELD]: _ignored, ...rest } = record as Record<string, unknown>;
  return rest as T;
}

/**
 * Debates the private-URL actor may see or submit for. Built only from live
 * (non-deleted) debates so a soft-deleted debate can never crash the lookup.
 */
export function selectAssignedDebates(
  liveDebates: ReadonlyMap<string, Debate>,
  actorType: PrivateActorType,
  actorId: string
): Map<string, Debate> {
  const assigned = new Map<string, Debate>();
  for (const [id, debate] of liveDebates) {
    const isAssigned = actorType === "adjudicator"
      ? debate.adjudicators?.chairId === actorId ||
        debate.adjudicators?.panellistIds?.includes(actorId) === true ||
        debate.adjudicators?.traineeIds?.includes(actorId) === true
      : Object.values(debate.teams || {}).some((slot) => slot?.teamId === actorId);
    if (isAssigned) assigned.set(id, debate);
  }
  return assigned;
}

export interface ExistingBallotRecord {
  id: string;
  data: Partial<BallotSubmission>;
}

/**
 * True when the ballot was confirmed by the tab room rather than by the
 * submitting chair. Such ballots are authoritative and must never be
 * discarded by a later private-URL submission.
 */
export function isTabRoomConfirmed(ballot: Partial<BallotSubmission>): boolean {
  if (ballot.confirmed !== true || ballot.discarded === true) return false;
  if (ballot.submitterType !== "judge") return true;
  return typeof ballot.confirmedBy === "string" && ballot.confirmedBy !== ballot.submitterName;
}

export interface PrivateBallotWritePlan {
  /** Existing ballot ids to mark `confirmed: false, discarded: true`. */
  discardExistingIds: string[];
  /** New ballots to store, with final version/confirmed/discarded values. */
  writes: BallotSubmission[];
}

/**
 * Decides how private-URL ballot submissions are stored.
 *
 * A chair's final ballot normally supersedes earlier ballots for the debate.
 * If the tab room has already confirmed a ballot, nothing is discarded and the
 * chair's ballot is stored unconfirmed as a new version for tab review.
 */
export function planPrivateBallotWrites(
  submissions: readonly BallotSubmission[],
  existingByDebate: ReadonlyMap<string, readonly ExistingBallotRecord[]>
): PrivateBallotWritePlan {
  const discardExistingIds: string[] = [];
  const pendingIdsToDiscard = new Set<string>();
  const lockedDebateIds = new Set<string>();
  const debateIds = [...new Set(submissions.map((ballot) => ballot.debateId))];

  for (const debateId of debateIds) {
    const existing = existingByDebate.get(debateId) ?? [];
    if (existing.some((record) => isTabRoomConfirmed(record.data))) {
      lockedDebateIds.add(debateId);
      continue;
    }
    const group = submissions.filter((ballot) => ballot.debateId === debateId);
    const finalChairIndex = group.reduce(
      (lastIndex, ballot, index) => ballot.confirmed ? index : lastIndex,
      -1
    );
    if (finalChairIndex < 0) continue;
    group.slice(0, finalChairIndex).forEach((ballot) => pendingIdsToDiscard.add(ballot.id));
    for (const record of existing) {
      if (record.data.discarded !== true) discardExistingIds.push(record.id);
    }
  }

  const nextVersionByDebate = new Map<string, number>();
  for (const debateId of debateIds) {
    const currentVersion = (existingByDebate.get(debateId) ?? []).reduce(
      (version, record) => Math.max(version, Number(record.data.version) || 0),
      0
    );
    nextVersionByDebate.set(debateId, currentVersion);
  }

  const writes = submissions.map((ballot): BallotSubmission => {
    const version = (nextVersionByDebate.get(ballot.debateId) ?? 0) + 1;
    nextVersionByDebate.set(ballot.debateId, version);
    const discarded = pendingIdsToDiscard.has(ballot.id);
    if (lockedDebateIds.has(ballot.debateId)) {
      const { confirmedBy: _confirmedBy, confirmedTimestamp: _confirmedTimestamp, ...rest } = ballot;
      // Never overwrite a stored ballot in a tab-confirmed debate; keep it as a new version.
      const idTaken = (existingByDebate.get(ballot.debateId) ?? []).some((record) => record.id === ballot.id);
      return {
        ...rest,
        id: idTaken ? `${ballot.id}-v${version}` : ballot.id,
        version,
        confirmed: false,
        discarded: false,
      };
    }
    return {
      ...ballot,
      version,
      confirmed: ballot.confirmed && !discarded,
      discarded,
    };
  });

  return { discardExistingIds, writes };
}

/**
 * The fields a private-URL submission changes on an earlier ballot it supersedes. The sync version
 * moves on, so a tab-room device still holding the earlier version as live gets a sync conflict on
 * its next upload instead of silently reviving that version.
 */
export function supersededBallotUpdate(
  existing: Partial<BallotSubmission> & { syncVersion?: number }
): Partial<BallotSubmission> & { syncVersion: number } {
  return { confirmed: false, discarded: true, syncVersion: (Number(existing.syncVersion) || 0) + 1 };
}

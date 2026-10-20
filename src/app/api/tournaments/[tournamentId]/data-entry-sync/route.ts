import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import type { DocumentSnapshot } from "firebase-admin/firestore";
import type { Debate, Round } from "@/types";
import { checkBallotIntake, remoteBallotSubmissionBlocker } from "@/features/tournament/application/stateGuards";
import { authorizeDataEntryStaff, currentDataEntryPermissions } from "@/lib/staffAccessServer";
import { hasStaffPermission } from "@/lib/staffPermissions";
import {
  DATA_ENTRY_FIELDS,
  requiredDataEntryPermission,
  type DataEntryCollection,
  canAssistantOverwriteBallot,
  isRecord,
  nextAssistantResultStatus,
  prepareAssistantBallot,
  sanitizeDataEntryRecord,
  validDataEntryId as validId,
  validateAssistantFeedback,
} from "@/lib/dataEntrySync";

export const runtime = "nodejs";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }
  return value;
}

function recordsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function generatePrivateKey(prefix = "") {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let key = prefix ? `${prefix}_` : "";
  while (key.length < (prefix ? prefix.length + 1 : 0) + 12) {
    for (const value of randomBytes(16)) {
      if (value >= 240) continue;
      key += alphabet[value % alphabet.length];
      if (key.length === (prefix ? prefix.length + 1 : 0) + 12) break;
    }
  }
  return key;
}

type SyncRecord = {
  collectionName: DataEntryCollection;
  record: Record<string, unknown>;
  createOnly: Record<string, unknown>;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params;
  if (!validId(tournamentId)) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  const authorization = await authorizeDataEntryStaff(request, tournamentId);
  if ("error" in authorization) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isRecord(body) || !isRecord(body.collections) || !Array.isArray(body.debates)) {
    return NextResponse.json({ error: "Invalid data-entry sync payload." }, { status: 400 });
  }
  const collectionsInput = body.collections as Record<string, unknown>;
  if (JSON.stringify(body).length > 4_000_000) {
    return NextResponse.json({ error: "Sync payload is too large. Upload fewer records at a time." }, { status: 413 });
  }

  let records: SyncRecord[];
  try {
    records = (Object.keys(DATA_ENTRY_FIELDS) as DataEntryCollection[]).flatMap((collectionName) => {
      const values = collectionsInput[collectionName];
      if (values === undefined) return [];
      if (!Array.isArray(values) || values.length > 5000) throw new Error(`Invalid ${collectionName} collection.`);
      return values.map((value) => ({
        collectionName,
        ...sanitizeDataEntryRecord(collectionName, value, tournamentId),
      }));
    });
    if (body.debates.length > 5000) throw new Error("Too many debate results in one sync.");
    if (!body.debates.every((debate) => isRecord(debate) && validId(debate.id))) {
      throw new Error("Invalid debate result record.");
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid sync record." }, { status: 400 });
  }

  try {
    let archivedConflictCount = 0;
    // Records archived for the tab room instead of written, so the device keeps them as local edits.
    const rejected: Array<{ collectionName: DataEntryCollection; recordId: string }> = [];
    const { tournament, user } = authorization;
    const actor = { uid: user.uid, name: authorization.actorName };
    const referencedDebateIds = [...new Set(records
      .filter(({ collectionName }) => collectionName === "ballots" || collectionName === "feedback" || collectionName === "ballotIntake")
      .map(({ record }) => record.debateId)
      .filter(validId))];
    const debateSnapshots: DocumentSnapshot[] = referencedDebateIds.length > 0
      ? await authorization.firestore.getAll(
          ...referencedDebateIds.map((id) => authorization.tournamentRef.collection("debates").doc(id))
        )
      : [];
    const debatesById = new Map<string, Debate & { deletedAt?: unknown }>(
      debateSnapshots
        .filter((snapshot) => snapshot.exists)
        .map((snapshot) => [snapshot.id, { ...snapshot.data(), id: snapshot.id } as Debate])
    );
    // Ballots may only be entered for rounds whose draw is published and still running.
    const referencedRoundIds = [...new Set([...debatesById.values()].map((debate) => debate.roundId).filter(validId))];
    const roundSnapshots: DocumentSnapshot[] = referencedRoundIds.length > 0
      ? await authorization.firestore.getAll(
          ...referencedRoundIds.map((id) => authorization.tournamentRef.collection("rounds").doc(id))
        )
      : [];
    const roundsById = new Map<string, Round>(
      roundSnapshots
        .filter((snapshot) => snapshot.exists && typeof snapshot.data()?.deletedAt !== "string")
        .map((snapshot) => [snapshot.id, { ...snapshot.data(), id: snapshot.id } as Round])
    );

    for (const { collectionName, record, createOnly } of records) {
      const recordRef = authorization.tournamentRef.collection(collectionName).doc(record.id as string);
      const conflictRef = authorization.tournamentRef.collection("syncConflicts").doc();
      const outcome = await authorization.firestore.runTransaction(async (transaction): Promise<"unchanged" | "written" | "superseded" | "rejected"> => {
        const permissions = await currentDataEntryPermissions(transaction, authorization);
        const snapshot = await transaction.get(recordRef);
        const current: Record<string, unknown> | null = snapshot.exists
          ? { ...snapshot.data(), id: snapshot.id }
          : null;
        // Records the assistant did not change (including ones pulled from the cloud) are left alone.
        const changedKeys = Object.keys(record).filter((key) => !current || !recordsEqual(current[key], record[key]));
        if (current && changedKeys.length === 0) {
          return "unchanged";
        }
        // Outside the assistant's permissions: nothing is written, and the device keeps the edit.
        if (!hasStaffPermission(permissions, requiredDataEntryPermission(collectionName, current === null, changedKeys))) {
          return "rejected";
        }
        const archiveIncoming = (resolution: "deleted" | "rejected") => {
          transaction.create(conflictRef, {
            id: conflictRef.id,
            collectionName,
            recordId: record.id,
            record: current,
            incomingRecord: record,
            resolution,
            archivedAt: new Date().toISOString(),
            archivedBy: user.uid,
          });
          return "rejected" as const;
        };
        if (current && typeof current.deletedAt === "string") return archiveIncoming("deleted");

        let next: Record<string, unknown>;
        if (collectionName === "ballots") {
          // Confirmed ballots and ballots entered by someone else are kept for tab review instead.
          if (current && !canAssistantOverwriteBallot(current, user.uid)) return archiveIncoming("rejected");
          const debate = debatesById.get(String(record.debateId));
          if (debate && remoteBallotSubmissionBlocker(roundsById.get(debate.roundId))) {
            return archiveIncoming("rejected");
          }
          next = { ...prepareAssistantBallot(record, {
            debate: debatesById.get(String(record.debateId)),
            preferences: tournament.preferences,
            actor,
          }) };
        } else if (collectionName === "ballotIntake") {
          // The first receipt of a sheet stands; the same sheet scanned again changes nothing.
          if (current) return "unchanged";
          const debate = debatesById.get(String(record.debateId));
          if (
            !debate ||
            debate.roundId !== record.roundId ||
            checkBallotIntake(roundsById.get(debate.roundId), debate.id).length > 0
          ) {
            return archiveIncoming("rejected");
          }
          next = { ...record, receivedBy: user.uid, receivedByName: authorization.actorName };
        } else if (collectionName === "feedback") {
          validateAssistantFeedback(record, debatesById.get(String(record.debateId)), tournament.preferences);
          next = current ? { ...current, ...record } : { ...record, confirmed: false };
        } else {
          next = current ? { ...current, ...record } : { ...createOnly, ...record };
        }

        if (collectionName === "teams") {
          const currentSpeakers = current?.speakers;
          const incomingSpeakers = record.speakers;
          if (current && Array.isArray(currentSpeakers) && Array.isArray(incomingSpeakers)) {
            const cloudSpeakersById = new Map(
              currentSpeakers.filter(isRecord).map((speaker) => [speaker.id, speaker])
            );
            next.speakers = [
              ...currentSpeakers.filter(isRecord).map((speaker) => speaker.id),
              ...incomingSpeakers.filter(isRecord).map((speaker) => speaker.id),
            ].filter((id, index, all) => all.indexOf(id) === index).map((id) => {
              const existingSpeaker = cloudSpeakersById.get(id);
              const incomingSpeaker = incomingSpeakers.find((speaker) => isRecord(speaker) && speaker.id === id);
              return { ...(existingSpeaker || {}), ...(isRecord(incomingSpeaker) ? incomingSpeaker : {}) };
            });
          }
          next.privateUrlKey = typeof next.privateUrlKey === "string" ? next.privateUrlKey : generatePrivateKey("team");
          next.privatePasscode = typeof next.privatePasscode === "string" ? next.privatePasscode : generatePrivateKey();
        }
        if (collectionName === "adjudicators") {
          next.privateUrlKey = typeof next.privateUrlKey === "string" ? next.privateUrlKey : generatePrivateKey("adj");
          next.privatePasscode = typeof next.privatePasscode === "string" ? next.privatePasscode : generatePrivateKey();
        }
        if (current && recordsEqual(current, next)) return "unchanged";
        // Every write bumps the version, so an administrator's stale upload of this record is
        // archived as a conflict instead of overwriting it, and their next download picks it up.
        next.syncVersion = (Number(current?.syncVersion) || 0) + 1;
        if (current) {
          transaction.create(conflictRef, {
            id: conflictRef.id,
            collectionName,
            recordId: record.id,
            record: current,
            archivedAt: new Date().toISOString(),
            archivedBy: user.uid,
          });
        }
        transaction.set(recordRef, next);
        return current ? "superseded" : "written";
      });
      if (outcome === "rejected") rejected.push({ collectionName, recordId: record.id as string });
      archivedConflictCount += Number(outcome === "rejected" || outcome === "superseded");
    }

    for (const debate of body.debates as Record<string, unknown>[]) {
      const debateRef = authorization.tournamentRef.collection("debates").doc(debate.id as string);
      const conflictRef = authorization.tournamentRef.collection("syncConflicts").doc();
      const archived = await authorization.firestore.runTransaction(async (transaction) => {
        const permissions = await currentDataEntryPermissions(transaction, authorization);
        if (!hasStaffPermission(permissions, "results.enter")) return false;
        const snapshot = await transaction.get(debateRef);
        if (!snapshot.exists) return false;
        const current: Record<string, unknown> = { ...snapshot.data(), id: snapshot.id };
        if (typeof current.deletedAt === "string") return false;
        // Assistants may only flag that a ballot was entered; result points and
        // confirmation are written by the tab room when it confirms a ballot.
        const resultStatus = nextAssistantResultStatus(current.resultStatus, debate.resultStatus);
        if (resultStatus === current.resultStatus) return false;
        transaction.create(conflictRef, {
          id: conflictRef.id,
          collectionName: "debates",
          recordId: debate.id,
          record: current,
          archivedAt: new Date().toISOString(),
          archivedBy: user.uid,
        });
        transaction.update(debateRef, { resultStatus, syncVersion: (Number(current.syncVersion) || 0) + 1 });
        return true;
      });
      archivedConflictCount += Number(archived);
    }

    return NextResponse.json({ archivedConflictCount, rejected });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not sync assistant data." },
      { status: 409 }
    );
  }
}

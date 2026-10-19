import {
  collection,
  deleteField,
  doc,
  FieldPath,
  onSnapshot,
  query,
  waitForPendingWrites,
  where,
  writeBatch,
  type Firestore,
  type Query,
} from "firebase/firestore";

import type { CloudRecord } from "@/features/tournament/collections";
import type { LivePort, LiveSnapshot } from "@/features/tournament/application/liveSession";
import type { LiveScope, LiveWrite } from "@/features/tournament/application/liveSync";
import { PARTICIPANT_IDS_FIELD, debateParticipantIds, withoutParticipantIds } from "@/lib/privateSync";
import { cleanUndefined } from "./firestore";

/** Writes per batch; each record is one write, well inside Firestore's 500-write limit. */
const LIVE_BATCH_SIZE = 400;

export function liveScopeQuery(firestoreDb: Firestore, tournamentId: string, scope: LiveScope): Query {
  const records = collection(firestoreDb, "tournaments", tournamentId, scope.collection);
  return scope.roundId === undefined ? records : query(records, where("roundId", "==", scope.roundId));
}

/**
 * The document data and merge fields for one write. A "set" replaces the record (cloud-only
 * fields such as a debate's participant index are recomputed); a "patch" names exactly the field
 * paths it changes, so Firestore leaves every other field (and other keys of a map field) as
 * another device last wrote them.
 */
export function liveWriteData(write: LiveWrite): { data: Record<string, unknown>; mergeFields?: FieldPath[] } {
  const derived: Record<string, unknown> =
    write.collection === "debates"
      ? { [PARTICIPANT_IDS_FIELD]: debateParticipantIds(write.record as never) }
      : {};
  if (write.kind === "set") {
    const record = cleanUndefined(withoutParticipantIds(write.record)) as unknown as Record<string, unknown>;
    return { data: { ...record, ...derived, id: write.id, syncVersion: write.syncVersion } };
  }
  const data: Record<string, unknown> = {};
  const mergeFields: FieldPath[] = [];
  for (const field of write.fields) {
    const value = "delete" in field ? deleteField() : cleanUndefined(field.value);
    const [key, entry] = field.path;
    if (entry === undefined) {
      data[key] = value;
    } else {
      const map = (data[key] as Record<string, unknown> | undefined) ?? {};
      map[entry] = value;
      data[key] = map;
    }
    mergeFields.push(new FieldPath(...field.path));
  }
  data.syncVersion = write.syncVersion;
  mergeFields.push(new FieldPath("syncVersion"));
  // The index follows the debate's teams and panel, so private portals keep finding it.
  for (const [key, value] of Object.entries(derived)) {
    data[key] = value;
    mergeFields.push(new FieldPath(key));
  }
  return { data, mergeFields };
}

export function createFirestoreLivePort(firestoreDb: Firestore, tournamentId: string): LivePort {
  return {
    subscribe(scope, handlers) {
      return onSnapshot(
        liveScopeQuery(firestoreDb, tournamentId, scope),
        { includeMetadataChanges: true },
        (snapshot) => {
          const live: LiveSnapshot = {
            changes: snapshot.docChanges().map((change) => ({
              type: change.type,
              // The participant index is cloud-only; the working copy never holds it.
              record: { ...withoutParticipantIds(change.doc.data()), id: change.doc.id } as CloudRecord,
            })),
            fromCache: snapshot.metadata.fromCache,
            pendingIds: snapshot.docs.filter((document) => document.metadata.hasPendingWrites).map((document) => document.id),
          };
          handlers.next(live);
        },
        (error) => handlers.error(error)
      );
    },
    async commit(writes) {
      // Every batch is handed to the SDK before any is awaited: offline, a commit only settles on
      // reconnect, and batches not yet committed would not be in the SDK's persisted queue.
      const commits: Promise<void>[] = [];
      for (let index = 0; index < writes.length; index += LIVE_BATCH_SIZE) {
        const batch = writeBatch(firestoreDb);
        for (const write of writes.slice(index, index + LIVE_BATCH_SIZE)) {
          const ref = doc(firestoreDb, "tournaments", tournamentId, write.collection, write.id);
          const { data, mergeFields } = liveWriteData(write);
          if (mergeFields) batch.set(ref, data, { mergeFields });
          else batch.set(ref, data);
        }
        commits.push(batch.commit());
      }
      await Promise.all(commits);
    },
    waitForPendingWrites() {
      return waitForPendingWrites(firestoreDb);
    },
  };
}

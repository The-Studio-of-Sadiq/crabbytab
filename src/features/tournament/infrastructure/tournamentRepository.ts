import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  where,
  writeBatch,
  type DocumentReference,
  type DocumentSnapshot,
  type Transaction,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import type { Tournament } from "@/types";
import type {
  CloudDeletionMap,
  CloudOverwriteMap,
  CloudCollectionName,
  CloudRecord,
  TournamentCloudRepository,
  SyncConflict,
} from "@/features/tournament/application/cloudSync";
import { hasStaleSyncVersion } from "@/features/tournament/application/cloudSync";
import { CLOUD_COLLECTIONS } from "@/features/tournament/collections";
import { cleanUndefined } from "./firestore";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }
  return value;
}

function recordsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function withoutUpdatedAt(data: Record<string, unknown>): Record<string, unknown> {
  const { updatedAt: _updatedAt, syncVersion: _syncVersion, ...rest } = data;
  return rest;
}

/**
 * Records per upload transaction. Each record can add two writes (itself and the archived version
 * it replaces), which keeps a transaction well inside Firestore's 500-write and 10 MiB limits.
 */
const UPLOAD_TRANSACTION_SIZE = 150;
/** Audit events per blind batch (one write each). */
const UPLOAD_BATCH_SIZE = 400;

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

/**
 * Writes one uploaded record inside a transaction, given its current cloud snapshot:
 * - not in the cloud: created at syncVersion 1;
 * - identical to the cloud: nothing written;
 * - soft-deleted in the cloud, or uploaded from a stale version: not written, and the incoming
 *   version is archived in syncConflicts (counted as a conflict);
 * - otherwise (or restored from a backup): written at the next version, archiving the version it
 *   replaces. Audit events are never rewritten.
 */
function writeRecordInTransaction(input: {
  transaction: Transaction;
  collectionName: CloudCollectionName;
  item: CloudRecord;
  snapshot: DocumentSnapshot;
  restored: boolean;
  recordRef: DocumentReference;
  newConflictRef: () => DocumentReference;
}): { conflict: boolean; syncVersion: number } {
  const { transaction, collectionName, item, snapshot, restored, recordRef } = input;
  const cleanRecord = cleanUndefined(item);
  if (collectionName === "auditEvents" && snapshot.exists()) {
    return { conflict: false, syncVersion: Number(snapshot.data()?.syncVersion) || 0 };
  }
  if (!snapshot.exists()) {
    transaction.set(recordRef, { ...cleanRecord, syncVersion: 1 });
    return { conflict: false, syncVersion: 1 };
  }
  const archive = (current: CloudRecord, resolution: string) => {
    const conflictRef = input.newConflictRef();
    transaction.set(conflictRef, {
      id: conflictRef.id,
      collectionName,
      recordId: item.id,
      record: current,
      incomingRecord: cleanRecord,
      resolution,
      archivedAt: new Date().toISOString(),
    });
  };
  const current = { ...snapshot.data(), id: snapshot.id } as CloudRecord;
  const currentVersion = Number(current.syncVersion) || 0;
  const incomingVersion = Number(item.syncVersion) || 0;
  // A record restored from a backup replaces whatever the cloud holds, deleted or newer.
  if (typeof current.deletedAt === "string" && !restored) {
    archive(current, "deleted");
    return { conflict: true, syncVersion: currentVersion };
  }
  if (recordsEqual(withoutUpdatedAt(current), withoutUpdatedAt(cleanRecord))) {
    return { conflict: false, syncVersion: currentVersion };
  }
  if (!restored && hasStaleSyncVersion(incomingVersion, currentVersion)) {
    archive(current, "unresolved");
    return { conflict: true, syncVersion: currentVersion };
  }
  archive(current, restored ? "restored" : "superseded");
  const nextVersion = currentVersion + 1;
  transaction.set(recordRef, { ...cleanRecord, syncVersion: nextVersion });
  return { conflict: false, syncVersion: nextVersion };
}

export function createFirestoreTournamentRepository(): TournamentCloudRepository {
  const getFirestore = () => {
    if (!db) throw new Error("Cloud sync is unavailable because Firebase is not configured.");
    return db;
  };

  return {
    async getTournament(tournamentId) {
      const firestoreDb = getFirestore();
      const snapshot = await getDoc(doc(firestoreDb, "tournaments", tournamentId));
      return snapshot.exists()
        ? { id: snapshot.id, data: snapshot.data() as Record<string, unknown> }
        : null;
    },
    async findTournamentBySlug(slug) {
      if (auth?.currentUser) {
        const token = await auth.currentUser.getIdToken();
        const response = await fetch(
          `/api/tournaments/lookup?slug=${encodeURIComponent(slug)}`,
          { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
        );
        if (response.status === 404) return null;
        const result = await response.json() as {
          error?: string;
          id?: string;
          data?: Record<string, unknown>;
        };
        if (!response.ok) {
          throw new Error(result.error || "This account cannot access the requested tournament.");
        }
        if (!result.id || !result.data) throw new Error("Tournament lookup returned invalid data.");
        return { id: result.id, data: result.data };
      }

      const firestoreDb = getFirestore();
      const snapshot = await getDocs(
        query(collection(firestoreDb, "tournaments"), where("slug", "==", slug), limit(2))
      );
      if (snapshot.docs.length > 1) {
        throw new Error("This tournament slug is ambiguous. Contact a tournament administrator.");
      }
      const tournament = snapshot.docs[0];
      return tournament
        ? { id: tournament.id, data: tournament.data() as Record<string, unknown> }
        : null;
    },
    async saveTournament(tournamentId: string, tournament: Tournament) {
      const firestoreDb = getFirestore();
      const tournamentRef = doc(firestoreDb, "tournaments", tournamentId);
      const conflictRef = doc(collection(firestoreDb, "tournaments", tournamentId, "syncConflicts"));
      const slug = tournament.slug;
      if (!/^[a-z0-9-]{1,40}$/.test(slug)) {
        throw new Error("Tournament slug must contain 1-40 lowercase letters, numbers, or hyphens.");
      }
      const slugRef = doc(firestoreDb, "tournamentSlugs", slug);
      try {
        const matchingTournaments = await getDocs(
          query(collection(firestoreDb, "tournaments"), where("slug", "==", slug), limit(2))
        );
        if (matchingTournaments.docs.some((document) => document.id !== tournamentId)) {
          throw new Error("This tournament slug is already in use.");
        }
      } catch (error) {
        // Only global admins may query every tournament; for other admins the
        // tournamentSlugs reservation in the transaction below enforces uniqueness.
        if ((error as { code?: unknown } | null)?.code !== "permission-denied") throw error;
      }
      const cleanTournament = cleanUndefined(tournament);
      return runTransaction(firestoreDb, async (transaction) => {
        const snapshot = await transaction.get(tournamentRef);
        const slugReservation = await transaction.get(slugRef);
        const previousSlug = snapshot.data()?.slug;
        const previousSlugRef =
          typeof previousSlug === "string" && previousSlug !== slug
            ? doc(firestoreDb, "tournamentSlugs", previousSlug)
            : null;
        const previousSlugReservation = previousSlugRef
          ? await transaction.get(previousSlugRef)
          : null;

        if (
          slugReservation.exists() && slugReservation.data().tournamentId !== tournamentId
        ) {
          throw new Error("This tournament slug is already in use.");
        }

        if (!snapshot.exists()) {
          transaction.set(slugRef, { tournamentId });
          transaction.set(tournamentRef, { ...cleanTournament, syncVersion: 1 }, { merge: true });
          tournament.syncVersion = 1;
          return false;
        }
        const current = { ...snapshot.data(), id: snapshot.id } as Record<string, unknown>;
        const incoming = cleanTournament as unknown as Record<string, unknown>;
        const currentVersion = Number(current.syncVersion) || 0;
        const incomingVersion = Number(incoming.syncVersion) || 0;
        const hasConflict = !recordsEqual(withoutUpdatedAt(current), withoutUpdatedAt(incoming));
        if (hasConflict && currentVersion !== incomingVersion) {
          transaction.set(conflictRef, {
            id: conflictRef.id,
            collectionName: "tournament",
            recordId: tournamentId,
            record: current,
            incomingRecord: incoming,
            resolution: "unresolved",
            archivedAt: new Date().toISOString(),
          });
          return true;
        }
        if (
          previousSlugRef &&
          previousSlugReservation?.exists() &&
          previousSlugReservation.data().tournamentId === tournamentId
        ) {
          transaction.delete(previousSlugRef);
        }
        transaction.set(slugRef, { tournamentId });
        const nextVersion = hasConflict ? currentVersion + 1 : currentVersion;
        transaction.set(tournamentRef, { ...cleanTournament, syncVersion: nextVersion }, { merge: true });
        tournament.syncVersion = nextVersion;
        return false;
      });
    },
    async getCollections(tournamentId) {
      const firestoreDb = getFirestore();
      const snapshots = await Promise.all(
        CLOUD_COLLECTIONS.map((name) =>
          getDocs(collection(firestoreDb, "tournaments", tournamentId, name))
        )
      );
      return Object.fromEntries(
        CLOUD_COLLECTIONS.map((name, index) => [
          name,
          snapshots[index].docs.map((document) => ({
            ...document.data(),
            id: document.id,
          })),
        ])
      ) as Record<CloudCollectionName, CloudRecord[]>;
    },
    async syncCollections(
      tournamentId: string,
      localCollections: Record<CloudCollectionName, CloudRecord[]>,
      deletions: CloudDeletionMap = {},
      overwrites: CloudOverwriteMap = {}
    ) {
      const firestoreDb = getFirestore();
      const recordRef = (collectionName: CloudCollectionName, recordId: string) =>
        doc(firestoreDb, "tournaments", tournamentId, collectionName, recordId);
      const newConflictRef = () => doc(collection(firestoreDb, "tournaments", tournamentId, "syncConflicts"));
      let archivedConflictCount = 0;

      for (const collectionName of CLOUD_COLLECTIONS) {
        const deletedIds = [...new Set(deletions[collectionName] || [])];
        const deletedIdSet = new Set(deletedIds);
        const restoredIds = new Set(overwrites[collectionName] || []);

        for (const chunk of chunked(deletedIds, UPLOAD_TRANSACTION_SIZE)) {
          await runTransaction(firestoreDb, async (transaction) => {
            const snapshots = await Promise.all(chunk.map((recordId) => transaction.get(recordRef(collectionName, recordId))));
            chunk.forEach((recordId, index) => {
              const snapshot = snapshots[index];
              if (snapshot.exists() && typeof snapshot.data().deletedAt === "string") return;
              const deletedAt = new Date().toISOString();
              const current = snapshot.exists()
                ? { ...snapshot.data(), id: snapshot.id } as CloudRecord
                : { id: recordId };
              if (snapshot.exists()) {
                const conflictRef = newConflictRef();
                transaction.set(conflictRef, {
                  id: conflictRef.id,
                  collectionName,
                  recordId,
                  record: current,
                  resolution: "recoverable-delete",
                  archivedAt: deletedAt,
                });
              }
              transaction.set(recordRef(collectionName, recordId), {
                ...current,
                id: recordId,
                deletedAt,
                syncVersion: (Number(current.syncVersion) || 0) + 1,
              });
            });
          });
        }

        const items = (localCollections[collectionName] || []).filter((item) => !deletedIdSet.has(item.id));
        let transactional = items;
        if (collectionName === "auditEvents") {
          // Audit events are append-only (the rules refuse updates), so events the cloud has never
          // seen are created in plain batches without reading them first. A batch that hits an
          // existing event is refused as a whole and is retried below with reads.
          transactional = items.filter((item) => item.syncVersion !== undefined);
          for (const chunk of chunked(items.filter((item) => item.syncVersion === undefined), UPLOAD_BATCH_SIZE)) {
            const batch = writeBatch(firestoreDb);
            for (const item of chunk) batch.set(recordRef(collectionName, item.id), { ...cleanUndefined(item), syncVersion: 1 });
            try {
              await batch.commit();
              for (const item of chunk) item.syncVersion = 1;
            } catch (error) {
              console.warn("An audit batch was refused; retrying it with per-event checks:", error);
              transactional = [...transactional, ...chunk];
            }
          }
        }

        // Records the cloud may already hold are read and written in one transaction per chunk,
        // so each keeps its stale-version check and the archived copy of what it replaces.
        for (const chunk of chunked(transactional, UPLOAD_TRANSACTION_SIZE)) {
          const outcomes = await runTransaction(firestoreDb, async (transaction) => {
            const snapshots = await Promise.all(chunk.map((item) => transaction.get(recordRef(collectionName, item.id))));
            return chunk.map((item, index) => writeRecordInTransaction({
              transaction,
              collectionName,
              item,
              snapshot: snapshots[index],
              restored: restoredIds.has(item.id),
              recordRef: recordRef(collectionName, item.id),
              newConflictRef,
            }));
          });
          outcomes.forEach((outcome, index) => {
            if (outcome.conflict) archivedConflictCount += 1;
            else chunk[index].syncVersion = outcome.syncVersion;
          });
        }
      }
      return archivedConflictCount;
    },
    async getSyncConflicts(tournamentId) {
      const firestoreDb = getFirestore();
      const snapshot = await getDocs(
        collection(firestoreDb, "tournaments", tournamentId, "syncConflicts")
      );
      return snapshot.docs.map((document) => ({
        ...document.data(),
        id: document.id,
      })) as SyncConflict[];
    },
  };
}
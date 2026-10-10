import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  where,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import type { Tournament } from "@/types";
import type {
  CloudDeletionMap,
  CloudCollectionName,
  CloudRecord,
  TournamentCloudRepository,
  SyncConflict,
} from "@/features/tournament/application/cloudSync";
import { hasStaleSyncVersion } from "@/features/tournament/application/cloudSync";
import { CLOUD_COLLECTIONS, planCollectionReconciliation } from "@/features/tournament/collections";
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
      const matchingTournaments = await getDocs(
        query(collection(firestoreDb, "tournaments"), where("slug", "==", slug), limit(2))
      );
      if (matchingTournaments.docs.some((document) => document.id !== tournamentId)) {
        throw new Error("This tournament slug is already in use.");
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
      deletions: CloudDeletionMap = {}
    ) {
      const firestoreDb = getFirestore();
      let archivedConflictCount = 0;
      for (const collectionName of CLOUD_COLLECTIONS) {
        const collectionRef = collection(firestoreDb, "tournaments", tournamentId, collectionName);
        const remoteIds = collectionName === "auditEvents"
          ? (await getDocs(collectionRef)).docs.map((remoteDoc) => remoteDoc.id)
          : [];
        const localItems = localCollections[collectionName];
        const plan = planCollectionReconciliation(
          collectionName,
          remoteIds,
          localItems
        );
        const deletedIds = new Set(deletions[collectionName] || []);
        for (const recordId of deletedIds) {
          const recordRef = doc(firestoreDb, "tournaments", tournamentId, collectionName, recordId);
          const conflictRef = doc(collection(firestoreDb, "tournaments", tournamentId, "syncConflicts"));
          await runTransaction(firestoreDb, async (transaction) => {
            const snapshot = await transaction.get(recordRef);
            if (snapshot.exists() && typeof snapshot.data().deletedAt === "string") return;
            const deletedAt = new Date().toISOString();
            const current = snapshot.exists()
              ? { ...snapshot.data(), id: snapshot.id } as CloudRecord
              : { id: recordId };
            if (snapshot.exists()) {
              transaction.set(conflictRef, {
                id: conflictRef.id,
                collectionName,
                recordId,
                record: current,
                resolution: "recoverable-delete",
                archivedAt: deletedAt,
              });
            }
            transaction.set(recordRef, {
              ...current,
              id: recordId,
              deletedAt,
              syncVersion: (Number(current.syncVersion) || 0) + 1,
            });
          });
        }
        for (const item of plan.recordsToWrite) {
          if (deletedIds.has(item.id)) continue;
          const recordRef = doc(firestoreDb, "tournaments", tournamentId, collectionName, item.id);
          const conflictRef = doc(collection(firestoreDb, "tournaments", tournamentId, "syncConflicts"));
          const cleanRecord = cleanUndefined(item);
          const archived = await runTransaction(firestoreDb, async (transaction) => {
            const snapshot = await transaction.get(recordRef);
            if (collectionName === "auditEvents" && snapshot.exists()) {
              return { conflict: false, syncVersion: Number(snapshot.data().syncVersion) || 0 };
            }
            if (!snapshot.exists()) {
              transaction.set(recordRef, { ...cleanRecord, syncVersion: 1 });
              return { conflict: false, syncVersion: 1 };
            }
            const current = { ...snapshot.data(), id: snapshot.id } as CloudRecord;
            const currentVersion = Number(current.syncVersion) || 0;
            const incomingVersion = Number(item.syncVersion) || 0;
            if (typeof current.deletedAt === "string") {
              transaction.set(conflictRef, {
                id: conflictRef.id,
                collectionName,
                recordId: item.id,
                record: current,
                incomingRecord: cleanRecord,
                resolution: "deleted",
                archivedAt: new Date().toISOString(),
              });
              return { conflict: true, syncVersion: currentVersion };
            }
            if (recordsEqual(withoutUpdatedAt(current), withoutUpdatedAt(cleanRecord))) {
              return { conflict: false, syncVersion: currentVersion };
            }
            if (hasStaleSyncVersion(incomingVersion, currentVersion)) {
              transaction.set(conflictRef, {
                id: conflictRef.id,
                collectionName,
                recordId: item.id,
                record: current,
                incomingRecord: cleanRecord,
                resolution: typeof current.deletedAt === "string" ? "deleted" : "unresolved",
                archivedAt: new Date().toISOString(),
              });
              return { conflict: true, syncVersion: currentVersion };
            }
            transaction.set(conflictRef, {
              id: conflictRef.id,
              collectionName,
              recordId: item.id,
              record: current,
              incomingRecord: cleanRecord,
              resolution: "superseded",
              archivedAt: new Date().toISOString(),
            });
            const nextVersion = currentVersion + 1;
            transaction.set(recordRef, { ...cleanRecord, syncVersion: nextVersion });
            return { conflict: false, syncVersion: nextVersion };
          });
          if (archived.conflict) {
            archivedConflictCount += 1;
          } else {
            item.syncVersion = archived.syncVersion;
          }
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
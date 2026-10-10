import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  where,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import type { Tournament } from "@/types";
import type {
  CloudCollectionName,
  CloudRecord,
  TournamentCloudRepository,
  SyncConflict,
} from "@/features/tournament/application/cloudSync";
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
  const { updatedAt: _updatedAt, ...rest } = data;
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
        query(collection(firestoreDb, "tournaments"), where("slug", "==", slug))
      );
      const tournament = snapshot.docs[0];
      return tournament
        ? { id: tournament.id, data: tournament.data() as Record<string, unknown> }
        : null;
    },
    async saveTournament(tournamentId: string, tournament: Tournament) {
      const firestoreDb = getFirestore();
      const tournamentRef = doc(firestoreDb, "tournaments", tournamentId);
      const conflictRef = doc(collection(firestoreDb, "tournaments", tournamentId, "syncConflicts"));
      const cleanTournament = cleanUndefined(tournament);
      return runTransaction(firestoreDb, async (transaction) => {
        const snapshot = await transaction.get(tournamentRef);
        if (!snapshot.exists()) {
          transaction.set(tournamentRef, cleanTournament, { merge: true });
          return false;
        }
        const current = { ...snapshot.data(), id: snapshot.id } as Record<string, unknown>;
        const incoming = cleanTournament as unknown as Record<string, unknown>;
        const hasConflict = !recordsEqual(withoutUpdatedAt(current), withoutUpdatedAt(incoming));
        if (hasConflict) {
          transaction.set(conflictRef, {
            id: conflictRef.id,
            collectionName: "tournament",
            recordId: tournamentId,
            record: current,
            archivedAt: new Date().toISOString(),
          });
        }
        transaction.set(tournamentRef, cleanTournament, { merge: true });
        return hasConflict;
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
      localCollections: Record<CloudCollectionName, CloudRecord[]>
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
        for (const item of plan.recordsToWrite) {
          const recordRef = doc(firestoreDb, "tournaments", tournamentId, collectionName, item.id);
          const conflictRef = doc(collection(firestoreDb, "tournaments", tournamentId, "syncConflicts"));
          const cleanRecord = cleanUndefined(item);
          const archived = await runTransaction(firestoreDb, async (transaction) => {
            const snapshot = await transaction.get(recordRef);
            if (collectionName === "auditEvents" && snapshot.exists()) return false;
            if (!snapshot.exists()) {
              transaction.set(recordRef, cleanRecord);
              return false;
            }
            const current = { ...snapshot.data(), id: snapshot.id } as CloudRecord;
            if (recordsEqual(current, cleanRecord)) return false;
            transaction.set(conflictRef, {
              id: conflictRef.id,
              collectionName,
              recordId: item.id,
              record: current,
              archivedAt: new Date().toISOString(),
            });
            transaction.set(recordRef, cleanRecord);
            return true;
          });
          archivedConflictCount += Number(archived);
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
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  type WriteBatch,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import type { Tournament } from "@/types";
import type {
  CloudCollectionName,
  CloudRecord,
  TournamentCloudRepository,
} from "@/features/tournament/application/cloudSync";
import { CLOUD_COLLECTIONS, planCollectionReconciliation } from "@/features/tournament/collections";
import { cleanUndefined, commitChunkedBatches } from "./firestore";

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
      const firestoreDb = getFirestore();
      const snapshot = await getDocs(
        query(collection(firestoreDb, "tournaments"), where("slug", "==", slug))
      );
      const tournament = snapshot.docs[0];
      return tournament
        ? { id: tournament.id, data: tournament.data() as Record<string, unknown> }
        : null;
    },
    async saveTournament(tournamentId, tournament: Tournament) {
      const firestoreDb = getFirestore();
      await setDoc(
        doc(firestoreDb, "tournaments", tournamentId),
        cleanUndefined(tournament),
        { merge: true }
      );
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
    async syncCollections(tournamentId, localCollections) {
      const firestoreDb = getFirestore();
      const operations: Array<(batch: WriteBatch) => void> = [];
      for (const collectionName of CLOUD_COLLECTIONS) {
        const remoteSnapshot = await getDocs(
          collection(firestoreDb, "tournaments", tournamentId, collectionName)
        );
        const localItems = localCollections[collectionName];
        const plan = planCollectionReconciliation(
          collectionName,
          remoteSnapshot.docs.map((remoteDoc) => remoteDoc.id),
          localItems
        );
        const remoteDocumentsById = new Map(remoteSnapshot.docs.map((remoteDoc) => [remoteDoc.id, remoteDoc]));
        for (const id of plan.deleteIds) {
          const remoteDocument = remoteDocumentsById.get(id);
          if (remoteDocument) operations.push((batch) => batch.delete(remoteDocument.ref));
        }
        for (const item of plan.recordsToWrite) {
          operations.push((batch) =>
            batch.set(
              doc(firestoreDb, "tournaments", tournamentId, collectionName, item.id),
              cleanUndefined(item)
            )
          );
        }
      }
      await commitChunkedBatches(operations, firestoreDb);
    },
  };
}
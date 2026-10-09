import { doc, setDoc, type WriteBatch } from "firebase/firestore";

import type { Adjudicator, Motion, Team } from "@/types";
import { db } from "@/lib/firebase";
import { cleanUndefined, commitChunkedBatches } from "./firestore";

export function createFirestoreEntityRepository(tournamentId: string) {
  return {
    async saveMotion(motion: Motion) {
      if (!db) return;
      await setDoc(
        doc(db, "tournaments", tournamentId, "motions", motion.id),
        cleanUndefined(motion)
      );
    },
    async savePrivateAccessChanges(changes: {
      teams?: Team[];
      adjudicators?: Adjudicator[];
    }): Promise<void> {
      const firestoreDb = db;
      if (!firestoreDb) return;
      const operations: Array<(batch: WriteBatch) => void> = [];
      for (const team of changes.teams || []) {
        operations.push((batch) =>
          batch.set(doc(firestoreDb, "tournaments", tournamentId, "teams", team.id), cleanUndefined(team))
        );
      }
      for (const adjudicator of changes.adjudicators || []) {
        operations.push((batch) =>
          batch.set(doc(firestoreDb, "tournaments", tournamentId, "adjudicators", adjudicator.id), cleanUndefined(adjudicator))
        );
      }
      await commitChunkedBatches(operations, firestoreDb);
    },
  };
}
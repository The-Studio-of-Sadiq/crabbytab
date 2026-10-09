import { doc, type WriteBatch } from "firebase/firestore";

import type { Debate, Round } from "@/types";
import { db } from "@/lib/firebase";
import { cleanUndefined, commitChunkedBatches } from "./firestore";

export function createFirestoreDrawRepository(tournamentId: string) {
  return {
    async saveDebates(debates: Debate[]): Promise<void> {
      const firestoreDb = db;
      if (!firestoreDb) return;
      const operations: Array<(batch: WriteBatch) => void> = debates.map((debate) =>
        (batch) =>
          batch.set(doc(firestoreDb, "tournaments", tournamentId, "debates", debate.id), cleanUndefined(debate))
      );
      await commitChunkedBatches(operations);
    },
    async replaceRoundDraw(
      _roundId: string,
      removedDebates: Debate[],
      debates: Debate[],
      round: Round
    ): Promise<void> {
      const firestoreDb = db;
      if (!firestoreDb) return;
      const operations: Array<(batch: WriteBatch) => void> = [];
      for (const debate of removedDebates) {
        operations.push((batch) =>
          batch.delete(doc(firestoreDb, "tournaments", tournamentId, "debates", debate.id))
        );
      }
      for (const debate of debates) {
        operations.push((batch) =>
          batch.set(doc(firestoreDb, "tournaments", tournamentId, "debates", debate.id), cleanUndefined(debate))
        );
      }
      operations.push((batch) =>
        batch.set(doc(firestoreDb, "tournaments", tournamentId, "rounds", round.id), cleanUndefined(round))
      );
      await commitChunkedBatches(operations);
    },
  };
}
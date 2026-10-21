import { doc, type WriteBatch } from "firebase/firestore";

import type { BallotSubmission, Debate, Round } from "@/types";
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
      round: Round,
      discardedBallots: BallotSubmission[] = []
    ): Promise<void> {
      const firestoreDb = db;
      if (!firestoreDb) return;
      // Ballots of the replaced draw are discarded first, so the cloud never holds the new draw
      // alongside results that still count. Up to BATCH_CHUNK_SIZE (400) writes — any realistic
      // round — this is one atomic batch; beyond that, chunks commit in this order.
      const operations: Array<(batch: WriteBatch) => void> = discardedBallots.map((ballot) =>
        (batch) =>
          batch.set(doc(firestoreDb, "tournaments", tournamentId, "ballots", ballot.id), cleanUndefined(ballot))
      );
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
import { doc, setDoc, type WriteBatch } from "firebase/firestore";

import type { Debate, FeedbackSubmission, Motion, BallotSubmission, Round } from "@/types";
import { db } from "@/lib/firebase";
import type { DeleteRoundDependencies } from "@/features/tournament/application/roundAdministration";
import { cleanUndefined, commitChunkedBatches } from "./firestore";

export function createFirestoreRoundRepository(tournamentId: string) {
  return {
    async saveRound(round: Round) {
      if (!db) return;
      await setDoc(
        doc(db, "tournaments", tournamentId, "rounds", round.id),
        cleanUndefined(round)
      );
    },
    async saveRoundCountChanges(rounds: Round[], changedDebates: Debate[]): Promise<void> {
      const firestoreDb = db;
      if (!firestoreDb) return;
      const operations: Array<(batch: WriteBatch) => void> = [];
      for (const round of rounds) {
        operations.push((batch) =>
          batch.set(doc(firestoreDb, "tournaments", tournamentId, "rounds", round.id), cleanUndefined(round))
        );
      }
      for (const debate of changedDebates) {
        operations.push((batch) =>
          batch.set(doc(firestoreDb, "tournaments", tournamentId, "debates", debate.id), cleanUndefined(debate))
        );
      }
      await commitChunkedBatches(operations);
    },
    async deleteRoundAndSaveChanges(changes: Parameters<NonNullable<DeleteRoundDependencies["cloudRepository"]>["deleteRoundAndSaveChanges"]>[0]): Promise<void> {
      const firestoreDb = db;
      if (!firestoreDb) return;
      const operations: Array<(batch: WriteBatch) => void> = [
        (batch) => batch.delete(doc(firestoreDb, "tournaments", tournamentId, "rounds", changes.roundId)),
      ];
      for (const debate of changes.deletedDebates) {
        operations.push((batch) =>
          batch.delete(doc(firestoreDb, "tournaments", tournamentId, "debates", debate.id))
        );
      }
      for (const ballot of changes.deletedBallots) {
        operations.push((batch) =>
          batch.delete(doc(firestoreDb, "tournaments", tournamentId, "ballots", ballot.id))
        );
      }
      for (const submission of changes.deletedFeedback) {
        operations.push((batch) =>
          batch.delete(doc(firestoreDb, "tournaments", tournamentId, "feedback", submission.id))
        );
      }
      for (const round of changes.remainingRounds) {
        operations.push((batch) =>
          batch.set(doc(firestoreDb, "tournaments", tournamentId, "rounds", round.id), round)
        );
      }
      for (const debate of changes.updatedDebates) {
        operations.push((batch) =>
          batch.set(doc(firestoreDb, "tournaments", tournamentId, "debates", debate.id), cleanUndefined(debate))
        );
      }
      for (const motion of changes.changedMotions) {
        operations.push((batch) =>
          batch.set(doc(firestoreDb, "tournaments", tournamentId, "motions", motion.id), cleanUndefined(motion))
        );
      }
      await commitChunkedBatches(operations);
    },
  };
}
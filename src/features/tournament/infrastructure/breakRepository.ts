import { doc, type WriteBatch } from "firebase/firestore";

import type { BreakCategory, Round, Team } from "@/types";
import { db } from "@/lib/firebase";
import { cleanUndefined, commitChunkedBatches } from "./firestore";

export function createFirestoreBreakRepository(tournamentId: string) {
  return {
    async saveBreakCategories(categories: BreakCategory[]): Promise<void> {
      const firestoreDb = db;
      if (!firestoreDb) return;
      const operations: Array<(batch: WriteBatch) => void> = categories.map((category) =>
        (batch) =>
          batch.set(doc(firestoreDb, "tournaments", tournamentId, "breakCategories", category.id), category)
      );
      await commitChunkedBatches(operations);
    },
    async saveGeneratedBreak(teams: Team[], rounds: Round[]): Promise<void> {
      const firestoreDb = db;
      if (!firestoreDb) return;
      const operations: Array<(batch: WriteBatch) => void> = [];
      for (const team of teams) {
        operations.push((batch) =>
          batch.set(doc(firestoreDb, "tournaments", tournamentId, "teams", team.id), cleanUndefined(team))
        );
      }
      for (const round of rounds.filter((item) => item.stage === "elimination")) {
        operations.push((batch) =>
          batch.set(doc(firestoreDb, "tournaments", tournamentId, "rounds", round.id), cleanUndefined(round))
        );
      }
      await commitChunkedBatches(operations);
    },
    async saveEliminationAdvancement(
      teams: Team[],
      participatingTeamIds: Set<string>,
      round: Round
    ): Promise<void> {
      const firestoreDb = db;
      if (!firestoreDb) return;
      const operations: Array<(batch: WriteBatch) => void> = teams
        .filter((team) => participatingTeamIds.has(team.id))
        .map((team) => (batch) =>
          batch.set(doc(firestoreDb, "tournaments", tournamentId, "teams", team.id), cleanUndefined(team))
        );
      operations.push((batch) =>
        batch.set(doc(firestoreDb, "tournaments", tournamentId, "rounds", round.id), cleanUndefined(round))
      );
      await commitChunkedBatches(operations);
    },
  };
}
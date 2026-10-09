import { doc, setDoc } from "firebase/firestore";

import type { Round } from "@/types";
import { db } from "@/lib/firebase";
import type { RoundCloudRepository } from "@/features/tournament/application/rounds";
import { cleanUndefined } from "./firestore";

export function createFirestoreRoundRepository(tournamentId: string): RoundCloudRepository {
  return {
    async saveRound(round: Round) {
      if (!db) return;
      await setDoc(
        doc(db, "tournaments", tournamentId, "rounds", round.id),
        cleanUndefined(round)
      );
    },
  };
}
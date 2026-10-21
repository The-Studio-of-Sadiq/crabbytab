import { doc, setDoc } from "firebase/firestore";

import type { AuditEvent } from "@/types";
import { db } from "@/lib/firebase";
import { cleanUndefined } from "./firestore";

export function createFirestoreAuditRepository(tournamentId: string) {
  return {
    async append(event: AuditEvent): Promise<void> {
      const firestoreDb = db;
      if (!firestoreDb) return;
      await setDoc(
        doc(firestoreDb, "tournaments", tournamentId, "auditEvents", event.id),
        cleanUndefined(event)
      );
    },
  };
}
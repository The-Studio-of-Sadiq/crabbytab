import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";

const MAX_ATTEMPTS = 50;
const WINDOW_MS = 60 * 60 * 1000;

export async function checkPrivateTeamRateLimit(
  firestore: Firestore,
  clientIp: string,
  now = Date.now()
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const documentId = createHash("sha256").update(clientIp).digest("hex");
  const rateLimitRef = firestore.collection("apiRateLimits").doc(`private-team-${documentId}`);

  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(rateLimitRef);
    const storedTimestamps: unknown = snapshot.data()?.timestamps;
    const timestamps = Array.isArray(storedTimestamps)
      ? storedTimestamps.filter(
          (timestamp): timestamp is number =>
            typeof timestamp === "number" && timestamp > now - WINDOW_MS && timestamp <= now
        )
      : [];

    if (timestamps.length >= MAX_ATTEMPTS) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((timestamps[0] + WINDOW_MS - now) / 1000)),
      };
    }

    transaction.set(rateLimitRef, { timestamps: [...timestamps, now] });
    return { allowed: true, retryAfterSeconds: 0 };
  });
}

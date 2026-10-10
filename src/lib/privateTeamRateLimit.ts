import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";

const MAX_ATTEMPTS = 50;
const WINDOW_MS = 60 * 60 * 1000;

export async function checkPrivateApiRateLimit(
  firestore: Firestore,
  clientIp: string,
  scope: string,
  maxAttempts = MAX_ATTEMPTS,
  now = Date.now()
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const documentId = createHash("sha256").update(clientIp).digest("hex");
  const safeScope = scope.replace(/[^a-z0-9-]/gi, "-").slice(0, 40);
  const rateLimitRef = firestore.collection("apiRateLimits").doc(`private-${safeScope}-${documentId}`);

  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(rateLimitRef);
    const storedTimestamps: unknown = snapshot.data()?.timestamps;
    const timestamps = Array.isArray(storedTimestamps)
      ? storedTimestamps.filter(
          (timestamp): timestamp is number =>
            typeof timestamp === "number" && timestamp > now - WINDOW_MS && timestamp <= now
        )
      : [];

    if (timestamps.length >= maxAttempts) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((timestamps[0] + WINDOW_MS - now) / 1000)),
      };
    }

    transaction.set(rateLimitRef, { timestamps: [...timestamps, now] });
    return { allowed: true, retryAfterSeconds: 0 };
  });
}

export function checkPrivateTeamRateLimit(
  firestore: Firestore,
  clientIp: string,
  now = Date.now()
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  return checkPrivateApiRateLimit(firestore, clientIp, "team", MAX_ATTEMPTS, now);
}

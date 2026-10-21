import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";

const MAX_ATTEMPTS = 300;
const WINDOW_MS = 60 * 60 * 1000;

export async function checkPrivateApiRateLimit(
  firestore: Firestore,
  identity: string,
  scope: string,
  maxAttempts = MAX_ATTEMPTS,
  now = Date.now()
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const documentId = createHash("sha256").update(identity).digest("hex");
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
  identity: string,
  now = Date.now()
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  return checkPrivateApiRateLimit(firestore, identity, "team", MAX_ATTEMPTS, now);
}

const MAX_FAILED_ATTEMPTS = 100;

function failureLimitRef(firestore: Firestore, identity: string, scope: string) {
  const documentId = createHash("sha256").update(identity).digest("hex");
  const safeScope = scope.replace(/[^a-z0-9-]/gi, "-").slice(0, 40);
  return firestore.collection("apiRateLimits").doc(`private-fail-${safeScope}-${documentId}`);
}

function recentTimestamps(stored: unknown, now: number): number[] {
  return Array.isArray(stored)
    ? stored.filter(
        (timestamp): timestamp is number =>
          typeof timestamp === "number" && timestamp > now - WINDOW_MS && timestamp <= now
      )
    : [];
}

/**
 * Read-only check of failed private-link attempts for a client. Runs before
 * the private key is looked up so unknown-key guessing is throttled too,
 * while successful requests never write anything.
 */
export async function checkPrivateFailureLimit(
  firestore: Firestore,
  identity: string,
  scope: string,
  maxAttempts = MAX_FAILED_ATTEMPTS,
  now = Date.now()
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const snapshot = await failureLimitRef(firestore, identity, scope).get();
  const timestamps = recentTimestamps(snapshot.data()?.timestamps, now);
  if (timestamps.length >= maxAttempts) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((timestamps[0] + WINDOW_MS - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Records one failed private-link attempt (unknown key or wrong passcode). */
export async function recordPrivateFailure(
  firestore: Firestore,
  identity: string,
  scope: string,
  maxAttempts = MAX_FAILED_ATTEMPTS,
  now = Date.now()
): Promise<void> {
  const reference = failureLimitRef(firestore, identity, scope);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const timestamps = recentTimestamps(snapshot.data()?.timestamps, now);
    transaction.set(reference, { timestamps: [...timestamps, now].slice(-maxAttempts) });
  });
}

/**
 * Best-effort client address for throttling. Vercel sets x-real-ip and
 * overwrites x-forwarded-for, so neither can be spoofed there.
 */
export function clientAddressFromHeaders(headers: Pick<Headers, "get">): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 64);
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded ? forwarded.slice(0, 64) : "unknown";
}

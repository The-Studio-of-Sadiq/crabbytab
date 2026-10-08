import { writeBatch, type WriteBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";

export const BATCH_CHUNK_SIZE = 400;
export const CLOUD_COLLECTIONS = [
  "rounds",
  "teams",
  "adjudicators",
  "venues",
  "motions",
  "breakCategories",
  "debates",
  "ballots",
  "feedback",
  "institutions",
  "auditEvents",
] as const;

/**
 * Recursively removes any object keys whose value is undefined, which Firestore rejects.
 */
export function cleanUndefined<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(cleanUndefined) as unknown as T;
  }
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = cleanUndefined(value);
    }
  }
  return cleaned as T;
}

/**
 * Execute batch operations in chunks of at most 400 operations to respect Firestore's limit.
 */
export async function commitChunkedBatches(
  operations: Array<(batch: WriteBatch) => void>,
  firestoreDb = db
): Promise<void> {
  if (!firestoreDb || operations.length === 0) return;

  for (let i = 0; i < operations.length; i += BATCH_CHUNK_SIZE) {
    const chunk = operations.slice(i, i + BATCH_CHUNK_SIZE);
    const batch = writeBatch(firestoreDb);
    chunk.forEach((operation) => operation(batch));
    await batch.commit();
  }
}

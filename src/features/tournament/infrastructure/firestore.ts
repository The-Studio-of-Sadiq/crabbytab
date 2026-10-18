import { writeBatch, type WriteBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { CLOUD_COLLECTIONS } from "@/features/tournament/collections";

export { CLOUD_COLLECTIONS };

export const BATCH_CHUNK_SIZE = 400;

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
 * Thrown when a multi-batch write stops part-way. Earlier batches stay committed, so callers must
 * either retry (every write here is an idempotent set/delete) or reconcile from local state.
 */
export class PartialBatchCommitError extends Error {
  constructor(
    readonly committedOperations: number,
    readonly totalOperations: number,
    readonly cause: unknown
  ) {
    super(`Only ${committedOperations} of ${totalOperations} cloud writes were saved before an error.`);
    this.name = "PartialBatchCommitError";
  }
}

/**
 * Execute batch operations in chunks of at most 400 operations to respect Firestore's limit.
 * Each chunk is atomic; the sequence is not. A failed chunk is retried once before giving up with
 * a PartialBatchCommitError that reports how much was saved.
 */
export async function commitChunkedBatches(
  operations: Array<(batch: WriteBatch) => void>,
  firestoreDb = db
): Promise<void> {
  if (!firestoreDb || operations.length === 0) return;

  let committed = 0;
  for (let i = 0; i < operations.length; i += BATCH_CHUNK_SIZE) {
    const chunk = operations.slice(i, i + BATCH_CHUNK_SIZE);
    const commitChunk = () => {
      const batch = writeBatch(firestoreDb);
      chunk.forEach((operation) => operation(batch));
      return batch.commit();
    };
    try {
      await commitChunk();
    } catch {
      try {
        await commitChunk();
      } catch (error) {
        throw new PartialBatchCommitError(committed, operations.length, error);
      }
    }
    committed += chunk.length;
  }
}

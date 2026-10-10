import type { DocumentData, DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { checkPrivateApiRateLimit, checkPrivateTeamRateLimit } from "@/lib/privateTeamRateLimit";

function createFirestoreMock() {
  const documents = new Map<string, DocumentData>();
  const firestore = {
    collection: () => ({
      doc: (id: string) => ({ id }),
    }),
    runTransaction: async <T>(callback: (transaction: Transaction) => Promise<T>) => {
      const transaction = {
        get: async (reference: DocumentReference) => ({
          data: () => documents.get(reference.id),
        }),
        set: (reference: DocumentReference, data: DocumentData) => {
          documents.set(reference.id, data);
        },
      } as unknown as Transaction;
      return callback(transaction);
    },
  };

  return { firestore: firestore as unknown as Firestore, documents };
}

describe("checkPrivateTeamRateLimit", () => {
  it("allows 50 attempts and rejects the 51st for the same IP within an hour", async () => {
    const { firestore } = createFirestoreMock();
    const now = 1_000_000;

    for (let attempt = 0; attempt < 50; attempt += 1) {
      await expect(checkPrivateTeamRateLimit(firestore, "192.0.2.1", now + attempt)).resolves.toEqual({
        allowed: true,
        retryAfterSeconds: 0,
      });
    }

    await expect(checkPrivateTeamRateLimit(firestore, "192.0.2.1", now + 50)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 3600,
    });
  });

  it("allows requests again when the oldest attempt leaves the rolling window", async () => {
    const { firestore } = createFirestoreMock();
    const now = 1_000_000;

    for (let attempt = 0; attempt < 50; attempt += 1) {
      await checkPrivateTeamRateLimit(firestore, "192.0.2.1", now);
    }

    await expect(
      checkPrivateTeamRateLimit(firestore, "192.0.2.1", now + 60 * 60 * 1000)
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("tracks different IP addresses independently", async () => {
    const { firestore } = createFirestoreMock();
    const now = 1_000_000;

    for (let attempt = 0; attempt < 50; attempt += 1) {
      await checkPrivateTeamRateLimit(firestore, "192.0.2.1", now);
    }

    await expect(checkPrivateTeamRateLimit(firestore, "192.0.2.2", now)).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it("applies independent limits per private endpoint scope", async () => {
    const { firestore } = createFirestoreMock();
    const now = 1_000_000;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await checkPrivateApiRateLimit(firestore, "192.0.2.1", "sync", 2, now + attempt);
    }

    await expect(checkPrivateApiRateLimit(firestore, "192.0.2.1", "sync", 2, now + 2)).resolves.toMatchObject({
      allowed: false,
    });
    await expect(checkPrivateTeamRateLimit(firestore, "192.0.2.1", now + 2)).resolves.toMatchObject({
      allowed: true,
    });
  });
});

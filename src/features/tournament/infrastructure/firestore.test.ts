import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Firestore is replaced with an in-memory fake: each committed batch records its operations, and
 * chosen commit attempts (1-based, counted across batches) fail.
 */
const firestoreFake = vi.hoisted(() => ({
  committedBatches: [] as Array<Array<{ kind: "set" | "delete"; path: string; data?: unknown }>>,
  commitAttempts: 0,
  failingAttempts: new Set<number>(),
}));

vi.mock("@/lib/firebase", () => ({ db: { fake: true } }));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join("/") }),
  setDoc: vi.fn(),
  writeBatch: () => {
    const operations: Array<{ kind: "set" | "delete"; path: string; data?: unknown }> = [];
    return {
      set: (ref: { path: string }, data: unknown) => operations.push({ kind: "set", path: ref.path, data }),
      delete: (ref: { path: string }) => operations.push({ kind: "delete", path: ref.path }),
      commit: async () => {
        firestoreFake.commitAttempts += 1;
        if (firestoreFake.failingAttempts.has(firestoreFake.commitAttempts)) throw new Error("unavailable");
        firestoreFake.committedBatches.push(operations);
      },
    };
  },
}));

import type { WriteBatch } from "firebase/firestore";
import type { Round } from "@/types";
import { BATCH_CHUNK_SIZE, commitChunkedBatches, PartialBatchCommitError } from "./firestore";
import { createFirestoreRoundRepository } from "./roundRepository";

function setOperations(count: number): Array<(batch: WriteBatch) => void> {
  return Array.from({ length: count }, (_, index) => (batch: WriteBatch) => {
    (batch as unknown as { set: (ref: { path: string }, data: unknown) => void }).set({ path: `items/${index}` }, { index });
  });
}

beforeEach(() => {
  firestoreFake.committedBatches = [];
  firestoreFake.commitAttempts = 0;
  firestoreFake.failingAttempts = new Set();
});

describe("commitChunkedBatches", () => {
  it("retries a failed chunk once and carries on", async () => {
    firestoreFake.failingAttempts = new Set([2]);
    await commitChunkedBatches(setOperations(BATCH_CHUNK_SIZE + 5));
    expect(firestoreFake.committedBatches.map((batch) => batch.length)).toEqual([BATCH_CHUNK_SIZE, 5]);
  });

  it("reports how much was saved when a later chunk keeps failing", async () => {
    // Attempt 1 commits the first chunk; both attempts at the second chunk fail.
    firestoreFake.failingAttempts = new Set([2, 3]);
    const error = await commitChunkedBatches(setOperations(BATCH_CHUNK_SIZE + 50)).catch((caught) => caught);
    expect(error).toBeInstanceOf(PartialBatchCommitError);
    expect(error).toMatchObject({ committedOperations: BATCH_CHUNK_SIZE, totalOperations: BATCH_CHUNK_SIZE + 50 });
    expect(firestoreFake.committedBatches).toHaveLength(1);
  });
});

describe("round deletion", () => {
  it("strips undefined fields from the remaining rounds it rewrites", async () => {
    const remaining = { id: "r2", seq: 2, name: "Round 2", drawSeed: undefined } as unknown as Round;
    await createFirestoreRoundRepository("t1").deleteRoundAndSaveChanges({
      roundId: "r1",
      deletedDebates: [],
      deletedBallots: [],
      deletedFeedback: [],
      remainingRounds: [remaining],
      updatedDebates: [],
      changedMotions: [],
    } as never);
    const write = firestoreFake.committedBatches
      .flat()
      .find((operation) => operation.path === "tournaments/t1/rounds/r2");
    expect(write?.kind).toBe("set");
    expect(Object.prototype.hasOwnProperty.call(write?.data, "drawSeed")).toBe(false);
  });
});

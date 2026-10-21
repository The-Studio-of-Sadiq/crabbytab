import { describe, expect, it, vi } from "vitest";

/** Just enough of the Firestore SDK to see the queries and writes the live port makes. */
const sdk = vi.hoisted(() => ({
  listeners: [] as Array<{ query: unknown; options: unknown; next: (snapshot: unknown) => void }>,
  batches: [] as Array<Array<{ path: string; data: Record<string, unknown>; options?: { mergeFields?: Array<{ segments: string[] }> } }>>,
}));

vi.mock("@/lib/firebase", () => ({ db: { fake: true } }));
vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join("/") }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join("/") }),
  query: (source: { path: string }, ...constraints: unknown[]) => ({ path: source.path, constraints }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  deleteField: () => "<delete>",
  FieldPath: class {
    segments: string[];
    constructor(...segments: string[]) {
      this.segments = segments;
    }
  },
  onSnapshot: (query: unknown, options: unknown, next: (snapshot: unknown) => void) => {
    sdk.listeners.push({ query, options, next });
    return () => undefined;
  },
  writeBatch: () => {
    const operations: (typeof sdk.batches)[number] = [];
    return {
      set: (ref: { path: string }, data: Record<string, unknown>, options?: { mergeFields?: Array<{ segments: string[] }> }) =>
        operations.push({ path: ref.path, data, options }),
      commit: async () => {
        sdk.batches.push(operations);
      },
    };
  },
  waitForPendingWrites: async () => undefined,
}));

import type { Firestore } from "firebase/firestore";
import { createFirestoreLivePort, liveWriteData } from "./liveRepository";

const db = { fake: true } as unknown as Firestore;

describe("live Firestore port", () => {
  it("listens to the active round only, with metadata so queued writes are visible", () => {
    const port = createFirestoreLivePort(db, "tourn-1");
    port.subscribe({ collection: "ballots", roundId: "r2" }, { next: () => undefined, error: () => undefined });
    port.subscribe({ collection: "teams" }, { next: () => undefined, error: () => undefined });
    expect(sdk.listeners[0].query).toEqual({
      path: "tournaments/tourn-1/ballots",
      constraints: [{ field: "roundId", op: "==", value: "r2" }],
    });
    expect(sdk.listeners[0].options).toEqual({ includeMetadataChanges: true });
    expect(sdk.listeners[1].query).toEqual({ path: "tournaments/tourn-1/teams" });
  });

  it("reports changes without the cloud-only participant index, and which records are queued", () => {
    const port = createFirestoreLivePort(db, "tourn-1");
    const next = vi.fn();
    port.subscribe({ collection: "debates", roundId: "r1" }, { next, error: () => undefined });
    const document = (id: string, pending: boolean) => ({
      id,
      data: () => ({ id, roundId: "r1", participantIds: ["t1"] }),
      metadata: { hasPendingWrites: pending },
    });
    sdk.listeners[sdk.listeners.length - 1].next({
      docChanges: () => [{ type: "modified", doc: document("d1", true) }],
      docs: [document("d1", true), document("d2", false)],
      metadata: { fromCache: true },
    });
    expect(next).toHaveBeenCalledWith({
      changes: [{ type: "modified", record: { id: "d1", roundId: "r1" } }],
      fromCache: true,
      pendingIds: ["d1"],
    });
  });

  it("writes a patch as merge fields only, so other fields and other map keys stay as they are", async () => {
    const port = createFirestoreLivePort(db, "tourn-1");
    await port.commit([{
      kind: "patch",
      collection: "teams",
      id: "t1",
      record: { id: "t1" },
      fields: [
        { path: ["roundAvailability", "r2"], value: true },
        { path: ["note"], delete: true },
      ],
      syncVersion: 4,
    }]);
    const [operation] = sdk.batches[sdk.batches.length - 1];
    expect(operation.path).toBe("tournaments/tourn-1/teams/t1");
    expect(operation.data).toEqual({ roundAvailability: { r2: true }, note: "<delete>", syncVersion: 4 });
    expect(operation.options?.mergeFields?.map((field) => field.segments)).toEqual([
      ["roundAvailability", "r2"],
      ["note"],
      ["syncVersion"],
    ]);
  });

  it("keeps a debate's participant index in step with its teams and panel", () => {
    const debate = {
      id: "d1",
      teams: { AFF: { teamId: "t1" }, NEG: { teamId: "t2" } },
      adjudicators: { chairId: "a1", panellistIds: ["a2"], traineeIds: [] },
    };
    const set = liveWriteData({ kind: "set", collection: "debates", id: "d1", record: debate, syncVersion: 1 });
    expect(set.mergeFields).toBeUndefined();
    expect(set.data).toMatchObject({ id: "d1", syncVersion: 1, participantIds: ["a1", "a2", "t1", "t2"] });
    const patch = liveWriteData({
      kind: "patch",
      collection: "debates",
      id: "d1",
      record: debate,
      fields: [{ path: ["adjudicators"], value: debate.adjudicators }],
      syncVersion: 2,
    });
    expect(patch.data.participantIds).toEqual(["a1", "a2", "t1", "t2"]);
    expect(patch.mergeFields?.map((field) => (field as unknown as { segments: string[] }).segments)).toContainEqual(["participantIds"]);
  });

  it("hands every batch to the SDK before awaiting any, so offline writes are all queued", async () => {
    const port = createFirestoreLivePort(db, "tourn-1");
    const before = sdk.batches.length;
    const writes = Array.from({ length: 450 }, (_, index) => ({
      kind: "set" as const,
      collection: "teams" as const,
      id: `t${index}`,
      record: { id: `t${index}` },
      syncVersion: 1,
    }));
    await port.commit(writes);
    expect(sdk.batches.slice(before).map((batch) => batch.length)).toEqual([400, 50]);
  });
});

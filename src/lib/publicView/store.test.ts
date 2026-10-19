import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: (fn: () => unknown) => fn,
}));
vi.mock("@/lib/firebaseAdmin", () => ({
  getAdminFirestore: () => {
    throw new Error("Tests pass a fake Firestore explicitly.");
  },
}));

import { publishPublicView, PUBLIC_VIEWS_COLLECTION } from "@/lib/publicView/store";
import { canSkipPublish, publicSourceToken } from "@/lib/publicView/snapshot";

type Data = Record<string, unknown>;

/**
 * The subset of the Admin Firestore API `publishPublicView` uses, over an in-memory map of
 * document paths. Aggregations are computed from the spec's keys (count, versionSum,
 * ballotVersionSum), matching `readPublicSourceStats`.
 */
class FakeFirestore {
  docs = new Map<string, Data>();
  reads = 0;

  collection(path: string) {
    return new FakeCollection(this, path);
  }
  batch() {
    const operations: Array<() => void> = [];
    return {
      set: (ref: FakeDocument, data: Data) => operations.push(() => this.docs.set(ref.path, { ...data })),
      delete: (ref: FakeDocument) => operations.push(() => this.docs.delete(ref.path)),
      commit: async () => operations.forEach((operation) => operation()),
    };
  }
  async recursiveDelete(ref: FakeDocument) {
    for (const path of [...this.docs.keys()]) {
      if (path === ref.path || path.startsWith(`${ref.path}/`)) this.docs.delete(path);
    }
  }
}

class FakeDocument {
  constructor(readonly store: FakeFirestore, readonly path: string) {}
  get id() {
    return this.path.split("/").pop()!;
  }
  get ref() {
    return this;
  }
  collection(name: string) {
    return new FakeCollection(this.store, `${this.path}/${name}`);
  }
  async get() {
    this.store.reads += 1;
    const data = this.store.docs.get(this.path);
    return { exists: data !== undefined, id: this.id, ref: this, data: () => data };
  }
  async set(data: Data) {
    this.store.docs.set(this.path, { ...data });
  }
}

class FakeCollection {
  constructor(
    readonly store: FakeFirestore,
    readonly path: string,
    readonly filter?: { field: string; value: unknown }
  ) {}
  doc(id: string) {
    return new FakeDocument(this.store, `${this.path}/${id}`);
  }
  private matching() {
    return [...this.store.docs.entries()]
      .filter(([path]) => path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes("/"))
      .filter(([, data]) => !this.filter || data[this.filter.field] === this.filter.value)
      .map(([path]) => new FakeDocument(this.store, path));
  }
  where(field: string, _op: "==", value: unknown) {
    return new FakeCollection(this.store, this.path, { field, value });
  }
  async get() {
    const documents = this.matching();
    this.store.reads += Math.max(1, documents.length);
    return {
      docs: documents.map((document) => ({
        id: document.id,
        ref: document,
        data: () => this.store.docs.get(document.path)!,
      })),
    };
  }
  aggregate(spec: Record<string, unknown>) {
    return {
      get: async () => {
        this.store.reads += 1;
        const records = this.matching().map((document) => this.store.docs.get(document.path)!);
        const sum = (field: string) => records.reduce((total, record) => total + (Number(record[field]) || 0), 0);
        const data: Record<string, number> = {};
        if ("count" in spec) data.count = records.length;
        if ("versionSum" in spec) data.versionSum = sum("syncVersion");
        if ("ballotVersionSum" in spec) data.ballotVersionSum = sum("version");
        return { data: () => data };
      },
    };
  }
}

const TOURNAMENT_ID = "t1";

function seed(store: FakeFirestore) {
  store.docs.set(`tournaments/${TOURNAMENT_ID}`, {
    name: "Test Open",
    slug: "test-open",
    format: "bp",
    ownerId: "owner",
    admins: { owner: true },
    preferences: { publicDraw: true, publicResults: true },
    syncVersion: 1,
    updatedAt: "2026-10-18T10:00:00.000Z",
  });
  store.docs.set(`tournaments/${TOURNAMENT_ID}/teams/team-a`, { name: "Alpha", speakers: [], syncVersion: 1 });
}

const publish = (store: FakeFirestore, clientFingerprint = "abc123") =>
  publishPublicView({ tournamentId: TOURNAMENT_ID, clientFingerprint, firestore: store as unknown as Firestore });

describe("publishPublicView unchanged-skip", () => {
  let store: FakeFirestore;
  beforeEach(() => {
    store = new FakeFirestore();
    seed(store);
  });

  it("stores the cloud source token with the view and skips an identical republish", async () => {
    expect((await publish(store)).status).toBe("published");
    const root = store.docs.get(`${PUBLIC_VIEWS_COLLECTION}/test-open`)!;
    expect(typeof root.sourceToken).toBe("string");
    expect((await publish(store)).status).toBe("unchanged");
  });

  it("publishes changes another device uploaded even when this device's fingerprint is unchanged", async () => {
    await publish(store);
    // Another device renames the team (the repository bumps syncVersion on every write).
    store.docs.set(`tournaments/${TOURNAMENT_ID}/teams/team-a`, { name: "Alpha Prime", speakers: [], syncVersion: 2 });
    expect((await publish(store)).status).toBe("published");
  });

  it("publishes records another device added", async () => {
    await publish(store);
    store.docs.set(`tournaments/${TOURNAMENT_ID}/teams/team-b`, { name: "Beta", speakers: [], syncVersion: 1 });
    expect((await publish(store)).status).toBe("published");
  });

  it("publishes private-portal ballot resubmissions, which bump the ballot version", async () => {
    store.docs.set(`tournaments/${TOURNAMENT_ID}/ballots/b1`, { debateId: "d1", version: 1 });
    await publish(store);
    store.docs.set(`tournaments/${TOURNAMENT_ID}/ballots/b1`, { debateId: "d1", version: 2 });
    expect((await publish(store)).status).toBe("published");
  });

  it("ignores the updatedAt stamp an upload rewrites without other changes", async () => {
    await publish(store);
    const tournament = store.docs.get(`tournaments/${TOURNAMENT_ID}`)!;
    store.docs.set(`tournaments/${TOURNAMENT_ID}`, { ...tournament, updatedAt: "2026-10-19T10:00:00.000Z" });
    expect((await publish(store)).status).toBe("unchanged");
  });

  it("rebuilds when the publishing device's fingerprint changed", async () => {
    await publish(store);
    expect((await publish(store, "def456")).status).toBe("published");
  });

  it("rebuilds a view published before source tokens existed", async () => {
    await publish(store);
    const root = store.docs.get(`${PUBLIC_VIEWS_COLLECTION}/test-open`)!;
    const { sourceToken: _sourceToken, ...legacyRoot } = root;
    store.docs.set(`${PUBLIC_VIEWS_COLLECTION}/test-open`, legacyRoot);
    expect((await publish(store)).status).toBe("published");
  });
});

describe("canSkipPublish", () => {
  const token = publicSourceToken({ slug: "x" }, { teams: { count: 1, versionSum: 1 } });
  it("needs both the client fingerprint and the source token to match", () => {
    const previous = { clientFingerprint: "f", sourceToken: token };
    expect(canSkipPublish(previous, { clientFingerprint: "f", sourceToken: token })).toBe(true);
    expect(canSkipPublish(previous, { clientFingerprint: "g", sourceToken: token })).toBe(false);
    expect(canSkipPublish(previous, { clientFingerprint: "f", sourceToken: "other" })).toBe(false);
    expect(canSkipPublish(previous, { sourceToken: token })).toBe(false);
    expect(canSkipPublish(previous, { clientFingerprint: "f", sourceToken: token, force: true })).toBe(false);
    expect(canSkipPublish(null, { clientFingerprint: "f", sourceToken: token })).toBe(false);
  });

  it("derives the token from the tournament without updatedAt", () => {
    expect(publicSourceToken({ slug: "x", updatedAt: "a" }, {})).toBe(publicSourceToken({ slug: "x", updatedAt: "b" }, {}));
    expect(publicSourceToken({ slug: "x" }, {})).not.toBe(publicSourceToken({ slug: "y" }, {}));
  });
});

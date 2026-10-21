import { describe, expect, it, vi } from "vitest";
import {
  LocalStore,
  createMemoryBackend,
  createStorageBackend,
  migrateFromStorage,
  readLocalTournamentMetas,
  tournamentKeyPrefix,
} from "./localStore";

class MemoryStorage implements Storage {
  readonly data = new Map<string, string>();
  failOn?: string;
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failOn && key.endsWith(this.failOn)) throw new Error("QuotaExceededError");
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

describe("LocalStore", () => {
  it("reads a loaded tournament synchronously and only that tournament", async () => {
    const backend = createMemoryBackend({
      crabbytab_t_spring_teams: "[1]",
      crabbytab_t_springfield_teams: "[2]",
    });
    const store = new LocalStore(Promise.resolve(backend));
    await store.loadPrefix(tournamentKeyPrefix("spring"));
    expect(store.getItem("crabbytab_t_spring_teams")).toBe("[1]");
    expect(store.getItem("crabbytab_t_spring_rounds")).toBeNull();
    expect(() => store.getItem("crabbytab_t_springfield_teams")).toThrow("before it finished loading");
  });

  it("coalesces writes into one backend transaction", async () => {
    const backend = createMemoryBackend();
    const store = new LocalStore(Promise.resolve(backend));
    await store.loadPrefix("crabbytab_t_a_");
    store.setItem("crabbytab_t_a_teams", "[1]");
    store.setItem("crabbytab_t_a_teams", "[1,2]");
    store.setItem("crabbytab_t_a_rounds", "[]");
    store.removeItem("crabbytab_t_a_rounds");
    expect(store.getItem("crabbytab_t_a_teams")).toBe("[1,2]");
    await store.flush();
    expect(backend.writes).toBe(1);
    expect(Object.fromEntries(backend.data)).toEqual({ crabbytab_t_a_teams: "[1,2]" });
  });

  it("flushes on its own shortly after a write", async () => {
    vi.useFakeTimers();
    try {
      const backend = createMemoryBackend();
      const store = new LocalStore(Promise.resolve(backend));
      store.setItem("crabbytab_t_a_meta", "{}");
      await vi.runAllTimersAsync();
      expect(backend.data.get("crabbytab_t_a_meta")).toBe("{}");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a write made while the tournament was still loading", async () => {
    const backend = createMemoryBackend({ crabbytab_t_a_teams: "old" });
    const store = new LocalStore(Promise.resolve(backend));
    const loading = store.loadPrefix("crabbytab_t_a_");
    store.setItem("crabbytab_t_a_teams", "new");
    await loading;
    expect(store.getItem("crabbytab_t_a_teams")).toBe("new");
  });

  it("reports a failed save (e.g. quota) and retries it with the next write", async () => {
    const backend = createMemoryBackend();
    const store = new LocalStore(Promise.resolve(backend));
    const errors: Array<[string[], unknown]> = [];
    store.onWriteError((keys, error) => errors.push([keys, error]));
    backend.failWrites = new DOMException("The quota has been exceeded.", "QuotaExceededError");
    store.setItem("crabbytab_t_a_ballots", "[big]");
    await store.flush();
    expect(errors).toHaveLength(1);
    expect(errors[0][0]).toEqual(["crabbytab_t_a_ballots"]);
    expect((errors[0][1] as DOMException).name).toBe("QuotaExceededError");
    expect(backend.data.size).toBe(0);

    backend.failWrites = null;
    store.setItem("crabbytab_t_a_teams", "[]");
    await store.flush();
    expect(Object.fromEntries(backend.data)).toEqual({ crabbytab_t_a_ballots: "[big]", crabbytab_t_a_teams: "[]" });
  });

  it("writeAll is all-or-nothing and rejects on failure", async () => {
    const backend = createMemoryBackend();
    const store = new LocalStore(Promise.resolve(backend));
    backend.failWrites = new Error("disk full");
    await expect(store.writeAll([["crabbytab_t_a_meta", "{}"], ["crabbytab_t_a_teams", "[]"]])).rejects.toThrow("disk full");
    expect(backend.data.size).toBe(0);
    expect(await store.read("crabbytab_t_a_meta")).toBeNull();
  });

  it("removes one tournament without touching a slug that extends it", async () => {
    const backend = createMemoryBackend({
      crabbytab_t_spring_meta: "{}",
      crabbytab_t_spring_teams: "[]",
      crabbytab_t_springfield_meta: "{}",
    });
    const store = new LocalStore(Promise.resolve(backend));
    await store.removePrefix(tournamentKeyPrefix("spring"));
    expect([...backend.data.keys()]).toEqual(["crabbytab_t_springfield_meta"]);
  });

  it("lists tournament summaries on the device", async () => {
    const store = new LocalStore(Promise.resolve(createMemoryBackend({
      crabbytab_t_a_meta: '{"slug":"a"}',
      crabbytab_t_a_teams: "[]",
      crabbytab_t_b_meta: '{"slug":"b"}',
    })));
    store.setItem("crabbytab_t_c_meta", '{"slug":"c"}');
    expect((await readLocalTournamentMetas(store)).map((entry) => entry.raw)).toEqual([
      '{"slug":"a"}',
      '{"slug":"b"}',
      '{"slug":"c"}',
    ]);
  });
});

describe("migrating from localStorage", () => {
  it("copies tournament keys once, then clears them from localStorage", async () => {
    const storage = new MemoryStorage();
    storage.setItem("crabbytab_t_a_teams", "[1]");
    storage.setItem("crabbytab_t_a_meta", "{}");
    storage.setItem("crabbytab_theme", "dark");
    const backend = createMemoryBackend();
    expect(await migrateFromStorage(backend, storage)).toBe(2);
    expect(Object.fromEntries(backend.data)).toEqual({ crabbytab_t_a_teams: "[1]", crabbytab_t_a_meta: "{}" });
    expect([...storage.data.keys()]).toEqual(["crabbytab_theme"]);
    expect(await migrateFromStorage(backend, storage)).toBe(0);
  });

  it("never overwrites data already in IndexedDB", async () => {
    const storage = new MemoryStorage();
    storage.setItem("crabbytab_t_a_teams", "stale");
    const backend = createMemoryBackend({ crabbytab_t_a_teams: "current" });
    await migrateFromStorage(backend, storage);
    expect(backend.data.get("crabbytab_t_a_teams")).toBe("current");
    expect(storage.length).toBe(0);
  });

  it("keeps the localStorage copy when the copy fails", async () => {
    const storage = new MemoryStorage();
    storage.setItem("crabbytab_t_a_teams", "[1]");
    const backend = createMemoryBackend();
    backend.failWrites = new Error("blocked");
    await expect(migrateFromStorage(backend, storage)).rejects.toThrow("blocked");
    expect(storage.getItem("crabbytab_t_a_teams")).toBe("[1]");
  });
});

describe("localStorage fallback backend", () => {
  it("rolls back a partial write that hits the quota", async () => {
    const storage = new MemoryStorage();
    storage.setItem("crabbytab_t_a_teams", "old");
    storage.failOn = "_ballots";
    const backend = createStorageBackend(storage);
    await expect(backend.write([["crabbytab_t_a_teams", "new"], ["crabbytab_t_a_ballots", "[]"]], [])).rejects.toThrow("Quota");
    expect(Object.fromEntries(storage.data)).toEqual({ crabbytab_t_a_teams: "old" });
  });
});

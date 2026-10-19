/**
 * The device's working copy of each tournament, kept in IndexedDB.
 *
 * localStorage holds ~5 MB per origin, and a 1000-team tournament's working copy is larger than
 * that before feedback, audit events and the sync baseline. IndexedDB is bounded only by the
 * browser's disk quota. Values stay JSON strings under the same `crabbytab_t_{slug}_{suffix}` keys,
 * so the working-copy format (and backups) are unchanged.
 *
 * TournamentContext reads its working copy synchronously all over the place, so a tournament's keys
 * are loaded into memory once (`loadPrefix`) and then read and written synchronously; writes are
 * coalesced and flushed to IndexedDB in one transaction a moment later. A failed flush (e.g. quota
 * exceeded) is reported to `onWriteError` listeners and retried on the next write.
 *
 * Trade-offs: a write is durable a few milliseconds after `setItem` rather than immediately, and
 * another tab's writes to the same tournament are seen after a reload (localStorage was shared
 * live, but two tabs editing one tournament already overwrote each other's state).
 */

export interface KeyValueBackend {
  /** Every entry whose key starts with `prefix` ("" = all). */
  entries(prefix: string): Promise<Array<[string, string]>>;
  keys(prefix: string): Promise<string[]>;
  /** Applies all puts and deletes atomically, or none of them. */
  write(puts: Array<[string, string]>, deletes: string[]): Promise<void>;
}

const DATABASE_NAME = "crabbytab";
const STORE_NAME = "kv";
/** Keys that hold tournament working copies; other localStorage keys (theme, language, remembered passcodes) stay there. */
export const LOCAL_TOURNAMENT_KEY_PREFIX = "crabbytab_t_";

const startsWith = (key: string, prefix: string) => prefix === "" || key.startsWith(prefix);

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function prefixRange(prefix: string): IDBKeyRange | undefined {
  // "￿" sorts after every character a key can contain here.
  return prefix ? IDBKeyRange.bound(prefix, `${prefix}￿`) : undefined;
}

export async function createIndexedDbBackend(factory: IDBFactory): Promise<KeyValueBackend> {
  const openRequest = factory.open(DATABASE_NAME, 1);
  openRequest.onupgradeneeded = () => {
    if (!openRequest.result.objectStoreNames.contains(STORE_NAME)) openRequest.result.createObjectStore(STORE_NAME);
  };
  const database = await requestResult(openRequest);

  return {
    async entries(prefix) {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const [keys, values] = await Promise.all([
        requestResult(store.getAllKeys(prefixRange(prefix))),
        requestResult(store.getAll(prefixRange(prefix))),
      ]);
      return keys.map((key, index) => [String(key), String(values[index])] as [string, string]);
    },
    async keys(prefix) {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const keys = await requestResult(transaction.objectStore(STORE_NAME).getAllKeys(prefixRange(prefix)));
      return keys.map(String);
    },
    write(puts, deletes) {
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        for (const key of deletes) store.delete(key);
        for (const [key, value] of puts) store.put(value, key);
        transaction.oncomplete = () => resolve();
        // Quota errors surface as an aborted transaction.
        transaction.onabort = () => reject(transaction.error ?? new Error("Saving on this device was aborted."));
        transaction.onerror = () => reject(transaction.error ?? new Error("Saving on this device failed."));
      });
    },
  };
}

/** Fallback when IndexedDB is unavailable (some private-browsing modes), keeping the old ~5 MB limit. */
export function createStorageBackend(storage: Storage): KeyValueBackend {
  const keys = (prefix: string) => {
    const found: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key !== null && startsWith(key, prefix)) found.push(key);
    }
    return found;
  };
  return {
    async entries(prefix) {
      return keys(prefix).flatMap((key) => {
        const value = storage.getItem(key);
        return value === null ? [] : [[key, value] as [string, string]];
      });
    },
    async keys(prefix) {
      return keys(prefix);
    },
    async write(puts, deletes) {
      const previous = new Map(puts.map(([key]) => [key, storage.getItem(key)]));
      try {
        for (const [key, value] of puts) storage.setItem(key, value);
      } catch (error) {
        for (const [key, value] of previous) {
          if (value === null) storage.removeItem(key);
          else storage.setItem(key, value);
        }
        throw error;
      }
      for (const key of deletes) storage.removeItem(key);
    },
  };
}

/** In-memory backend for tests; `failWrites` makes every write reject (to simulate a full disk). */
export function createMemoryBackend(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const backend = {
    data,
    failWrites: null as Error | null,
    writes: 0,
    async entries(prefix: string) {
      return [...data].filter(([key]) => startsWith(key, prefix)).sort(([a], [b]) => a.localeCompare(b));
    },
    async keys(prefix: string) {
      return [...data.keys()].filter((key) => startsWith(key, prefix)).sort();
    },
    async write(puts: Array<[string, string]>, deletes: string[]) {
      backend.writes += 1;
      if (backend.failWrites) throw backend.failWrites;
      for (const key of deletes) data.delete(key);
      for (const [key, value] of puts) data.set(key, value);
    },
  };
  return backend satisfies KeyValueBackend;
}

/**
 * Moves tournament keys from localStorage into the backend, once. A key already in the backend
 * wins (it was written after an earlier migration); the localStorage copy is then dropped either way.
 */
export async function migrateFromStorage(backend: KeyValueBackend, storage: Storage): Promise<number> {
  const legacy: Array<[string, string]> = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key === null || !key.startsWith(LOCAL_TOURNAMENT_KEY_PREFIX)) continue;
    const value = storage.getItem(key);
    if (value !== null) legacy.push([key, value]);
  }
  if (legacy.length === 0) return 0;
  const existing = new Set(await backend.keys(LOCAL_TOURNAMENT_KEY_PREFIX));
  const toCopy = legacy.filter(([key]) => !existing.has(key));
  // Copy first; localStorage is only cleared once the copy has committed.
  if (toCopy.length > 0) await backend.write(toCopy, []);
  for (const [key] of legacy) storage.removeItem(key);
  return toCopy.length;
}

export type WriteErrorListener = (keys: string[], error: unknown) => void;

export class LocalStore {
  private readonly cache = new Map<string, string>();
  private readonly loadedPrefixes = new Set<string>();
  private readonly loading = new Map<string, Promise<void>>();
  /** key -> value to write, or null to delete. */
  private pending = new Map<string, string | null>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<WriteErrorListener>();

  constructor(private readonly backend: Promise<KeyValueBackend>) {}

  /** Loads every key under `prefix` into memory so it can be read synchronously. Idempotent. */
  loadPrefix(prefix: string): Promise<void> {
    if (this.loadedPrefixes.has(prefix)) return Promise.resolve();
    const inFlight = this.loading.get(prefix);
    if (inFlight) return inFlight;
    const load = (async () => {
      const entries = await (await this.backend).entries(prefix);
      for (const [key, value] of entries) {
        // A write made while loading is newer than what was on disk.
        if (!this.pending.has(key)) this.cache.set(key, value);
      }
      this.loadedPrefixes.add(prefix);
    })().finally(() => this.loading.delete(prefix));
    this.loading.set(prefix, load);
    return load;
  }

  private assertLoaded(key: string) {
    for (const prefix of this.loadedPrefixes) if (key.startsWith(prefix)) return;
    throw new Error(`Local data for "${key}" was read before it finished loading.`);
  }

  getItem(key: string): string | null {
    this.assertLoaded(key);
    return this.cache.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.cache.set(key, value);
    this.pending.set(key, value);
    this.scheduleFlush();
  }

  removeItem(key: string): void {
    this.cache.delete(key);
    this.pending.set(key, null);
    this.scheduleFlush();
  }

  onWriteError(listener: WriteErrorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private scheduleFlush() {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, 0);
  }

  /** Writes every pending change. Resolves once they are on disk; never rejects (errors go to listeners). */
  flush(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushing = this.flushing.then(async () => {
      if (this.pending.size === 0) return;
      const batch = this.pending;
      this.pending = new Map();
      const puts: Array<[string, string]> = [];
      const deletes: string[] = [];
      for (const [key, value] of batch) {
        if (value === null) deletes.push(key);
        else puts.push([key, value]);
      }
      try {
        await (await this.backend).write(puts, deletes);
      } catch (error) {
        // Keep the failed changes for the next attempt unless they were superseded meanwhile.
        for (const [key, value] of batch) if (!this.pending.has(key)) this.pending.set(key, value);
        for (const listener of this.listeners) listener([...batch.keys()], error);
      }
    });
    return this.flushing;
  }

  /** Reads one key from disk (no `loadPrefix` needed). */
  async read(key: string): Promise<string | null> {
    if (this.pending.has(key)) return this.pending.get(key) ?? null;
    if (this.cache.has(key)) return this.cache.get(key)!;
    const entries = await (await this.backend).entries(key);
    return entries.find(([entryKey]) => entryKey === key)?.[1] ?? null;
  }

  async keys(prefix: string): Promise<string[]> {
    await this.flush();
    return (await this.backend).keys(prefix);
  }

  /**
   * Writes the entries now, all or nothing, and rejects if that fails. For one-off writes
   * (creating or importing a tournament) whose caller must know the outcome.
   */
  async writeAll(entries: Array<[string, string]>): Promise<void> {
    await this.flush();
    await (await this.backend).write(entries, []);
    for (const [key, value] of entries) this.cache.set(key, value);
  }

  /** Deletes every key under `prefix`, on disk and in memory. */
  async removePrefix(prefix: string): Promise<void> {
    await this.flush();
    const keys = await (await this.backend).keys(prefix);
    await (await this.backend).write([], keys);
    for (const key of [...this.cache.keys()]) if (key.startsWith(prefix)) this.cache.delete(key);
    this.loadedPrefixes.delete(prefix);
  }
}

/** `crabbytab_t_{slug}_`: every working-copy key of one tournament (and no other slug's). */
export function tournamentKeyPrefix(slug: string): string {
  return `${LOCAL_TOURNAMENT_KEY_PREFIX}${slug}_`;
}

async function openBrowserBackend(): Promise<KeyValueBackend> {
  let backend: KeyValueBackend;
  try {
    if (typeof indexedDB === "undefined") throw new Error("IndexedDB is unavailable.");
    backend = await createIndexedDbBackend(indexedDB);
  } catch (error) {
    console.warn("IndexedDB is unavailable; keeping tournament data in localStorage:", error);
    return createStorageBackend(window.localStorage);
  }
  try {
    await migrateFromStorage(backend, window.localStorage);
  } catch (error) {
    // The localStorage copy is kept, so the next load retries.
    console.error("Could not move tournament data from localStorage to IndexedDB:", error);
  }
  return backend;
}

let browserStore: LocalStore | null = null;

/** The browser's store (IndexedDB, migrating old localStorage data on first use). Client-only. */
export function getLocalStore(): LocalStore {
  if (typeof window === "undefined") throw new Error("Tournament data on this device is only available in the browser.");
  browserStore ??= new LocalStore(openBrowserBackend());
  return browserStore;
}

/** Summaries (the `_meta` record) of every tournament saved on this device. */
export async function readLocalTournamentMetas(store: LocalStore): Promise<Array<{ key: string; raw: string }>> {
  const keys = (await store.keys(LOCAL_TOURNAMENT_KEY_PREFIX)).filter((key) => key.endsWith("_meta"));
  const values = await Promise.all(keys.map(async (key) => ({ key, raw: await store.read(key) })));
  return values.flatMap(({ key, raw }) => (raw === null ? [] : [{ key, raw }]));
}

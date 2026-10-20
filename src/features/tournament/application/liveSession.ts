import {
  coalesceLiveWrites,
  liveListenerScopes,
  liveScopeKey,
  liveWriteKey,
  type LiveCollectionName,
  type LiveRecordChange,
  type LiveScope,
  type LiveSyncStatus,
  type LiveWrite,
} from "./liveSync";

/** One listener event: the changed records, and whether the cloud has confirmed this state. */
export interface LiveSnapshot {
  changes: LiveRecordChange[];
  /** Served from the device's cache because the cloud is unreachable. */
  fromCache: boolean;
  /** Records in this listener that hold writes the cloud has not acknowledged yet. */
  pendingIds: string[];
}

/** What a live session needs from Firestore (see infrastructure/liveRepository.ts). */
export interface LivePort {
  subscribe(
    scope: LiveScope,
    handlers: { next(snapshot: LiveSnapshot): void; error(error: unknown): void }
  ): () => void;
  /** Commits writes as atomic batches. Offline, the promise settles once the cloud has them. */
  commit(writes: LiveWrite[]): Promise<void>;
  /** Resolves once every write made so far is acknowledged by the cloud. */
  waitForPendingWrites(): Promise<void>;
}

export interface LiveSessionHost {
  applySnapshot(collection: LiveCollectionName, snapshot: LiveSnapshot): void;
  /** The cloud refused these writes (not offline: offline writes wait). */
  onWritesRejected(writes: LiveWrite[], error: unknown): void;
  onStatus(status: LiveSyncStatus): void;
}

export interface LiveSession {
  /**
   * Listens to the scopes for this round and the rounds concurrent with it (teams and
   * adjudicators always).
   */
  setActiveRound(roundId: string | null | undefined, concurrentRoundIds?: readonly string[]): void;
  /** Queues writes; writes queued in the same tick commit together. */
  write(writes: LiveWrite[]): void;
  /** Resolves once the cloud has every write queued so far (call while online). */
  flush(): Promise<void>;
  setOnline(online: boolean): void;
  dispose(): void;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "permission-denied") {
    return "the cloud refused access for this account";
  }
  return error instanceof Error ? error.message : String(error);
}

export function createLiveSession(port: LivePort, host: LiveSessionHost, options: { online?: boolean } = {}): LiveSession {
  const listeners = new Map<string, { scope: LiveScope; unsubscribe: () => void }>();
  const pendingByScope = new Map<string, Set<string>>();
  const cacheOnlyScopes = new Set<string>();
  const awaitingFirstSnapshot = new Set<string>();
  const inFlight = new Map<string, number>();
  let queue: LiveWrite[] = [];
  let flushScheduled = false;
  let online = options.online ?? true;
  let error: string | undefined;
  let disposed = false;
  let lastStatus = "";

  const queuedIds = () => {
    const ids = new Set(inFlight.keys());
    for (const write of queue) ids.add(liveWriteKey(write));
    for (const [key, pending] of pendingByScope) {
      const collection = listeners.get(key)?.scope.collection;
      if (!collection) continue;
      for (const id of pending) ids.add(`${collection}/${id}`);
    }
    return ids;
  };

  const report = () => {
    if (disposed) return;
    const queuedWrites = queuedIds().size;
    const mode: LiveSyncStatus["mode"] = error
      ? "error"
      : !online || (listeners.size > 0 && cacheOnlyScopes.size > 0)
        ? "offline"
        : awaitingFirstSnapshot.size > 0
          ? "connecting"
          : "live";
    const status: LiveSyncStatus = error ? { mode, queuedWrites, error } : { mode, queuedWrites };
    const key = JSON.stringify(status);
    if (key === lastStatus) return;
    lastStatus = key;
    host.onStatus(status);
  };

  const subscribe = (scope: LiveScope) => {
    const key = liveScopeKey(scope);
    const entry = { scope, unsubscribe: () => {} };
    listeners.set(key, entry);
    awaitingFirstSnapshot.add(key);
    entry.unsubscribe = port.subscribe(scope, {
      next(snapshot) {
        if (disposed || listeners.get(key) !== entry) return;
        awaitingFirstSnapshot.delete(key);
        if (snapshot.fromCache) cacheOnlyScopes.add(key);
        else cacheOnlyScopes.delete(key);
        pendingByScope.set(key, new Set(snapshot.pendingIds));
        if (snapshot.changes.length > 0) host.applySnapshot(scope.collection, snapshot);
        report();
      },
      error(listenerError) {
        if (disposed || listeners.get(key) !== entry) return;
        // A refused listener (e.g. access revoked) does not retry; the device keeps its copy.
        error = `listening to ${scope.collection} failed: ${errorMessage(listenerError)}`;
        listeners.delete(key);
        awaitingFirstSnapshot.delete(key);
        pendingByScope.delete(key);
        cacheOnlyScopes.delete(key);
        report();
      },
    });
  };

  const stopListening = (key: string) => {
    listeners.get(key)?.unsubscribe();
    listeners.delete(key);
    pendingByScope.delete(key);
    cacheOnlyScopes.delete(key);
    awaitingFirstSnapshot.delete(key);
  };

  const flushQueue = () => {
    flushScheduled = false;
    if (disposed || queue.length === 0) return;
    const writes = coalesceLiveWrites(queue);
    queue = [];
    const keys = writes.map(liveWriteKey);
    for (const key of keys) inFlight.set(key, (inFlight.get(key) || 0) + 1);
    report();
    port.commit(writes).then(
      () => undefined,
      (commitError: unknown) => {
        if (disposed) return;
        error = `a change was not saved to the cloud: ${errorMessage(commitError)}`;
        host.onWritesRejected(writes, commitError);
      }
    ).finally(() => {
      for (const key of keys) {
        const count = (inFlight.get(key) || 1) - 1;
        if (count > 0) inFlight.set(key, count);
        else inFlight.delete(key);
      }
      report();
    });
  };

  return {
    setActiveRound(roundId, concurrentRoundIds) {
      if (disposed) return;
      const wanted = new Map(
        liveListenerScopes(roundId, concurrentRoundIds).map((scope) => [liveScopeKey(scope), scope])
      );
      for (const key of [...listeners.keys()]) if (!wanted.has(key)) stopListening(key);
      for (const [key, scope] of wanted) if (!listeners.has(key)) subscribe(scope);
      report();
    },
    write(writes) {
      if (disposed || writes.length === 0) return;
      queue.push(...writes);
      if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(flushQueue);
      }
      report();
    },
    async flush() {
      flushQueue();
      await port.waitForPendingWrites();
    },
    setOnline(next) {
      online = next;
      report();
    },
    dispose() {
      // Queued writes are committed first: the cloud SDK keeps them (offline too) after this.
      flushQueue();
      for (const key of [...listeners.keys()]) stopListening(key);
      disposed = true;
    },
  };
}

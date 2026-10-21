import {
  MAX_QUERY_LIMIT,
  type ApiCollection,
  type ApiStore,
  type QueryOptions,
  type StoredRecord,
  type TournamentReader,
  type TournamentStore,
  type TournamentTransaction,
} from "./store";

/**
 * In-memory ApiStore for tests and local tooling. Transactions apply their writes only when the
 * function resolves, so a thrown rule violation leaves the data untouched, as in Firestore.
 */
export interface MemoryTournament {
  tournament: StoredRecord;
  collections: Partial<Record<ApiCollection, StoredRecord[]>>;
  apiTokens?: StoredRecord[];
  /** `serverOnly/staffPermissionGroups.groups`. */
  customPermissionGroups?: unknown;
}

export interface MemoryApiStore extends ApiStore {
  readonly tournaments: Map<string, MemoryTournament>;
  /** Number of documents returned by reads, to assert reads stay proportional. */
  readonly reads: { count: number };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function matches(record: StoredRecord, options: QueryOptions): boolean {
  return (options.filters ?? []).every((filter) => {
    const value = record[filter.field];
    return filter.op === "=="
      ? value === filter.value
      : Array.isArray(value) && value.includes(filter.value);
  });
}

export function createMemoryApiStore(initial: MemoryTournament[] = []): MemoryApiStore {
  const tournaments = new Map(initial.map((entry) => [entry.tournament.id, clone(entry)]));
  const reads = { count: 0 };
  const limits = new Map<string, number[]>();

  const tournamentReader = (state: () => MemoryTournament): TournamentReader => ({
    async getTournament() {
      reads.count += 1;
      return clone(state().tournament);
    },
    async get(collection, id) {
      reads.count += 1;
      const record = state().collections[collection]?.find((item) => item.id === id);
      return record ? clone(record) : null;
    },
    async getMany(collection, ids) {
      const records = ids
        .map((id) => state().collections[collection]?.find((item) => item.id === id))
        .filter((record): record is StoredRecord => Boolean(record));
      reads.count += records.length;
      return clone(records);
    },
    async query(collection, options) {
      const records = [...(state().collections[collection] ?? [])]
        .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
        .filter((record) => options.after === undefined || record.id > options.after)
        .filter((record) => matches(record, options))
        .slice(0, Math.min(Math.max(1, options.limit), MAX_QUERY_LIMIT));
      reads.count += Math.max(1, records.length);
      return clone(records);
    },
  });

  const store = (tournamentId: string): TournamentStore => {
    const state = () => {
      const entry = tournaments.get(tournamentId);
      if (!entry) throw new Error(`Unknown tournament ${tournamentId}`);
      return entry;
    };
    return {
      tournamentId,
      ...tournamentReader(state),
      async getCustomPermissionGroups() {
        return clone(state().customPermissionGroups ?? []);
      },
      async transaction(fn) {
        const working = clone(state());
        const transaction: TournamentTransaction = {
          ...tournamentReader(() => working),
          set(collection, id, data) {
            const records = working.collections[collection] ?? [];
            const index = records.findIndex((item) => item.id === id);
            const next = clone({ ...data, id });
            if (index >= 0) records[index] = next;
            else records.push(next);
            working.collections[collection] = records;
          },
          setTournament(data) {
            working.tournament = clone({ ...data, id: tournamentId });
          },
        };
        const result = await fn(transaction);
        tournaments.set(tournamentId, working);
        return result;
      },
    };
  };

  return {
    tournaments,
    reads,
    async findTournamentBySlug(slug) {
      const found = [...tournaments.values()].filter((entry) => entry.tournament.slug === slug);
      return found.length === 1 ? clone(found[0].tournament) : null;
    },
    forTournament: store,
    async findToken(tournamentId, tokenHash) {
      const token = tournaments.get(tournamentId)?.apiTokens?.find((item) => item.tokenHash === tokenHash);
      return token ? clone(token) : null;
    },
    async touchToken(tournamentId, tokenId, at) {
      const token = tournaments.get(tournamentId)?.apiTokens?.find((item) => item.id === tokenId);
      if (token) token.lastUsedAt = at;
    },
    async consumeHourlyRateLimit(key, maxPerHour, now) {
      const windowMs = 60 * 60 * 1000;
      const recent = (limits.get(key) ?? []).filter((timestamp) => timestamp > now - windowMs);
      if (recent.length >= maxPerHour) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
      }
      limits.set(key, [...recent, now]);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

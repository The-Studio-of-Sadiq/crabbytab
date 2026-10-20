import type { CloudCollectionName } from "@/features/tournament/collections";

/**
 * Persistence port of the REST API. The Firestore implementation (firestoreStore.ts) runs in the
 * server routes; the in-memory one (memoryStore.ts) backs the unit tests, so every route can be
 * tested without live Firebase credentials (AGENTS.md §11).
 *
 * Every query is ordered by document id and bounded by `limit`, so list endpoints read one page
 * of documents rather than whole collections.
 */

export type StoredRecord = Record<string, unknown> & { id: string };

/** Tournament sub-collections the API reads or writes. */
export type ApiCollection = CloudCollectionName | "syncConflicts";

export interface QueryFilter {
  field: string;
  op: "==" | "array-contains";
  value: string | number | boolean;
}

export interface QueryOptions {
  filters?: QueryFilter[];
  /** Return documents whose id sorts after this id (cursor pagination). */
  after?: string;
  limit: number;
}

export interface TournamentReader {
  getTournament(): Promise<StoredRecord | null>;
  get(collection: ApiCollection, id: string): Promise<StoredRecord | null>;
  /** Existing documents among `ids`, in the order given. */
  getMany(collection: ApiCollection, ids: string[]): Promise<StoredRecord[]>;
  query(collection: ApiCollection, options: QueryOptions): Promise<StoredRecord[]>;
}

export interface TournamentTransaction extends TournamentReader {
  /** Replaces a document. */
  set(collection: ApiCollection, id: string, data: StoredRecord): void;
  /** Replaces the tournament document. */
  setTournament(data: StoredRecord): void;
}

export interface TournamentStore extends TournamentReader {
  readonly tournamentId: string;
  /**
   * Runs `fn` atomically: reads inside it see one consistent state and the writes are applied
   * together or not at all (Firestore retries the function on contention).
   */
  transaction<T>(fn: (transaction: TournamentTransaction) => Promise<T>): Promise<T>;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface ApiStore {
  findTournamentBySlug(slug: string): Promise<StoredRecord | null>;
  forTournament(tournamentId: string): TournamentStore;
  findToken(tournamentId: string, tokenHash: string): Promise<StoredRecord | null>;
  /** Best effort; a failure must not fail the request. */
  touchToken(tournamentId: string, tokenId: string, at: string): Promise<void>;
  /** Durable (cross-instance) limiter over a one-hour sliding window, used for writes. */
  consumeHourlyRateLimit(key: string, maxPerHour: number, now: number): Promise<RateLimitResult>;
}

export function isActive(record: StoredRecord | null | undefined): record is StoredRecord {
  return Boolean(record) && typeof record?.deletedAt !== "string";
}

export const MAX_QUERY_LIMIT = 500;

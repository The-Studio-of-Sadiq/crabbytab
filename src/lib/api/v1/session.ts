import { randomUUID } from "node:crypto";
import type { CloudCollectionName } from "@/features/tournament/collections";
import { PARTICIPANT_IDS_FIELD, debateParticipantIds, withoutParticipantIds } from "@/lib/privateSync";
import type { AuditCategory, Tournament } from "@/types";
import { ApiError, conflict } from "./errors";
import type { QueryFilter, StoredRecord, TournamentTransaction } from "./store";

/**
 * Runs the tab room's application commands (src/features/tournament/application) on the server.
 *
 * The commands are written against in-memory arrays and `save(records)` repositories, exactly
 * as TournamentContext and the lifecycle test harness use them. A session loads the records a
 * command needs inside one Firestore transaction, hands the command plain arrays, and at the end
 * diffs what the command saved against what was loaded:
 *
 * - a changed or new record is written at the next `syncVersion`, and the version it replaces is
 *   archived in `syncConflicts` (as the data-entry sync route does), so a tab-room device holding
 *   an older copy cannot silently overwrite the API's change and nothing is lost;
 * - a loaded record the command dropped is soft-deleted (`deletedAt`), never hard-deleted;
 * - the command's audit events are appended, attributed to the API token.
 *
 * Everything is committed atomically; if a command throws (a tournament rule, validation), the
 * transaction writes nothing. Records that were not loaded are never touched, so commands may be
 * given a filtered view (e.g. one round's debates) when that is all they read.
 */

type SessionCollection = Exclude<CloudCollectionName, "auditEvents">;

export interface ApiActor {
  tokenId: string;
  tokenName: string;
  requestId: string;
  /**
   * Who the audit log and archived versions name; defaults to the token ("api-token:<id>").
   * A participant writing with their private URL key is "participant:<type>:<id>".
   */
  actorId?: string;
  actorName?: string;
  /** Audit actor type; tokens act as "system", participants as "public". */
  actorType?: "system" | "public";
}

export interface SessionAuditEvent {
  action: string;
  category: AuditCategory;
  summary: string;
  roundId?: string;
  debateId?: string;
  details?: Record<string, unknown>;
}

/** Firestore allows 500 writes per commit; each change can need two (record + archived version). */
export const MAX_SESSION_WRITES = 450;

function canonical(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .filter(([, nested]) => nested !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, normalize(nested)])
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

/** Content of a record without the cloud's stamps, for change detection. */
function content(record: StoredRecord): string {
  const { syncVersion: _version, updatedAt: _updatedAt, ...rest } = withoutParticipantIds(record);
  return canonical(rest);
}

/** Firestore rejects `undefined`; drop it recursively. */
export function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutUndefined) as unknown as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .map(([key, nested]) => [key, withoutUndefined(nested)])
    ) as T;
  }
  return value;
}

export interface SessionCommitResult {
  written: Record<string, string[]>;
  deleted: Record<string, string[]>;
  auditEventIds: string[];
}

export class ApiCommandSession {
  /** Every loaded record as it was read (including soft-deleted ones), by collection and id. */
  private readonly originals = new Map<SessionCollection, Map<string, StoredRecord>>();
  /** The working view: active records, as the commands last saved them. */
  private readonly current = new Map<SessionCollection, Map<string, StoredRecord>>();
  private readonly fullyLoaded = new Set<SessionCollection>();
  private readonly auditEvents: SessionAuditEvent[] = [];
  private tournamentRecord: Tournament;
  private readonly originalTournament: string;

  constructor(
    private readonly transaction: TournamentTransaction,
    tournament: Tournament,
    private readonly actor: ApiActor,
    private readonly now: Date
  ) {
    this.tournamentRecord = tournament;
    this.originalTournament = canonical(tournament);
  }

  private get actorId(): string {
    return this.actor.actorId ?? `api-token:${this.actor.tokenId}`;
  }

  get tournament(): Tournament {
    return this.tournamentRecord;
  }

  setTournament(tournament: Tournament): void {
    this.tournamentRecord = tournament;
  }

  private bucket(collection: SessionCollection) {
    let originals = this.originals.get(collection);
    let current = this.current.get(collection);
    if (!originals || !current) {
      originals = new Map();
      current = new Map();
      this.originals.set(collection, originals);
      this.current.set(collection, current);
    }
    return { originals, current };
  }

  private absorb(collection: SessionCollection, records: StoredRecord[]): void {
    const { originals, current } = this.bucket(collection);
    for (const record of records) {
      if (originals.has(record.id)) continue;
      const clean = withoutParticipantIds(record);
      originals.set(record.id, clean);
      if (typeof clean.deletedAt !== "string") current.set(record.id, structuredClone(clean));
    }
  }

  /** Loads a whole collection (in pages) and returns its active records. */
  async all<T>(collection: SessionCollection): Promise<T[]> {
    if (!this.fullyLoaded.has(collection)) {
      let after: string | undefined;
      for (;;) {
        const page = await this.transaction.query(collection, { after, limit: 500 });
        this.absorb(collection, page);
        if (page.length < 500) break;
        after = page[page.length - 1].id;
      }
      this.fullyLoaded.add(collection);
    }
    return this.view<T>(collection);
  }

  /** Loads the records matching `filters` and returns the active ones among them. */
  async where<T>(collection: SessionCollection, filters: QueryFilter[]): Promise<T[]> {
    if (!this.fullyLoaded.has(collection)) {
      let after: string | undefined;
      for (;;) {
        const page = await this.transaction.query(collection, { filters, after, limit: 500 });
        this.absorb(collection, page);
        if (page.length < 500) break;
        after = page[page.length - 1].id;
      }
    }
    return this.view<T>(collection).filter((record) =>
      filters.every((filter) => {
        const value = (record as Record<string, unknown>)[filter.field];
        return filter.op === "==" ? value === filter.value : Array.isArray(value) && value.includes(filter.value);
      })
    );
  }

  /** Loads records by id; returns the active ones found. */
  async byIds<T>(collection: SessionCollection, ids: string[]): Promise<T[]> {
    const { originals } = this.bucket(collection);
    const missing = [...new Set(ids)].filter((id) => !originals.has(id));
    if (missing.length > 0 && !this.fullyLoaded.has(collection)) {
      this.absorb(collection, await this.transaction.getMany(collection, missing));
    }
    const { current } = this.bucket(collection);
    return ids.map((id) => current.get(id)).filter(Boolean) as unknown as T[];
  }

  async one<T>(collection: SessionCollection, id: string): Promise<T | null> {
    return (await this.byIds<T>(collection, [id]))[0] ?? null;
  }

  /** One record of the working view (after `commit`, as stored). */
  latest<T>(collection: SessionCollection, id: string): T | null {
    return (this.bucket(collection).current.get(id) as unknown as T) ?? null;
  }

  /** The loaded, active records of a collection as the commands see them. */
  view<T>(collection: SessionCollection): T[] {
    return [...this.bucket(collection).current.values()] as unknown as T[];
  }

  /**
   * A repository `save`: the records are the collection's new content as far as this session
   * knows it. Loaded records missing from it are deleted; records not loaded are untouched.
   */
  save<T extends { id: string }>(collection: SessionCollection, records: T[]): void {
    const { current } = this.bucket(collection);
    current.clear();
    for (const record of records) current.set(record.id, structuredClone(record) as unknown as StoredRecord);
  }

  /** Replaces or adds single records, leaving the rest of the view as it is. */
  put<T extends { id: string }>(collection: SessionCollection, records: T[]): void {
    const { current } = this.bucket(collection);
    for (const record of records) current.set(record.id, structuredClone(record) as unknown as StoredRecord);
  }

  recordAuditEvent = async (event: SessionAuditEvent): Promise<void> => {
    this.auditEvents.push(event);
  };

  /** Fails with 409 when a client's `expectedVersion` no longer matches the stored record. */
  static assertVersion(record: { syncVersion?: number } | null | undefined, expectedVersion: number | undefined): void {
    if (expectedVersion === undefined || !record) return;
    const actual = Number(record.syncVersion) || 0;
    if (actual !== expectedVersion) {
      throw conflict(`The record changed meanwhile (version ${actual}, expected ${expectedVersion}). Read it again and retry.`);
    }
  }

  /** Writes every change in the transaction. Call once, after the command succeeded. */
  async commit(): Promise<SessionCommitResult> {
    const timestamp = this.now.toISOString();
    type Change = { collection: SessionCollection; id: string; next: StoredRecord | null; previous: StoredRecord | undefined };
    const changes: Change[] = [];
    for (const [collection, { originals, current }] of [...this.current.keys()].map((name) => [name, this.bucket(name)] as const)) {
      for (const [id, next] of current) {
        const previous = originals.get(id);
        if (previous && typeof previous.deletedAt !== "string" && content(previous) === content(next)) continue;
        changes.push({ collection, id, next, previous });
      }
      for (const [id, previous] of originals) {
        if (typeof previous.deletedAt !== "string" && !current.has(id)) changes.push({ collection, id, next: null, previous });
      }
    }

    // A created id may already exist (e.g. a soft-deleted round with the same deterministic id):
    // read those first so the new version continues the old one's syncVersion. All reads happen
    // before any write, as Firestore transactions require.
    const unknown = changes.filter((change) => !change.previous);
    const byCollection = new Map<SessionCollection, string[]>();
    for (const change of unknown) byCollection.set(change.collection, [...(byCollection.get(change.collection) ?? []), change.id]);
    for (const [collection, ids] of byCollection) {
      const existing = new Map((await this.transaction.getMany(collection, ids)).map((record) => [record.id, record]));
      for (const change of unknown) {
        if (change.collection === collection) change.previous = existing.get(change.id);
      }
    }

    const tournamentChanged = canonical(this.tournamentRecord) !== this.originalTournament;
    const writeCount = changes.reduce((count, change) => count + (change.previous ? 2 : 1), 0) +
      this.auditEvents.length + (tournamentChanged ? 1 : 0);
    if (writeCount > MAX_SESSION_WRITES) {
      throw new ApiError(413, "payload_too_large", `This change needs ${writeCount} writes; split it into smaller requests.`);
    }

    const result: SessionCommitResult = { written: {}, deleted: {}, auditEventIds: [] };
    for (const change of changes) {
      const version = (Number(change.previous?.syncVersion) || 0) + 1;
      if (change.previous) {
        const archiveId = randomUUID();
        this.transaction.set("syncConflicts", archiveId, {
          id: archiveId,
          collectionName: change.collection,
          recordId: change.id,
          record: change.previous,
          resolution: change.next ? "superseded" : "recoverable-delete",
          archivedAt: timestamp,
          archivedBy: this.actorId,
        });
      }
      let data: StoredRecord;
      if (change.next) {
        data = { ...withoutUndefined(change.next), id: change.id, syncVersion: version };
        delete (data as Record<string, unknown>).deletedAt;
        result.written[change.collection] = [...(result.written[change.collection] ?? []), change.id];
      } else {
        data = { ...withoutUndefined(change.previous as StoredRecord), id: change.id, deletedAt: timestamp, syncVersion: version };
        result.deleted[change.collection] = [...(result.deleted[change.collection] ?? []), change.id];
      }
      if (change.collection === "debates") {
        // Private portals find their debates through this index.
        (data as Record<string, unknown>)[PARTICIPANT_IDS_FIELD] = debateParticipantIds(data as never);
      }
      this.transaction.set(change.collection, change.id, data);
      // Responses built after the commit show the stored version.
      if (change.next) this.bucket(change.collection).current.set(change.id, withoutParticipantIds(data));
    }

    if (tournamentChanged) {
      const { id: _id, ...rest } = withoutUndefined(this.tournamentRecord) as unknown as StoredRecord;
      const saved = {
        ...rest,
        id: this.tournamentRecord.id,
        updatedAt: timestamp,
        syncVersion: (Number(this.tournamentRecord.syncVersion) || 0) + 1,
      };
      this.transaction.setTournament(saved);
      this.tournamentRecord = saved as unknown as Tournament;
    }

    for (const event of this.auditEvents) {
      const id = randomUUID();
      result.auditEventIds.push(id);
      this.transaction.set("auditEvents", id, withoutUndefined({
        ...event,
        id,
        tournamentId: this.tournamentRecord.id,
        timestamp,
        actorId: this.actorId,
        actorName: this.actor.actorName ?? `API token “${this.actor.tokenName}”`,
        actorType: this.actor.actorType ?? "system",
        details: {
          ...event.details,
          ...(this.actor.actorId ? {} : { apiTokenId: this.actor.tokenId }),
          requestId: this.actor.requestId,
        },
        syncVersion: 1,
      }));
    }
    return result;
  }
}

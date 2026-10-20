import type { PublicBaseSection } from "@/lib/publicView/snapshot";
import type { PublicViewReader } from "@/lib/publicView/store";
import { badRequest } from "./errors";
import { isActive, type ApiCollection, type QueryFilter, type StoredRecord, type TournamentReader } from "./store";

/**
 * Where a request's tournament data comes from.
 *
 * - Administrator tokens read the live Firestore records (soft-deleted ones are hidden).
 * - `read:public` tokens read the published public view: the same sanitized, release-gated
 *   projection the public site shows (lib/publicView/projection.ts), served from the Vercel data
 *   cache, so a public API client can never see more than a public visitor, and costs almost no
 *   Firestore reads.
 */

export interface Page<T> {
  data: T[];
  /** Pass as `cursor` to get the next page; null on the last page. */
  nextCursor: string | null;
}

export interface PageRequest {
  limit: number;
  cursor?: string;
}

export type ReadableCollection = Exclude<ApiCollection, "syncConflicts">;

export interface TournamentData {
  readonly view: "admin" | "public";
  /** Page through a collection in document-id order. */
  page(collection: ReadableCollection, request: PageRequest, filters?: QueryFilter[]): Promise<Page<StoredRecord>>;
  get(collection: ReadableCollection, id: string): Promise<StoredRecord | null>;
  getMany(collection: ReadableCollection, ids: string[]): Promise<StoredRecord[]>;
  /**
   * Every record (optionally filtered). Only for collections whose size is bounded by the
   * tournament's configuration (rounds, motions, break categories) or for computations that need
   * the whole tournament (standings); it reads in pages of `ALL_PAGE_SIZE`.
   */
  all(collection: ReadableCollection, filters?: QueryFilter[]): Promise<StoredRecord[]>;
}

const ALL_PAGE_SIZE = 500;
/** Upper bound for `all()`, far above any real tournament; stops a runaway loop. */
const ALL_MAX_RECORDS = 50_000;

const CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

export function encodeCursor(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): string | undefined {
  if (cursor === undefined) return undefined;
  if (!CURSOR_PATTERN.test(cursor)) throw badRequest("cursor is not valid.");
  const id = Buffer.from(cursor, "base64url").toString("utf8");
  if (!id || id.length > 128 || id.includes("/")) throw badRequest("cursor is not valid.");
  return id;
}

function matchesFilters(record: StoredRecord, filters: QueryFilter[] = []): boolean {
  return filters.every((filter) => {
    const value = record[filter.field];
    return filter.op === "==" ? value === filter.value : Array.isArray(value) && value.includes(filter.value);
  });
}

export function createAdminData(reader: TournamentReader): TournamentData {
  return {
    view: "admin",
    async page(collection, request, filters) {
      const after = decodeCursor(request.cursor);
      // One extra document tells whether another page exists.
      const records = await reader.query(collection, { filters, after, limit: request.limit + 1 });
      const pageRecords = records.slice(0, request.limit);
      const hasMore = records.length > request.limit;
      const last = pageRecords[pageRecords.length - 1];
      return {
        // A page can be shorter than `limit` when it held soft-deleted records; the cursor still advances.
        data: pageRecords.filter(isActive),
        nextCursor: hasMore && last ? encodeCursor(last.id) : null,
      };
    },
    async get(collection, id) {
      const record = await reader.get(collection, id);
      return isActive(record) ? record : null;
    },
    async getMany(collection, ids) {
      return (await reader.getMany(collection, [...new Set(ids)])).filter(isActive);
    },
    async all(collection, filters) {
      const records: StoredRecord[] = [];
      let after: string | undefined;
      for (;;) {
        const batch = await reader.query(collection, { filters, after, limit: ALL_PAGE_SIZE });
        records.push(...batch.filter(isActive));
        if (batch.length < ALL_PAGE_SIZE || records.length >= ALL_MAX_RECORDS) return records;
        after = batch[batch.length - 1].id;
      }
    },
  };
}

const PUBLIC_SECTIONS: Partial<Record<ReadableCollection, PublicBaseSection>> = {
  rounds: "rounds",
  teams: "teams",
  adjudicators: "adjudicators",
  venues: "venues",
  motions: "motions",
  breakCategories: "breakCategories",
  institutions: "institutions",
};

export function createPublicData(reader: PublicViewReader): TournamentData {
  const sectionCache = new Map<string, Promise<StoredRecord[]>>();
  const load = (collection: ReadableCollection): Promise<StoredRecord[]> => {
    const cached = sectionCache.get(collection);
    if (cached) return cached;
    const loading = (async (): Promise<StoredRecord[]> => {
      const section = PUBLIC_SECTIONS[collection];
      if (section) return asRecords(await reader.readBase(section));
      if (collection === "debates" || collection === "ballots") {
        // Debates and ballots are published per round; only published rounds have a section.
        const rounds = await Promise.all(Object.keys(reader.roundHashes).map((roundId) => reader.readRound(roundId)));
        return rounds.flatMap((content) => asRecords(content?.[collection]));
      }
      // Feedback, audit events, ballot intake: never public.
      return [];
    })();
    sectionCache.set(collection, loading);
    return loading;
  };
  const sorted = (records: StoredRecord[]) =>
    [...records].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  return {
    view: "public",
    async page(collection, request, filters) {
      const after = decodeCursor(request.cursor);
      const records = sorted(await load(collection))
        .filter((record) => after === undefined || record.id > after)
        .filter((record) => matchesFilters(record, filters));
      const data = records.slice(0, request.limit);
      return {
        data,
        nextCursor: records.length > request.limit ? encodeCursor(data[data.length - 1].id) : null,
      };
    },
    async get(collection, id) {
      return (await load(collection)).find((record) => record.id === id) ?? null;
    },
    async getMany(collection, ids) {
      const byId = new Map((await load(collection)).map((record) => [record.id, record]));
      return [...new Set(ids)].map((id) => byId.get(id)).filter((record): record is StoredRecord => Boolean(record));
    },
    async all(collection, filters) {
      return sorted(await load(collection)).filter((record) => matchesFilters(record, filters));
    },
  };
}

function asRecords(value: unknown): StoredRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is StoredRecord =>
      item !== null && typeof item === "object" && typeof (item as { id?: unknown }).id === "string"
  );
}

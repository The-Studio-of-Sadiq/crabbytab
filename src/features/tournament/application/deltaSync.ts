import { CLOUD_COLLECTIONS, type CloudCollectionName, type CloudRecord } from "@/features/tournament/collections";
import {
  mergeCloudIntoWorkingCopy,
  type CloudDeletionMap,
  type CloudOverwriteMap,
  type DivergedRecord,
  type SyncBaseline,
  type WorkingCopyMerge,
} from "./cloudSync";
import { applyLiveSnapshot, mergeDivergedRecords, withBaselineEntries } from "./liveSync";

/**
 * Downloading only what changed (docs/storage-and-scale.md, "Downloading only what changed").
 *
 * Every cloud write stamps the record with the server time (`cloudUpdatedAt`). A device remembers,
 * per collection, the latest stamp it has seen and the `syncVersion` of every cloud record it has
 * seen (its cursor), and on the next open asks only for records stamped after that. Before trusting
 * such a download it checks that the cloud and the device still agree:
 *
 * - the cloud's record count and `syncVersion` sum (one aggregation query) equal the cursor's after
 *   applying the download. A write that was not stamped (an older app version, a writer that
 *   forgot) bumps `syncVersion` all the same, and a hard delete changes the count, so either one
 *   makes the collection fall back to a full download;
 * - the device's copy follows the cursor: every record the cloud holds is on the device (or
 *   deleted here, waiting for upload), synced at the version the cursor records. A working copy
 *   replaced since (a backup restored, a tournament re-imported) fails this and is downloaded in
 *   full.
 *
 * Both checks are conservative: they can only ask for a full download, never skip one.
 */

/** A cloud record and its stamp, as read for a merge (cloud-only fields removed). */
export interface CloudDocument {
  record: CloudRecord;
  /** `cloudUpdatedAt` in milliseconds; absent on records written before stamping existed. */
  updatedAt?: number;
}

export interface CollectionCursor {
  /** The latest stamp seen in this collection (0: none yet). */
  since: number;
  /** `syncVersion` of every cloud record seen, soft-deleted ones included. */
  versions: Record<string, number>;
  /** Records soft-deleted in the cloud. */
  deleted: string[];
}

export interface SyncCursor {
  tournamentId: string;
  collections: Partial<Record<CloudCollectionName, CollectionCursor>>;
}

/** What the cloud reports for a whole collection (count and `syncVersion` sum, deleted included). */
export interface CollectionAggregate {
  count: number;
  versionSum: number;
}

/**
 * Firestore queries are strongly consistent and a stamp is the write's commit time, so every record
 * stamped up to the latest stamp a read returned was in that read. The overlap is a margin against
 * a stamp assigned before its commit became visible (a long transaction). It costs re-reading the
 * records stamped in the minute before the latest one (merging a record twice changes nothing).
 */
export const DELTA_OVERLAP_MS = 60 * 1000;

const versionOf = (record: CloudRecord) => Number(record.syncVersion) || 0;

export function cursorFromFullRead(documents: readonly CloudDocument[]): CollectionCursor {
  return advanceCursor({ since: 0, versions: {}, deleted: [] }, documents);
}

/** The cursor after applying downloaded records (a full download, a delta, or a listener event). */
export function advanceCursor(cursor: CollectionCursor, documents: readonly CloudDocument[]): CollectionCursor {
  if (documents.length === 0) return cursor;
  const versions = { ...cursor.versions };
  const deleted = new Set(cursor.deleted);
  let since = cursor.since;
  for (const { record, updatedAt } of documents) {
    versions[record.id] = versionOf(record);
    if (typeof record.deletedAt === "string") deleted.add(record.id);
    else deleted.delete(record.id);
    if (updatedAt !== undefined && updatedAt > since) since = updatedAt;
  }
  return { since, versions, deleted: [...deleted].sort() };
}

/** Where a delta download starts: the latest stamp seen, minus the overlap. */
export function deltaStart(cursor: CollectionCursor): number {
  return Math.max(0, cursor.since - DELTA_OVERLAP_MS);
}

export function cursorMatchesAggregate(cursor: CollectionCursor, aggregate: CollectionAggregate): boolean {
  const versions = Object.values(cursor.versions);
  const sum = versions.reduce((total, version) => total + version, 0);
  return versions.length === aggregate.count && sum === aggregate.versionSum;
}

/**
 * Whether records the delta did not bring can be trusted as they are on the device: every live
 * cloud record in the cursor is on the device at the cursor's version, or deleted here and waiting
 * for upload, restored from a backup (the device's version wins), or listed as a sync conflict.
 */
export function localCopyFollowsCursor(input: {
  cursor: CollectionCursor;
  local: readonly CloudRecord[];
  baseline: SyncBaseline[CloudCollectionName];
  collection: CloudCollectionName;
  deletions?: CloudDeletionMap;
  overwrites?: CloudDeletionMap;
  diverged?: readonly DivergedRecord[];
}): boolean {
  const { cursor, collection } = input;
  const localIds = new Set(input.local.map((record) => record.id));
  const pendingDeletion = new Set(input.deletions?.[collection] || []);
  const restored = new Set(input.overwrites?.[collection] || []);
  const conflicted = new Set(
    (input.diverged || [])
      .filter((record) => record.collectionName === collection)
      .map((record) => record.recordId)
  );
  const deleted = new Set(cursor.deleted);
  for (const [id, version] of Object.entries(cursor.versions)) {
    if (deleted.has(id) || pendingDeletion.has(id) || restored.has(id) || conflicted.has(id)) continue;
    if (!localIds.has(id)) return false;
    if (input.baseline?.[id]?.v !== version) return false;
  }
  return true;
}

export function parseSyncCursor(value: unknown, tournamentId: string): SyncCursor {
  const empty: SyncCursor = { tournamentId, collections: {} };
  if (!value || typeof value !== "object") return empty;
  const stored = value as { tournamentId?: unknown; collections?: unknown };
  if (stored.tournamentId !== tournamentId || !stored.collections || typeof stored.collections !== "object") {
    return empty;
  }
  const collections: SyncCursor["collections"] = {};
  for (const name of CLOUD_COLLECTIONS) {
    const entry = (stored.collections as Record<string, unknown>)[name];
    if (!entry || typeof entry !== "object") continue;
    const { since, versions, deleted } = entry as Record<string, unknown>;
    if (typeof since !== "number" || !Number.isFinite(since) || since < 0) continue;
    if (!versions || typeof versions !== "object" || Array.isArray(versions)) continue;
    if (!Array.isArray(deleted) || !deleted.every((id) => typeof id === "string")) continue;
    const parsedVersions: Record<string, number> = {};
    let valid = true;
    for (const [id, version] of Object.entries(versions)) {
      if (typeof version !== "number" || !Number.isFinite(version)) {
        valid = false;
        break;
      }
      parsedVersions[id] = version;
    }
    if (valid) collections[name] = { since, versions: parsedVersions, deleted: [...deleted] };
  }
  return { tournamentId, collections };
}

/** One collection to read: in full, or (with `since`) only records stamped after that time. */
export interface CloudCollectionRead {
  name: CloudCollectionName;
  since?: number;
}

export interface CloudCollectionReadResult {
  documents: CloudDocument[];
  /** For a read with `since`: the whole collection's record count and `syncVersion` sum. */
  aggregate?: CollectionAggregate;
}

export type CloudReadResults = Partial<Record<CloudCollectionName, CloudCollectionReadResult>>;

/** Collections the device has a cursor for are read from it; the others in full. */
export function planCloudReads(
  cursor: SyncCursor,
  names: readonly CloudCollectionName[]
): CloudCollectionRead[] {
  return names.map((name) => {
    const entry = cursor.collections[name];
    return entry ? { name, since: deltaStart(entry) } : { name };
  });
}

/**
 * Delta reads that cannot be trusted and must be read in full instead: the cloud's count or
 * version sum disagrees with the cursor once the changes are applied, or the device's copy no
 * longer follows the cursor for the records the changes did not bring.
 */
export function collectionsNeedingFullRead(input: {
  results: CloudReadResults;
  cursor: SyncCursor;
  local: Partial<Record<CloudCollectionName, readonly CloudRecord[]>>;
  baseline: SyncBaseline;
  deletions?: CloudDeletionMap;
  overwrites?: CloudDeletionMap;
  diverged?: readonly DivergedRecord[];
}): CloudCollectionName[] {
  const stale: CloudCollectionName[] = [];
  for (const name of CLOUD_COLLECTIONS) {
    const result = input.results[name];
    const entry = input.cursor.collections[name];
    if (!result?.aggregate || !entry) continue;
    const changedIds = new Set(result.documents.map((document) => document.record.id));
    // Records the changes did not bring must be on the device as the cursor last saw them.
    const unchanged: CollectionCursor = {
      ...entry,
      versions: Object.fromEntries(Object.entries(entry.versions).filter(([id]) => !changedIds.has(id))),
    };
    const follows = localCopyFollowsCursor({
      cursor: unchanged,
      local: input.local[name] || [],
      baseline: input.baseline[name],
      collection: name,
      deletions: input.deletions,
      overwrites: input.overwrites,
      diverged: input.diverged,
    });
    if (!follows || !cursorMatchesAggregate(advanceCursor(entry, result.documents), result.aggregate)) {
      stale.push(name);
    }
  }
  return stale;
}

/**
 * Merges what was read when the tournament opened into the working copy. Collections read in full
 * merge as a download does (`mergeCloudIntoWorkingCopy`); collections read as changes apply them
 * the way a live listener event does (`applyLiveSnapshot`), leaving every record they did not
 * bring as it is. Collections not read at all stay as they are, and so do the sync
 * conflicts already listed for them and for the delta collections. Returns the next cursor too.
 */
export function mergeCloudReads(input: {
  results: CloudReadResults;
  cursor: SyncCursor;
  localCollections: Record<CloudCollectionName, CloudRecord[]> | null;
  baseline: SyncBaseline;
  deletions?: CloudDeletionMap;
  overwrites?: CloudOverwriteMap;
  /** Sync conflicts listed before this merge. */
  diverged?: readonly DivergedRecord[];
}): WorkingCopyMerge & { cursor: SyncCursor } {
  const deltaNames = CLOUD_COLLECTIONS.filter((name) => input.results[name]?.aggregate);
  const fullNames = CLOUD_COLLECTIONS.filter((name) => input.results[name] && !input.results[name]?.aggregate);
  const untouched = new Set<CloudCollectionName>(
    CLOUD_COLLECTIONS.filter((name) => !fullNames.includes(name))
  );
  const full = mergeCloudIntoWorkingCopy({
    cloudCollections: Object.fromEntries(
      CLOUD_COLLECTIONS.map((name) => [
        name,
        fullNames.includes(name) ? (input.results[name]?.documents || []).map((document) => document.record) : [],
      ])
    ) as Record<CloudCollectionName, CloudRecord[]>,
    localCollections: input.localCollections,
    baseline: input.baseline,
    deletions: input.deletions,
    overwrites: input.overwrites,
    keepLocal: [...untouched],
  });

  const collections = { ...full.collections };
  let baseline = full.baseline;
  let diverged: DivergedRecord[] = [
    ...(input.diverged || []).filter((record) => untouched.has(record.collectionName as CloudCollectionName)),
    ...full.divergedRecords,
  ];
  const cursorCollections = { ...input.cursor.collections };
  for (const name of deltaNames) {
    const documents = input.results[name]?.documents || [];
    const applied = applyLiveSnapshot({
      collection: name,
      local: collections[name],
      baseline: baseline[name] || {},
      changes: documents.map((document) => ({ type: "modified" as const, record: document.record })),
      deletions: input.deletions?.[name],
      overwrites: input.overwrites?.[name],
    });
    collections[name] = applied.records;
    baseline = withBaselineEntries(baseline, name, applied.baseline);
    diverged = mergeDivergedRecords(diverged, applied.diverged);
    const entry = cursorCollections[name];
    if (entry) cursorCollections[name] = advanceCursor(entry, documents);
  }
  for (const name of fullNames) {
    cursorCollections[name] = cursorFromFullRead(input.results[name]?.documents || []);
  }
  return {
    collections,
    baseline,
    divergedRecords: diverged,
    cursor: { tournamentId: input.cursor.tournamentId, collections: cursorCollections },
  };
}

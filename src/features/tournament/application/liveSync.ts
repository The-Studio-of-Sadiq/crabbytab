import type { CloudCollectionName, CloudRecord } from "@/features/tournament/collections";
import {
  baselineEntryFor,
  classifyAgainstBaseline,
  syncContentHash,
  syncVersionOf,
  type DivergedRecord,
  type SyncBaseline,
  type SyncBaselineEntry,
} from "./cloudSync";

/**
 * Live collaboration (sync model B, first step). For a cloud tournament opened by an
 * administrator, these collections are written to Firestore record by record as they change and
 * read back through listeners, so tab-room devices see each other's ballots, check-ins and
 * allocations within seconds. Every other collection stays on manual upload/download.
 * See docs/live-collaboration.md.
 */
export const LIVE_COLLECTIONS = ["ballots", "debates", "teams", "adjudicators"] as const satisfies readonly CloudCollectionName[];
export type LiveCollectionName = (typeof LIVE_COLLECTIONS)[number];

export function isLiveCollection(name: string): name is LiveCollectionName {
  return (LIVE_COLLECTIONS as readonly string[]).includes(name);
}

/** One listener: a whole collection, or the records of one round. */
export interface LiveScope {
  collection: LiveCollectionName;
  roundId?: string;
}

export function liveScopeKey(scope: LiveScope): string {
  return scope.roundId === undefined ? scope.collection : `${scope.collection}@${scope.roundId}`;
}

/**
 * The listeners for an administrator's device: check-ins (teams and adjudicators, whole
 * collections, since availability is per round on each record) and the active round's debates
 * (draw and allocation) and ballots. Earlier rounds are not listened to: their records change
 * rarely and arrive with the next load or download, which keeps reads proportional to the work of
 * the current round.
 */
export function liveListenerScopes(activeRoundId: string | null | undefined): LiveScope[] {
  const scopes: LiveScope[] = [{ collection: "teams" }, { collection: "adjudicators" }];
  if (activeRoundId) {
    scopes.push({ collection: "debates", roundId: activeRoundId }, { collection: "ballots", roundId: activeRoundId });
  }
  return scopes;
}

/**
 * Fields written key by key rather than as a whole, so concurrent edits of different keys survive:
 * availability is per round (last write wins per round), and a debate's result is per side. Every
 * other field is written whole (last write wins per field): for example a debate's adjudicator
 * panel is replaced as one unit, so two operators never produce a mixed panel.
 */
export const LIVE_MAP_FIELDS: Record<LiveCollectionName, readonly string[]> = {
  teams: ["roundAvailability", "roundAvailabilityAt"],
  adjudicators: ["roundAvailability", "roundAvailabilityAt"],
  debates: ["teams"],
  ballots: [],
};

/** Fields the live path never writes from a record's content (stamped or derived instead). */
const STAMPED_FIELDS = new Set(["id", "syncVersion"]);

export type LiveFieldWrite = { path: string[]; value: unknown } | { path: string[]; delete: true };

/**
 * One record's write. "set" writes the whole record (a record the cloud has never stored); "patch"
 * writes only `fields`, leaving every other field as the cloud holds it. `record` is the full
 * record as this device holds it after the write (for derived cloud fields such as a debate's
 * participant index). Both stamp `syncVersion`.
 */
export type LiveWrite =
  | { kind: "set"; collection: LiveCollectionName; id: string; record: CloudRecord; syncVersion: number }
  | {
      kind: "patch";
      collection: LiveCollectionName;
      id: string;
      record: CloudRecord;
      fields: LiveFieldWrite[];
      syncVersion: number;
    };

export function liveWriteKey(write: Pick<LiveWrite, "collection" | "id">): string {
  return `${write.collection}/${write.id}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  return syncContentHash({ id: "", value: left } as CloudRecord) === syncContentHash({ id: "", value: right } as CloudRecord);
}

/**
 * The field writes that turn `before` into `after`. Map fields (`LIVE_MAP_FIELDS`) are compared key
 * by key, treating a missing map as empty, so writing one round's availability never replaces
 * another round's. Removed fields are deleted.
 */
export function diffLiveFields(
  collection: LiveCollectionName,
  before: CloudRecord,
  after: CloudRecord
): LiveFieldWrite[] {
  const mapFields = new Set(LIVE_MAP_FIELDS[collection]);
  const previous = before as unknown as Record<string, unknown>;
  const next = after as unknown as Record<string, unknown>;
  const writes: LiveFieldWrite[] = [];
  const keys = [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort();
  for (const key of keys) {
    if (STAMPED_FIELDS.has(key)) continue;
    const from = previous[key];
    const to = next[key];
    if (mapFields.has(key) && (from === undefined || isPlainObject(from)) && (to === undefined || isPlainObject(to))) {
      const fromMap = (from ?? {}) as Record<string, unknown>;
      const toMap = (to ?? {}) as Record<string, unknown>;
      for (const entry of [...new Set([...Object.keys(fromMap), ...Object.keys(toMap)])].sort()) {
        if (sameValue(fromMap[entry], toMap[entry])) continue;
        writes.push(toMap[entry] === undefined ? { path: [key, entry], delete: true } : { path: [key, entry], value: toMap[entry] });
      }
      continue;
    }
    if (sameValue(from, to)) continue;
    writes.push(to === undefined ? { path: [key], delete: true } : { path: [key], value: to });
  }
  return writes;
}

/** Applies field writes to a record (the same result the cloud computes for a "patch"). */
export function applyLiveFields(record: CloudRecord, fields: LiveFieldWrite[]): CloudRecord {
  const result: Record<string, unknown> = { ...(record as unknown as Record<string, unknown>) };
  for (const field of fields) {
    const [key, entry] = field.path;
    if (entry === undefined) {
      if ("delete" in field) delete result[key];
      else result[key] = field.value;
      continue;
    }
    const map = { ...(isPlainObject(result[key]) ? (result[key] as Record<string, unknown>) : {}) };
    if ("delete" in field) delete map[entry];
    else map[entry] = field.value;
    result[key] = map;
  }
  return result as unknown as CloudRecord;
}

export interface LiveWritePlan {
  /** The collection as this device should now hold it. */
  records: CloudRecord[];
  writes: LiveWrite[];
  /** New baseline entries for the written records; `null` removes an entry (deleted records). */
  baseline: Record<string, SyncBaselineEntry | null>;
  /** Records soft-deleted in the cloud by this plan. */
  deletedIds: string[];
}

/**
 * Turns one save of a live collection into per-record writes.
 *
 * Commands compute their result from the state they were given (`base`), which can be older than
 * what this device holds now (`latest`) if a listener delivered another device's change meanwhile.
 * Only the records the command changed (from `base` to `next`) are written, and only the fields it
 * changed; they are applied on top of `latest`, so another device's change to other records or
 * other fields of the same record is kept. A changed field is last write wins.
 *
 * A record is written only when this device's copy is in sync with the cloud (its content matches
 * its baseline entry) or the cloud has never stored it. A record still holding changes from before
 * live collaboration started (or edited while it was off) stays on the upload path, whose stale
 * version check decides whether it can replace the cloud version; it is changed locally only.
 * Deleting a synced record soft-deletes it in the cloud (`deletedAt`), keeping its content.
 */
export function planLiveWrites(input: {
  collection: LiveCollectionName;
  base: CloudRecord[];
  next: CloudRecord[];
  latest: CloudRecord[];
  baseline: Record<string, SyncBaselineEntry>;
  now: string;
}): LiveWritePlan {
  const { collection, baseline, now } = input;
  const baseById = new Map(input.base.map((record) => [record.id, record]));
  const nextById = new Map(input.next.map((record) => [record.id, record]));
  const latestById = new Map(input.latest.map((record) => [record.id, record]));
  const writes: LiveWrite[] = [];
  const entries: Record<string, SyncBaselineEntry | null> = {};
  const deletedIds: string[] = [];
  const replaced = new Map<string, CloudRecord>();
  const removed = new Set<string>();

  const cloudVersion = (id: string, record: CloudRecord | undefined) =>
    Math.max(baseline[id]?.v ?? 0, record ? syncVersionOf(record) : 0);
  const inSync = (id: string, record: CloudRecord) => baseline[id]?.h === syncContentHash(record);
  const neverStored = (id: string, record: CloudRecord | undefined) =>
    !baseline[id] && !(record && syncVersionOf(record) > 0);

  for (const [id, after] of nextById) {
    const before = baseById.get(id);
    if (before && syncContentHash(before) === syncContentHash(after)) continue;
    const current = latestById.get(id);
    if (!current || !before) {
      // New on this device (or re-added): the whole record is written if the cloud lacks it.
      const record = { ...after };
      if (neverStored(id, current ?? after)) {
        record.syncVersion = 1;
        writes.push({ kind: "set", collection, id, record, syncVersion: 1 });
        entries[id] = baselineEntryFor(record);
      }
      replaced.set(id, record);
      continue;
    }
    const fields = diffLiveFields(collection, before, after);
    const merged = applyLiveFields(current, fields);
    if (inSync(id, current)) {
      const syncVersion = cloudVersion(id, current) + 1;
      const record = { ...merged, syncVersion };
      writes.push({ kind: "patch", collection, id, record, fields, syncVersion });
      entries[id] = baselineEntryFor(record);
      replaced.set(id, record);
    } else if (neverStored(id, current)) {
      const record = { ...merged, syncVersion: 1 };
      writes.push({ kind: "set", collection, id, record, syncVersion: 1 });
      entries[id] = baselineEntryFor(record);
      replaced.set(id, record);
    } else {
      replaced.set(id, merged);
    }
  }

  for (const [id, before] of baseById) {
    if (nextById.has(id)) continue;
    removed.add(id);
    const current = latestById.get(id) ?? before;
    if (!baseline[id]) continue;
    const syncVersion = cloudVersion(id, current) + 1;
    writes.push({
      kind: "patch",
      collection,
      id,
      record: { ...current, deletedAt: now, syncVersion },
      fields: [{ path: ["deletedAt"], value: now }],
      syncVersion,
    });
    entries[id] = null;
    deletedIds.push(id);
  }

  const records: CloudRecord[] = [];
  for (const record of input.latest) {
    if (removed.has(record.id)) continue;
    records.push(replaced.get(record.id) ?? record);
    replaced.delete(record.id);
  }
  // Records the latest copy lacks (new, or removed by another device meanwhile), in `next` order.
  for (const record of input.next) {
    const added = replaced.get(record.id);
    if (added) records.push(added);
  }
  return { records, writes, baseline: entries, deletedIds };
}

/**
 * Merges writes queued in the same tick into one write per record, so a command's saves (for
 * example a confirmation's ballots and debate) commit as one atomic batch. A later field write
 * wins over an earlier one to the same path; a "set" absorbs the patches after it.
 */
export function coalesceLiveWrites(writes: LiveWrite[]): LiveWrite[] {
  const byKey = new Map<string, LiveWrite>();
  for (const write of writes) {
    const key = liveWriteKey(write);
    const previous = byKey.get(key);
    if (!previous || write.kind === "set") {
      byKey.delete(key);
      byKey.set(key, write);
      continue;
    }
    const syncVersion = Math.max(previous.syncVersion, write.syncVersion);
    if (previous.kind === "set") {
      const record = { ...applyLiveFields(previous.record, write.fields), syncVersion };
      byKey.set(key, { ...previous, record, syncVersion });
      continue;
    }
    byKey.set(key, {
      ...write,
      fields: mergeFieldWrites(previous.fields, write.fields),
      syncVersion,
      record: { ...write.record, syncVersion },
    });
  }
  return [...byKey.values()];
}

/**
 * Field writes in order, later ones winning. A whole-field write replaces earlier writes to its
 * keys; a key write after a whole-field write is folded into that field's value.
 */
function mergeFieldWrites(earlier: LiveFieldWrite[], later: LiveFieldWrite[]): LiveFieldWrite[] {
  const result = [...earlier];
  for (const field of later) {
    const [key, entry] = field.path;
    if (entry === undefined) {
      const kept = result.filter((existing) => existing.path[0] !== key);
      result.length = 0;
      result.push(...kept, field);
      continue;
    }
    const wholeIndex = result.findIndex((existing) => existing.path.length === 1 && existing.path[0] === key);
    if (wholeIndex >= 0) {
      const whole = result[wholeIndex];
      const map = { ...("value" in whole && isPlainObject(whole.value) ? whole.value : {}) };
      if ("delete" in field) delete map[entry];
      else map[entry] = field.value;
      result[wholeIndex] = { path: [key], value: map };
      continue;
    }
    const sameIndex = result.findIndex((existing) => existing.path.length === 2 && existing.path[0] === key && existing.path[1] === entry);
    if (sameIndex >= 0) result.splice(sameIndex, 1);
    result.push(field);
  }
  return result;
}

/** A listener event for one record, as the cloud (plus this device's queued writes) holds it. */
export interface LiveRecordChange {
  type: "added" | "modified" | "removed";
  record: CloudRecord;
}

/**
 * Applies a listener's changes to this device's copy of a live collection, with the same rule as
 * a download (see `classifyAgainstBaseline`):
 * - a record unchanged here since it was last synced takes the cloud version (this is how other
 *   devices' changes arrive; the cloud already merged them field by field with this device's
 *   queued writes);
 * - a record edited here and not written live (changes from before live collaboration) keeps the
 *   local edit for upload, and is reported as diverged if the cloud changed it too;
 * - records soft-deleted (or removed) in the cloud are dropped unless this device restored them
 *   from a backup; records with a pending local deletion are not brought back.
 */
export function applyLiveSnapshot(input: {
  collection: LiveCollectionName;
  local: CloudRecord[];
  baseline: Record<string, SyncBaselineEntry>;
  changes: LiveRecordChange[];
  deletions?: string[];
  overwrites?: string[];
}): {
  records: CloudRecord[];
  baseline: Record<string, SyncBaselineEntry | null>;
  diverged: DivergedRecord[];
  changed: boolean;
} {
  const { collection, baseline } = input;
  const deletions = new Set(input.deletions || []);
  const overwrites = new Set(input.overwrites || []);
  const localById = new Map(input.local.map((record) => [record.id, record]));
  const updates = new Map<string, CloudRecord | null>();
  const entries: Record<string, SyncBaselineEntry | null> = {};
  const diverged: DivergedRecord[] = [];

  for (const { type, record: cloud } of input.changes) {
    const id = cloud.id;
    const local = localById.get(id);
    const deleted = type === "removed" || typeof cloud.deletedAt === "string";
    if (overwrites.has(id)) continue;
    if (deleted) {
      entries[id] = null;
      if (local) updates.set(id, null);
      continue;
    }
    if (deletions.has(id)) continue;
    if (!local) {
      updates.set(id, cloud);
      entries[id] = baselineEntryFor(cloud);
      continue;
    }
    const outcome = classifyAgainstBaseline(local, cloud, baseline[id]);
    if (outcome === "cloud") {
      updates.set(id, cloud);
      entries[id] = baselineEntryFor(cloud);
    } else if (outcome === "diverged") {
      diverged.push({ collectionName: collection, recordId: id, cloudRecord: cloud });
    }
  }

  let changed = false;
  const records: CloudRecord[] = [];
  for (const record of input.local) {
    const update = updates.get(record.id);
    updates.delete(record.id);
    if (update === undefined) {
      records.push(record);
    } else if (update === null) {
      changed = true;
    } else if (syncContentHash(update) === syncContentHash(record) && syncVersionOf(update) === syncVersionOf(record)) {
      records.push(record);
    } else {
      records.push(update);
      changed = true;
    }
  }
  for (const update of updates.values()) {
    if (!update) continue;
    records.push(update);
    changed = true;
  }
  return { records, baseline: entries, diverged, changed };
}

/**
 * Debates with more than one confirmed, non-discarded ballot. Every confirmation discards the
 * debate's other versions in the same atomic batch, so this needs two devices confirming
 * different versions while one of them could not yet see the other's ballot (offline, or within a
 * listener's delay). It is never resolved automatically: the tab room chooses the version to keep.
 */
export function findConfirmationConflicts(
  ballots: Array<{ id: string; debateId: string; confirmed?: boolean; discarded?: boolean }>
): Array<{ debateId: string; ballotIds: string[] }> {
  const confirmedByDebate = new Map<string, string[]>();
  for (const ballot of ballots) {
    if (!ballot.confirmed || ballot.discarded) continue;
    confirmedByDebate.set(ballot.debateId, [...(confirmedByDebate.get(ballot.debateId) || []), ballot.id]);
  }
  return [...confirmedByDebate.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([debateId, ballotIds]) => ({ debateId, ballotIds: [...ballotIds].sort() }))
    .sort((left, right) => left.debateId.localeCompare(right.debateId));
}

export type LiveSyncMode = "off" | "connecting" | "live" | "offline" | "error";

export interface LiveSyncStatus {
  mode: LiveSyncMode;
  /** Records written on this device that the cloud has not acknowledged yet. */
  queuedWrites: number;
  /** The last listener or write error, if any. */
  error?: string;
}

export const LIVE_SYNC_OFF: LiveSyncStatus = { mode: "off", queuedWrites: 0 };

export function describeLiveSyncStatus(status: LiveSyncStatus): string {
  const queued = `${status.queuedWrites} change${status.queuedWrites === 1 ? "" : "s"} queued`;
  switch (status.mode) {
    case "off":
      return "Live updates are off.";
    case "connecting":
      return "Connecting live updates…";
    case "live":
      return status.queuedWrites > 0 ? `Live; sending ${queued}.` : "Live: ballots, check-ins and allocations are up to date.";
    case "offline":
      return `Offline — ${queued}. They are saved on this device and sent when you reconnect.`;
    case "error":
      return `Live updates stopped: ${status.error || "unknown error"}. Changes stay on this device for upload.`;
  }
}

/** The baseline with one collection's entries added, replaced or (`null`) removed. */
export function withBaselineEntries(
  baseline: SyncBaseline,
  collection: LiveCollectionName,
  entries: Record<string, SyncBaselineEntry | null>
): SyncBaseline {
  const ids = Object.keys(entries);
  if (ids.length === 0) return baseline;
  const next = { ...(baseline[collection] || {}) };
  for (const id of ids) {
    const entry = entries[id];
    if (entry) next[id] = entry;
    else delete next[id];
  }
  return { ...baseline, [collection]: next };
}

/** Adds or replaces diverged records by key. */
export function mergeDivergedRecords(current: DivergedRecord[], incoming: DivergedRecord[]): DivergedRecord[] {
  if (incoming.length === 0) return current;
  const key = (record: DivergedRecord) => `${record.collectionName}/${record.recordId}`;
  const replaced = new Set(incoming.map(key));
  return [...current.filter((record) => !replaced.has(key(record))), ...incoming];
}

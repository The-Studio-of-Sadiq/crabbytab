import type { Adjudicator, Team, Tournament } from "@/types";
import { CLOUD_COLLECTIONS, type CloudCollectionName, type CloudRecord } from "@/features/tournament/collections";
import { sanitizeAssistantAdjudicator, sanitizeAssistantTeam } from "@/lib/tournamentAccess";

export type { CloudCollectionName, CloudRecord } from "@/features/tournament/collections";

export type CloudDeletionMap = Partial<Record<CloudCollectionName, string[]>>;
/**
 * Records this device restored from a backup. Their local version is authoritative: the next
 * upload writes them over newer or deleted cloud versions (archiving what it replaces), and a
 * download keeps them even if the cloud deleted them.
 */
export type CloudOverwriteMap = Partial<Record<CloudCollectionName, string[]>>;

export function hasStaleSyncVersion(
  localVersion: number | undefined,
  cloudVersion: number
): boolean {
  return (Number(localVersion) || 0) !== (Number(cloudVersion) || 0);
}

export const DATA_ENTRY_COLLECTIONS = [
  "teams",
  "adjudicators",
  "institutions",
  "ballots",
  "feedback",
] as const satisfies readonly CloudCollectionName[];

export interface TournamentCloudRepository {
  getTournament(id: string): Promise<{ id: string; data: Record<string, unknown> } | null>;
  findTournamentBySlug(slug: string): Promise<{ id: string; data: Record<string, unknown> } | null>;
  saveTournament(id: string, tournament: Tournament): Promise<boolean>;
  getCollections(tournamentId: string): Promise<Record<CloudCollectionName, CloudRecord[]>>;
  syncCollections(
    tournamentId: string,
    collections: Record<CloudCollectionName, CloudRecord[]>,
    deletions?: CloudDeletionMap,
    overwrites?: CloudOverwriteMap
  ): Promise<number>;
  getSyncConflicts(tournamentId: string): Promise<SyncConflict[]>;
}

export interface SyncConflict {
  id: string;
  collectionName: string;
  recordId: string;
  record: CloudRecord;
  incomingRecord?: CloudRecord;
  archivedAt: string;
}

export function buildDataEntrySyncPayload(input: {
  localCollections: Record<CloudCollectionName, CloudRecord[]>;
}): {
  collections: Record<(typeof DATA_ENTRY_COLLECTIONS)[number], CloudRecord[]>;
  debates: CloudRecord[];
} {
  const collections = Object.fromEntries(
    DATA_ENTRY_COLLECTIONS.map((name) => [name, input.localCollections[name]])
  ) as Record<(typeof DATA_ENTRY_COLLECTIONS)[number], CloudRecord[]>;
  collections.teams = input.localCollections.teams.map(
    (record) => sanitizeAssistantTeam(record as unknown as Team) as unknown as CloudRecord
  );
  collections.adjudicators = input.localCollections.adjudicators.map(
    (record) => sanitizeAssistantAdjudicator(record as unknown as Adjudicator) as unknown as CloudRecord
  );
  return {
    collections,
    debates: input.localCollections.debates,
  };
}

export async function uploadTournamentCommand(input: {
  tournament: Tournament;
  userId: string;
  isGlobalAdmin?: boolean;
  localCollections: Record<CloudCollectionName, CloudRecord[]>;
  deletions?: CloudDeletionMap;
  overwrites?: CloudOverwriteMap;
  repository: TournamentCloudRepository;
  /**
   * Saves the tournament and records locally once the collections have been sent, whether or not
   * every record was written. The repository stamps each record it saves with the cloud's new
   * syncVersion, so keeping those after an interrupted upload lets the device edit the records
   * already written without its next upload being read as a stale copy. `baseline` is the synced
   * baseline to store with them.
   */
  saveSyncedRecords?(
    tournament: Tournament,
    collections: Record<CloudCollectionName, CloudRecord[]>,
    baseline: SyncBaseline
  ): void;
  /** This device's synced baseline; each record the upload writes gets a new entry. */
  baseline?: SyncBaseline;
}): Promise<number> {
  const { tournament, userId, localCollections, deletions, overwrites, repository } = input;
  const cloudTournament = await repository.getTournament(tournament.id);
  if (
    cloudTournament &&
    !input.isGlobalAdmin &&
    cloudTournament.data.ownerId !== userId &&
    (cloudTournament.data.admins as Record<string, boolean> | undefined)?.[userId] !== true
  ) {
    throw new Error("This cloud tournament belongs to another account.");
  }

  const cloudAdmins = cloudTournament
    ? (cloudTournament.data.admins as Record<string, boolean> | undefined) || {}
    : tournament.admins;
  // Ownership and the admin list of an existing cloud tournament are never
  // changed by an upload; Firestore rules reject such writes from non-owners.
  const ownerId = cloudTournament
    ? typeof cloudTournament.data.ownerId === "string"
      ? cloudTournament.data.ownerId
      : tournament.ownerId
    : tournament.ownerId === "local" || tournament.ownerId === "director"
      ? userId
      : tournament.ownerId;
  const admins = cloudTournament
    ? cloudAdmins
    : { ...cloudAdmins, [userId]: true };
  const metadata = {
    ...tournament,
    ownerId,
    admins,
    updatedAt: new Date().toISOString(),
  };
  const metadataConflict = await repository.saveTournament(tournament.id, metadata);
  if (!metadataConflict) tournament.syncVersion = metadata.syncVersion;
  const versionsBeforeUpload = new Map(
    CLOUD_COLLECTIONS.map((name) => [
      name,
      new Map((localCollections[name] || []).map((record) => [record.id, record.syncVersion])),
    ])
  );
  let collectionConflicts: number;
  try {
    collectionConflicts = await repository.syncCollections(
      tournament.id,
      localCollections,
      deletions,
      overwrites
    );
  } finally {
    input.saveSyncedRecords?.(
      tournament,
      localCollections,
      baselineAfterUpload(input.baseline || {}, localCollections, versionsBeforeUpload)
    );
  }
  return collectionConflicts + Number(metadataConflict);
}


/**
 * A record as this device last uploaded or downloaded it: the cloud `syncVersion` it had then
 * (`v`) and a hash of its content (`h`). Stored per tournament in localStorage, by collection and
 * record id, so a download can tell records edited on this device since they were last synced
 * from unchanged records, which can safely take a newer cloud version.
 */
export interface SyncBaselineEntry {
  v: number;
  h: string;
}
export type SyncBaseline = Partial<Record<CloudCollectionName, Record<string, SyncBaselineEntry>>>;

/**
 * A record changed both on this device (since its baseline) and in the cloud. The device keeps its
 * own version until the organiser chooses one; `cloudRecord` is the cloud version seen at download.
 */
export interface DivergedRecord {
  collectionName: CloudCollectionName;
  recordId: string;
  cloudRecord: CloudRecord;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item ?? null)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * A hash of a record's content that ignores key order and the fields the cloud stamps
 * (`syncVersion`, `updatedAt`), so a record hashes the same before upload and after a Firestore
 * round trip. 53-bit cyrb53, not cryptographic: a collision could only make a local edit look
 * unchanged, and then the record takes the cloud version, which is a real state of the record.
 */
export function syncContentHash(record: CloudRecord): string {
  const { syncVersion: _syncVersion, updatedAt: _updatedAt, ...content } = record as CloudRecord & {
    updatedAt?: unknown;
  };
  const text = stableStringify(content);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function syncVersionOf(record: CloudRecord): number {
  return Number(record.syncVersion) || 0;
}

function baselineEntryFor(record: CloudRecord): SyncBaselineEntry {
  return { v: syncVersionOf(record), h: syncContentHash(record) };
}

/**
 * The baseline after an upload. The repository stamps each record it writes with the cloud's new
 * `syncVersion`, so a record whose version changed is now in the cloud exactly as held locally.
 * Other records (a stale-version conflict, or not reached by an interrupted upload) keep their
 * previous entry, and entries of records no longer on the device are dropped.
 */
function baselineAfterUpload(
  baseline: SyncBaseline,
  collections: Record<CloudCollectionName, CloudRecord[]>,
  versionsBeforeUpload: Map<CloudCollectionName, Map<string, number | undefined>>
): SyncBaseline {
  return Object.fromEntries(
    CLOUD_COLLECTIONS.map((name) => {
      const previous = baseline[name] || {};
      const versions = versionsBeforeUpload.get(name);
      const entries: Record<string, SyncBaselineEntry> = {};
      for (const record of collections[name] || []) {
        const written = versions?.has(record.id) && versions.get(record.id) !== record.syncVersion;
        if (written) entries[record.id] = baselineEntryFor(record);
        else if (previous[record.id]) entries[record.id] = previous[record.id];
      }
      return [name, entries];
    })
  ) as SyncBaseline;
}

export async function downloadTournamentCommand(input: {
  tournamentId: string;
  slug: string;
  userId: string;
  isGlobalAdmin?: boolean;
  localTournament: Tournament;
  localCollections: Record<CloudCollectionName, CloudRecord[]>;
  baseline?: SyncBaseline;
  deletions?: CloudDeletionMap;
  overwrites?: CloudOverwriteMap;
  repository: TournamentCloudRepository;
}): Promise<WorkingCopyMerge & { tournament: Tournament }> {
  const {
    tournamentId,
    slug,
    userId,
    localTournament,
    localCollections,
    baseline,
    deletions = {},
    overwrites = {},
    repository,
  } = input;
  const snapshot = await repository.getTournament(tournamentId);
  if (!snapshot) throw new Error("This tournament is not available in Firestore.");
  const cloudAdmins = snapshot.data.admins as Record<string, boolean> | undefined;
  const tournament = {
    ...snapshot.data,
    ...localTournament,
    id: snapshot.id,
    slug,
    ownerId: typeof snapshot.data.ownerId === "string" ? snapshot.data.ownerId : localTournament.ownerId,
    admins: { ...cloudAdmins, ...localTournament.admins },
  } as Tournament;
  if (!input.isGlobalAdmin && tournament.ownerId !== userId && tournament.admins?.[userId] !== true) {
    throw new Error("This cloud tournament belongs to another account.");
  }
  const cloudCollections = await repository.getCollections(tournamentId);
  const merge = mergeCloudIntoWorkingCopy({ cloudCollections, localCollections, baseline, deletions, overwrites });
  return { tournament, ...merge };
}

export interface WorkingCopyMerge {
  collections: Record<CloudCollectionName, CloudRecord[]>;
  /** The baseline to store with `collections`. */
  baseline: SyncBaseline;
  /** Records kept locally although the cloud changed them too; the organiser resolves these. */
  divergedRecords: DivergedRecord[];
}

/**
 * Merges cloud records into the device's working copy without losing local work. For a record on
 * both sides, the device's synced baseline decides:
 * - unchanged here since its baseline, or identical to the cloud: the cloud version is taken, so
 *   self check-ins, private-URL ballot discards, assistant edits and other devices' uploads arrive;
 * - edited here while the cloud is still at the version it was synced at: the edit is kept for upload;
 * - edited here and changed in the cloud: the local version is kept and reported in
 *   `divergedRecords`. It is never overwritten unless the organiser chooses the cloud version.
 * A record with no baseline entry (e.g. synced before baselines existed) counts as edited here,
 * with its own `syncVersion` as the baseline version. Cloud-only records are added, while records
 * soft-deleted in the cloud (`deletedAt`) or pending local deletion (`deletions` tombstones) are
 * dropped. Records restored from a backup (`overwrites`) keep their local version, even if the
 * cloud soft-deleted them. With no local copy (`localCollections` null) this is the cloud state
 * minus soft-deletions.
 */
export function mergeCloudIntoWorkingCopy(input: {
  cloudCollections: Record<CloudCollectionName, CloudRecord[]>;
  localCollections: Record<CloudCollectionName, CloudRecord[]> | null;
  baseline?: SyncBaseline;
  deletions?: CloudDeletionMap;
  overwrites?: CloudOverwriteMap;
}): WorkingCopyMerge {
  const { cloudCollections, localCollections, baseline = {}, deletions = {}, overwrites = {} } = input;
  const divergedRecords: DivergedRecord[] = [];
  const nextBaseline: SyncBaseline = {};
  const collections = Object.fromEntries(
    CLOUD_COLLECTIONS.map((name) => {
      const cloudRecords = cloudCollections[name] || [];
      const previousBaseline = baseline[name] || {};
      const restoredIds = new Set(overwrites[name] || []);
      const deletedIds = new Set(
        cloudRecords
          .filter((record) => typeof record.deletedAt === "string" && !restoredIds.has(record.id))
          .map((record) => record.id)
      );
      for (const deletedId of deletions[name] || []) deletedIds.add(deletedId);
      const recordsById = new Map(
        cloudRecords
          .filter((record) => !deletedIds.has(record.id))
          .map((record) => [record.id, record])
      );
      const entries: Record<string, SyncBaselineEntry> = Object.fromEntries(
        [...recordsById.values()].map((record) => [record.id, baselineEntryFor(record)])
      );
      for (const local of localCollections?.[name] || []) {
        if (deletedIds.has(local.id)) continue;
        const cloud = recordsById.get(local.id);
        const base = previousBaseline[local.id];
        if (!cloud || restoredIds.has(local.id)) {
          recordsById.set(local.id, local);
          if (base) entries[local.id] = base;
          else delete entries[local.id];
          continue;
        }
        const localHash = syncContentHash(local);
        // In sync, or unchanged here since the last sync: the cloud version (already in place) is current.
        if (localHash === entries[local.id].h || base?.h === localHash) continue;
        recordsById.set(local.id, local);
        // The record carries the version it was synced at, like its baseline entry; both must
        // match, so a record whose baseline was saved without it (a failed local write) is flagged.
        const cloudVersion = syncVersionOf(cloud);
        if (syncVersionOf(local) === cloudVersion && (!base || base.v === cloudVersion)) {
          // Edited only here. Without an entry, the cloud version is the one the edit started from.
          if (base) entries[local.id] = base;
        } else {
          divergedRecords.push({ collectionName: name, recordId: local.id, cloudRecord: cloud });
          if (base) entries[local.id] = base;
          else delete entries[local.id];
        }
      }
      nextBaseline[name] = entries;
      return [name, [...recordsById.values()]];
    })
  ) as Record<CloudCollectionName, CloudRecord[]>;
  return { collections, baseline: nextBaseline, divergedRecords };
}

/**
 * Applies the organiser's choice for diverged records. "cloud" replaces this device's version with
 * the cloud version seen at download. "local" keeps this device's version and adopts the cloud's
 * `syncVersion`, so the next upload replaces the cloud version (archiving it in `syncConflicts`,
 * as every replaced version is). Either way the record is then based on that cloud version, so a
 * later download treats it like any other synced record.
 */
export function resolveDivergedRecords(input: {
  localCollections: Record<CloudCollectionName, CloudRecord[]>;
  baseline: SyncBaseline;
  divergedRecords: DivergedRecord[];
  keep: "cloud" | "local";
}): { collections: Record<CloudCollectionName, CloudRecord[]>; baseline: SyncBaseline } {
  const { divergedRecords, keep } = input;
  const collections = { ...input.localCollections };
  const baseline: SyncBaseline = { ...input.baseline };
  for (const { collectionName, recordId, cloudRecord } of divergedRecords) {
    const records = collections[collectionName] || [];
    if (!records.some((record) => record.id === recordId)) continue;
    collections[collectionName] = records.map((record) => {
      if (record.id !== recordId) return record;
      return keep === "cloud" ? cloudRecord : { ...record, syncVersion: cloudRecord.syncVersion };
    });
    baseline[collectionName] = { ...baseline[collectionName], [recordId]: baselineEntryFor(cloudRecord) };
  }
  return { collections, baseline };
}

function isBaselineEntry(value: unknown): value is SyncBaselineEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.v === "number" && Number.isFinite(entry.v) && typeof entry.h === "string";
}

/**
 * Reads a stored baseline. Malformed entries are skipped rather than rejected: a record without an
 * entry counts as edited here, which keeps its local version, so nothing is lost.
 */
export function parseSyncBaseline(value: unknown): SyncBaseline {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const baseline: SyncBaseline = {};
  for (const name of CLOUD_COLLECTIONS) {
    const stored = (value as Record<string, unknown>)[name];
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) continue;
    baseline[name] = Object.fromEntries(
      Object.entries(stored).filter(([, entry]) => isBaselineEntry(entry))
    ) as Record<string, SyncBaselineEntry>;
  }
  return baseline;
}

/** Reads stored diverged records, skipping malformed ones; the next download lists them again. */
export function parseDivergedRecords(value: unknown): DivergedRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is DivergedRecord => {
    if (!item || typeof item !== "object") return false;
    const record = item as Record<string, unknown>;
    const cloudRecord = record.cloudRecord as Record<string, unknown> | null | undefined;
    return (
      CLOUD_COLLECTIONS.includes(record.collectionName as CloudCollectionName) &&
      typeof record.recordId === "string" &&
      !!cloudRecord &&
      typeof cloudRecord === "object" &&
      cloudRecord.id === record.recordId
    );
  });
}

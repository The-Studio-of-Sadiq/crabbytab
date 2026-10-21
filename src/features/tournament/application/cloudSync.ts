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
  "ballotIntake",
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
  /**
   * Makes sure every cloud debate carries its participant index (one pass per tournament, then a
   * single read per upload). `createdByThisUpload`: the tournament was new in the cloud, so every
   * debate in it was just written with the index. Returns how many debates it updated.
   */
  ensureParticipantIndex?(tournamentId: string, options?: { createdByThisUpload?: boolean }): Promise<number>;
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
  /** The staff member's permissions: conflicts are sent only by staff who can see them. */
  permissions?: readonly string[];
}): {
  collections: Record<(typeof DATA_ENTRY_COLLECTIONS)[number], CloudRecord[]>;
  debates: CloudRecord[];
} {
  const collections = Object.fromEntries(
    DATA_ENTRY_COLLECTIONS.map((name) => [name, input.localCollections[name]])
  ) as Record<(typeof DATA_ENTRY_COLLECTIONS)[number], CloudRecord[]>;
  collections.teams = input.localCollections.teams.map(
    (record) => sanitizeAssistantTeam(record as unknown as Team, input.permissions) as unknown as CloudRecord
  );
  collections.adjudicators = input.localCollections.adjudicators.map(
    (record) => sanitizeAssistantAdjudicator(record as unknown as Adjudicator, input.permissions) as unknown as CloudRecord
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
      recordsChangedSinceBaseline(localCollections, input.baseline || {}, overwrites || {}),
      deletions,
      overwrites
    );
    try {
      await repository.ensureParticipantIndex?.(tournament.id, { createdByThisUpload: !cloudTournament });
    } catch (error) {
      // The records are uploaded; private portals read every debate until a later upload indexes them.
      console.warn("Could not index debates by participant:", error);
    }
  } finally {
    const baseline = baselineAfterUpload(input.baseline || {}, localCollections, versionsBeforeUpload);
    // The settings were written (or already matched the cloud) unless the upload hit a newer version.
    baseline.tournament = metadataConflict ? input.baseline?.tournament : baselineEntryFor(tournament);
    input.saveSyncedRecords?.(tournament, localCollections, baseline);
  }
  return collectionConflicts + Number(metadataConflict);
}


/**
 * The records an upload sends: those without a baseline entry (never synced from this device, or
 * synced before baselines existed), those whose content or version changed since their entry, and
 * those restored from a backup. A record unchanged since the last sync is already in the cloud as
 * held here, so sending it would only cost a read (or, if another device changed it meanwhile,
 * archive this device's stale copy as a conflict). The arrays hold the same record objects, so the
 * repository's syncVersion stamps reach the working copy.
 */
export function recordsChangedSinceBaseline(
  collections: Record<CloudCollectionName, CloudRecord[]>,
  baseline: SyncBaseline,
  overwrites: CloudOverwriteMap = {}
): Record<CloudCollectionName, CloudRecord[]> {
  return Object.fromEntries(
    CLOUD_COLLECTIONS.map((name) => {
      const entries = baseline[name] || {};
      const restored = new Set(overwrites[name] || []);
      return [
        name,
        (collections[name] || []).filter((record) => {
          const entry = entries[record.id];
          return (
            !entry ||
            restored.has(record.id) ||
            entry.v !== syncVersionOf(record) ||
            entry.h !== syncContentHash(record)
          );
        }),
      ];
    })
  ) as Record<CloudCollectionName, CloudRecord[]>;
}

/**
 * A record as this device last uploaded or downloaded it: the cloud `syncVersion` it had then
 * (`v`) and a hash of its content (`h`). Stored per tournament in the working copy, by collection and
 * record id (and `tournament` for the tournament's settings), so a download can tell records
 * edited on this device since they were last synced from unchanged records, which can safely take
 * a newer cloud version.
 */
export interface SyncBaselineEntry {
  v: number;
  h: string;
}
export type SyncBaseline = Partial<Record<CloudCollectionName, Record<string, SyncBaselineEntry>>> & {
  tournament?: SyncBaselineEntry;
};

/** The tournament document itself (settings), alongside the record collections. */
export const TOURNAMENT_SETTINGS = "tournament";
export type SyncedRecordKind = CloudCollectionName | typeof TOURNAMENT_SETTINGS;

/**
 * A record changed both on this device (since its baseline) and in the cloud. The device keeps its
 * own version until someone chooses one; `cloudRecord` is the cloud version seen at download.
 */
export interface DivergedRecord {
  collectionName: SyncedRecordKind;
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
  const { syncVersion: _syncVersion, updatedAt: _updatedAt, participantIds: _participantIds, ...content } = record as CloudRecord & {
    updatedAt?: unknown;
    participantIds?: unknown;
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

export function syncVersionOf(record: CloudRecord): number {
  return Number(record.syncVersion) || 0;
}

export function baselineEntryFor(record: CloudRecord): SyncBaselineEntry {
  return { v: syncVersionOf(record), h: syncContentHash(record) };
}

/**
 * How a record on both sides merges, given this device's baseline entry for it:
 * - "cloud": identical to the cloud, or unchanged here since the last sync, so the cloud version
 *   is current (this is how check-ins, ballot discards and other devices' writes arrive);
 * - "local": edited here while the cloud still holds the version the edit started from, so the
 *   edit is kept for upload;
 * - "diverged": edited here and changed in the cloud, so both versions matter.
 * The cloud counts as changed when its content or version differs from the baseline, so a server
 * write that does not bump `syncVersion` is still noticed. Without an entry (synced before
 * baselines existed), the record's own `syncVersion` is the version it started from. That version
 * must match the cloud's too, so a record whose baseline was saved without it is flagged.
 */
export function classifyAgainstBaseline(
  local: CloudRecord,
  cloud: CloudRecord,
  base: SyncBaselineEntry | undefined
): "cloud" | "local" | "diverged" {
  const localHash = syncContentHash(local);
  const cloudHash = syncContentHash(cloud);
  if (localHash === cloudHash || base?.h === localHash) return "cloud";
  const cloudVersion = syncVersionOf(cloud);
  const cloudChanged = base ? base.h !== cloudHash || base.v !== cloudVersion : false;
  return !cloudChanged && syncVersionOf(local) === cloudVersion ? "local" : "diverged";
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

/**
 * The baseline after a data-entry assistant's sync. The server applied every record it was sent
 * except the `rejected` ones (archived for the tab room instead), so the others now count as
 * synced in the version this device holds, and the next load takes the server's result for them.
 * Rejected records keep their previous entry, so they stay local edits (or are flagged as
 * diverged once the cloud changes them).
 */
export function baselineAfterDataEntrySync(input: {
  baseline: SyncBaseline;
  sentCollections: Partial<Record<CloudCollectionName, CloudRecord[]>>;
  rejected: Array<{ collectionName: string; recordId: string }>;
}): SyncBaseline {
  const rejected = new Set(input.rejected.map(({ collectionName, recordId }) => `${collectionName}/${recordId}`));
  const baseline: SyncBaseline = { ...input.baseline };
  for (const name of CLOUD_COLLECTIONS) {
    const sent = input.sentCollections[name];
    if (!sent) continue;
    const entries = { ...baseline[name] };
    for (const record of sent) {
      if (!rejected.has(`${name}/${record.id}`)) entries[record.id] = baselineEntryFor(record);
    }
    baseline[name] = entries;
  }
  return baseline;
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
    baseline = {},
    deletions = {},
    overwrites = {},
    repository,
  } = input;
  const snapshot = await repository.getTournament(tournamentId);
  if (!snapshot) throw new Error("This tournament is not available in Firestore.");
  const cloudAdmins = snapshot.data.admins as Record<string, boolean> | undefined;
  const ownerId = typeof snapshot.data.ownerId === "string" ? snapshot.data.ownerId : localTournament.ownerId;
  const admins = { ...cloudAdmins, ...localTournament.admins };
  if (!input.isGlobalAdmin && ownerId !== userId && admins[userId] !== true) {
    throw new Error("This cloud tournament belongs to another account.");
  }
  const settings = mergeCloudTournament({
    cloudTournament: { ...snapshot.data, id: snapshot.id, slug } as Tournament,
    localTournament,
    base: baseline.tournament,
  });
  const cloudCollections = await repository.getCollections(tournamentId);
  const merge = mergeCloudIntoWorkingCopy({ cloudCollections, localCollections, baseline, deletions, overwrites });
  return {
    tournament: settings.tournament,
    collections: merge.collections,
    baseline: { ...merge.baseline, tournament: settings.baseline },
    divergedRecords: settings.diverged ? [settings.diverged, ...merge.divergedRecords] : merge.divergedRecords,
  };
}

/**
 * Merges the cloud's tournament settings into this device's copy with the same rule as records
 * (see `classifyAgainstBaseline`). A kept local copy takes the cloud's owner and adds its admins,
 * which an upload never changes. With no local copy, the cloud settings are used.
 */
export function mergeCloudTournament(input: {
  cloudTournament: Tournament;
  localTournament: Tournament | null;
  base?: SyncBaselineEntry;
}): { tournament: Tournament; baseline?: SyncBaselineEntry; diverged?: DivergedRecord } {
  const { cloudTournament, localTournament, base } = input;
  if (!localTournament) return { tournament: cloudTournament, baseline: baselineEntryFor(cloudTournament) };
  const outcome = classifyAgainstBaseline(localTournament, cloudTournament, base);
  if (outcome === "cloud") return { tournament: cloudTournament, baseline: baselineEntryFor(cloudTournament) };
  const tournament = {
    ...cloudTournament,
    ...localTournament,
    id: cloudTournament.id,
    slug: cloudTournament.slug,
    ownerId: typeof cloudTournament.ownerId === "string" ? cloudTournament.ownerId : localTournament.ownerId,
    admins: { ...cloudTournament.admins, ...localTournament.admins },
  } as Tournament;
  if (outcome === "local") return { tournament, baseline: base ?? baselineEntryFor(cloudTournament) };
  return {
    tournament,
    baseline: base,
    diverged: { collectionName: TOURNAMENT_SETTINGS, recordId: cloudTournament.id, cloudRecord: cloudTournament },
  };
}

export interface WorkingCopyMerge {
  collections: Record<CloudCollectionName, CloudRecord[]>;
  /** The baseline to store with `collections`. */
  baseline: SyncBaseline;
  /** Records kept locally although the cloud changed them too; someone has to choose a version. */
  divergedRecords: DivergedRecord[];
}

/**
 * Merges cloud records into the device's working copy without losing local work. A record on both
 * sides takes the cloud version, keeps the local edit, or is kept and reported in `divergedRecords`
 * (see `classifyAgainstBaseline`); a diverged record is never overwritten unless someone chooses
 * the cloud version. Cloud-only records are added, while records soft-deleted in the cloud
 * (`deletedAt`) or pending local deletion (`deletions` tombstones) are dropped. Records restored
 * from a backup (`overwrites`) keep their local version, even if the cloud soft-deleted them.
 * `cloudOmitsDeleted` is for a cloud copy that leaves deleted or hidden records out (a data-entry
 * assistant's projection): a local record missing from it that is unchanged since its baseline is
 * dropped, while one edited here is kept. With no local copy (`localCollections` null) this is the
 * cloud state minus soft-deletions.
 */
export function mergeCloudIntoWorkingCopy(input: {
  cloudCollections: Record<CloudCollectionName, CloudRecord[]>;
  localCollections: Record<CloudCollectionName, CloudRecord[]> | null;
  baseline?: SyncBaseline;
  deletions?: CloudDeletionMap;
  overwrites?: CloudOverwriteMap;
  cloudOmitsDeleted?: boolean;
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
        if (!cloud && input.cloudOmitsDeleted && base?.h === syncContentHash(local)) continue;
        if (!cloud || restoredIds.has(local.id)) {
          recordsById.set(local.id, local);
          if (base) entries[local.id] = base;
          else delete entries[local.id];
          continue;
        }
        const outcome = classifyAgainstBaseline(local, cloud, base);
        // The cloud version and its entry are already in place.
        if (outcome === "cloud") continue;
        recordsById.set(local.id, local);
        if (outcome === "diverged") {
          divergedRecords.push({ collectionName: name, recordId: local.id, cloudRecord: cloud });
        }
        // Without an entry, a local edit started from the cloud version (whose entry is in place);
        // a diverged record without one stays without, so it is flagged until resolved.
        if (base) entries[local.id] = base;
        else if (outcome === "diverged") delete entries[local.id];
      }
      nextBaseline[name] = entries;
      return [name, [...recordsById.values()]];
    })
  ) as Record<CloudCollectionName, CloudRecord[]>;
  return { collections, baseline: nextBaseline, divergedRecords };
}

/**
 * Applies a choice for some diverged records. "cloud" replaces this device's version with the
 * cloud version seen at download. "local" keeps this device's version and adopts the cloud's
 * `syncVersion`, so the next upload replaces the cloud version (archiving it in `syncConflicts`, as
 * every replaced version is). Either way the record is then based on that cloud version, so a later
 * download treats it like any other synced record. Returns the records still diverged.
 */
export function resolveDivergedRecords(input: {
  localTournament: Tournament;
  localCollections: Record<CloudCollectionName, CloudRecord[]>;
  baseline: SyncBaseline;
  divergedRecords: DivergedRecord[];
  /** The records to resolve, as `divergedRecordKey`s; all of them when omitted. */
  keys?: string[];
  keep: "cloud" | "local";
}): {
  tournament: Tournament;
  collections: Record<CloudCollectionName, CloudRecord[]>;
  baseline: SyncBaseline;
  remaining: DivergedRecord[];
} {
  const { keep } = input;
  const selected = input.keys ? new Set(input.keys) : null;
  const isSelected = (record: DivergedRecord) => !selected || selected.has(divergedRecordKey(record));
  let tournament = input.localTournament;
  const collections = { ...input.localCollections };
  const baseline: SyncBaseline = { ...input.baseline };
  const adopt = <T extends CloudRecord>(local: T, cloudRecord: CloudRecord): T =>
    keep === "cloud" ? cloudRecord as T : { ...local, syncVersion: cloudRecord.syncVersion };
  for (const diverged of input.divergedRecords.filter(isSelected)) {
    const { collectionName, recordId, cloudRecord } = diverged;
    if (collectionName === TOURNAMENT_SETTINGS) {
      tournament = adopt(tournament, cloudRecord);
      baseline.tournament = baselineEntryFor(cloudRecord);
      continue;
    }
    const records = collections[collectionName] || [];
    if (!records.some((record) => record.id === recordId)) continue;
    collections[collectionName] = records.map((record) => record.id === recordId ? adopt(record, cloudRecord) : record);
    baseline[collectionName] = { ...baseline[collectionName], [recordId]: baselineEntryFor(cloudRecord) };
  }
  return {
    tournament,
    collections,
    baseline,
    remaining: input.divergedRecords.filter((record) => !isSelected(record)),
  };
}

export function divergedRecordKey(record: Pick<DivergedRecord, "collectionName" | "recordId">): string {
  return `${record.collectionName}/${record.recordId}`;
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
  const stored = value as Record<string, unknown>;
  const baseline: SyncBaseline = {};
  for (const name of CLOUD_COLLECTIONS) {
    const entries = stored[name];
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) continue;
    baseline[name] = Object.fromEntries(
      Object.entries(entries).filter(([, entry]) => isBaselineEntry(entry))
    ) as Record<string, SyncBaselineEntry>;
  }
  if (isBaselineEntry(stored.tournament)) baseline.tournament = stored.tournament;
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
      (record.collectionName === TOURNAMENT_SETTINGS ||
        CLOUD_COLLECTIONS.includes(record.collectionName as CloudCollectionName)) &&
      typeof record.recordId === "string" &&
      !!cloudRecord &&
      typeof cloudRecord === "object" &&
      cloudRecord.id === record.recordId
    );
  });
}

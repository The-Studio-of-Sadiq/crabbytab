import type { Tournament } from "@/types";
import { CLOUD_COLLECTIONS, type CloudCollectionName, type CloudRecord } from "@/features/tournament/collections";
import {
  syncContentHash,
  TOURNAMENT_SETTINGS,
  type CloudDeletionMap,
  type CloudOverwriteMap,
  type SyncBaseline,
  type SyncedRecordKind,
} from "@/features/tournament/application/cloudSync";

/**
 * How honest the cloud copy (and the public pages published from it) is relative to this device.
 * Admin mutations only change local state; the cloud changes on Upload, and public pages change
 * when an upload (or Republish) publishes the cloud copy. These pure helpers decide what the shell
 * shows and which publish actions are safe.
 */

export interface PendingCollectionChanges {
  collection: SyncedRecordKind;
  /** Records on this device the cloud has never stored. */
  added: number;
  /** Records edited here since they were last uploaded or downloaded, or restored from a backup. */
  changed: number;
  /** Records deleted here whose deletion has not been uploaded. */
  deleted: number;
}

export interface PendingChanges {
  total: number;
  /** Only collections with at least one pending change, in `CLOUD_COLLECTIONS` order (settings first). */
  collections: PendingCollectionChanges[];
}

export const NO_PENDING_CHANGES: PendingChanges = { total: 0, collections: [] };

/**
 * Records changed on this device since they were last synced, from the synced baseline (see
 * `SyncBaselineEntry`). A record with a baseline entry is changed when its content hash differs;
 * one without an entry is new unless it carries a cloud `syncVersion` (synced before baselines
 * existed, or kept locally after an upload conflict), which counts as changed because nothing
 * proves it matches the cloud. Pending tombstones count as deletions and pending backup restores
 * as changes.
 */
export function computePendingChanges(input: {
  tournament: Tournament | null;
  collections: Partial<Record<CloudCollectionName, CloudRecord[]>>;
  baseline: SyncBaseline;
  deletions?: CloudDeletionMap;
  overwrites?: CloudOverwriteMap;
}): PendingChanges {
  const { tournament, collections, baseline, deletions = {}, overwrites = {} } = input;
  const result: PendingCollectionChanges[] = [];
  if (tournament) {
    const entry = baseline.tournament;
    if (!entry || entry.h !== syncContentHash(tournament)) {
      const isNew = !entry && !(Number(tournament.syncVersion) > 0);
      result.push({ collection: TOURNAMENT_SETTINGS, added: isNew ? 1 : 0, changed: isNew ? 0 : 1, deleted: 0 });
    }
  }
  for (const name of CLOUD_COLLECTIONS) {
    const entries = baseline[name] || {};
    const restored = new Set(overwrites[name] || []);
    const deletedIds = new Set(deletions[name] || []);
    let added = 0;
    let changed = 0;
    for (const record of collections[name] || []) {
      if (deletedIds.has(record.id)) continue;
      const entry = entries[record.id];
      if (restored.has(record.id)) changed += 1;
      else if (!entry) {
        if (Number(record.syncVersion) > 0) changed += 1;
        else added += 1;
      } else if (entry.h !== syncContentHash(record)) changed += 1;
    }
    const deleted = deletedIds.size;
    if (added + changed + deleted > 0) result.push({ collection: name, added, changed, deleted });
  }
  return {
    total: result.reduce((sum, item) => sum + item.added + item.changed + item.deleted, 0),
    collections: result,
  };
}

/**
 * Reads a stored per-collection id list (tombstones or restores) for display only: malformed
 * entries are skipped. The upload path validates these strictly and refuses invalid data.
 */
export function parseCloudIdMap(value: unknown): CloudDeletionMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const stored = value as Record<string, unknown>;
  const ids: CloudDeletionMap = {};
  for (const name of CLOUD_COLLECTIONS) {
    const list = stored[name];
    if (Array.isArray(list)) ids[name] = list.filter((id): id is string => typeof id === "string");
  }
  return ids;
}

const COLLECTION_LABELS: Record<SyncedRecordKind, string> = {
  tournament: "Tournament settings",
  rounds: "Rounds",
  teams: "Teams",
  adjudicators: "Adjudicators",
  venues: "Rooms",
  motions: "Motions",
  breakCategories: "Break categories",
  debates: "Draws and allocations",
  ballots: "Ballots",
  feedback: "Feedback",
  institutions: "Institutions",
  auditEvents: "Audit log",
};

export function pendingCollectionLabel(collection: SyncedRecordKind): string {
  return COLLECTION_LABELS[collection];
}

export function describePendingCollection(item: PendingCollectionChanges): string {
  const parts = [
    item.added > 0 ? `${item.added} new` : "",
    item.changed > 0 ? `${item.changed} changed` : "",
    item.deleted > 0 ? `${item.deleted} deleted` : "",
  ].filter(Boolean);
  return `${pendingCollectionLabel(item.collection)}: ${parts.join(", ")}`;
}

/**
 * The last upload did not leave the cloud matching this device: some records were archived as
 * sync conflicts (the cloud held a newer or deleted version), or the upload stopped part-way.
 * Either way the cloud copy is not one consistent state, so it must not be published until the
 * issue is resolved (Download and choose versions, or Upload again).
 */
export type UploadIssue =
  | { kind: "conflicts"; count: number; at: string }
  | { kind: "partial"; message: string; at: string };

export function parseUploadIssue(value: unknown): UploadIssue | null {
  if (!value || typeof value !== "object") return null;
  const issue = value as Record<string, unknown>;
  if (typeof issue.at !== "string") return null;
  if (issue.kind === "conflicts" && typeof issue.count === "number" && issue.count > 0) {
    return { kind: "conflicts", count: issue.count, at: issue.at };
  }
  if (issue.kind === "partial" && typeof issue.message === "string") {
    return { kind: "partial", message: issue.message, at: issue.at };
  }
  return null;
}

export function describeUploadIssue(issue: UploadIssue): string {
  return issue.kind === "conflicts"
    ? `${issue.count} record(s) were not uploaded because the cloud holds a newer or deleted version. ` +
        "Their cloud versions are archived for recovery. Download to compare and choose a version, then upload again."
    : `The last upload stopped part-way (${issue.message}). The cloud holds a mix of old and new records. Upload again to finish.`;
}

/**
 * Whether an upload may publish public pages. Records archived as conflicts are not in the cloud,
 * so publishing would show the public a state that mixes this device's changes with older versions.
 */
export function publishBlockerAfterUpload(conflicts: number): string | null {
  return conflicts > 0
    ? `Public pages were not updated: ${conflicts} record(s) conflicted with newer cloud versions. ` +
        "Download to compare and choose versions, then upload again to publish."
    : null;
}

export type RepublishPlan =
  | { kind: "publish" }
  /** Publishing would serve the cloud copy, which lacks this device's pending changes. */
  | { kind: "confirm-pending"; pendingTotal: number }
  | { kind: "blocked"; reason: string };

/** Republish publishes the cloud copy as it stands, so it is checked against this device's state. */
export function planRepublish(input: {
  pendingTotal: number;
  uploadIssue: UploadIssue | null;
}): RepublishPlan {
  if (input.uploadIssue) {
    return {
      kind: "blocked",
      reason: `Public pages cannot be republished yet. ${describeUploadIssue(input.uploadIssue)}`,
    };
  }
  if (input.pendingTotal > 0) return { kind: "confirm-pending", pendingTotal: input.pendingTotal };
  return { kind: "publish" };
}

export type ReleaseSyncPlan =
  /** Save the release, upload this device's changes and publish, as one action. */
  | { kind: "upload"; otherPendingTotal: number }
  /** No cloud sync from this device: the release only changes this device's copy. */
  | { kind: "local-only"; reason: string }
  | { kind: "blocked"; reason: string };

/**
 * How a release (draw, results, motions, tabs, breaks, participant lists) reaches the public.
 * Public pages are served from the cloud copy, so a release is only public once it is uploaded and
 * published; doing that as part of the release keeps the "Public" label honest. A release is
 * refused when the upload could not publish: offline, or records known to conflict with the cloud.
 */
export function planReleaseSync(input: {
  cloudConfigured: boolean;
  signedIn: boolean;
  canUpload: boolean;
  online: boolean;
  pendingTotal: number;
  divergedCount: number;
  uploadIssue: UploadIssue | null;
}): ReleaseSyncPlan {
  if (!input.cloudConfigured) {
    return {
      kind: "local-only",
      reason: "Cloud sync is not configured, so this change only affects public pages opened on this device.",
    };
  }
  if (!input.signedIn || !input.canUpload) {
    return {
      kind: "local-only",
      reason:
        "You are not signed in as a tournament administrator, so this change is saved on this device only. " +
        "Public pages for everyone else change after an administrator uploads it.",
    };
  }
  if (!input.online) {
    return {
      kind: "blocked",
      reason: "You are offline. Releases are uploaded and published as one step; connect to the internet and try again.",
    };
  }
  if (input.divergedCount > 0) {
    return {
      kind: "blocked",
      reason: `${input.divergedCount} record(s) changed both here and in the cloud. Resolve the sync conflicts first; otherwise the upload could not publish this release.`,
    };
  }
  if (input.uploadIssue?.kind === "conflicts") {
    return { kind: "blocked", reason: describeUploadIssue(input.uploadIssue) };
  }
  return { kind: "upload", otherPendingTotal: input.pendingTotal };
}

/**
 * Leaving the page loses nothing stored on this device, but changes not yet uploaded are not in the
 * cloud or on public pages, and an upload in flight may stop part-way.
 */
export function shouldWarnBeforeUnload(input: {
  cloudSyncEnabled: boolean;
  pendingTotal: number;
  cloudBusy: boolean;
}): boolean {
  if (input.cloudBusy) return true;
  return input.cloudSyncEnabled && input.pendingTotal > 0;
}

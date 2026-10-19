import { describe, expect, it } from "vitest";

import type { Tournament } from "@/types";
import { CLOUD_COLLECTIONS, type CloudCollectionName, type CloudRecord } from "../collections";
import {
  syncContentHash,
  uploadTournamentCommand,
  type SyncBaseline,
  type TournamentCloudRepository,
} from "./cloudSync";
import {
  computePendingChanges,
  describePendingCollection,
  parseUploadIssue,
  planReleaseSync,
  planRepublish,
  publishBlockerAfterUpload,
  shouldWarnBeforeUnload,
} from "./syncStatus";

const tournament = {
  id: "t1",
  name: "Test",
  slug: "test",
  format: "bp",
  ownerId: "owner",
  admins: {},
  preferences: {},
  syncVersion: 3,
} as unknown as Tournament;

function collections(
  overrides: Partial<Record<CloudCollectionName, CloudRecord[]>> = {}
): Record<CloudCollectionName, CloudRecord[]> {
  return {
    ...(Object.fromEntries(CLOUD_COLLECTIONS.map((name) => [name, []])) as unknown as Record<
      CloudCollectionName,
      CloudRecord[]
    >),
    ...overrides,
  };
}

const entry = (record: CloudRecord) => ({ v: Number(record.syncVersion) || 0, h: syncContentHash(record) });

describe("computePendingChanges", () => {
  const synced = { id: "a", name: "Alpha", syncVersion: 2 } as CloudRecord;
  const baseline: SyncBaseline = { tournament: entry(tournament), teams: { a: entry(synced) } };

  it("reports nothing when every record matches its baseline", () => {
    expect(computePendingChanges({ tournament, collections: collections({ teams: [synced] }), baseline })).toEqual({
      total: 0,
      collections: [],
    });
  });

  it("ignores cloud-stamped fields when comparing", () => {
    const restamped = { ...synced, syncVersion: 9, updatedAt: "2026-01-01" } as CloudRecord;
    expect(computePendingChanges({ tournament, collections: collections({ teams: [restamped] }), baseline }).total).toBe(0);
  });

  it("counts added, changed and deleted records per collection", () => {
    const pending = computePendingChanges({
      tournament: { ...tournament, name: "Renamed" },
      collections: collections({
        teams: [{ ...synced, name: "Edited" } as CloudRecord, { id: "new" }],
        venues: [{ id: "legacy", syncVersion: 4 }],
      }),
      baseline,
      deletions: { adjudicators: ["gone"] },
    });
    expect(pending.collections).toEqual([
      { collection: "tournament", added: 0, changed: 1, deleted: 0 },
      { collection: "teams", added: 1, changed: 1, deleted: 0 },
      { collection: "adjudicators", added: 0, changed: 0, deleted: 1 },
      { collection: "venues", added: 0, changed: 1, deleted: 0 },
    ]);
    expect(pending.total).toBe(5);
    expect(describePendingCollection(pending.collections[1])).toBe("Teams: 1 new, 1 changed");
  });

  it("counts a backup restore as a change even when the content matches", () => {
    const pending = computePendingChanges({
      tournament,
      collections: collections({ teams: [synced] }),
      baseline,
      overwrites: { teams: ["a"] },
    });
    expect(pending.collections).toEqual([{ collection: "teams", added: 0, changed: 1, deleted: 0 }]);
  });

  it("treats a never-synced tournament as new", () => {
    const pending = computePendingChanges({
      tournament: { ...tournament, syncVersion: undefined },
      collections: collections(),
      baseline: {},
    });
    expect(pending.collections).toEqual([{ collection: "tournament", added: 1, changed: 0, deleted: 0 }]);
  });

  it("is empty after an upload stores the new baseline", async () => {
    let stored: SyncBaseline = {};
    const local = collections({ teams: [{ id: "a", name: "Alpha" } as CloudRecord], rounds: [{ id: "r1" }] });
    const localTournament = { ...tournament, syncVersion: undefined };
    const repository: TournamentCloudRepository = {
      getTournament: async () => null,
      findTournamentBySlug: async () => null,
      saveTournament: async (_id, value) => {
        value.syncVersion = 1;
        return false;
      },
      getCollections: async () => collections(),
      syncCollections: async (_id, records) => {
        for (const name of CLOUD_COLLECTIONS) for (const record of records[name]) record.syncVersion = 1;
        return 0;
      },
      getSyncConflicts: async () => [],
    };
    expect(computePendingChanges({ tournament: localTournament, collections: local, baseline: {} }).total).toBe(3);
    await uploadTournamentCommand({
      tournament: localTournament,
      userId: "owner",
      localCollections: local,
      repository,
      saveSyncedRecords: (_tournament, _collections, baseline) => {
        stored = baseline;
      },
    });
    expect(computePendingChanges({ tournament: localTournament, collections: local, baseline: stored }).total).toBe(0);
  });
});

describe("publish gating", () => {
  it("refuses to publish after an upload with conflicts", () => {
    expect(publishBlockerAfterUpload(0)).toBeNull();
    expect(publishBlockerAfterUpload(2)).toMatch(/not updated: 2 record/);
  });

  it("blocks republish while the last upload left conflicts or stopped part-way", () => {
    expect(planRepublish({ pendingTotal: 0, uploadIssue: { kind: "conflicts", count: 1, at: "x" } }).kind).toBe("blocked");
    const partial = planRepublish({ pendingTotal: 0, uploadIssue: { kind: "partial", message: "network", at: "x" } });
    expect(partial).toMatchObject({ kind: "blocked" });
    expect(partial.kind === "blocked" && partial.reason).toMatch(/Upload again/);
  });

  it("asks before republishing a cloud copy that lacks local changes", () => {
    expect(planRepublish({ pendingTotal: 4, uploadIssue: null })).toEqual({ kind: "confirm-pending", pendingTotal: 4 });
    expect(planRepublish({ pendingTotal: 0, uploadIssue: null })).toEqual({ kind: "publish" });
  });

  it("parses only well-formed stored upload issues", () => {
    expect(parseUploadIssue({ kind: "conflicts", count: 2, at: "now" })).toEqual({ kind: "conflicts", count: 2, at: "now" });
    expect(parseUploadIssue({ kind: "partial", message: "m", at: "now" })).toEqual({ kind: "partial", message: "m", at: "now" });
    expect(parseUploadIssue({ kind: "conflicts", count: 0, at: "now" })).toBeNull();
    expect(parseUploadIssue({ kind: "other", at: "now" })).toBeNull();
    expect(parseUploadIssue("nonsense")).toBeNull();
  });
});

describe("planReleaseSync", () => {
  const ready = {
    cloudConfigured: true,
    signedIn: true,
    canUpload: true,
    online: true,
    pendingTotal: 0,
    divergedCount: 0,
    uploadIssue: null,
  };

  it("uploads and publishes with the release, reporting other pending changes", () => {
    expect(planReleaseSync(ready)).toEqual({ kind: "upload", otherPendingTotal: 0 });
    expect(planReleaseSync({ ...ready, pendingTotal: 7 })).toEqual({ kind: "upload", otherPendingTotal: 7 });
  });

  it("is local-only without cloud sync from this device", () => {
    expect(planReleaseSync({ ...ready, cloudConfigured: false }).kind).toBe("local-only");
    expect(planReleaseSync({ ...ready, signedIn: false }).kind).toBe("local-only");
    expect(planReleaseSync({ ...ready, canUpload: false }).kind).toBe("local-only");
  });

  it("refuses while offline or while known conflicts would stop the publish", () => {
    expect(planReleaseSync({ ...ready, online: false }).kind).toBe("blocked");
    expect(planReleaseSync({ ...ready, divergedCount: 1 }).kind).toBe("blocked");
    expect(planReleaseSync({ ...ready, uploadIssue: { kind: "conflicts", count: 1, at: "x" } }).kind).toBe("blocked");
  });

  it("retries a part-way upload as part of the release", () => {
    expect(planReleaseSync({ ...ready, uploadIssue: { kind: "partial", message: "m", at: "x" } }).kind).toBe("upload");
  });
});

describe("shouldWarnBeforeUnload", () => {
  it("warns about unuploaded changes only when cloud sync is in use", () => {
    expect(shouldWarnBeforeUnload({ cloudSyncEnabled: true, pendingTotal: 1, cloudBusy: false })).toBe(true);
    expect(shouldWarnBeforeUnload({ cloudSyncEnabled: true, pendingTotal: 0, cloudBusy: false })).toBe(false);
    expect(shouldWarnBeforeUnload({ cloudSyncEnabled: false, pendingTotal: 5, cloudBusy: false })).toBe(false);
  });

  it("always warns while a cloud operation is in flight", () => {
    expect(shouldWarnBeforeUnload({ cloudSyncEnabled: false, pendingTotal: 0, cloudBusy: true })).toBe(true);
  });
});

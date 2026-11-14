import { describe, expect, it } from "vitest";

import type { CloudCollectionName, CloudRecord } from "../collections";
import { syncContentHash, type DivergedRecord, type SyncBaseline } from "./cloudSync";
import {
  advanceCursor,
  collectionsNeedingFullRead,
  cursorFromFullRead,
  cursorMatchesAggregate,
  deltaStart,
  DELTA_OVERLAP_MS,
  localCopyFollowsCursor,
  mergeCloudReads,
  parseSyncCursor,
  planCloudReads,
  type CloudDocument,
  type SyncCursor,
} from "./deltaSync";
import { liveListenerScopes } from "./liveSync";

const team = (id: string, version: number, fields: Record<string, unknown> = {}): CloudRecord =>
  ({ id, name: id.toUpperCase(), syncVersion: version, ...fields }) as CloudRecord;
const stamped = (record: CloudRecord, updatedAt?: number): CloudDocument =>
  updatedAt === undefined ? { record } : { record, updatedAt };
const entry = (record: CloudRecord) => ({ v: Number(record.syncVersion) || 0, h: syncContentHash(record) });
const baselineOf = (name: CloudCollectionName, records: CloudRecord[]): SyncBaseline => ({
  [name]: Object.fromEntries(records.map((record) => [record.id, entry(record)])),
});
const emptyLocal = (): Record<CloudCollectionName, CloudRecord[]> => ({
  rounds: [], teams: [], adjudicators: [], venues: [], motions: [], breakCategories: [], debates: [],
  ballots: [], feedback: [], institutions: [], auditEvents: [], ballotIntake: [],
});

describe("download cursor", () => {
  it("records every cloud record's version, the deleted ones, and the latest stamp", () => {
    const cursor = cursorFromFullRead([
      stamped(team("t1", 2), 1000),
      stamped(team("t2", 1, { deletedAt: "2026-01-01T00:00:00.000Z" }), 3000),
      stamped(team("t3", 4)), // written before stamping existed
    ]);
    expect(cursor).toEqual({ since: 3000, versions: { t1: 2, t2: 1, t3: 4 }, deleted: ["t2"] });

    const next = advanceCursor(cursor, [stamped(team("t2", 2), 5000), stamped(team("t1", 3), 4000)]);
    expect(next).toEqual({ since: 5000, versions: { t1: 3, t2: 2, t3: 4 }, deleted: [] });
    expect(advanceCursor(next, [])).toBe(next);
  });

  it("starts a delta a little before the latest stamp, never before zero", () => {
    expect(deltaStart({ since: 10 * DELTA_OVERLAP_MS, versions: {}, deleted: [] })).toBe(9 * DELTA_OVERLAP_MS);
    expect(deltaStart({ since: 1000, versions: {}, deleted: [] })).toBe(0);
  });

  it("agrees with the cloud only when the count and version sum both match", () => {
    const cursor = { since: 0, versions: { t1: 2, t2: 3 }, deleted: [] };
    expect(cursorMatchesAggregate(cursor, { count: 2, versionSum: 5 })).toBe(true);
    expect(cursorMatchesAggregate(cursor, { count: 2, versionSum: 6 })).toBe(false);
    expect(cursorMatchesAggregate(cursor, { count: 1, versionSum: 5 })).toBe(false);
  });

  it("parses only a cursor saved for this tournament, dropping malformed collections", () => {
    const saved = {
      tournamentId: "tourn-1",
      collections: {
        teams: { since: 5, versions: { t1: 1 }, deleted: [] },
        debates: { since: "soon", versions: {}, deleted: [] },
        ballots: { since: 5, versions: { b1: "two" }, deleted: [] },
        unknown: { since: 5, versions: {}, deleted: [] },
      },
    };
    expect(parseSyncCursor(saved, "tourn-1")).toEqual({
      tournamentId: "tourn-1",
      collections: { teams: { since: 5, versions: { t1: 1 }, deleted: [] } },
    });
    expect(parseSyncCursor(saved, "tourn-2")).toEqual({ tournamentId: "tourn-2", collections: {} });
    expect(parseSyncCursor(null, "tourn-1")).toEqual({ tournamentId: "tourn-1", collections: {} });
  });

  it("plans a delta read for collections with a cursor and a full read for the others", () => {
    const cursor: SyncCursor = {
      tournamentId: "tourn-1",
      collections: { teams: { since: 10 * DELTA_OVERLAP_MS, versions: {}, deleted: [] } },
    };
    expect(planCloudReads(cursor, ["teams", "debates"])).toEqual([
      { name: "teams", since: 9 * DELTA_OVERLAP_MS },
      { name: "debates" },
    ]);
  });
});

describe("whether the device's copy follows the cursor", () => {
  const t1 = team("t1", 2);
  const t2 = team("t2", 1);
  const cursor = { since: 0, versions: { t1: 2, t2: 1, gone: 3 }, deleted: ["gone"] };
  const base = { cursor, collection: "teams" as const, baseline: baselineOf("teams", [t1, t2]).teams };

  it("follows when every live cloud record is on the device at the cursor's version", () => {
    expect(localCopyFollowsCursor({ ...base, local: [t1, t2] })).toBe(true);
    // An edit made here keeps the synced baseline, so it still follows.
    expect(localCopyFollowsCursor({ ...base, local: [{ ...t1, name: "Edited" } as CloudRecord, t2] })).toBe(true);
  });

  it("does not follow when a cloud record is missing or synced at another version", () => {
    expect(localCopyFollowsCursor({ ...base, local: [t1] })).toBe(false);
    expect(localCopyFollowsCursor({ ...base, local: [t1, t2], baseline: baselineOf("teams", [t1, team("t2", 0)]).teams }))
      .toBe(false);
  });

  it("excuses records deleted here, restored from a backup, or listed as sync conflicts", () => {
    expect(localCopyFollowsCursor({ ...base, local: [t1], deletions: { teams: ["t2"] } })).toBe(true);
    expect(localCopyFollowsCursor({ ...base, local: [t1], overwrites: { teams: ["t2"] } })).toBe(true);
    expect(localCopyFollowsCursor({
      ...base,
      local: [t1],
      diverged: [{ collectionName: "teams", recordId: "t2", cloudRecord: t2 }],
    })).toBe(true);
  });
});

describe("delta reads that must be read in full", () => {
  const t1 = team("t1", 1);
  const t2 = team("t2", 1);
  const cursor: SyncCursor = {
    tournamentId: "tourn-1",
    collections: { teams: { since: 1000, versions: { t1: 1, t2: 1 }, deleted: [] } },
  };
  const local = { teams: [t1, t2] };
  const baseline = baselineOf("teams", [t1, t2]);

  it("trusts a delta whose changes account for the whole collection", () => {
    const results = { teams: { documents: [stamped(team("t2", 2), 2000)], aggregate: { count: 2, versionSum: 3 } } };
    expect(collectionsNeedingFullRead({ results, cursor, local, baseline })).toEqual([]);
  });

  it("reads in full after a write that was not stamped (an older app version)", () => {
    const results = { teams: { documents: [], aggregate: { count: 2, versionSum: 3 } } };
    expect(collectionsNeedingFullRead({ results, cursor, local, baseline })).toEqual(["teams"]);
  });

  it("reads in full after a record was removed from the cloud outright", () => {
    const results = { teams: { documents: [], aggregate: { count: 1, versionSum: 1 } } };
    expect(collectionsNeedingFullRead({ results, cursor, local, baseline })).toEqual(["teams"]);
  });

  it("reads in full when the device's copy no longer holds a cloud record", () => {
    const results = { teams: { documents: [], aggregate: { count: 2, versionSum: 2 } } };
    expect(collectionsNeedingFullRead({ results, cursor, local: { teams: [t1] }, baseline })).toEqual(["teams"]);
  });

  it("does not hold records the delta brings to the cursor's older version", () => {
    // This device uploaded t2 (baseline at version 2); the delta brings it back at version 2.
    const results = { teams: { documents: [stamped(team("t2", 2), 2000)], aggregate: { count: 2, versionSum: 3 } } };
    const uploaded = baselineOf("teams", [t1, team("t2", 2)]);
    expect(collectionsNeedingFullRead({ results, cursor, local, baseline: uploaded })).toEqual([]);
  });

  it("ignores full reads and collections without a cursor", () => {
    const results = { teams: { documents: [stamped(t1, 1000)] }, debates: { documents: [] } };
    expect(collectionsNeedingFullRead({ results, cursor, local, baseline })).toEqual([]);
  });
});

describe("merging what was read on open", () => {
  it("applies a delta like listener events and rebuilds the cursor of collections read in full", () => {
    const t1 = team("t1", 1);
    const t2 = team("t2", 1);
    const t3 = team("t3", 1);
    const local = emptyLocal();
    local.teams = [t1, { ...t2, name: "Edited here" } as CloudRecord, t3];
    local.venues = [{ id: "v1", name: "Old", syncVersion: 1 } as CloudRecord];
    const baseline: SyncBaseline = { ...baselineOf("teams", [t1, t2, t3]), ...baselineOf("venues", [local.venues[0]]) };
    const cursor: SyncCursor = {
      tournamentId: "tourn-1",
      collections: { teams: { since: 1000, versions: { t1: 1, t2: 1, t3: 1 }, deleted: [] } },
    };
    const checkedIn = team("t1", 2, { checkedIn: true });
    const changedThere = team("t2", 2, { name: "Edited there" });
    const deleted = team("t3", 2, { deletedAt: "2026-01-01T00:00:00.000Z" });
    const added = team("t4", 1);
    const venue = { id: "v1", name: "New", syncVersion: 2 } as CloudRecord;
    const input = {
      results: {
        teams: {
          documents: [stamped(checkedIn, 2000), stamped(changedThere, 3000), stamped(deleted, 4000), stamped(added, 5000)],
          aggregate: { count: 4, versionSum: 7 },
        },
        venues: { documents: [stamped(venue, 2500)] },
      },
      cursor,
      localCollections: local,
      baseline,
      diverged: [
        { collectionName: "rounds", recordId: "r1", cloudRecord: { id: "r1" } },
        { collectionName: "venues", recordId: "v9", cloudRecord: { id: "v9" } },
      ] satisfies DivergedRecord[],
    };

    const merge = mergeCloudReads(input);

    expect(merge.collections.teams.map((record) => record.id).sort()).toEqual(["t1", "t2", "t4"]);
    expect(merge.collections.teams.find((record) => record.id === "t1")).toEqual(checkedIn);
    // Edited on both sides: kept here and listed for someone to choose.
    expect(merge.collections.teams.find((record) => record.id === "t2")).toMatchObject({ name: "Edited here" });
    expect(merge.divergedRecords.map((record) => `${record.collectionName}/${record.recordId}`).sort())
      .toEqual(["rounds/r1", "teams/t2"]);
    expect(merge.baseline.teams).toEqual({ t1: entry(checkedIn), t2: entry(t2), t4: entry(added) });
    expect(merge.collections.venues).toEqual([venue]);
    expect(merge.cursor.collections.teams).toEqual({
      since: 5000,
      versions: { t1: 2, t2: 2, t3: 2, t4: 1 },
      deleted: ["t3"],
    });
    expect(merge.cursor.collections.venues).toEqual({ since: 2500, versions: { v1: 2 }, deleted: [] });
    // Collections not read at all keep their records and baseline.
    expect(merge.collections.rounds).toEqual([]);
    expect(mergeCloudReads(input)).toEqual(merge);
  });

  it("with no copy on the device, is the cloud state minus soft-deletions", () => {
    const merge = mergeCloudReads({
      results: {
        teams: { documents: [stamped(team("t1", 1), 1000), stamped(team("t2", 1, { deletedAt: "x" }), 2000)] },
      },
      cursor: { tournamentId: "tourn-1", collections: {} },
      localCollections: null,
      baseline: {},
    });
    expect(merge.collections.teams).toEqual([team("t1", 1)]);
    expect(merge.cursor.collections.teams).toEqual({ since: 2000, versions: { t1: 1, t2: 1 }, deleted: ["t2"] });
  });
});

describe("live listeners from a cursor", () => {
  it("listen to the changes since each collection's cursor, in every round", () => {
    const since = { ballots: 1, debates: 2, teams: 3, adjudicators: 4 };
    expect(liveListenerScopes("r2", ["r3"], since)).toEqual([
      { collection: "ballots", since: 1 },
      { collection: "debates", since: 2 },
      { collection: "teams", since: 3 },
      { collection: "adjudicators", since: 4 },
    ]);
  });

  it("listen the round-scoped way unless every live collection has a cursor", () => {
    expect(liveListenerScopes("r2", [], { ballots: 1 })).toEqual(liveListenerScopes("r2", []));
  });
});

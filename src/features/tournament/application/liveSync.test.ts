import { describe, expect, it } from "vitest";
import type { CloudRecord } from "@/features/tournament/collections";
import { baselineEntryFor, type SyncBaselineEntry } from "./cloudSync";
import {
  applyLiveFields,
  applyLiveSnapshot,
  coalesceLiveWrites,
  diffLiveFields,
  findConfirmationConflicts,
  liveListenerScopes,
  mergeDivergedRecords,
  planLiveWrites,
  withBaselineEntries,
  type LiveWrite,
} from "./liveSync";

type Rec = CloudRecord & Record<string, unknown>;
const rec = (id: string, fields: Record<string, unknown> = {}): Rec => ({ id, ...fields }) as Rec;
const synced = (...records: Rec[]): Record<string, SyncBaselineEntry> =>
  Object.fromEntries(records.map((record) => [record.id, baselineEntryFor(record)]));

describe("liveListenerScopes", () => {
  it("always listens to check-ins and only the active round's debates and ballots", () => {
    expect(liveListenerScopes("r2")).toEqual([
      { collection: "teams" },
      { collection: "adjudicators" },
      { collection: "debates", roundId: "r2" },
      { collection: "ballots", roundId: "r2" },
    ]);
    expect(liveListenerScopes(null)).toEqual([{ collection: "teams" }, { collection: "adjudicators" }]);
  });
});

describe("diffLiveFields", () => {
  it("writes availability per round so another round's check-in is untouched", () => {
    const before = rec("t1", { name: "A", roundAvailability: { r1: true } });
    const after = rec("t1", { name: "A", roundAvailability: { r1: true, r2: false } });
    expect(diffLiveFields("teams", before, after)).toEqual([{ path: ["roundAvailability", "r2"], value: false }]);
  });

  it("treats a missing availability map as empty instead of replacing the map", () => {
    expect(diffLiveFields("teams", rec("t1"), rec("t1", { roundAvailability: { r3: true } }))).toEqual([
      { path: ["roundAvailability", "r3"], value: true },
    ]);
  });

  it("writes a debate's panel as one field and its result per side", () => {
    const before = rec("d1", {
      adjudicators: { chairId: "a1", panellistIds: [] },
      teams: { AFF: { teamId: "t1" }, NEG: { teamId: "t2" } },
    });
    const after = rec("d1", {
      adjudicators: { chairId: "a2", panellistIds: ["a1"] },
      teams: { AFF: { teamId: "t1", points: 1 }, NEG: { teamId: "t2" } },
    });
    expect(diffLiveFields("debates", before, after)).toEqual([
      { path: ["adjudicators"], value: { chairId: "a2", panellistIds: ["a1"] } },
      { path: ["teams", "AFF"], value: { teamId: "t1", points: 1 } },
    ]);
  });

  it("deletes removed fields and ignores the cloud's version stamp", () => {
    const writes = diffLiveFields("ballots", rec("b1", { confirmedTimestamp: "x", syncVersion: 3 }), rec("b1", { syncVersion: 4 }));
    expect(writes).toEqual([{ path: ["confirmedTimestamp"], delete: true }]);
  });
});

describe("planLiveWrites", () => {
  const now = "2026-10-19T10:00:00.000Z";

  it("writes only the changed fields of a synced record, at the next version", () => {
    const team = rec("t1", { name: "A", syncVersion: 2 });
    const plan = planLiveWrites({
      collection: "teams",
      base: [team],
      next: [rec("t1", { ...team, roundAvailability: { r1: true } })],
      latest: [team],
      baseline: synced(team),
      now,
    });
    expect(plan.writes).toEqual([
      expect.objectContaining({ kind: "patch", id: "t1", syncVersion: 3, fields: [{ path: ["roundAvailability", "r1"], value: true }] }),
    ]);
    expect(plan.records[0]).toMatchObject({ roundAvailability: { r1: true }, syncVersion: 3 });
    expect(plan.baseline.t1).toEqual(baselineEntryFor(plan.records[0]));
  });

  it("applies a command built on stale state on top of the latest copy, keeping another device's change", () => {
    const stale = rec("t1", { name: "A", roundAvailability: { r1: false }, syncVersion: 1 });
    // Another device checked the team in for r2 meanwhile; this device's listener applied it.
    const latest = rec("t1", { name: "A", roundAvailability: { r1: false, r2: true }, syncVersion: 2 });
    const other = rec("t2", { name: "B", syncVersion: 4 });
    const plan = planLiveWrites({
      collection: "teams",
      base: [stale],
      next: [rec("t1", { ...stale, roundAvailability: { r1: true } })],
      latest: [latest, other],
      baseline: synced(latest, other),
      now,
    });
    expect(plan.records).toEqual([
      expect.objectContaining({ id: "t1", roundAvailability: { r1: true, r2: true }, syncVersion: 3 }),
      other,
    ]);
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]).toMatchObject({ fields: [{ path: ["roundAvailability", "r1"], value: true }] });
  });

  it("writes new records whole at version 1", () => {
    const ballot = rec("b1", { debateId: "d1", confirmed: false });
    const plan = planLiveWrites({ collection: "ballots", base: [], next: [ballot], latest: [], baseline: {}, now });
    expect(plan.writes).toEqual([{ kind: "set", collection: "ballots", id: "b1", record: { ...ballot, syncVersion: 1 }, syncVersion: 1 }]);
    expect(plan.records).toEqual([{ ...ballot, syncVersion: 1 }]);
  });

  it("soft-deletes synced records and forgets unsynced ones", () => {
    const syncedDebate = rec("d1", { roundId: "r1", syncVersion: 5 });
    const localDebate = rec("d2", { roundId: "r1" });
    const plan = planLiveWrites({
      collection: "debates",
      base: [syncedDebate, localDebate],
      next: [],
      latest: [syncedDebate, localDebate],
      baseline: synced(syncedDebate),
      now,
    });
    expect(plan.records).toEqual([]);
    expect(plan.deletedIds).toEqual(["d1"]);
    expect(plan.writes).toEqual([
      expect.objectContaining({ kind: "patch", id: "d1", syncVersion: 6, fields: [{ path: ["deletedAt"], value: now }] }),
    ]);
    expect(plan.baseline).toEqual({ d1: null });
  });

  it("leaves a record with changes from before live collaboration on the upload path", () => {
    const cloudVersion = rec("t1", { name: "A", syncVersion: 2 });
    const edited = { ...cloudVersion, name: "A (edited offline before live)" };
    const plan = planLiveWrites({
      collection: "teams",
      base: [edited],
      next: [rec("t1", { ...edited, checkedIn: true })],
      latest: [edited],
      baseline: synced(cloudVersion),
      now,
    });
    expect(plan.writes).toEqual([]);
    expect(plan.records[0]).toMatchObject({ name: "A (edited offline before live)", checkedIn: true, syncVersion: 2 });
  });

  it("writes a second save of a record the same command created, so it never diverges from the cloud", () => {
    // Submitting a ballot confirmed saves it, then confirmation saves it again, both times with the
    // state the command started from (which lacks the new ballot).
    const first = planLiveWrites({
      collection: "ballots",
      base: [],
      next: [rec("b1", { confirmed: true, confirmedTimestamp: "A" })],
      latest: [],
      baseline: {},
      now,
    });
    const created = first.records[0];
    const second = planLiveWrites({
      collection: "ballots",
      base: [],
      next: [rec("b1", { confirmed: true, confirmedTimestamp: "B" })],
      latest: first.records,
      baseline: first.baseline as Record<string, SyncBaselineEntry>,
      now,
    });
    expect(second.writes).toEqual([
      expect.objectContaining({ kind: "patch", id: "b1", syncVersion: 2, fields: [{ path: ["confirmedTimestamp"], value: "B" }] }),
    ]);
    expect(second.records[0]).toMatchObject({ confirmedTimestamp: "B", syncVersion: 2 });
    expect(second.baseline.b1).toEqual(baselineEntryFor(second.records[0]));
    // The same content a second time writes nothing and keeps the cloud version stamp.
    const unchanged = planLiveWrites({
      collection: "ballots",
      base: [],
      next: [rec("b1", { confirmed: true, confirmedTimestamp: "A" })],
      latest: first.records,
      baseline: first.baseline as Record<string, SyncBaselineEntry>,
      now,
    });
    expect(unchanged.writes).toEqual([]);
    expect(unchanged.records).toEqual([created]);
  });

  it("writes nothing when the command changed nothing", () => {
    const team = rec("t1", { name: "A", syncVersion: 1 });
    const plan = planLiveWrites({ collection: "teams", base: [team], next: [{ ...team }], latest: [team], baseline: synced(team), now });
    expect(plan.writes).toEqual([]);
    expect(plan.records).toEqual([team]);
  });
});

describe("coalesceLiveWrites", () => {
  const patch = (id: string, fields: LiveWrite extends infer W ? W extends { fields: infer F } ? F : never : never, syncVersion: number): LiveWrite => ({
    kind: "patch",
    collection: "ballots",
    id,
    record: rec(id, { syncVersion }),
    fields,
    syncVersion,
  });

  it("merges a command's writes to one record into one write, later fields winning", () => {
    const merged = coalesceLiveWrites([
      patch("b1", [{ path: ["confirmed"], value: false }, { path: ["discarded"], value: true }], 2),
      patch("b2", [{ path: ["confirmed"], value: true }], 4),
      patch("b1", [{ path: ["confirmed"], value: true }, { path: ["discarded"], value: false }], 3),
    ]);
    expect(merged).toHaveLength(2);
    const b1 = merged.find((write) => write.id === "b1");
    expect(b1).toMatchObject({ kind: "patch", syncVersion: 3 });
    expect(b1 && "fields" in b1 ? b1.fields : []).toEqual([
      { path: ["confirmed"], value: true },
      { path: ["discarded"], value: false },
    ]);
  });

  it("folds patches into an earlier whole-record write", () => {
    const merged = coalesceLiveWrites([
      { kind: "set", collection: "ballots", id: "b1", record: rec("b1", { confirmed: false, syncVersion: 1 }), syncVersion: 1 },
      patch("b1", [{ path: ["confirmed"], value: true }], 2),
    ]);
    expect(merged).toEqual([
      { kind: "set", collection: "ballots", id: "b1", record: rec("b1", { confirmed: true, syncVersion: 2 }), syncVersion: 2 },
    ]);
  });

  it("folds a key write into an earlier whole-field write of the same map", () => {
    const merged = coalesceLiveWrites([
      { kind: "patch", collection: "teams", id: "t1", record: rec("t1"), fields: [{ path: ["roundAvailability"], value: { r1: true } }], syncVersion: 2 },
      { kind: "patch", collection: "teams", id: "t1", record: rec("t1"), fields: [{ path: ["roundAvailability", "r2"], value: false }], syncVersion: 2 },
    ]);
    expect(merged[0]).toMatchObject({ fields: [{ path: ["roundAvailability"], value: { r1: true, r2: false } }] });
  });
});

describe("applyLiveFields", () => {
  it("applies key writes and deletions inside maps", () => {
    const record = rec("t1", { roundAvailability: { r1: true, r2: true }, note: "x" });
    expect(applyLiveFields(record, [
      { path: ["roundAvailability", "r2"], delete: true },
      { path: ["roundAvailability", "r3"], value: false },
      { path: ["note"], delete: true },
    ])).toEqual(rec("t1", { roundAvailability: { r1: true, r3: false } }));
  });
});

describe("applyLiveSnapshot", () => {
  it("takes another device's change to a record unchanged here", () => {
    const local = rec("b1", { confirmed: false, syncVersion: 1 });
    const cloud = rec("b1", { confirmed: true, syncVersion: 2 });
    const result = applyLiveSnapshot({
      collection: "ballots",
      local: [local],
      baseline: synced(local),
      changes: [{ type: "modified", record: cloud }],
    });
    expect(result.records).toEqual([cloud]);
    expect(result.baseline).toEqual({ b1: baselineEntryFor(cloud) });
    expect(result.changed).toBe(true);
  });

  it("keeps an unsynced local edit and reports it when the cloud changed too", () => {
    const base = rec("t1", { name: "A", syncVersion: 1 });
    const local = { ...base, name: "Local" };
    const cloud = { ...base, name: "Cloud", syncVersion: 2 };
    const result = applyLiveSnapshot({
      collection: "teams",
      local: [local],
      baseline: synced(base),
      changes: [{ type: "modified", record: cloud }],
    });
    expect(result.records).toEqual([local]);
    expect(result.diverged).toEqual([{ collectionName: "teams", recordId: "t1", cloudRecord: cloud }]);
    expect(result.baseline).toEqual({});
  });

  it("adds new cloud records, drops cloud deletions and respects pending local deletions", () => {
    const kept = rec("d1", { roundId: "r1", syncVersion: 1 });
    const deleted = rec("d2", { roundId: "r1", syncVersion: 1 });
    const result = applyLiveSnapshot({
      collection: "debates",
      local: [kept, deleted],
      baseline: synced(kept, deleted),
      changes: [
        { type: "modified", record: { ...deleted, deletedAt: "now", syncVersion: 2 } },
        { type: "added", record: rec("d3", { roundId: "r1", syncVersion: 1 }) },
        { type: "added", record: rec("d4", { roundId: "r1", syncVersion: 1 }) },
      ],
      deletions: ["d4"],
    });
    expect(result.records.map((record) => record.id)).toEqual(["d1", "d3"]);
    expect(result.baseline).toEqual({ d2: null, d3: baselineEntryFor(rec("d3", { roundId: "r1", syncVersion: 1 })) });
  });

  it("keeps records restored from a backup until they are uploaded", () => {
    const restored = rec("t1", { name: "Restored" });
    const result = applyLiveSnapshot({
      collection: "teams",
      local: [restored],
      baseline: {},
      changes: [{ type: "modified", record: rec("t1", { name: "Cloud", deletedAt: "x" }) }],
      overwrites: ["t1"],
    });
    expect(result.records).toEqual([restored]);
    expect(result.changed).toBe(false);
  });

  it("is a no-op for this device's own write echoed back", () => {
    const local = rec("b1", { confirmed: true, syncVersion: 3 });
    const result = applyLiveSnapshot({
      collection: "ballots",
      local: [local],
      baseline: synced(local),
      changes: [{ type: "modified", record: { ...local } }],
    });
    expect(result.changed).toBe(false);
    expect(result.records[0]).toBe(local);
  });
});

describe("findConfirmationConflicts", () => {
  it("lists debates with more than one counted confirmation", () => {
    expect(findConfirmationConflicts([
      { id: "b1", debateId: "d1", confirmed: true },
      { id: "b2", debateId: "d1", confirmed: true },
      { id: "b3", debateId: "d2", confirmed: true },
      { id: "b4", debateId: "d2", confirmed: true, discarded: true },
    ])).toEqual([{ debateId: "d1", ballotIds: ["b1", "b2"] }]);
  });
});

describe("baseline and diverged helpers", () => {
  it("adds, replaces and removes baseline entries of one collection", () => {
    const next = withBaselineEntries({ teams: { t1: { v: 1, h: "a" }, t2: { v: 1, h: "b" } } }, "teams", {
      t1: { v: 2, h: "c" },
      t2: null,
    });
    expect(next).toEqual({ teams: { t1: { v: 2, h: "c" } } });
  });

  it("replaces diverged records by key", () => {
    const first = { collectionName: "teams" as const, recordId: "t1", cloudRecord: rec("t1", { v: 1 }) };
    const second = { collectionName: "teams" as const, recordId: "t1", cloudRecord: rec("t1", { v: 2 }) };
    expect(mergeDivergedRecords([first], [second])).toEqual([second]);
  });
});

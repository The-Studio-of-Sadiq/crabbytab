import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase", () => ({ db: { fake: true }, auth: null }));
vi.mock("firebase/firestore", () => import("@/test/fakeFirestore"));

import { fakeStore, resetFakeStore } from "@/test/fakeFirestore";
import { CLOUD_COLLECTIONS, type CloudCollectionName, type CloudRecord } from "../collections";
import type { SyncBaseline } from "../application/cloudSync";
import {
  collectionsNeedingFullRead,
  mergeCloudReads,
  parseSyncCursor,
  planCloudReads,
  type SyncCursor,
} from "../application/deltaSync";
import { createFirestoreTournamentRepository, readCloudCollections } from "./tournamentRepository";

const TOURNAMENT = "tourn-delta";
const OPEN: CloudCollectionName[] = ["teams", "ballots"];
const path = (name: string, id: string) => `tournaments/${TOURNAMENT}/${name}/${id}`;

function emptyCollections(): Record<CloudCollectionName, CloudRecord[]> {
  return Object.fromEntries(CLOUD_COLLECTIONS.map((name) => [name, []])) as unknown as Record<CloudCollectionName, CloudRecord[]>;
}

/** One device: its working copy, synced baseline and download cursor. */
interface Device {
  collections: Record<CloudCollectionName, CloudRecord[]>;
  baseline: SyncBaseline;
  cursor: SyncCursor;
}

/** What the tournament page does on open (TournamentContext's load), without React. */
async function open(device: Device | null): Promise<{ device: Device; fullReads: CloudCollectionName[]; reads: number }> {
  const before = fakeStore.reads;
  const cursor = device?.cursor ?? parseSyncCursor(null, TOURNAMENT);
  let results = await readCloudCollections(TOURNAMENT, planCloudReads(cursor, OPEN));
  const stale = device
    ? collectionsNeedingFullRead({ results, cursor, local: device.collections, baseline: device.baseline })
    : [];
  if (stale.length > 0) results = { ...results, ...(await readCloudCollections(TOURNAMENT, stale.map((name) => ({ name })))) };
  const merge = mergeCloudReads({
    results,
    cursor,
    localCollections: device?.collections ?? null,
    baseline: device?.baseline ?? {},
  });
  const fullReads = OPEN.filter((name) => !results[name]?.aggregate);
  return {
    device: { collections: merge.collections, baseline: merge.baseline, cursor: merge.cursor },
    fullReads,
    reads: fakeStore.reads - before,
  };
}

async function upload(records: Partial<Record<CloudCollectionName, CloudRecord[]>>): Promise<void> {
  await createFirestoreTournamentRepository().syncCollections(TOURNAMENT, { ...emptyCollections(), ...records });
}

/** Time passes after an open (the fake clock moves one second per commit otherwise). */
const later = () => {
  fakeStore.now += 60 * 60 * 1000;
};

const teams = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `t${index}`, name: `Team ${index}` }) as CloudRecord);

/**
 * A tournament whose initial upload is long past, opened once on a device. Its latest stamp is
 * a later edit, so the next open's delta starts after the initial burst of writes.
 */
async function openedTournament(count: number): Promise<Device> {
  await upload({ teams: teams(count) });
  later();
  await upload({ teams: [{ id: "t0", name: "Edited", syncVersion: 1 } as CloudRecord] });
  const first = await open(null);
  later();
  return first.device;
}

beforeEach(() => {
  resetFakeStore();
});

describe("downloading only what changed", () => {
  it("reads a reopened tournament's changes only, and every write carries the server's stamp", async () => {
    await upload({ teams: teams(200) });
    expect(fakeStore.documents.get(path("teams", "t0"))).toHaveProperty("cloudUpdatedAt");

    const first = await open(null);
    later();
    expect(first.fullReads).toEqual(OPEN);
    expect(first.device.collections.teams).toHaveLength(200);
    // The stamp is cloud-only: it never enters the working copy.
    expect(first.device.collections.teams[0]).not.toHaveProperty("cloudUpdatedAt");

    // Another device changes two teams later on.
    await upload({ teams: [{ id: "t5", name: "Renamed", syncVersion: 1 } as CloudRecord, { id: "t9", name: "Renamed too", syncVersion: 1 } as CloudRecord] });

    const reopened = await open(first.device);
    expect(reopened.fullReads).toEqual([]);
    // The first reopen also re-reads the minute of writes before the latest stamp it had seen
    // (here the whole initial upload, written in one burst); see DELTA_OVERLAP_MS.
    expect(reopened.device.collections.teams.find((team) => team.id === "t5")).toMatchObject({ name: "Renamed", syncVersion: 2 });
    expect(reopened.device.collections.teams).toHaveLength(200);
    later();

    await upload({ teams: [{ id: "t7", name: "Renamed later", syncVersion: 1 } as CloudRecord] });
    const again = await open(reopened.device);
    expect(again.fullReads).toEqual([]);
    expect(first.reads).toBeGreaterThan(200);
    // Only the records stamped since the latest stamp seen (minus a minute), and one
    // aggregation per collection.
    expect(again.reads).toBeLessThan(10);
    expect(again.device.collections.teams.find((team) => team.id === "t7")).toMatchObject({ name: "Renamed later" });
    expect(again.device.collections.teams).toHaveLength(200);
  });

  it("falls back to a full read when an older app version wrote without a stamp", async () => {
    const device = await openedTournament(20);
    const stored = fakeStore.documents.get(path("teams", "t3"));
    // An older client's upload: new content and version, no stamp change.
    fakeStore.documents.set(path("teams", "t3"), { ...stored, name: "Old client", syncVersion: 2 });

    const reopened = await open(device);
    expect(reopened.fullReads).toEqual(["teams"]);
    expect(reopened.device.collections.teams.find((team) => team.id === "t3")).toMatchObject({ name: "Old client" });
  });

  it("falls back to a full read after a record was removed from the cloud outright", async () => {
    const device = await openedTournament(20);
    fakeStore.documents.delete(path("teams", "t4"));

    const reopened = await open(device);
    expect(reopened.fullReads).toEqual(["teams"]);
  });

  it("falls back to a full read when the device's copy lost a cloud record (e.g. a restored backup)", async () => {
    const device = await openedTournament(20);
    const restored = { ...device, collections: { ...device.collections, teams: device.collections.teams.filter((team) => team.id !== "t5") } };

    const reopened = await open(restored);
    expect(reopened.fullReads).toEqual(["teams"]);
    expect(reopened.device.collections.teams).toHaveLength(20);
  });

  it("brings a soft-deleted record's deletion with the changes", async () => {
    await upload({ teams: teams(5) });
    const first = await open(null);
    later();
    await createFirestoreTournamentRepository().syncCollections(TOURNAMENT, emptyCollections(), { teams: ["t2"] });

    const reopened = await open(first.device);
    expect(reopened.fullReads).toEqual([]);
    expect(reopened.device.collections.teams.map((team) => team.id)).not.toContain("t2");
    expect(reopened.device.cursor.collections.teams?.deleted).toEqual(["t2"]);
  });
});

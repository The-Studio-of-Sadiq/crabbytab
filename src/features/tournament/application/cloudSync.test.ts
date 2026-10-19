import { describe, expect, it } from "vitest";

import type { Tournament } from "@/types";
import { CLOUD_COLLECTIONS } from "../collections";
import {
  buildDataEntrySyncPayload,
  downloadTournamentCommand,
  baselineAfterDataEntrySync,
  divergedRecordKey,
  hasStaleSyncVersion,
  mergeCloudIntoWorkingCopy,
  mergeCloudTournament,
  parseDivergedRecords,
  parseSyncBaseline,
  recordsChangedSinceBaseline,
  resolveDivergedRecords,
  syncContentHash,
  uploadTournamentCommand,
  type CloudCollectionName,
  type CloudRecord,
  type SyncBaseline,
  type TournamentCloudRepository,
} from "./cloudSync";

const tournament: Tournament = {
  id: "tournament-1",
  name: "Test Tournament",
  shortName: "Test",
  slug: "test",
  format: "bp",
  active: true,
  ownerId: "local",
  admins: {},
  preferences: {
    teamsInDebate: 4,
    substantiveSpeakers: 2,
    replyScoresEnabled: false,
    minSpeakerScore: 50,
    maxSpeakerScore: 90,
    stepSpeakerScore: 1,
    minReplyScore: 30,
    maxReplyScore: 45,
    drawRule: "power_paired",
    sideAllocationRule: "balanced",
    ballotDoubleEntry: false,
    publicDraw: true,
    publicResults: true,
    publicStandings: true,
    publicMotions: true,
    feedbackEnabled: true,
    feedbackMinScore: 1,
    feedbackMaxScore: 10,
  },
  createdAt: "",
  updatedAt: "",
};

function emptyCollections(): Record<CloudCollectionName, CloudRecord[]> {
  return Object.fromEntries(CLOUD_COLLECTIONS.map((name) => [name, []])) as unknown as Record<CloudCollectionName, CloudRecord[]>;
}

describe("tournament cloud synchronization", () => {
  it("does not resurrect locally cached records deleted in the cloud", async () => {
    const localCollections = emptyCollections();
    localCollections.teams = [{ id: "deleted-team", name: "Old local copy" } as CloudRecord as CloudRecord];
    const cloudCollections = emptyCollections();
    cloudCollections.teams = [{
      id: "deleted-team",
      deletedAt: "2026-10-10T00:00:00.000Z",
    } as CloudRecord];
    const repository: TournamentCloudRepository = {
      async getTournament() {
        return {
          id: tournament.id,
          data: { ...tournament, ownerId: "user-1", admins: {} },
        };
      },
      async findTournamentBySlug() { return null; },
      async saveTournament() { return false; },
      async getCollections() { return cloudCollections; },
      async syncCollections() { return 0; },
      async getSyncConflicts() { return []; },
    };

    const result = await downloadTournamentCommand({
      tournamentId: tournament.id,
      slug: tournament.slug,
      userId: "user-1",
      localTournament: tournament,
      localCollections,
      repository,
    });

    expect(result.collections.teams).toEqual([]);
  });

  it("does not restore a cloud record with a pending local deletion", async () => {
    const cloudCollections = emptyCollections();
    cloudCollections.teams = [{ id: "deleted-team", name: "Cloud copy" } as CloudRecord];
    const repository: TournamentCloudRepository = {
      async getTournament() {
        return {
          id: tournament.id,
          data: { ...tournament, ownerId: "user-1", admins: {} },
        };
      },
      async findTournamentBySlug() { return null; },
      async saveTournament() { return false; },
      async getCollections() { return cloudCollections; },
      async syncCollections() { return 0; },
      async getSyncConflicts() { return []; },
    };

    const result = await downloadTournamentCommand({
      tournamentId: tournament.id,
      slug: tournament.slug,
      userId: "user-1",
      localTournament: tournament,
      localCollections: emptyCollections(),
      deletions: { teams: ["deleted-team"] },
      repository,
    });

    expect(result.collections.teams).toEqual([]);
  });

  it("promotes a local tournament and writes metadata before reconciling collections", async () => {
    const calls: string[] = [];
    let savedMetadata: Tournament | undefined;
    const repository: TournamentCloudRepository = {
      async getTournament() { calls.push("read"); return null; },
      async findTournamentBySlug() { return null; },
      async saveTournament(_id, metadata) { calls.push("metadata"); savedMetadata = metadata; return false; },
      async getCollections() { return emptyCollections(); },
      async syncCollections() { calls.push("collections"); return 2; },
      async getSyncConflicts() { return []; },
    };

    const archivedConflictCount = await uploadTournamentCommand({
      tournament,
      userId: "user-1",
      localCollections: emptyCollections(),
      repository,
    });
    expect(calls).toEqual(["read", "metadata", "collections"]);
    expect(archivedConflictCount).toBe(2);
    expect(savedMetadata).toMatchObject({ ownerId: "user-1", admins: { "user-1": true } });
    expect(savedMetadata?.updatedAt).toEqual(expect.any(String));
  });

  it("never rewrites ownership or admins of an existing cloud tournament", async () => {
    let savedMetadata: Tournament | undefined;
    const repository: TournamentCloudRepository = {
      async getTournament() {
        return { id: tournament.id, data: { ...tournament, ownerId: "owner", admins: { "user-1": true } } };
      },
      async findTournamentBySlug() { return null; },
      async saveTournament(_id, metadata) { savedMetadata = metadata; return false; },
      async getCollections() { return emptyCollections(); },
      async syncCollections() { return 0; },
      async getSyncConflicts() { return []; },
    };

    await uploadTournamentCommand({
      tournament: { ...tournament, ownerId: "local", admins: { intruder: true } },
      userId: "user-1",
      localCollections: emptyCollections(),
      repository,
    });

    expect(savedMetadata?.ownerId).toBe("owner");
    expect(savedMetadata?.admins).toEqual({ "user-1": true });
  });

  it("forwards local deletion tombstones with the upload", async () => {
    let receivedDeletions: Partial<Record<CloudCollectionName, string[]>> | undefined;
    const repository: TournamentCloudRepository = {
      async getTournament() {
        return { id: tournament.id, data: { ...tournament, ownerId: "user-1" } };
      },
      async findTournamentBySlug() { return null; },
      async saveTournament() { return false; },
      async getCollections() { return emptyCollections(); },
      async syncCollections(_id, _collections, deletions) {
        receivedDeletions = deletions;
        return 0;
      },
      async getSyncConflicts() { return []; },
    };
    const deletions = { teams: ["deleted-team"] };

    await uploadTournamentCommand({
      tournament,
      userId: "user-1",
      localCollections: emptyCollections(),
      deletions,
      repository,
    });

    expect(receivedDeletions).toEqual(deletions);
  });

  it("detects stale device versions while accepting current versions", () => {
    expect(hasStaleSyncVersion(3, 4)).toBe(true);
    expect(hasStaleSyncVersion(undefined, 0)).toBe(false);
    expect(hasStaleSyncVersion(4, 4)).toBe(false);
  });

  it("lets global admins sync another owner's tournament without changing its owner access", async () => {
    let savedMetadata: Tournament | undefined;
    const repository: TournamentCloudRepository = {
      async getTournament() {
        return {
          id: tournament.id,
          data: { ...tournament, ownerId: "owner-1", admins: { "admin-1": true } },
        };
      },
      async findTournamentBySlug() { return null; },
      async saveTournament(_id, metadata) { savedMetadata = metadata; return false; },
      async getCollections() { return emptyCollections(); },
      async syncCollections() { return 0; },
      async getSyncConflicts() { return []; },
    };

    await uploadTournamentCommand({
      tournament,
      userId: "global-admin",
      isGlobalAdmin: true,
      localCollections: emptyCollections(),
      repository,
    });

    expect(savedMetadata).toMatchObject({
      ownerId: "owner-1",
      admins: { "admin-1": true },
    });
    expect(savedMetadata?.admins).not.toHaveProperty("global-admin");
  });

  it("rejects another account's cloud tournament before downloading collections", async () => {
    const calls: string[] = [];
    const repository: TournamentCloudRepository = {
      async getTournament() {
        calls.push("read");
        return { id: tournament.id, data: { ...tournament, ownerId: "other-user", admins: {} } };
      },
      async findTournamentBySlug() { return null; },
      async saveTournament() { calls.push("save"); return false; },
      async getCollections() { calls.push("collections"); return emptyCollections(); },
      async syncCollections() { calls.push("sync"); return 0; },
      async getSyncConflicts() { return []; },
    };

    await expect(downloadTournamentCommand({
      tournamentId: tournament.id,
      slug: tournament.slug,
      userId: "user-1",
      localTournament: tournament,
      localCollections: emptyCollections(),
      repository,
    })).rejects.toThrow("This cloud tournament belongs to another account.");

    expect(calls).toEqual(["read"]);
  });

  it("merges downloaded records without dropping local-only records or replacing local conflicts", async () => {
    const localCollections = emptyCollections();
    localCollections.teams = [
      { id: "same", name: "Local version" } as CloudRecord as CloudRecord,
      { id: "local-only", name: "Local only" } as CloudRecord as CloudRecord,
    ];
    const cloudCollections = emptyCollections();
    cloudCollections.teams = [
      { id: "same", name: "Cloud version" } as CloudRecord as CloudRecord,
      { id: "cloud-only", name: "Cloud only" } as CloudRecord as CloudRecord,
    ];
    const repository: TournamentCloudRepository = {
      async getTournament() {
        return { id: tournament.id, data: { ...tournament, ownerId: "user-1", admins: {} } };
      },
      async findTournamentBySlug() { return null; },
      async saveTournament() { return false; },
      async getCollections() { return cloudCollections; },
      async syncCollections() { return 0; },
      async getSyncConflicts() { return []; },
    };

    const result = await downloadTournamentCommand({
      tournamentId: tournament.id,
      slug: tournament.slug,
      userId: "user-1",
      localTournament: tournament,
      localCollections,
      repository,
    });

    expect(result.collections.teams).toEqual([
      { id: "same", name: "Local version" } as CloudRecord,
      { id: "cloud-only", name: "Cloud only" } as CloudRecord,
      { id: "local-only", name: "Local only" } as CloudRecord,
    ]);
  });

  it("limits data-entry sync to approved collections and debate results", async () => {
    const localCollections = emptyCollections();
    localCollections.debates = [{ id: "debate-1" }];
    localCollections.teams = [{
      id: "team-1",
      tournamentId: tournament.id,
      name: "Team",
      speakers: [{ id: "speaker-1", name: "Speaker", email: "private@example.com" }],
      breakCategories: [],
      speakerCategories: [],
      privateUrlKey: "private-key",
      privatePasscode: "private-code",
    } as unknown as CloudRecord];
    const payload = buildDataEntrySyncPayload({
      localCollections,
    });

    expect(Object.keys(payload.collections)).toEqual(["teams", "adjudicators", "institutions", "ballots", "feedback", "ballotIntake"]);
    expect(payload).toMatchObject({ debates: [{ id: "debate-1" }] });
    expect(payload).not.toHaveProperty("rounds");
    expect(payload).not.toHaveProperty("venues");
    expect(payload).not.toHaveProperty("motions");
    expect(payload.collections.teams[0]).not.toHaveProperty("privateUrlKey");
    expect(payload.collections.teams[0]).not.toHaveProperty("privatePasscode");
    const teamPayload = payload.collections.teams[0] as unknown as Record<string, unknown>;
    expect((teamPayload.speakers as Array<Record<string, unknown>>)[0]).not.toHaveProperty("email");
  });

  describe("opening a tournament that has a cloud copy", () => {
    it("keeps unuploaded local edits and local-only records instead of replacing them", () => {
      const local = emptyCollections();
      local.teams = [
        { id: "t1", name: "Renamed on this device", syncVersion: 2 } as CloudRecord,
        { id: "t-new", name: "Added on this device" } as CloudRecord,
      ];
      local.ballots = [{ id: "b1", confirmed: true, syncVersion: 1 } as CloudRecord];
      const cloud = emptyCollections();
      cloud.teams = [{ id: "t1", name: "Old name", syncVersion: 2 } as CloudRecord];
      cloud.ballots = [{ id: "b1", confirmed: false, syncVersion: 1 } as CloudRecord];

      const { collections: merged } = mergeCloudIntoWorkingCopy({ cloudCollections: cloud, localCollections: local });

      expect(merged.teams).toEqual(local.teams);
      expect(merged.ballots).toEqual(local.ballots);
    });

    it("adds cloud-only records, such as rows another device uploaded", () => {
      const local = emptyCollections();
      local.feedback = [{ id: "f-local" } as CloudRecord];
      const cloud = emptyCollections();
      cloud.feedback = [{ id: "f-cloud", syncVersion: 1 } as CloudRecord];

      const { collections: merged } = mergeCloudIntoWorkingCopy({ cloudCollections: cloud, localCollections: local });

      expect(merged.feedback.map((record) => record.id).sort()).toEqual(["f-cloud", "f-local"]);
    });

    it("does not restore records pending local deletion or soft-deleted in the cloud", () => {
      const local = emptyCollections();
      local.venues = [{ id: "v-cloud-deleted" } as CloudRecord];
      const cloud = emptyCollections();
      cloud.venues = [
        { id: "v-cloud-deleted", deletedAt: "2026-01-01T00:00:00.000Z" } as CloudRecord,
        { id: "v-locally-deleted", syncVersion: 1 } as CloudRecord,
      ];

      const { collections: merged } = mergeCloudIntoWorkingCopy({
        cloudCollections: cloud,
        localCollections: local,
        deletions: { venues: ["v-locally-deleted"] },
      });

      expect(merged.venues).toEqual([]);
    });

    it("keeps a backup-restored record even though the cloud copy is soft-deleted", () => {
      const local = emptyCollections();
      local.teams = [{ id: "t-restored", name: "From backup" } as CloudRecord];
      const cloud = emptyCollections();
      cloud.teams = [{ id: "t-restored", deletedAt: "2026-01-01T00:00:00.000Z" } as CloudRecord];

      const { collections: merged } = mergeCloudIntoWorkingCopy({
        cloudCollections: cloud,
        localCollections: local,
        overwrites: { teams: ["t-restored"] },
      });

      expect(merged.teams).toEqual(local.teams);
    });

    it("uses the cloud copy without soft-deleted records on a device with no local copy", () => {
      const cloud = emptyCollections();
      cloud.teams = [
        { id: "t1", syncVersion: 1 } as CloudRecord,
        { id: "t2", deletedAt: "2026-01-01T00:00:00.000Z" } as CloudRecord,
      ];

      const { collections: merged } = mergeCloudIntoWorkingCopy({ cloudCollections: cloud, localCollections: null });

      expect(merged.teams).toEqual([{ id: "t1", syncVersion: 1 }]);
      expect(Object.keys(merged).sort()).toEqual([...CLOUD_COLLECTIONS].sort());
    });
  });

  it("saves the records stamped before an interrupted upload stopped", async () => {
    const localCollections = emptyCollections();
    localCollections.teams = [{ id: "written" }, { id: "not-written" }];
    let saved: Record<CloudCollectionName, CloudRecord[]> | undefined;
    const repository: TournamentCloudRepository = {
      async getTournament() { return { id: tournament.id, data: { ...tournament, ownerId: "user-1" } }; },
      async findTournamentBySlug() { return null; },
      async saveTournament() { return false; },
      async getCollections() { return emptyCollections(); },
      async syncCollections(_id, collections) {
        collections.teams[0].syncVersion = 3;
        throw new Error("unavailable");
      },
      async getSyncConflicts() { return []; },
    };

    await expect(uploadTournamentCommand({
      tournament,
      userId: "user-1",
      localCollections,
      repository,
      saveSyncedRecords: (_tournament, collections) => { saved = collections; },
    })).rejects.toThrow("unavailable");

    expect(saved?.teams).toEqual([{ id: "written", syncVersion: 3 }, { id: "not-written" }]);
  });

  describe("synced baseline", () => {
    const team = (fields: Record<string, unknown>) => ({ id: "t1", name: "Team", ...fields }) as CloudRecord;
    const baselineOf = (record: CloudRecord): SyncBaseline => ({
      teams: { [record.id]: { v: Number(record.syncVersion) || 0, h: syncContentHash(record) } },
    });

    it("gives a record unchanged here since its baseline the newer cloud version, e.g. a self check-in", () => {
      const synced = team({ syncVersion: 2 });
      const local = emptyCollections();
      local.teams = [synced];
      const cloud = emptyCollections();
      const checkedIn = team({ roundAvailability: { r1: true }, syncVersion: 3 });
      cloud.teams = [checkedIn];

      const merge = mergeCloudIntoWorkingCopy({ cloudCollections: cloud, localCollections: local, baseline: baselineOf(synced) });

      expect(merge.collections.teams).toEqual([checkedIn]);
      expect(merge.divergedRecords).toEqual([]);
      expect(merge.baseline.teams).toEqual(baselineOf(checkedIn).teams);
    });

    it("brings in a chair's private-URL discard of a ballot the device still holds as confirmed", () => {
      const synced = { id: "b1", confirmed: true, discarded: false, syncVersion: 1 } as CloudRecord;
      const discarded = { id: "b1", confirmed: false, discarded: true, syncVersion: 2 } as CloudRecord;
      const local = emptyCollections();
      local.ballots = [synced];
      const cloud = emptyCollections();
      cloud.ballots = [discarded];

      const merge = mergeCloudIntoWorkingCopy({
        cloudCollections: cloud,
        localCollections: local,
        baseline: { ballots: { b1: { v: 1, h: syncContentHash(synced) } } },
      });

      expect(merge.collections.ballots).toEqual([discarded]);
      expect(merge.divergedRecords).toEqual([]);
    });

    it("keeps a local edit for upload while the cloud is still at the baseline version", () => {
      const synced = team({ syncVersion: 2 });
      const edited = team({ name: "Renamed here", syncVersion: 2 });
      const local = emptyCollections();
      local.teams = [edited];
      const cloud = emptyCollections();
      cloud.teams = [synced];

      const merge = mergeCloudIntoWorkingCopy({ cloudCollections: cloud, localCollections: local, baseline: baselineOf(synced) });

      expect(merge.collections.teams).toEqual([edited]);
      expect(merge.divergedRecords).toEqual([]);
      expect(merge.baseline.teams).toEqual(baselineOf(synced).teams);
    });

    it("keeps and reports a record edited here that the cloud also changed, never overwriting it", () => {
      const synced = team({ syncVersion: 2 });
      const edited = team({ name: "Renamed here", syncVersion: 2 });
      const checkedIn = team({ roundAvailability: { r1: false }, syncVersion: 3 });
      const local = emptyCollections();
      local.teams = [edited];
      const cloud = emptyCollections();
      cloud.teams = [checkedIn];

      const merge = mergeCloudIntoWorkingCopy({ cloudCollections: cloud, localCollections: local, baseline: baselineOf(synced) });

      expect(merge.collections.teams).toEqual([edited]);
      expect(merge.divergedRecords).toEqual([{ collectionName: "teams", recordId: "t1", cloudRecord: checkedIn }]);
      // The baseline still describes the version the edit started from, so the record stays flagged.
      expect(merge.baseline.teams).toEqual(baselineOf(synced).teams);
      const again = mergeCloudIntoWorkingCopy({
        cloudCollections: cloud,
        localCollections: merge.collections,
        baseline: merge.baseline,
      });
      expect(again.collections.teams).toEqual([edited]);
      expect(again.divergedRecords).toHaveLength(1);
    });

    it("without a baseline entry, keeps differing records and reports them when the versions differ", () => {
      const local = emptyCollections();
      local.teams = [
        { id: "same-version", name: "Local", syncVersion: 4 } as CloudRecord,
        { id: "older-version", name: "Local", syncVersion: 1 } as CloudRecord,
        { id: "identical", name: "Same", syncVersion: 1 } as CloudRecord,
      ];
      const cloud = emptyCollections();
      cloud.teams = [
        { id: "same-version", name: "Cloud", syncVersion: 4 } as CloudRecord,
        { id: "older-version", name: "Cloud", syncVersion: 2 } as CloudRecord,
        { id: "identical", name: "Same", syncVersion: 5 } as CloudRecord,
      ];

      const merge = mergeCloudIntoWorkingCopy({ cloudCollections: cloud, localCollections: local });

      expect(merge.collections.teams).toEqual([
        local.teams[0],
        local.teams[1],
        cloud.teams[2],
      ]);
      expect(merge.divergedRecords.map((record) => record.recordId)).toEqual(["older-version"]);
      // The edit to "same-version" started from cloud version 4, so that becomes its baseline.
      expect(merge.baseline.teams).toEqual({
        "same-version": { v: 4, h: syncContentHash(cloud.teams[0]) },
        identical: { v: 5, h: syncContentHash(cloud.teams[2]) },
      });
    });

    it("keeps backup-restored records as they are, without reporting them", () => {
      const synced = team({ syncVersion: 1 });
      const restored = team({ name: "From backup", syncVersion: 1 });
      const local = emptyCollections();
      local.teams = [restored];
      const cloud = emptyCollections();
      cloud.teams = [team({ name: "Newer cloud", syncVersion: 3 })];

      const merge = mergeCloudIntoWorkingCopy({
        cloudCollections: cloud,
        localCollections: local,
        baseline: baselineOf(synced),
        overwrites: { teams: ["t1"] },
      });

      expect(merge.collections.teams).toEqual([restored]);
      expect(merge.divergedRecords).toEqual([]);
      expect(merge.baseline.teams).toEqual(baselineOf(synced).teams);
    });

    it("still drops records deleted here or in the cloud, and their baseline entries", () => {
      const local = emptyCollections();
      local.venues = [{ id: "v-cloud-deleted", syncVersion: 1 } as CloudRecord];
      const cloud = emptyCollections();
      cloud.venues = [
        { id: "v-cloud-deleted", deletedAt: "2026-01-01T00:00:00.000Z", syncVersion: 2 } as CloudRecord,
        { id: "v-locally-deleted", syncVersion: 1 } as CloudRecord,
      ];
      const baseline: SyncBaseline = {
        venues: {
          "v-cloud-deleted": { v: 1, h: syncContentHash(local.venues[0]) },
          "v-locally-deleted": { v: 1, h: syncContentHash(cloud.venues[1]) },
        },
      };

      const merge = mergeCloudIntoWorkingCopy({
        cloudCollections: cloud,
        localCollections: local,
        baseline,
        deletions: { venues: ["v-locally-deleted"] },
      });

      expect(merge.collections.venues).toEqual([]);
      expect(merge.baseline.venues).toEqual({});
    });

    it("produces the same merge for the same inputs", () => {
      const local = emptyCollections();
      local.teams = [team({ name: "Here", syncVersion: 1 }), { id: "t2", syncVersion: 1 } as CloudRecord];
      const cloud = emptyCollections();
      cloud.teams = [team({ name: "There", syncVersion: 2 }), { id: "t3", syncVersion: 1 } as CloudRecord];
      const input = { cloudCollections: cloud, localCollections: local, baseline: baselineOf(team({ syncVersion: 1 })) };

      expect(mergeCloudIntoWorkingCopy(input)).toEqual(mergeCloudIntoWorkingCopy(input));
    });

    it("downloads with the baseline and returns the new baseline and diverged records", async () => {
      const synced = team({ syncVersion: 1 });
      const localCollections = emptyCollections();
      localCollections.teams = [synced, { id: "t2", name: "Edited here", syncVersion: 1 } as CloudRecord];
      const cloudCollections = emptyCollections();
      cloudCollections.teams = [
        team({ name: "Renamed by another admin", syncVersion: 2 }),
        { id: "t2", name: "Edited by an assistant", syncVersion: 2 } as CloudRecord,
      ];
      const repository: TournamentCloudRepository = {
        async getTournament() { return { id: tournament.id, data: { ...tournament, ownerId: "user-1" } }; },
        async findTournamentBySlug() { return null; },
        async saveTournament() { return false; },
        async getCollections() { return cloudCollections; },
        async syncCollections() { return 0; },
        async getSyncConflicts() { return []; },
      };

      const result = await downloadTournamentCommand({
        tournamentId: tournament.id,
        slug: tournament.slug,
        userId: "user-1",
        localTournament: tournament,
        localCollections,
        baseline: {
          teams: {
            t1: { v: 1, h: syncContentHash(synced) },
            t2: { v: 1, h: syncContentHash({ id: "t2", name: "Before", syncVersion: 1 } as CloudRecord) },
          },
        },
        repository,
      });

      expect(result.collections.teams).toEqual([cloudCollections.teams[0], localCollections.teams[1]]);
      expect(result.divergedRecords).toEqual([
        { collectionName: "teams", recordId: "t2", cloudRecord: cloudCollections.teams[1] },
      ]);
      expect(result.baseline.teams?.t1).toEqual({ v: 2, h: syncContentHash(cloudCollections.teams[0]) });
    });

    it("records a baseline for each record an upload wrote, and keeps the others' entries", async () => {
      const unchanged = { id: "unchanged", syncVersion: 1 } as CloudRecord;
      const conflicted = { id: "conflicted", name: "Edited", syncVersion: 1 } as CloudRecord;
      const localCollections = emptyCollections();
      localCollections.teams = [{ id: "written", name: "New" } as CloudRecord, conflicted, unchanged];
      const previous: SyncBaseline = {
        teams: {
          conflicted: { v: 1, h: "before-edit" },
          unchanged: { v: 1, h: syncContentHash(unchanged) },
          removed: { v: 1, h: "gone" },
        },
      };
      let savedBaseline: SyncBaseline | undefined;
      const repository: TournamentCloudRepository = {
        async getTournament() { return { id: tournament.id, data: { ...tournament, ownerId: "user-1" } }; },
        async findTournamentBySlug() { return null; },
        async saveTournament() { return false; },
        async getCollections() { return emptyCollections(); },
        async syncCollections(_id, collections) {
          collections.teams[0].syncVersion = 1; // written; "conflicted" hit a newer cloud version
          return 1;
        },
        async getSyncConflicts() { return []; },
      };

      await uploadTournamentCommand({
        tournament: { ...tournament },
        userId: "user-1",
        localCollections,
        baseline: previous,
        repository,
        saveSyncedRecords: (_tournament, _collections, baseline) => { savedBaseline = baseline; },
      });

      expect(savedBaseline?.teams).toEqual({
        written: { v: 1, h: syncContentHash({ id: "written", name: "New" } as CloudRecord) },
        conflicted: { v: 1, h: "before-edit" },
        unchanged: previous.teams?.unchanged,
      });
    });

    it("resolves diverged records with the cloud version", () => {
      const edited = team({ name: "Renamed here", syncVersion: 2 });
      const cloudRecord = team({ roundAvailability: { r1: true }, syncVersion: 3 });
      const localCollections = emptyCollections();
      localCollections.teams = [edited];

      const resolved = resolveDivergedRecords({
        localTournament: tournament,
        localCollections,
        baseline: baselineOf(team({ syncVersion: 2 })),
        divergedRecords: [{ collectionName: "teams", recordId: "t1", cloudRecord }],
        keep: "cloud",
      });

      expect(resolved.collections.teams).toEqual([cloudRecord]);
      expect(resolved.baseline.teams).toEqual(baselineOf(cloudRecord).teams);
      expect(localCollections.teams).toEqual([edited]);
    });

    it("resolves diverged records with this device's version, ready to upload over the cloud", () => {
      const edited = team({ name: "Renamed here", syncVersion: 2 });
      const cloudRecord = team({ roundAvailability: { r1: true }, syncVersion: 3 });
      const localCollections = emptyCollections();
      localCollections.teams = [edited];

      const resolved = resolveDivergedRecords({
        localTournament: tournament,
        localCollections,
        baseline: baselineOf(team({ syncVersion: 2 })),
        divergedRecords: [{ collectionName: "teams", recordId: "t1", cloudRecord }],
        keep: "local",
      });

      expect(resolved.collections.teams).toEqual([{ ...edited, syncVersion: 3 }]);
      expect(hasStaleSyncVersion(resolved.collections.teams[0].syncVersion, 3)).toBe(false);
      // A later download sees an edit waiting for upload, not a conflict.
      const cloud = emptyCollections();
      cloud.teams = [cloudRecord];
      const merge = mergeCloudIntoWorkingCopy({
        cloudCollections: cloud,
        localCollections: resolved.collections,
        baseline: resolved.baseline,
      });
      expect(merge.collections.teams).toEqual(resolved.collections.teams);
      expect(merge.divergedRecords).toEqual([]);
    });

    it("flags a record whose baseline was saved but whose synced version was not", () => {
      const cloudRecord = team({ name: "Downloaded", syncVersion: 2 });
      const local = emptyCollections();
      local.teams = [team({ name: "Before download", syncVersion: 1 })];
      const cloud = emptyCollections();
      cloud.teams = [cloudRecord];

      const merge = mergeCloudIntoWorkingCopy({ cloudCollections: cloud, localCollections: local, baseline: baselineOf(cloudRecord) });

      expect(merge.collections.teams).toEqual(local.teams);
      expect(merge.divergedRecords).toEqual([{ collectionName: "teams", recordId: "t1", cloudRecord }]);
    });

    it("hashes content regardless of key order and the fields the cloud stamps", () => {
      const record = { id: "t1", name: "Team", speakers: [{ id: "s1", name: "A" }] } as CloudRecord;
      const roundTripped = {
        speakers: [{ name: "A", id: "s1" }],
        updatedAt: "2026-10-18T00:00:00.000Z",
        name: "Team",
        id: "t1",
        syncVersion: 7,
        note: undefined,
      } as CloudRecord;

      expect(syncContentHash(roundTripped)).toBe(syncContentHash(record));
      expect(syncContentHash({ ...record, name: "Other" } as CloudRecord)).not.toBe(syncContentHash(record));
    });

    it("reads stored sync state, skipping malformed entries", () => {
      expect(parseSyncBaseline({
        teams: { ok: { v: 2, h: "abc" }, bad: { v: "2", h: "abc" } },
        unknown: { x: { v: 1, h: "a" } },
        venues: [],
      })).toEqual({ teams: { ok: { v: 2, h: "abc" } } });
      expect(parseSyncBaseline("nonsense")).toEqual({});
      expect(parseDivergedRecords([
        { collectionName: "teams", recordId: "t1", cloudRecord: { id: "t1" } },
        { collectionName: "teams", recordId: "t2", cloudRecord: { id: "other" } },
        { collectionName: "nope", recordId: "t3", cloudRecord: { id: "t3" } },
      ])).toEqual([{ collectionName: "teams", recordId: "t1", cloudRecord: { id: "t1" } }]);
      expect(parseDivergedRecords(null)).toEqual([]);
    });
  });

  describe("synced baseline: server writes, settings, assistants and per-record choices", () => {
    const team = (fields: Record<string, unknown>) => ({ id: "t1", name: "Team", ...fields }) as CloudRecord;
    const entry = (record: CloudRecord) => ({ v: Number(record.syncVersion) || 0, h: syncContentHash(record) });

    it("notices a cloud change that did not bump syncVersion, and flags it against a local edit", () => {
      const synced = team({ syncVersion: 2 });
      const local = emptyCollections();
      local.teams = [team({ name: "Renamed here", syncVersion: 2 })];
      const cloud = emptyCollections();
      cloud.teams = [team({ speakers: ["new"], syncVersion: 2 })];

      const merge = mergeCloudIntoWorkingCopy({ cloudCollections: cloud, localCollections: local, baseline: { teams: { t1: entry(synced) } } });

      expect(merge.collections.teams).toEqual(local.teams);
      expect(merge.divergedRecords.map((record) => record.recordId)).toEqual(["t1"]);
    });

    describe("tournament settings", () => {
      const cloudSettings = (fields: Partial<Tournament>) =>
        ({ ...tournament, ownerId: "owner", admins: { owner: true }, ...fields }) as Tournament;

      it("take the cloud settings when unchanged here since the last sync", () => {
        const synced = { ...tournament, syncVersion: 1 };
        const cloudTournament = cloudSettings({ name: "Renamed on another device", syncVersion: 2 });

        const result = mergeCloudTournament({ cloudTournament, localTournament: synced, base: entry(synced) });

        expect(result.tournament).toEqual(cloudTournament);
        expect(result.baseline).toEqual(entry(cloudTournament));
        expect(result.diverged).toBeUndefined();
      });

      it("keep settings edited here, with the cloud's owner and admins", () => {
        const synced = cloudSettings({ syncVersion: 2 });
        const edited = { ...synced, name: "Renamed here", ownerId: "local", admins: { me: true } };

        const result = mergeCloudTournament({ cloudTournament: synced, localTournament: edited, base: entry(synced) });

        expect(result.tournament).toMatchObject({ name: "Renamed here", ownerId: "owner", admins: { owner: true, me: true } });
        expect(result.baseline).toEqual(entry(synced));
        expect(result.diverged).toBeUndefined();
      });

      it("are reported when changed both here and in the cloud", () => {
        const synced = cloudSettings({ syncVersion: 2 });
        const edited = { ...synced, name: "Renamed here" };
        const cloudTournament = cloudSettings({ shortName: "Other", syncVersion: 3 });

        const result = mergeCloudTournament({ cloudTournament, localTournament: edited, base: entry(synced) });

        expect(result.tournament.name).toBe("Renamed here");
        expect(result.baseline).toEqual(entry(synced));
        expect(result.diverged).toEqual({ collectionName: "tournament", recordId: tournament.id, cloudRecord: cloudTournament });
      });

      it("arrive on download from another admin device, alongside the records", async () => {
        const synced = cloudSettings({ syncVersion: 1 });
        const cloudTournament = cloudSettings({ preferences: { ...tournament.preferences, publicStandings: false }, syncVersion: 2 });
        const repository: TournamentCloudRepository = {
          async getTournament() { return { id: tournament.id, data: { ...cloudTournament } }; },
          async findTournamentBySlug() { return null; },
          async saveTournament() { return false; },
          async getCollections() { return emptyCollections(); },
          async syncCollections() { return 0; },
          async getSyncConflicts() { return []; },
        };

        const result = await downloadTournamentCommand({
          tournamentId: tournament.id,
          slug: tournament.slug,
          userId: "owner",
          localTournament: synced,
          localCollections: emptyCollections(),
          baseline: { tournament: entry(synced) },
          repository,
        });

        expect(result.tournament.preferences.publicStandings).toBe(false);
        expect(result.baseline.tournament).toEqual(entry(cloudTournament));
        expect(result.divergedRecords).toEqual([]);
      });

      it("get a baseline entry when an upload writes them, and keep the old one on a conflict", async () => {
        const previous = { v: 1, h: "before" };
        const upload = async (metadataConflict: boolean) => {
          let saved: SyncBaseline | undefined;
          const repository: TournamentCloudRepository = {
            async getTournament() { return { id: tournament.id, data: { ...tournament, ownerId: "user-1" } }; },
            async findTournamentBySlug() { return null; },
            async saveTournament(_id, metadata) {
              if (!metadataConflict) metadata.syncVersion = 2;
              return metadataConflict;
            },
            async getCollections() { return emptyCollections(); },
            async syncCollections() { return 0; },
            async getSyncConflicts() { return []; },
          };
          const local = { ...tournament, syncVersion: 1 };
          await uploadTournamentCommand({
            tournament: local,
            userId: "user-1",
            localCollections: emptyCollections(),
            baseline: { tournament: previous },
            repository,
            saveSyncedRecords: (_tournament, _collections, baseline) => { saved = baseline; },
          });
          return { saved, local };
        };

        const written = await upload(false);
        expect(written.saved?.tournament).toEqual({ v: 2, h: syncContentHash(written.local) });
        expect((await upload(true)).saved?.tournament).toEqual(previous);
      });
    });

    describe("a data-entry assistant's projection", () => {
      it("drops local records it no longer contains, unless edited here", () => {
        const motion = { id: "m1", text: "Motion" } as CloudRecord;
        const edited = { id: "m2", text: "Edited here" } as CloudRecord;
        const local = emptyCollections();
        local.motions = [motion, edited, { id: "m3", text: "Never synced" } as CloudRecord];

        const merge = mergeCloudIntoWorkingCopy({
          cloudCollections: emptyCollections(),
          localCollections: local,
          baseline: { motions: { m1: entry(motion), m2: entry({ id: "m2", text: "Before" } as CloudRecord) } },
          cloudOmitsDeleted: true,
        });

        expect(merge.collections.motions.map((record) => record.id)).toEqual(["m2", "m3"]);
      });

      it("marks the records the server applied as synced, but not the rejected ones", () => {
        const accepted = { id: "b1", confirmed: false, speakerScores: [75] } as CloudRecord;
        const rejected = { id: "b2", confirmed: false } as CloudRecord;
        const debate = { id: "d1", resultStatus: "draft" } as CloudRecord;

        const baseline = baselineAfterDataEntrySync({
          baseline: { ballots: { b2: { v: 1, h: "before" } }, venues: { v1: { v: 1, h: "untouched" } } },
          sentCollections: { ballots: [accepted, rejected], debates: [debate] },
          rejected: [{ collectionName: "ballots", recordId: "b2" }],
        });

        expect(baseline.ballots).toEqual({ b1: entry(accepted), b2: { v: 1, h: "before" } });
        expect(baseline.debates).toEqual({ d1: entry(debate) });
        expect(baseline.venues).toEqual({ v1: { v: 1, h: "untouched" } });
      });
    });

    it("resolves only the chosen records, including the settings", () => {
      const localCollections = emptyCollections();
      localCollections.teams = [team({ name: "Mine", syncVersion: 1 }), { id: "t2", name: "Mine too", syncVersion: 1 } as CloudRecord];
      const cloudSettings = { ...tournament, name: "Cloud name", syncVersion: 4 };
      const divergedRecords = [
        { collectionName: "tournament" as const, recordId: tournament.id, cloudRecord: cloudSettings },
        { collectionName: "teams" as const, recordId: "t1", cloudRecord: team({ name: "Cloud", syncVersion: 2 }) },
        { collectionName: "teams" as const, recordId: "t2", cloudRecord: { id: "t2", name: "Cloud too", syncVersion: 3 } as CloudRecord },
      ];

      const resolved = resolveDivergedRecords({
        localTournament: { ...tournament, name: "My name", syncVersion: 3 },
        localCollections,
        baseline: {},
        divergedRecords,
        keys: ["tournament/tournament-1", "teams/t1"],
        keep: "cloud",
      });

      expect(resolved.tournament).toEqual(cloudSettings);
      expect(resolved.baseline.tournament).toEqual(entry(cloudSettings));
      expect(resolved.collections.teams).toEqual([divergedRecords[1].cloudRecord, localCollections.teams[1]]);
      expect(resolved.remaining).toEqual([divergedRecords[2]]);
      expect(divergedRecordKey(divergedRecords[2])).toBe("teams/t2");
    });

    it("reads a stored settings entry and settings conflicts", () => {
      expect(parseSyncBaseline({ tournament: { v: 3, h: "x" } })).toEqual({ tournament: { v: 3, h: "x" } });
      expect(parseDivergedRecords([
        { collectionName: "tournament", recordId: "tournament-1", cloudRecord: { id: "tournament-1" } },
      ])).toHaveLength(1);
    });
  });
});

describe("recordsChangedSinceBaseline", () => {
  const synced = { id: "same", name: "Same", syncVersion: 2 } as CloudRecord;
  const entry = (record: CloudRecord) => ({ v: Number(record.syncVersion) || 0, h: syncContentHash(record) });

  it("sends only new, edited, re-versioned and restored records", () => {
    const collections = emptyCollections();
    const edited = { id: "edited", name: "After", syncVersion: 1 } as CloudRecord;
    const reversioned = { id: "reversioned", name: "Kept", syncVersion: 5 } as CloudRecord;
    const restored = { id: "restored", name: "From backup", syncVersion: 1 } as CloudRecord;
    collections.teams = [synced, edited, reversioned, restored, { id: "new", name: "New" } as CloudRecord];
    const baseline: SyncBaseline = {
      teams: {
        same: entry(synced),
        edited: entry({ id: "edited", name: "Before", syncVersion: 1 } as CloudRecord),
        reversioned: { v: 4, h: syncContentHash(reversioned) },
        restored: entry(restored),
      },
    };
    const changed = recordsChangedSinceBaseline(collections, baseline, { teams: ["restored"] });
    expect(changed.teams.map((record) => record.id)).toEqual(["edited", "reversioned", "restored", "new"]);
    // The same objects, so the repository's version stamps reach the working copy.
    expect(changed.teams[0]).toBe(edited);
    expect(changed.rounds).toEqual([]);
  });

  it("sends everything when the device has no baseline", () => {
    const collections = emptyCollections();
    collections.ballots = [synced];
    expect(recordsChangedSinceBaseline(collections, {}).ballots).toEqual([synced]);
  });

  it("uploads only the changed records but keeps every record in the saved working copy", async () => {
    const collections = emptyCollections();
    const edited = { id: "edited", name: "After", syncVersion: 1 } as CloudRecord;
    collections.teams = [synced, edited];
    let sent: CloudRecord[] = [];
    let saved: CloudRecord[] = [];
    await uploadTournamentCommand({
      tournament: { id: "t1", slug: "t1", ownerId: "owner", admins: {} } as unknown as Tournament,
      userId: "owner",
      localCollections: collections,
      baseline: { teams: { same: entry(synced), edited: entry({ id: "edited", name: "Before", syncVersion: 1 } as CloudRecord) } },
      repository: {
        async getTournament() { return { id: "t1", data: { ownerId: "owner" } }; },
        async findTournamentBySlug() { return null; },
        async saveTournament() { return false; },
        async getCollections() { return emptyCollections(); },
        async syncCollections(_id, uploaded) {
          sent = uploaded.teams;
          uploaded.teams.forEach((record) => { record.syncVersion = 2; });
          return 0;
        },
        async getSyncConflicts() { return []; },
      },
      saveSyncedRecords: (_tournament, savedCollections) => {
        saved = savedCollections.teams;
      },
    });
    expect(sent.map((record) => record.id)).toEqual(["edited"]);
    expect(saved).toEqual([synced, { ...edited, syncVersion: 2 }]);
  });
});

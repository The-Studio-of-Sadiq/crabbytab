import { describe, expect, it } from "vitest";

import type { Tournament } from "@/types";
import { CLOUD_COLLECTIONS, planCollectionReconciliation } from "../collections";
import {
  buildDataEntrySyncPayload,
  downloadTournamentCommand,
  hasStaleSyncVersion,
  uploadTournamentCommand,
  type CloudCollectionName,
  type CloudRecord,
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
  it("preserves cloud-only records and only appends audit events", () => {
    expect(planCollectionReconciliation("teams", ["keep", "remove"], [
      { id: "keep" },
      { id: "add" },
    ])).toEqual({
      recordsToWrite: [{ id: "keep" }, { id: "add" }],
    });

    expect(planCollectionReconciliation("auditEvents", ["existing"], [
      { id: "existing" },
      { id: "new" },
    ])).toEqual({
      recordsToWrite: [{ id: "new" }],
    });
  });

  it("does not resurrect locally cached records deleted in the cloud", async () => {
    const localCollections = emptyCollections();
    localCollections.teams = [{ id: "deleted-team", name: "Old local copy" } as CloudRecord];
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
    cloudCollections.teams = [{ id: "deleted-team", name: "Cloud copy" }];
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
      { id: "same", name: "Local version" } as CloudRecord,
      { id: "local-only", name: "Local only" } as CloudRecord,
    ];
    const cloudCollections = emptyCollections();
    cloudCollections.teams = [
      { id: "same", name: "Cloud version" } as CloudRecord,
      { id: "cloud-only", name: "Cloud only" } as CloudRecord,
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
      { id: "same", name: "Local version" },
      { id: "cloud-only", name: "Cloud only" },
      { id: "local-only", name: "Local only" },
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

    expect(Object.keys(payload.collections)).toEqual(["teams", "adjudicators", "institutions", "ballots", "feedback"]);
    expect(payload).toMatchObject({ debates: [{ id: "debate-1" }] });
    expect(payload).not.toHaveProperty("rounds");
    expect(payload).not.toHaveProperty("venues");
    expect(payload).not.toHaveProperty("motions");
    expect(payload.collections.teams[0]).not.toHaveProperty("privateUrlKey");
    expect(payload.collections.teams[0]).not.toHaveProperty("privatePasscode");
    const teamPayload = payload.collections.teams[0] as unknown as Record<string, unknown>;
    expect((teamPayload.speakers as Array<Record<string, unknown>>)[0]).not.toHaveProperty("email");
  });
});
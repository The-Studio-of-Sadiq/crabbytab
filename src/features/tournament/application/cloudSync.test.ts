import { describe, expect, it } from "vitest";

import type { Tournament } from "@/types";
import { CLOUD_COLLECTIONS, planCollectionReconciliation } from "../collections";
import {
  downloadTournamentCommand,
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
  it("reconciles ordinary collections but only appends audit events", () => {
    expect(planCollectionReconciliation("teams", ["keep", "remove"], [
      { id: "keep" },
      { id: "add" },
    ])).toEqual({
      deleteIds: ["remove"],
      recordsToWrite: [{ id: "keep" }, { id: "add" }],
    });
    expect(planCollectionReconciliation("auditEvents", ["existing"], [
      { id: "existing" },
      { id: "new" },
    ])).toEqual({
      deleteIds: [],
      recordsToWrite: [{ id: "new" }],
    });
  });

  it("promotes a local tournament and writes metadata before reconciling collections", async () => {
    const calls: string[] = [];
    let savedMetadata: Tournament | undefined;
    const repository: TournamentCloudRepository = {
      async getTournament() { calls.push("read"); return null; },
      async findTournamentBySlug() { return null; },
      async saveTournament(_id, metadata) { calls.push("metadata"); savedMetadata = metadata; },
      async getCollections() { return emptyCollections(); },
      async syncCollections() { calls.push("collections"); },
    };

    await uploadTournamentCommand({
      tournament,
      userId: "user-1",
      localCollections: emptyCollections(),
      repository,
    });

    expect(calls).toEqual(["read", "metadata", "collections"]);
    expect(savedMetadata).toMatchObject({ ownerId: "user-1", admins: { "user-1": true } });
    expect(savedMetadata?.updatedAt).toEqual(expect.any(String));
  });

  it("rejects another account's cloud tournament before downloading collections", async () => {
    const calls: string[] = [];
    const repository: TournamentCloudRepository = {
      async getTournament() {
        calls.push("read");
        return { id: tournament.id, data: { ...tournament, ownerId: "other-user", admins: {} } };
      },
      async findTournamentBySlug() { return null; },
      async saveTournament() { calls.push("save"); },
      async getCollections() { calls.push("collections"); return emptyCollections(); },
      async syncCollections() { calls.push("sync"); },
    };

    await expect(downloadTournamentCommand({
      tournamentId: tournament.id,
      slug: tournament.slug,
      userId: "user-1",
      repository,
    })).rejects.toThrow("This cloud tournament belongs to another account.");

    expect(calls).toEqual(["read"]);
  });
});
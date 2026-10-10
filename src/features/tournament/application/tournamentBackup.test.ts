import { describe, expect, it } from "vitest";

import { CLOUD_COLLECTIONS, type CloudCollectionName, type CloudRecord } from "@/features/tournament/collections";
import { createTournamentBackup, mergeTournamentBackup, parseTournamentBackup } from "./tournamentBackup";
import type { Tournament } from "@/types";

const tournament = {
  id: "tournament-1",
  name: "Tournament",
  slug: "tournament",
} as Tournament;

function emptyCollections(): Record<CloudCollectionName, CloudRecord[]> {
  return Object.fromEntries(CLOUD_COLLECTIONS.map((name) => [name, []])) as Record<CloudCollectionName, CloudRecord[]>;
}

describe("tournament file backup", () => {
  it("creates and validates a versioned backup for the same tournament", () => {
    const backup = createTournamentBackup({
      tournament,
      collections: emptyCollections(),
      exportedAt: "2026-10-10T00:00:00.000Z",
    });

    expect(parseTournamentBackup(backup, tournament.id)).toEqual(backup);
    expect(() => parseTournamentBackup(backup, "different-tournament")).toThrow("different tournament");
  });

  it("merges backup-only records without replacing local conflicts or deleting either copy", () => {
    const current = emptyCollections();
    const backupCollections = emptyCollections();
    current.teams = [{ id: "shared", name: "Current" }];
    backupCollections.teams = [
      { id: "shared", name: "Backup" },
      { id: "backup-only", name: "Backup only" },
    ];
    current.auditEvents = [{ id: "event-1", summary: "Current" }];
    backupCollections.auditEvents = [
      { id: "event-1", summary: "Backup duplicate" },
      { id: "event-2", summary: "Backup event" },
    ];

    const merged = mergeTournamentBackup({ current, backup: backupCollections });

    expect(merged.teams).toEqual([
      { id: "shared", name: "Current" },
      { id: "backup-only", name: "Backup only" },
    ]);
    expect(merged.auditEvents).toEqual([
      { id: "event-1", summary: "Current" },
      { id: "event-2", summary: "Backup event" },
    ]);
  });
});
import type { Tournament } from "@/types";
import { CLOUD_COLLECTIONS, type CloudCollectionName, type CloudRecord } from "@/features/tournament/collections";

export interface TournamentBackup {
  format: "crabbytab-tournament-backup-v1";
  exportedAt: string;
  tournament: Tournament;
  collections: Record<CloudCollectionName, CloudRecord[]>;
}

export function createTournamentBackup(input: {
  tournament: Tournament;
  collections: Record<CloudCollectionName, CloudRecord[]>;
  exportedAt?: string;
}): TournamentBackup {
  return {
    format: "crabbytab-tournament-backup-v1",
    exportedAt: input.exportedAt || new Date().toISOString(),
    tournament: input.tournament,
    collections: input.collections,
  };
}

export function parseTournamentBackup(
  value: unknown,
  expectedTournamentId: string
): TournamentBackup {
  if (!value || typeof value !== "object") throw new Error("The backup file is not valid JSON data.");
  const backup = value as Partial<TournamentBackup>;
  if (backup.format !== "crabbytab-tournament-backup-v1") {
    throw new Error("This file is not a supported CrabbyTab tournament backup.");
  }
  if (!backup.tournament || backup.tournament.id !== expectedTournamentId) {
    throw new Error("This backup belongs to a different tournament.");
  }
  if (!backup.collections || typeof backup.collections !== "object") {
    throw new Error("The backup is missing tournament records.");
  }
  for (const name of CLOUD_COLLECTIONS) {
    const records = backup.collections[name];
    if (!Array.isArray(records) || !records.every((record) =>
      record && typeof record === "object" && typeof record.id === "string"
    )) {
      throw new Error(`The backup contains invalid ${name} records.`);
    }
  }
  return backup as TournamentBackup;
}

export function mergeTournamentBackup(input: {
  current: Record<CloudCollectionName, CloudRecord[]>;
  backup: Record<CloudCollectionName, CloudRecord[]>;
}): Record<CloudCollectionName, CloudRecord[]> {
  return Object.fromEntries(CLOUD_COLLECTIONS.map((name) => {
    const merged = new Map(input.current[name].map((record) => [record.id, record]));
    for (const record of input.backup[name]) {
      if (name === "auditEvents") {
        if (!merged.has(record.id)) merged.set(record.id, record);
      } else if (!merged.has(record.id)) {
        merged.set(record.id, record);
      }
    }
    return [name, [...merged.values()]];
  })) as Record<CloudCollectionName, CloudRecord[]>;
}
import type { Adjudicator, Team, Tournament } from "@/types";
import { CLOUD_COLLECTIONS, type CloudCollectionName, type CloudRecord } from "@/features/tournament/collections";
import { sanitizeAssistantAdjudicator, sanitizeAssistantTeam } from "@/lib/tournamentAccess";

export type { CloudCollectionName, CloudRecord } from "@/features/tournament/collections";

export type CloudDeletionMap = Partial<Record<CloudCollectionName, string[]>>;

export function hasStaleSyncVersion(
  localVersion: number | undefined,
  cloudVersion: number
): boolean {
  return (Number(localVersion) || 0) !== (Number(cloudVersion) || 0);
}

export const DATA_ENTRY_COLLECTIONS = [
  "teams",
  "adjudicators",
  "institutions",
  "ballots",
  "feedback",
] as const satisfies readonly CloudCollectionName[];

export interface TournamentCloudRepository {
  getTournament(id: string): Promise<{ id: string; data: Record<string, unknown> } | null>;
  findTournamentBySlug(slug: string): Promise<{ id: string; data: Record<string, unknown> } | null>;
  saveTournament(id: string, tournament: Tournament): Promise<boolean>;
  getCollections(tournamentId: string): Promise<Record<CloudCollectionName, CloudRecord[]>>;
  syncCollections(
    tournamentId: string,
    collections: Record<CloudCollectionName, CloudRecord[]>,
    deletions?: CloudDeletionMap
  ): Promise<number>;
  getSyncConflicts(tournamentId: string): Promise<SyncConflict[]>;
}

export interface SyncConflict {
  id: string;
  collectionName: string;
  recordId: string;
  record: CloudRecord;
  incomingRecord?: CloudRecord;
  archivedAt: string;
}

export function buildDataEntrySyncPayload(input: {
  localCollections: Record<CloudCollectionName, CloudRecord[]>;
}): {
  collections: Record<(typeof DATA_ENTRY_COLLECTIONS)[number], CloudRecord[]>;
  debates: CloudRecord[];
} {
  const collections = Object.fromEntries(
    DATA_ENTRY_COLLECTIONS.map((name) => [name, input.localCollections[name]])
  ) as Record<(typeof DATA_ENTRY_COLLECTIONS)[number], CloudRecord[]>;
  collections.teams = input.localCollections.teams.map(
    (record) => sanitizeAssistantTeam(record as unknown as Team) as unknown as CloudRecord
  );
  collections.adjudicators = input.localCollections.adjudicators.map(
    (record) => sanitizeAssistantAdjudicator(record as unknown as Adjudicator) as unknown as CloudRecord
  );
  return {
    collections,
    debates: input.localCollections.debates,
  };
}

export async function uploadTournamentCommand(input: {
  tournament: Tournament;
  userId: string;
  isGlobalAdmin?: boolean;
  localCollections: Record<CloudCollectionName, CloudRecord[]>;
  deletions?: CloudDeletionMap;
  repository: TournamentCloudRepository;
}): Promise<number> {
  const { tournament, userId, localCollections, deletions, repository } = input;
  const cloudTournament = await repository.getTournament(tournament.id);
  if (
    cloudTournament &&
    !input.isGlobalAdmin &&
    cloudTournament.data.ownerId !== userId &&
    (cloudTournament.data.admins as Record<string, boolean> | undefined)?.[userId] !== true
  ) {
    throw new Error("This cloud tournament belongs to another account.");
  }

  const cloudAdmins = cloudTournament
    ? (cloudTournament.data.admins as Record<string, boolean> | undefined) || {}
    : tournament.admins;
  const ownerId = cloudTournament && input.isGlobalAdmin
    ? typeof cloudTournament.data.ownerId === "string"
      ? cloudTournament.data.ownerId
      : tournament.ownerId
    : tournament.ownerId === "local" || tournament.ownerId === "director"
      ? userId
      : tournament.ownerId;
  const admins = cloudTournament && input.isGlobalAdmin
    ? cloudAdmins
    : { ...cloudAdmins, [userId]: true };
  const metadata = {
    ...tournament,
    ownerId,
    admins,
    updatedAt: new Date().toISOString(),
  };
  const metadataConflict = await repository.saveTournament(tournament.id, metadata);
  if (!metadataConflict) tournament.syncVersion = metadata.syncVersion;
  const collectionConflicts = await repository.syncCollections(
    tournament.id,
    localCollections,
    deletions
  );
  return collectionConflicts + Number(metadataConflict);
}

export async function downloadTournamentCommand(input: {
  tournamentId: string;
  slug: string;
  userId: string;
  isGlobalAdmin?: boolean;
  localTournament: Tournament;
  localCollections: Record<CloudCollectionName, CloudRecord[]>;
  deletions?: CloudDeletionMap;
  repository: TournamentCloudRepository;
}): Promise<{
  tournament: Tournament;
  collections: Record<CloudCollectionName, CloudRecord[]>;
}> {
  const {
    tournamentId,
    slug,
    userId,
    localTournament,
    localCollections,
    deletions = {},
    repository,
  } = input;
  const snapshot = await repository.getTournament(tournamentId);
  if (!snapshot) throw new Error("This tournament is not available in Firestore.");
  const cloudAdmins = snapshot.data.admins as Record<string, boolean> | undefined;
  const tournament = {
    ...snapshot.data,
    ...localTournament,
    id: snapshot.id,
    slug,
    ownerId: typeof snapshot.data.ownerId === "string" ? snapshot.data.ownerId : localTournament.ownerId,
    admins: { ...cloudAdmins, ...localTournament.admins },
  } as Tournament;
  if (!input.isGlobalAdmin && tournament.ownerId !== userId && tournament.admins?.[userId] !== true) {
    throw new Error("This cloud tournament belongs to another account.");
  }
  const cloudCollections = await repository.getCollections(tournamentId);
  const collections = Object.fromEntries(
    CLOUD_COLLECTIONS.map((name) => {
      const deletedIds = new Set(
        cloudCollections[name]
          .filter((record) => typeof record.deletedAt === "string")
          .map((record) => record.id)
      );
      for (const deletedId of deletions[name] || []) deletedIds.add(deletedId);
      const recordsById = new Map(
        cloudCollections[name]
          .filter((record) => !deletedIds.has(record.id))
          .map((record) => [record.id, record])
      );
      for (const record of localCollections[name]) {
        if (!deletedIds.has(record.id)) recordsById.set(record.id, record);
      }
      return [name, [...recordsById.values()]];
    })
  ) as Record<CloudCollectionName, CloudRecord[]>;
  return { tournament, collections };
}
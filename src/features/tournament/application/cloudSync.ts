import type { Tournament } from "@/types";
import { CLOUD_COLLECTIONS, type CloudCollectionName, type CloudRecord } from "@/features/tournament/collections";

export type { CloudCollectionName, CloudRecord } from "@/features/tournament/collections";

export interface TournamentCloudRepository {
  getTournament(id: string): Promise<{ id: string; data: Record<string, unknown> } | null>;
  findTournamentBySlug(slug: string): Promise<{ id: string; data: Record<string, unknown> } | null>;
  saveTournament(id: string, tournament: Tournament): Promise<boolean>;
  getCollections(tournamentId: string): Promise<Record<CloudCollectionName, CloudRecord[]>>;
  syncCollections(
    tournamentId: string,
    collections: Record<CloudCollectionName, CloudRecord[]>
  ): Promise<number>;
  getSyncConflicts(tournamentId: string): Promise<SyncConflict[]>;
}

export interface SyncConflict {
  id: string;
  collectionName: string;
  recordId: string;
  record: CloudRecord;
  archivedAt: string;
}

export async function uploadTournamentCommand(input: {
  tournament: Tournament;
  userId: string;
  localCollections: Record<CloudCollectionName, CloudRecord[]>;
  repository: TournamentCloudRepository;
}): Promise<number> {
  const { tournament, userId, localCollections, repository } = input;
  const cloudTournament = await repository.getTournament(tournament.id);
  if (
    cloudTournament &&
    cloudTournament.data.ownerId !== userId &&
    (cloudTournament.data.admins as Record<string, boolean> | undefined)?.[userId] !== true
  ) {
    throw new Error("This cloud tournament belongs to another account.");
  }

  const metadata = {
    ...tournament,
    ownerId:
      tournament.ownerId === "local" || tournament.ownerId === "director"
        ? userId
        : tournament.ownerId,
    admins: {
      ...(
        cloudTournament
          ? (cloudTournament.data.admins as Record<string, boolean> | undefined) || {}
          : tournament.admins
      ),
      [userId]: true,
    },
    updatedAt: new Date().toISOString(),
  };
  const metadataConflict = await repository.saveTournament(tournament.id, metadata);
  const collectionConflicts = await repository.syncCollections(tournament.id, localCollections);
  return collectionConflicts + Number(metadataConflict);
}

export async function downloadTournamentCommand(input: {
  tournamentId: string;
  slug: string;
  userId: string;
  localTournament: Tournament;
  localCollections: Record<CloudCollectionName, CloudRecord[]>;
  repository: TournamentCloudRepository;
}): Promise<{
  tournament: Tournament;
  collections: Record<CloudCollectionName, CloudRecord[]>;
}> {
  const { tournamentId, slug, userId, localTournament, localCollections, repository } = input;
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
  if (tournament.ownerId !== userId && tournament.admins?.[userId] !== true) {
    throw new Error("This cloud tournament belongs to another account.");
  }
  const cloudCollections = await repository.getCollections(tournamentId);
  const collections = Object.fromEntries(
    CLOUD_COLLECTIONS.map((name) => {
      const recordsById = new Map(cloudCollections[name].map((record) => [record.id, record]));
      for (const record of localCollections[name]) recordsById.set(record.id, record);
      return [name, [...recordsById.values()]];
    })
  ) as Record<CloudCollectionName, CloudRecord[]>;
  return { tournament, collections };
}
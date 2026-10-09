import type { Tournament } from "@/types";
import { CLOUD_COLLECTIONS, type CloudCollectionName, type CloudRecord } from "@/features/tournament/collections";

export type { CloudCollectionName, CloudRecord } from "@/features/tournament/collections";

export interface TournamentCloudRepository {
  getTournament(id: string): Promise<{ id: string; data: Record<string, unknown> } | null>;
  findTournamentBySlug(slug: string): Promise<{ id: string; data: Record<string, unknown> } | null>;
  saveTournament(id: string, tournament: Tournament): Promise<void>;
  getCollections(tournamentId: string): Promise<Record<CloudCollectionName, CloudRecord[]>>;
  syncCollections(
    tournamentId: string,
    collections: Record<CloudCollectionName, CloudRecord[]>
  ): Promise<void>;
}

export async function uploadTournamentCommand(input: {
  tournament: Tournament;
  userId: string;
  localCollections: Record<CloudCollectionName, CloudRecord[]>;
  repository: TournamentCloudRepository;
}): Promise<void> {
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
  await repository.saveTournament(tournament.id, metadata);
  await repository.syncCollections(tournament.id, localCollections);
}

export async function downloadTournamentCommand(input: {
  tournamentId: string;
  slug: string;
  userId: string;
  repository: TournamentCloudRepository;
}): Promise<{
  tournament: Tournament;
  collections: Record<CloudCollectionName, CloudRecord[]>;
}> {
  const { tournamentId, slug, userId, repository } = input;
  const snapshot = await repository.getTournament(tournamentId);
  if (!snapshot) throw new Error("This tournament is not available in Firestore.");
  const tournament = { ...snapshot.data, id: snapshot.id, slug } as Tournament;
  if (tournament.ownerId !== userId && tournament.admins?.[userId] !== true) {
    throw new Error("This cloud tournament belongs to another account.");
  }
  const collections = await repository.getCollections(tournamentId);
  return { tournament, collections };
}
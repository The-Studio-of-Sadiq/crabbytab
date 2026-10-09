import type { AuditCategory, Tournament } from "@/types";

export interface TournamentSettingsAuditEvent {
  action: string;
  category: AuditCategory;
  summary: string;
  details?: Record<string, unknown>;
}

export async function saveTournamentCommand(
  tournament: Tournament,
  previous: Tournament | null,
  dependencies: {
    localRepository: { saveTournament(tournament: Tournament): void };
    cloudRepository?: { saveTournament(tournamentId: string, tournament: Tournament): Promise<void> };
    recordAuditEvent(event: TournamentSettingsAuditEvent): Promise<void>;
    warn(message: string, error: unknown): void;
  }
): Promise<void> {
  dependencies.localRepository.saveTournament(tournament);
  try {
    if (dependencies.cloudRepository) {
      await dependencies.cloudRepository.saveTournament(tournament.id, tournament);
    }
  } catch (error) {
    dependencies.warn("Firestore sync warning:", error);
  }

  if (!previous || (
    previous.name === tournament.name &&
    previous.format === tournament.format &&
    JSON.stringify(previous.preferences) === JSON.stringify(tournament.preferences)
  )) {
    return;
  }

  const changedPreferenceKeys = Object.keys({
    ...previous.preferences,
    ...tournament.preferences,
  }).filter((key) =>
    JSON.stringify(previous.preferences[key as keyof typeof previous.preferences]) !==
    JSON.stringify(tournament.preferences[key as keyof typeof tournament.preferences])
  );
  await dependencies.recordAuditEvent({
    action: "tournament.settings_updated",
    category: "tournament",
    summary: "Tournament settings updated",
    details: {
      previousName: previous.name,
      name: tournament.name,
      previousFormat: previous.format,
      format: tournament.format,
      changedPreferenceKeys,
      previousPreferences: previous.preferences,
      preferences: tournament.preferences,
    },
  });
}
import type { Adjudicator, Speaker, Team, Tournament } from "@/types";

export function isTournamentAdministrator(
  tournament: { ownerId?: unknown; admins?: Record<string, unknown> } | null,
  userId: string | null | undefined
): boolean {
  return Boolean(
    tournament &&
      userId &&
      (tournament.ownerId === userId || tournament.admins?.[userId] === true)
  );
}

export type TournamentAccessRole = "admin" | "dataEntry" | null;

export function resolveTournamentAccessRole(
  tournament: { ownerId?: unknown; admins?: Record<string, unknown> } | null,
  userId: string,
  staffRole: unknown,
  globalAdmin: boolean
): TournamentAccessRole {
  if (
    globalAdmin ||
    isTournamentAdministrator(tournament, userId) ||
    staffRole === "admin"
  ) {
    return "admin";
  }
  return staffRole === "dataEntry" ? "dataEntry" : null;
}

export function isDataEntryRole(role: unknown): role is "dataEntry" {
  return role === "dataEntry";
}

export type AssistantTeam = Omit<Team, "privateUrlKey" | "privatePasscode" | "speakers"> & {
  speakers: Array<Omit<Speaker, "email">>;
};

export function sanitizeAssistantTeam(team: Team): AssistantTeam {
  const { privateUrlKey: _privateUrlKey, privatePasscode: _privatePasscode, speakers, ...safe } = team;
  return {
    ...safe,
    speakers: speakers.map(({ email: _email, ...speaker }) => speaker),
  };
}

export type AssistantAdjudicator = Omit<Adjudicator, "privateUrlKey" | "privatePasscode" | "conflicts"> & {
  conflicts: [];
};

export function sanitizeAssistantAdjudicator(adjudicator: Adjudicator): AssistantAdjudicator {
  const {
    privateUrlKey: _privateUrlKey,
    privatePasscode: _privatePasscode,
    conflicts: _conflicts,
    ...safe
  } = adjudicator;
  return { ...safe, conflicts: [] };
}
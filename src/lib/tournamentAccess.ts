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

export type AssistantTeam = Omit<Team, "privateUrlKey" | "privatePasscode" | "speakerUrlKeys" | "speakers"> & {
  speakers: Array<Omit<Speaker, "email" | "phone" | "privateUrlKey" | "privatePasscode">>;
};

/**
 * A data-entry assistant's copy of a team: no private URL credentials (the team's or its
 * speakers'), no speaker contact details, and team–institution conflicts only for staff who may
 * see conflicts (`conflicts.view`, docs/staff-access.md).
 */
export function sanitizeAssistantTeam(team: Team, permissions: readonly string[] = []): AssistantTeam {
  const {
    privateUrlKey: _privateUrlKey,
    privatePasscode: _privatePasscode,
    speakerUrlKeys: _speakerUrlKeys,
    institutionConflictIds,
    speakers,
    ...safe
  } = team;
  return {
    ...safe,
    ...(permissions.includes("conflicts.view") && institutionConflictIds !== undefined ? { institutionConflictIds } : {}),
    speakers: (speakers ?? []).map(
      ({ email: _email, phone: _phone, privateUrlKey: _speakerKey, privatePasscode: _speakerPasscode, ...speaker }) => speaker
    ),
  };
}

export type AssistantAdjudicator = Omit<Adjudicator, "privateUrlKey" | "privatePasscode" | "phone">;

/** An assistant's copy of an adjudicator: conflicts are kept only with `conflicts.view`. */
export function sanitizeAssistantAdjudicator(
  adjudicator: Adjudicator,
  permissions: readonly string[] = []
): AssistantAdjudicator {
  const {
    privateUrlKey: _privateUrlKey,
    privatePasscode: _privatePasscode,
    conflicts,
    phone: _phone,
    ...safe
  } = adjudicator;
  return { ...safe, conflicts: permissions.includes("conflicts.view") && Array.isArray(conflicts) ? conflicts : [] };
}
/**
 * A tournament that exists only on this device: it has never been uploaded, so its settings carry
 * no cloud `syncVersion`. It needs no account and no server: whoever holds the device runs it,
 * fully offline and without Firebase (docs/offline-and-accounts.md).
 */
export function isDeviceOnlyTournament(tournament: { syncVersion?: unknown } | null | undefined): boolean {
  return Boolean(tournament) && !(Number(tournament?.syncVersion) > 0);
}

/**
 * Whether the current viewer gets administrator views of a tournament.
 *
 * On admin pages, a device-only tournament is administered by whoever holds the device, signed in
 * or not: there is no cloud copy to protect, and the data is already on the device.
 *
 * On shared routes (/display, /public, private URLs) a signed-out viewer is never an
 * administrator, device-only tournament or not: a projector or a visitor at the venue must never
 * see unrevealed panels or unreleased data there. Otherwise administrator views need a signed-in
 * global admin or staff admin.
 */
export function isViewerTournamentAdmin(input: {
  hasTournament: boolean;
  signedIn: boolean;
  isGlobalAdmin: boolean;
  staffRole: unknown;
  /** The tournament has no cloud copy (`isDeviceOnlyTournament`). */
  deviceOnly?: boolean;
  /** The page is a shared route (/display, /public, a private URL). */
  sharedView?: boolean;
}): boolean {
  if (!input.hasTournament) return false;
  if (input.deviceOnly && !input.sharedView) return true;
  if (!input.signedIn) return false;
  return input.isGlobalAdmin || input.staffRole === "admin";
}

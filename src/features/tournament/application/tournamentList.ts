import type { Tournament } from "@/types";
import { isDeviceOnlyTournament } from "@/lib/tournamentAccess";

export type TournamentSummary = Pick<Tournament, "id" | "slug" | "name" | "format" | "createdAt">;

/** A tournament's settings as stored on this device (unvalidated). */
export type DeviceTournament = Partial<Record<keyof TournamentSummary | "syncVersion", unknown>>;

function summaryOf(value: DeviceTournament): TournamentSummary | null {
  const { id, slug, name, format, createdAt } = value;
  if (![id, slug, name, format, createdAt].every((field) => typeof field === "string" && field)) return null;
  return { id, slug, name, format, createdAt } as TournamentSummary;
}

/**
 * The tournaments to list on "My tournaments" (docs/offline-and-accounts.md).
 *
 * - Tournaments that exist only on this device are always listed: they need no account.
 * - Signed in and online (`server` is the server's list of tournaments this account may open),
 *   cloud copies on the device are listed only if the server lists them, or for a global admin.
 * - Signed out, or with the server unreachable (`server` null), every tournament on the device is
 *   listed; opening a cloud copy still needs the account that may administer it.
 */
export function tournamentsToList<Listed extends TournamentSummary>(input: {
  server: readonly Listed[] | null;
  device: readonly DeviceTournament[];
  isGlobalAdmin: boolean;
}): Array<Listed | TournamentSummary> {
  const listed = new Map<string, Listed | TournamentSummary>((input.server || []).map((tournament) => [tournament.id, tournament]));
  for (const value of input.device) {
    const summary = summaryOf(value);
    if (!summary || listed.has(summary.id)) continue;
    if (input.server === null || input.isGlobalAdmin || isDeviceOnlyTournament(value)) listed.set(summary.id, summary);
  }
  return [...listed.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

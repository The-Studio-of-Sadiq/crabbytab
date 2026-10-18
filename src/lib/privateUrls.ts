/**
 * Utilities for Tabbycat-style Participant Private URLs
 */

export function generatePrivateKey(prefix = ""): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let result = prefix ? `${prefix}_` : "";

  while (result.length < (prefix ? prefix.length + 1 : 0) + 12) {
    const randomValues = new Uint8Array(16);
    globalThis.crypto.getRandomValues(randomValues);
    for (const value of randomValues) {
      if (value >= 248) continue;
      result += chars[value % chars.length];
      if (result.length === (prefix ? prefix.length + 1 : 0) + 12) break;
    }
  }

  return result;
}

export function getAdjudicatorPrivatePath(tournamentSlug: string, keyOrId: string): string {
  return `/${tournamentSlug}/private/adjudicator/${encodeURIComponent(keyOrId)}`;
}

export function getTeamPrivatePath(tournamentSlug: string, keyOrId: string): string {
  return `/${tournamentSlug}/private/team/${encodeURIComponent(keyOrId)}`;
}

export function getAbsolutePrivateUrl(
  tournamentSlug: string,
  type: "adjudicator" | "team",
  keyOrId: string
): string {
  const path =
    type === "adjudicator"
      ? getAdjudicatorPrivatePath(tournamentSlug, keyOrId)
      : getTeamPrivatePath(tournamentSlug, keyOrId);

  if (typeof window !== "undefined") {
    return `${window.location.origin}${path}`;
  }
  return path;
}

export interface PrivateUrlSlip {
  id: string;
  type: "adjudicator" | "team";
  name: string;
  detail?: string;
  url: string;
  passcode?: string;
}

/**
 * Printable slips (name, link and, if wanted, passcode) for participants that have a private URL.
 * Participants without a key are left out; the page reports how many were skipped.
 */
export function buildPrivateUrlSlips(
  participants: { id: string; name: string; detail?: string; privateUrlKey?: string; privatePasscode?: string }[],
  type: "adjudicator" | "team",
  options: { origin: string; tournamentSlug: string; includePasscode: boolean }
): PrivateUrlSlip[] {
  return participants
    .filter((participant) => Boolean(participant.privateUrlKey))
    .map((participant) => {
      const path =
        type === "adjudicator"
          ? getAdjudicatorPrivatePath(options.tournamentSlug, participant.privateUrlKey!)
          : getTeamPrivatePath(options.tournamentSlug, participant.privateUrlKey!);
      return {
        id: participant.id,
        type,
        name: participant.name,
        ...(participant.detail ? { detail: participant.detail } : {}),
        url: `${options.origin}${path}`,
        ...(options.includePasscode && participant.privatePasscode ? { passcode: participant.privatePasscode } : {}),
      };
    });
}

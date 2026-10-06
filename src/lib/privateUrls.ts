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

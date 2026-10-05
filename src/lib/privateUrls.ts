/**
 * Utilities for Tabbycat-style Participant Private URLs
 */

export function generatePrivateKey(prefix = ""): string {
  // 12-char secure unguessable alphanumeric key
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let result = prefix ? `${prefix}_` : "";
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
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

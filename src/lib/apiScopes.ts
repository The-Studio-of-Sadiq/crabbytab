/* Token scopes. Kept free of Node imports so client pages can use them. */

/**
 * What a tournament API token may do. `read:public` sees only what the public site shows (the
 * published, release-gated view). Every other scope is an administrator grant for one resource
 * group; `write:X` implies `read:X`. Tokens are issued only by tournament administrators.
 */
export const API_RESOURCES = [
  "tournament",
  "rounds",
  "participants",
  "venues",
  "breaks",
  "draws",
  "results",
  "feedback",
  "checkins",
  "standings",
] as const;
export type ApiResource = (typeof API_RESOURCES)[number];
export type ApiAccess = "read" | "write";

/** Resources that have write endpoints (standings are always computed). */
export const WRITABLE_API_RESOURCES: readonly ApiResource[] = API_RESOURCES.filter(
  (resource) => resource !== "standings"
);

export type ApiTokenScope = "read:public" | `read:${ApiResource}` | `write:${ApiResource}`;

export const API_TOKEN_SCOPES: readonly ApiTokenScope[] = [
  "read:public",
  ...API_RESOURCES.map((resource) => `read:${resource}` as const),
  ...WRITABLE_API_RESOURCES.map((resource) => `write:${resource}` as const),
];

export const API_RESOURCE_LABELS: Record<ApiResource, string> = {
  tournament: "Tournament, preferences, feedback questions, speaker categories",
  rounds: "Rounds and motions",
  participants: "Institutions, teams, speakers, adjudicators",
  venues: "Venues and venue categories",
  breaks: "Break categories, eligibility and breaks",
  draws: "Pairings, draw generation, preformed panels",
  results: "Ballots",
  feedback: "Adjudicator feedback",
  checkins: "Availability and check-ins",
  standings: "Team, speaker, reply and adjudicator standings",
};

export function isApiTokenScope(value: unknown): value is ApiTokenScope {
  return typeof value === "string" && (API_TOKEN_SCOPES as readonly string[]).includes(value);
}

/**
 * The scopes a stored token grants. Tokens created before per-resource scopes hold a single
 * `scope` field ("read:public" or "read:draws"); newer ones hold a `scopes` array.
 */
export function storedTokenScopes(data: Record<string, unknown>): ApiTokenScope[] {
  const listed = Array.isArray(data.scopes) ? data.scopes : [data.scope];
  return [...new Set(listed.filter(isApiTokenScope))];
}

/** Validates a requested scope list for a new token: non-empty, known, no duplicates. */
export function parseRequestedScopes(value: unknown): ApiTokenScope[] | null {
  const list = typeof value === "string" ? [value] : value;
  if (!Array.isArray(list) || list.length === 0 || list.length > API_TOKEN_SCOPES.length) return null;
  if (!list.every(isApiTokenScope)) return null;
  const unique = [...new Set(list)];
  // A public token cannot also hold administrator scopes: it would be unclear which view applies.
  if (unique.includes("read:public") && unique.length > 1) return null;
  return unique;
}

/** True when `scopes` allow `access` to `resource` (write implies read). */
export function scopesAllow(scopes: readonly ApiTokenScope[], resource: ApiResource, access: ApiAccess): boolean {
  return scopes.includes(`write:${resource}`) || (access === "read" && scopes.includes(`read:${resource}`));
}

export function isPublicOnlyToken(scopes: readonly ApiTokenScope[]): boolean {
  return scopes.length === 1 && scopes[0] === "read:public";
}

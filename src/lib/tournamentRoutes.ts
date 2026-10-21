import type { StaffPermission } from "@/lib/staffPermissions";

/**
 * Route classification for pages under `/[tournamentSlug]/…` (docs/staff-access.md).
 *
 * Every check works on the path SEGMENTS after the tournament slug, never on substrings of the
 * whole path: a slug such as `public-speaking-open` or `display-cup` must not turn the tab room's
 * pages into the shared public view.
 */

/** The segments after the tournament slug, or null when the path is not inside that tournament. */
export function tournamentSubpathSegments(pathname: string | null | undefined, tournamentSlug: string): string[] | null {
  if (!pathname || !tournamentSlug) return null;
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== tournamentSlug) return null;
  return segments.slice(1);
}

/** Sections whose `/public` sub-page is a public view (schedule, check-in status, audit log). */
const PUBLIC_SUBPAGE_SECTIONS = new Set(["schedule", "checkins", "audit"]);

export type SharedRouteKind = "public" | "display" | "private" | null;

/**
 * Pages that open without staff sign-in: the public site (`/public/…` and the `/public` sub-pages
 * of a few sections), the projector (`/display`) and participants' private portals
 * (`/private/{type}/{key}`).
 */
export function sharedRouteKind(segments: readonly string[] | null): SharedRouteKind {
  if (!segments || segments.length === 0) return null;
  const [first, second] = segments;
  if (first === "public") return "public";
  if (first === "display") return "display";
  if (first === "private" && segments.length > 1) return "private";
  if (segments.length === 2 && second === "public" && PUBLIC_SUBPAGE_SECTIONS.has(first)) return "public";
  return null;
}

/** What a staff page needs: an administrator, any of some permissions, or any tournament staff. */
export type RouteRequirement = { kind: "admin" } | { kind: "anyOf"; permissions: StaffPermission[] } | { kind: "staff" };

const ADMIN: RouteRequirement = { kind: "admin" };
const STAFF: RouteRequirement = { kind: "staff" };
const anyOf = (...permissions: StaffPermission[]): RouteRequirement => ({ kind: "anyOf", permissions });

/** Administrator-only sections (their writes are administrator-only on the server too). */
const ADMIN_SECTIONS = new Set([
  "draw", "config", "staff", "private-urls", "email", "audit", "exports", "rehearsal", "api", "registration", "schedule",
]);
/** Setup lists data-entry staff cannot edit (no venue, motion or rule writes in the data-entry sync). */
const ADMIN_IMPORTS = new Set(["venues", "motions", "assistants", "speaker-categories", "adjudicator-requirements", "venue-constraints"]);

/**
 * The requirement of a staff page, matching the permission the server enforces for the data the
 * page shows or changes (lib/staffPermissions.ts) and the links the sidebar offers.
 */
export function routeRequirement(segments: readonly string[]): RouteRequirement {
  const [section, sub] = segments;
  if (!section) return STAFF;
  if (ADMIN_SECTIONS.has(section)) return ADMIN;
  switch (section) {
    case "allocation":
      // Preformed panels are written to the round, which only administrators sync.
      return sub === "panels" ? ADMIN : anyOf("allocation.edit");
    case "break":
      // Breaking adjudicators shows base scores and the breaking flag (feedback.view to see them).
      return sub === "adjudicators" ? anyOf("feedback.view", "adjudicators.scores_edit") : anyOf("standings.view");
    case "standings":
    case "analytics":
      return anyOf("standings.view");
    case "checkins":
      return anyOf("checkins.edit");
    case "feedback":
      // The adjudicator record shows base scores and conflicts as well as feedback.
      return sub === "adjudicator"
        ? anyOf("feedback.view", "adjudicators.scores_edit")
        : anyOf("feedback.enter", "feedback.view");
    case "imports":
      if (sub && ADMIN_IMPORTS.has(sub)) return ADMIN;
      if (sub === "conflicts") return anyOf("conflicts.view");
      return STAFF;
    default:
      return STAFF;
  }
}

export function meetsRouteRequirement(
  requirement: RouteRequirement,
  access: { isOwnerOrAdmin: boolean; permissions: readonly string[] }
): boolean {
  if (access.isOwnerOrAdmin) return true;
  if (requirement.kind === "admin") return false;
  if (requirement.kind === "staff") return true;
  return requirement.permissions.some((permission) => access.permissions.includes(permission));
}

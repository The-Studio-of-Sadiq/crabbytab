import type { AssistantAccessLevel } from "@/types";

/**
 * Data-entry staff permissions (Tabbycat's `assistant_access` and permission groups, mapped onto
 * what CrabbyTab's assistants can do; docs/staff-access.md).
 *
 * Administrators (owner, listed admins, staff admins, global admins) always have every permission
 * and are not described here. A data-entry staff member holds the permissions of their groups plus
 * any extra permissions, capped by the tournament's `assistantAccess` level. Every permission is
 * enforced on the server: the assistant-data route (what an assistant can read), the
 * data-entry-sync and assistant-ballots routes (what they can write) and firestore.rules (their
 * direct live writes), so hiding a page is never the only barrier.
 *
 * API token scopes (G6) can reuse these ids.
 */

export const STAFF_PERMISSIONS = [
  /** Enter ballots (unconfirmed) for debates whose draw is out. */
  "results.enter",
  /** Confirm, or blind-check, ballots that someone else entered (never their own). */
  "results.confirm_others",
  /** Record paper ballots arriving in the tab room. */
  "ballots.intake",
  /** Enter feedback on behalf of teams and adjudicators. */
  "feedback.enter",
  /** Mark teams, speakers, adjudicators and rooms available or checked in. */
  "checkins.edit",
  /** Add and edit teams, adjudicators and institutions (no scores, breaks or private URLs). */
  "participants.edit",
  /** See confirmed draws before they are released (draw display, room lists, printing). */
  "draw.display",
  /** See a round's motions before they are released (briefing-room display, printed ballots). */
  "motions.display",
] as const;

export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];

export const STAFF_PERMISSION_LABELS: Record<StaffPermission, string> = {
  "results.enter": "Enter ballots",
  "results.confirm_others": "Confirm others' ballots",
  "ballots.intake": "Receive paper ballots",
  "feedback.enter": "Enter feedback",
  "checkins.edit": "Check-ins and availability",
  "participants.edit": "Edit participants",
  "draw.display": "Draw display before release",
  "motions.display": "Motions before release",
};

export const PERMISSION_GROUP_IDS = ["tab_assistant", "ballot_desk", "check_in_desk", "feedback_desk"] as const;
export type PermissionGroupId = (typeof PERMISSION_GROUP_IDS)[number];

export interface PermissionGroup {
  label: string;
  description: string;
  permissions: readonly StaffPermission[];
}

/**
 * Tabbycat's "Tabulation Assistant" group is `tab_assistant`; the desks split it for larger tab
 * rooms. Tabbycat's Equity and Adjudication Core groups need administrator-only data (conflicts,
 * feedback scores, allocation) and stay administrator work in CrabbyTab.
 */
export const PERMISSION_GROUPS: Record<PermissionGroupId, PermissionGroup> = {
  tab_assistant: {
    label: "Tabulation assistant",
    description: "Everything data-entry staff can do (Tabbycat's assistant interface).",
    permissions: STAFF_PERMISSIONS,
  },
  ballot_desk: {
    label: "Ballot desk",
    description: "Enter and check ballots and receive paper ballots.",
    permissions: ["results.enter", "results.confirm_others", "ballots.intake"],
  },
  check_in_desk: {
    label: "Check-in desk",
    description: "Check participants and rooms in.",
    permissions: ["checkins.edit"],
  },
  feedback_desk: {
    label: "Feedback desk",
    description: "Enter adjudicator feedback.",
    permissions: ["feedback.enter"],
  },
};

export const ASSISTANT_ACCESS_LEVELS: AssistantAccessLevel[] = ["all_areas", "results_draw", "results_only", "none"];

export const ASSISTANT_ACCESS_LABELS: Record<AssistantAccessLevel, string> = {
  all_areas: "All areas (results entry, draw display and motions)",
  results_draw: "Results entry and draw display",
  results_only: "Results entry only",
  none: "No access",
};

/** Permissions removed by each access level (Tabbycat: pages that reveal matchups or motions early). */
const ACCESS_LEVEL_EXCLUDES: Record<AssistantAccessLevel, readonly StaffPermission[] | "all"> = {
  all_areas: [],
  results_draw: ["motions.display"],
  results_only: ["motions.display", "draw.display"],
  none: "all",
};

export function isStaffPermission(value: unknown): value is StaffPermission {
  return typeof value === "string" && (STAFF_PERMISSIONS as readonly string[]).includes(value);
}

export function isPermissionGroupId(value: unknown): value is PermissionGroupId {
  return typeof value === "string" && (PERMISSION_GROUP_IDS as readonly string[]).includes(value);
}

export function resolveAssistantAccess(value: unknown): AssistantAccessLevel {
  return ASSISTANT_ACCESS_LEVELS.includes(value as AssistantAccessLevel) ? (value as AssistantAccessLevel) : "all_areas";
}

/** What an administrator chose for one staff member, as stored on `staff/{uid}`. */
export interface StaffPermissionAssignment {
  groups?: unknown;
  extraPermissions?: unknown;
}

/** Cleans a submitted assignment; unknown ids are dropped. No groups means the default group. */
export function normalizePermissionAssignment(input: StaffPermissionAssignment): {
  groups: PermissionGroupId[];
  extraPermissions: StaffPermission[];
} {
  const groups = Array.isArray(input.groups) ? [...new Set(input.groups.filter(isPermissionGroupId))] : [];
  const extraPermissions = Array.isArray(input.extraPermissions)
    ? [...new Set(input.extraPermissions.filter(isStaffPermission))]
    : [];
  return { groups: groups.length > 0 ? groups : ["tab_assistant"], extraPermissions };
}

/**
 * The permissions a staff member's groups grant, before the tournament-wide access level. Stored
 * on the staff document as `permissions` so firestore.rules can check direct live writes. Staff
 * documents written before groups existed have no groups and keep the full assistant set.
 */
export function groupPermissions(assignment: StaffPermissionAssignment): StaffPermission[] {
  const { groups, extraPermissions } = normalizePermissionAssignment(assignment);
  const granted = new Set<StaffPermission>(extraPermissions);
  for (const group of groups) for (const permission of PERMISSION_GROUPS[group].permissions) granted.add(permission);
  return STAFF_PERMISSIONS.filter((permission) => granted.has(permission));
}

/** The effective permissions of a data-entry staff member under the tournament's access level. */
export function resolveStaffPermissions(
  staff: { role?: unknown; groups?: unknown; extraPermissions?: unknown } | null | undefined,
  accessLevel: unknown
): StaffPermission[] {
  if (staff?.role !== "dataEntry") return [];
  const excluded = ACCESS_LEVEL_EXCLUDES[resolveAssistantAccess(accessLevel)];
  if (excluded === "all") return [];
  return groupPermissions(staff).filter((permission) => !excluded.includes(permission));
}

export function hasStaffPermission(permissions: readonly string[] | null | undefined, permission: StaffPermission): boolean {
  return Boolean(permissions?.includes(permission));
}

export class StaffPermissionError extends Error {
  readonly status = 403;
  constructor(permission: StaffPermission) {
    super(`Your data-entry access does not include “${STAFF_PERMISSION_LABELS[permission]}”. Ask a tournament administrator.`);
  }
}

export function assertStaffPermission(permissions: readonly string[], permission: StaffPermission): void {
  if (!hasStaffPermission(permissions, permission)) throw new StaffPermissionError(permission);
}

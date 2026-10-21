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
  /** See adjudicator conflicts and team–institution conflicts (Tabbycat VIEW_*_CONFLICTS). */
  "conflicts.view",
  /** Change those conflicts (Tabbycat EDIT_*_CONFLICTS). Only together with `conflicts.view`. */
  "conflicts.edit",
  /** See feedback scores and comments, and adjudicator base/test scores and breaking status (Tabbycat VIEW_FEEDBACK*). */
  "feedback.view",
  /** Change adjudicator base and test scores and breaking status (Tabbycat EDIT_BASEJUDGESCORES_IND, EDIT_ADJ_BREAK). */
  "adjudicators.scores_edit",
  /** Change adjudicator allocations of draws they can see (Tabbycat EDIT_DEBATEADJUDICATORS). */
  "allocation.edit",
  /**
   * See standings, the break, analytics and the results of silent and unreleased rounds (Tabbycat
   * VIEW_TEAMSTANDINGS, VIEW_SPEAKERSSTANDINGS, VIEW_MOTIONSTAB, VIEW_BREAK). Not part of the
   * tabulation assistant set, as in Tabbycat.
   */
  "standings.view",
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
  "conflicts.view": "See conflicts",
  "conflicts.edit": "Edit conflicts",
  "feedback.view": "See feedback and adjudicator scores",
  "adjudicators.scores_edit": "Edit adjudicator scores and breaking",
  "allocation.edit": "Edit adjudicator allocations",
  "standings.view": "See standings, break and analytics",
};

/**
 * Tabbycat's Tabulation Assistant set: the eight permissions data-entry staff had before Equity
 * and Adjudication Core existed. Pinned, so adding a permission never widens existing assistants.
 */
export const TAB_ASSISTANT_PERMISSIONS: readonly StaffPermission[] = [
  "results.enter",
  "results.confirm_others",
  "ballots.intake",
  "feedback.enter",
  "checkins.edit",
  "participants.edit",
  "draw.display",
  "motions.display",
];

export const PERMISSION_GROUP_IDS = [
  "tab_assistant",
  "ballot_desk",
  "check_in_desk",
  "feedback_desk",
  "equity",
  "adjudication_core",
] as const;
export type PermissionGroupId = (typeof PERMISSION_GROUP_IDS)[number];

export interface PermissionGroup {
  label: string;
  description: string;
  permissions: readonly StaffPermission[];
}

/**
 * Tabbycat's "Tabulation Assistant" group is `tab_assistant`; the desks split it for larger tab
 * rooms. `equity` and `adjudication_core` map Tabbycat's groups of the same names onto the
 * permissions CrabbyTab enforces (docs/staff-access.md lists what they leave out).
 */
export const PERMISSION_GROUPS: Record<PermissionGroupId, PermissionGroup> = {
  tab_assistant: {
    label: "Tabulation assistant",
    description: "Everything data-entry staff can do (Tabbycat's assistant interface).",
    permissions: TAB_ASSISTANT_PERMISSIONS,
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
  equity: {
    label: "Equity",
    description: "See and edit conflicts (Tabbycat's Equity group).",
    permissions: ["conflicts.view", "conflicts.edit"],
  },
  adjudication_core: {
    label: "Adjudication core",
    description:
      "Allocate adjudicators, see feedback, set adjudicator scores and breaking, see draws and motions early, see standings (Tabbycat's Adjudication Core group).",
    permissions: [
      "feedback.view",
      "adjudicators.scores_edit",
      "allocation.edit",
      "conflicts.view",
      "draw.display",
      "motions.display",
      "standings.view",
    ],
  },
};

/**
 * An organiser-defined group (Tabbycat `users.Group`): a named set of the permissions above.
 * Stored server-only in `tournaments/{id}/serverOnly/staffPermissionGroups` and written only by the
 * staff groups route, which also refreshes the stored `permissions` of every staff member in it.
 */
export interface CustomPermissionGroup {
  /** `custom_` + a random suffix, so it can never collide with a built-in id. */
  id: string;
  name: string;
  permissions: StaffPermission[];
}

export const CUSTOM_GROUP_PREFIX = "custom_";
export const MAX_CUSTOM_GROUPS = 30;
const CUSTOM_GROUP_ID = /^custom_[A-Za-z0-9_-]{1,40}$/;

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
  // Allocations are made on unreleased draws, so they go with draw display.
  results_only: ["motions.display", "draw.display", "allocation.edit"],
  none: "all",
};

export function isStaffPermission(value: unknown): value is StaffPermission {
  return typeof value === "string" && (STAFF_PERMISSIONS as readonly string[]).includes(value);
}

export function isPermissionGroupId(value: unknown): value is PermissionGroupId {
  return typeof value === "string" && (PERMISSION_GROUP_IDS as readonly string[]).includes(value);
}

export function isCustomGroupId(value: unknown): value is string {
  return typeof value === "string" && CUSTOM_GROUP_ID.test(value);
}

export function resolveAssistantAccess(value: unknown): AssistantAccessLevel {
  return ASSISTANT_ACCESS_LEVELS.includes(value as AssistantAccessLevel) ? (value as AssistantAccessLevel) : "all_areas";
}

/**
 * Cleans stored custom groups: unknown permissions and malformed or duplicate groups are dropped,
 * so a stored copy can never grant more than the known permissions.
 */
export function normalizeCustomGroups(value: unknown): CustomPermissionGroup[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const groups: CustomPermissionGroup[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim().slice(0, 80) : "";
    if (!isCustomGroupId(record.id) || seen.has(record.id) || !name) continue;
    seen.add(record.id);
    const permissions = Array.isArray(record.permissions) ? record.permissions.filter(isStaffPermission) : [];
    groups.push({
      id: record.id,
      name,
      permissions: STAFF_PERMISSIONS.filter((permission) => permissions.includes(permission)),
    });
    if (groups.length >= MAX_CUSTOM_GROUPS) break;
  }
  return groups;
}

/** Problems with custom groups an administrator submitted (empty when they can be saved). */
export function validateCustomGroups(value: unknown): string[] {
  if (!Array.isArray(value)) return ["Send the permission groups as a list."];
  if (value.length > MAX_CUSTOM_GROUPS) return [`At most ${MAX_CUSTOM_GROUPS} permission groups.`];
  const problems: string[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  value.forEach((item, index) => {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const label = `Group ${index + 1}`;
    if (!isCustomGroupId(record.id)) problems.push(`${label} has an invalid id.`);
    else if (ids.has(record.id)) problems.push(`${label} repeats an id.`);
    else ids.add(record.id);
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) problems.push(`${label} needs a name.`);
    else if (name.length > 80) problems.push(`${label}: the name is longer than 80 characters.`);
    else if (names.has(name.toLowerCase())) problems.push(`Two groups are called “${name}”.`);
    else names.add(name.toLowerCase());
    if (!Array.isArray(record.permissions) || record.permissions.length === 0) {
      problems.push(`${label} needs at least one permission.`);
    } else if (!record.permissions.every(isStaffPermission)) {
      problems.push(`${label} names an unknown permission.`);
    } else if (record.permissions.includes("conflicts.edit") && !record.permissions.includes("conflicts.view")) {
      problems.push(`${label}: “${STAFF_PERMISSION_LABELS["conflicts.edit"]}” needs “${STAFF_PERMISSION_LABELS["conflicts.view"]}” too.`);
    }
  });
  return problems;
}

/** What an administrator chose for one staff member, as stored on `staff/{uid}`. */
export interface StaffPermissionAssignment {
  groups?: unknown;
  extraPermissions?: unknown;
}

/**
 * Cleans a submitted assignment: unknown ids, and custom group ids that are not among
 * `customGroups`, are dropped. No groups at all means the default group.
 */
export function normalizePermissionAssignment(
  input: StaffPermissionAssignment,
  customGroups: readonly CustomPermissionGroup[] = []
): {
  groups: string[];
  extraPermissions: StaffPermission[];
} {
  const customIds = new Set(customGroups.map((group) => group.id));
  const groups = Array.isArray(input.groups)
    ? [...new Set(input.groups.filter((group): group is string =>
        isPermissionGroupId(group) || (isCustomGroupId(group) && customIds.has(group))))]
    : [];
  const extraPermissions = Array.isArray(input.extraPermissions)
    ? [...new Set(input.extraPermissions.filter(isStaffPermission))]
    : [];
  return { groups: groups.length > 0 ? groups : ["tab_assistant"], extraPermissions };
}

/** Whether an assignment names custom groups (so their definitions must be read). */
export function usesCustomGroups(assignment: StaffPermissionAssignment | null | undefined): boolean {
  return Array.isArray(assignment?.groups) && assignment.groups.some(isCustomGroupId);
}

/**
 * The permissions a staff member's groups grant, before the tournament-wide access level. Stored
 * on the staff document as `permissions` so firestore.rules can check direct live writes. Staff
 * documents written before groups existed have no groups and keep the tabulation assistant set.
 * A custom group that no longer exists grants nothing: it never falls back to the default group.
 */
export function groupPermissions(
  assignment: StaffPermissionAssignment,
  customGroups: readonly CustomPermissionGroup[] = []
): StaffPermission[] {
  const { groups, extraPermissions } = normalizePermissionAssignment(assignment, customGroups);
  const onlyMissingCustomGroups =
    usesCustomGroups(assignment) &&
    !(assignment.groups as unknown[]).some((group) => isPermissionGroupId(group)) &&
    !groups.some(isCustomGroupId);
  const customById = new Map(customGroups.map((group) => [group.id, group]));
  const granted = new Set<StaffPermission>(extraPermissions);
  for (const group of onlyMissingCustomGroups ? [] : groups) {
    const permissions = isPermissionGroupId(group)
      ? PERMISSION_GROUPS[group].permissions
      : customById.get(group)?.permissions ?? [];
    for (const permission of permissions) granted.add(permission);
  }
  // Editing conflicts without seeing them would overwrite them blind.
  if (granted.has("conflicts.edit") && !granted.has("conflicts.view")) granted.delete("conflicts.edit");
  return STAFF_PERMISSIONS.filter((permission) => granted.has(permission));
}

/** The effective permissions of a data-entry staff member under the tournament's access level. */
export function resolveStaffPermissions(
  staff: { role?: unknown; groups?: unknown; extraPermissions?: unknown } | null | undefined,
  accessLevel: unknown,
  customGroups: readonly CustomPermissionGroup[] = []
): StaffPermission[] {
  if (staff?.role !== "dataEntry") return [];
  const excluded = ACCESS_LEVEL_EXCLUDES[resolveAssistantAccess(accessLevel)];
  if (excluded === "all") return [];
  return groupPermissions(staff, customGroups).filter((permission) => !excluded.includes(permission));
}

export function hasStaffPermission(permissions: readonly string[] | null | undefined, permission: StaffPermission): boolean {
  return Boolean(permissions?.includes(permission));
}

/**
 * Whether the viewer may change adjudicator base and test scores and the breaking and tester flags
 * (Tabbycat EDIT_BASEJUDGESCORES_IND, EDIT_ADJ_BREAK, EDIT_ADJ_TESTER): administrators, or data-entry
 * staff with `adjudicators.scores_edit` who can also see the scores (`feedback.view`), since the
 * data-entry sync ignores score fields from staff who cannot read them.
 */
export function mayEditAdjudicatorScores(access: {
  isOwnerOrAdmin: boolean;
  isDataEntryAssistant: boolean;
  permissions: readonly string[];
}): boolean {
  if (access.isOwnerOrAdmin) return true;
  return access.isDataEntryAssistant &&
    hasStaffPermission(access.permissions, "adjudicators.scores_edit") &&
    hasStaffPermission(access.permissions, "feedback.view");
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

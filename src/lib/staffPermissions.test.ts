import { describe, expect, it } from "vitest";
import {
  assertStaffPermission,
  groupPermissions,
  hasStaffPermission,
  normalizePermissionAssignment,
  resolveStaffPermissions,
  STAFF_PERMISSIONS,
  StaffPermissionError,
  TAB_ASSISTANT_PERMISSIONS,
  normalizeCustomGroups,
  validateCustomGroups,
  type CustomPermissionGroup,
} from "./staffPermissions";
import {
  requiredDataEntryPermission,
  requiredDataEntryPermissions,
  redactAssistantDebate,
  sanitizeDataEntryRecord,
} from "./dataEntrySync";

describe("staff permission groups", () => {
  it("gives staff documents without groups the full assistant set (written before groups existed)", () => {
    expect(resolveStaffPermissions({ role: "dataEntry" }, undefined)).toEqual([...TAB_ASSISTANT_PERMISSIONS]);
  });

  it("never widens the tabulation assistant set with the Equity and Adjudication Core permissions", () => {
    const permissions = resolveStaffPermissions({ role: "dataEntry", groups: ["tab_assistant"] }, "all_areas");
    for (const denied of ["conflicts.view", "conflicts.edit", "feedback.view", "adjudicators.scores_edit", "allocation.edit"]) {
      expect(permissions).not.toContain(denied);
    }
    expect(STAFF_PERMISSIONS.length).toBeGreaterThan(TAB_ASSISTANT_PERMISSIONS.length);
  });

  it("maps Tabbycat's Equity and Adjudication Core groups", () => {
    expect(groupPermissions({ groups: ["equity"] })).toEqual(["conflicts.view", "conflicts.edit"]);
    const core = groupPermissions({ groups: ["adjudication_core"] });
    expect(core).toEqual(expect.arrayContaining(["feedback.view", "adjudicators.scores_edit", "allocation.edit", "conflicts.view"]));
    expect(core).not.toContain("conflicts.edit");
    expect(core).not.toContain("results.enter");
    // Allocating goes with draw display: results-only access removes it.
    expect(resolveStaffPermissions({ role: "dataEntry", groups: ["adjudication_core"] }, "results_only")).not.toContain("allocation.edit");
  });
});

describe("custom permission groups", () => {
  const custom: CustomPermissionGroup[] = [
    { id: "custom_scorers", name: "Scorers", permissions: ["feedback.view", "adjudicators.scores_edit"] },
  ];

  it("grants a custom group's permissions only when the group exists", () => {
    expect(resolveStaffPermissions({ role: "dataEntry", groups: ["custom_scorers"] }, "all_areas", custom))
      .toEqual(["feedback.view", "adjudicators.scores_edit"]);
    // Deleted (or never loaded) custom group: nothing, never the default tabulation assistant set.
    expect(resolveStaffPermissions({ role: "dataEntry", groups: ["custom_scorers"] }, "all_areas", [])).toEqual([]);
    expect(resolveStaffPermissions({ role: "dataEntry", groups: ["custom_gone", "check_in_desk"] }, "all_areas", custom))
      .toEqual(["checkins.edit"]);
  });

  it("keeps only known custom group ids in an assignment", () => {
    expect(normalizePermissionAssignment({ groups: ["custom_scorers", "custom_other", "equity"] }, custom).groups)
      .toEqual(["custom_scorers", "equity"]);
  });

  it("drops editing conflicts without seeing them", () => {
    expect(groupPermissions({ groups: [], extraPermissions: ["conflicts.edit"] })).not.toContain("conflicts.edit");
  });

  it("validates submitted groups and cleans stored ones", () => {
    expect(validateCustomGroups([{ id: "custom_a", name: "A", permissions: ["results.enter"] }])).toEqual([]);
    expect(validateCustomGroups([{ id: "tab_assistant", name: "A", permissions: ["results.enter"] }])).not.toEqual([]);
    expect(validateCustomGroups([{ id: "custom_a", name: "", permissions: ["results.enter"] }])).not.toEqual([]);
    expect(validateCustomGroups([{ id: "custom_a", name: "A", permissions: ["admin.everything"] }])).not.toEqual([]);
    expect(validateCustomGroups([{ id: "custom_a", name: "A", permissions: ["conflicts.edit"] }])).not.toEqual([]);
    expect(validateCustomGroups([
      { id: "custom_a", name: "A", permissions: ["results.enter"] },
      { id: "custom_b", name: "a", permissions: ["results.enter"] },
    ])).not.toEqual([]);
    expect(normalizeCustomGroups([{ id: "custom_a", name: " A ", permissions: ["results.enter", "root"] }, { id: "bad" }]))
      .toEqual([{ id: "custom_a", name: "A", permissions: ["results.enter"] }]);
  });

  it("unions the groups and extra permissions, dropping unknown ids", () => {
    expect(groupPermissions({ groups: ["check_in_desk", "feedback_desk", "bogus"], extraPermissions: ["draw.display", "x"] }))
      .toEqual(["feedback.enter", "checkins.edit", "draw.display"]);
    expect(normalizePermissionAssignment({ groups: [] }).groups).toEqual(["tab_assistant"]);
  });

  it("caps permissions by the tournament's assistant access level", () => {
    const staff = { role: "dataEntry", groups: ["tab_assistant"] };
    expect(resolveStaffPermissions(staff, "all_areas")).toContain("motions.display");
    const resultsDraw = resolveStaffPermissions(staff, "results_draw");
    expect(resultsDraw).toContain("draw.display");
    expect(resultsDraw).not.toContain("motions.display");
    const resultsOnly = resolveStaffPermissions(staff, "results_only");
    expect(resultsOnly).not.toContain("draw.display");
    expect(resultsOnly).toContain("results.enter");
    expect(resolveStaffPermissions(staff, "none")).toEqual([]);
  });

  it("grants administrators and strangers nothing through this path", () => {
    expect(resolveStaffPermissions({ role: "admin" }, "all_areas")).toEqual([]);
    expect(resolveStaffPermissions(null, "all_areas")).toEqual([]);
  });

  it("asserts permissions with a readable 403 error", () => {
    expect(hasStaffPermission(["results.enter"], "results.enter")).toBe(true);
    expect(() => assertStaffPermission(["results.enter"], "results.confirm_others")).toThrow(StaffPermissionError);
  });
});

describe("data-entry sync permissions", () => {
  it("maps each collection to the permission it needs", () => {
    expect(requiredDataEntryPermission("ballots", true, [])).toBe("results.enter");
    expect(requiredDataEntryPermission("feedback", true, [])).toBe("feedback.enter");
    expect(requiredDataEntryPermission("ballotIntake", true, [])).toBe("ballots.intake");
    expect(requiredDataEntryPermission("institutions", false, ["name"])).toBe("participants.edit");
  });

  it("treats check-in-only changes to teams and adjudicators as check-ins", () => {
    expect(requiredDataEntryPermission("teams", false, ["checkedIn", "roundAvailability"])).toBe("checkins.edit");
    expect(requiredDataEntryPermission("adjudicators", false, ["roundAvailabilityAt"])).toBe("checkins.edit");
    expect(requiredDataEntryPermission("teams", false, ["checkedIn", "name"])).toBe("participants.edit");
    expect(requiredDataEntryPermission("teams", true, ["checkedIn"])).toBe("participants.edit");
  });

  it("needs the conflict and score permissions for those fields", () => {
    expect(requiredDataEntryPermissions("adjudicators", false, ["conflicts"])).toEqual(["conflicts.edit"]);
    expect(requiredDataEntryPermissions("teams", false, ["institutionConflictIds", "checkedIn"]).sort())
      .toEqual(["checkins.edit", "conflicts.edit"]);
    expect(requiredDataEntryPermissions("adjudicators", false, ["baseScore", "breaking"])).toEqual(["adjudicators.scores_edit"]);
    expect(requiredDataEntryPermissions("adjudicators", false, ["name", "checkedIn"])).toEqual(["participants.edit"]);
    // A new adjudicator's score is a create-only default; conflicts still need the permission.
    expect(requiredDataEntryPermissions("adjudicators", true, ["name", "baseScore"])).toEqual(["participants.edit"]);
    expect(requiredDataEntryPermissions("adjudicators", true, ["name", "conflicts"]).sort()).toEqual(["conflicts.edit", "participants.edit"]);
  });

  it("ignores conflicts and scores sent by staff who cannot see them", () => {
    const adjudicator = {
      id: "a1", tournamentId: "t1", name: "A", conflicts: [], baseScore: 9, breaking: true, syncVersion: 3,
    };
    const blind = sanitizeDataEntryRecord("adjudicators", adjudicator, "t1", ["checkins.edit"]);
    expect(blind.record).not.toHaveProperty("conflicts");
    expect(blind.record).not.toHaveProperty("baseScore");
    expect(blind.record).not.toHaveProperty("breaking");
    expect(blind.baseSyncVersion).toBe(3);
    const equity = sanitizeDataEntryRecord("adjudicators", adjudicator, "t1", ["conflicts.view", "conflicts.edit"]);
    expect(equity.record.conflicts).toEqual([]);
    expect(equity.record).not.toHaveProperty("baseScore");
    const core = sanitizeDataEntryRecord("adjudicators", adjudicator, "t1", ["feedback.view"]);
    expect(core.record.baseScore).toBe(9);
    expect(() => sanitizeDataEntryRecord("adjudicators", { ...adjudicator, conflicts: [{ type: "evil" }] }, "t1", ["conflicts.view"]))
      .toThrow();
    expect(() => sanitizeDataEntryRecord("adjudicators", { ...adjudicator, baseScore: 1000 }, "t1", ["feedback.view"])).toThrow();
  });

  it("shows unreleased panels only to staff who allocate", () => {
    const debate = { id: "d1", adjudicators: { chairId: "a", panellistIds: [], traineeIds: [] } };
    expect(redactAssistantDebate(debate, { adjudicatorsRevealed: false }).adjudicators).toMatchObject({ panellistIds: [] });
    expect((redactAssistantDebate(debate, { adjudicatorsRevealed: false }).adjudicators as { chairId?: string }).chairId).toBeUndefined();
    expect(redactAssistantDebate(debate, { adjudicatorsRevealed: false }, { showUnrevealedPanels: true }).adjudicators)
      .toMatchObject({ chairId: "a" });
  });

  it("shows unreleased motions only with the motions permission", () => {
    const debate = { id: "d1", motionId: "m1", motionText: "THW", adjudicators: { chairId: "a" } };
    const round = { adjudicatorsRevealed: true, motionsReleased: false };
    expect(redactAssistantDebate(debate, round).motionText).toBeUndefined();
    expect(redactAssistantDebate(debate, round, { showUnreleasedMotions: true }).motionText).toBe("THW");
  });
});

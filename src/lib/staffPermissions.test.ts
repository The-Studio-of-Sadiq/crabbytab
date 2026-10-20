import { describe, expect, it } from "vitest";
import {
  assertStaffPermission,
  groupPermissions,
  hasStaffPermission,
  normalizePermissionAssignment,
  resolveStaffPermissions,
  STAFF_PERMISSIONS,
  StaffPermissionError,
} from "./staffPermissions";
import { requiredDataEntryPermission, redactAssistantDebate } from "./dataEntrySync";

describe("staff permission groups", () => {
  it("gives staff documents without groups the full assistant set (written before groups existed)", () => {
    expect(resolveStaffPermissions({ role: "dataEntry" }, undefined)).toEqual([...STAFF_PERMISSIONS]);
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

  it("shows unreleased motions only with the motions permission", () => {
    const debate = { id: "d1", motionId: "m1", motionText: "THW", adjudicators: { chairId: "a" } };
    const round = { adjudicatorsRevealed: true, motionsReleased: false };
    expect(redactAssistantDebate(debate, round).motionText).toBeUndefined();
    expect(redactAssistantDebate(debate, round, { showUnreleasedMotions: true }).motionText).toBe("THW");
  });
});

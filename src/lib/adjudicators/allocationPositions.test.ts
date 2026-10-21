import { describe, expect, it } from "vitest";
import { allocationPositionOpen } from "./allocationPositions";

describe("allocation positions (Tabbycat no_panellist_position / no_trainee_position)", () => {
  it("keeps every position open by default", () => {
    for (const role of ["chair", "panellist", "trainee"] as const) expect(allocationPositionOpen(role, undefined)).toBe(true);
  });

  it("closes the panellist and trainee positions when turned off; the chair stays open", () => {
    const prefs = { noPanellistAdjs: true, noTraineeAdjs: true };
    expect(allocationPositionOpen("panellist", prefs)).toBe(false);
    expect(allocationPositionOpen("trainee", prefs)).toBe(false);
    expect(allocationPositionOpen("chair", prefs)).toBe(true);
    expect(allocationPositionOpen("trainee", { noPanellistAdjs: true })).toBe(true);
  });
});

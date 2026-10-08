import { describe, expect, it } from "vitest";

import { regeneratePrivateAccess } from "./privateAccess";

describe("regeneratePrivateAccess", () => {
  it("creates new private URLs and passcodes when they are missing", () => {
    const teams: Array<{ id: string; name?: string; privateUrlKey?: string; privatePasscode?: string }> = [
      {
        id: "team-1",
        name: "Alpha",
      },
    ];

    const result = regeneratePrivateAccess(teams, false, "team");

    expect(result.changed).toBe(true);
    expect(result.updatedIds).toEqual(["team-1"]);
    expect(result.items[0].privateUrlKey).toMatch(/^team_/);
    expect(result.items[0].privatePasscode).toBeTruthy();
  });

  it("leaves current credentials alone unless a refresh is forced", () => {
    const teams: Array<{ id: string; privateUrlKey?: string; privatePasscode?: string }> = [
      {
        id: "team-1",
        privateUrlKey: "team_existing_key",
        privatePasscode: "secure-passcode",
      },
    ];

    const result = regeneratePrivateAccess(teams, false, "team");

    expect(result.changed).toBe(false);
    expect(result.items[0]).toEqual(teams[0]);
  });
});

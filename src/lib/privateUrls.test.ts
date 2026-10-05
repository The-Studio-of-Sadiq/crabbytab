import { describe, it, expect } from "vitest";
import {
  generatePrivateKey,
  getAdjudicatorPrivatePath,
  getTeamPrivatePath,
  getAbsolutePrivateUrl,
} from "./privateUrls";

describe("privateUrls utility", () => {
  it("generates a random unguessable key with optional prefix", () => {
    const key1 = generatePrivateKey("adj");
    const key2 = generatePrivateKey("adj");
    const keyTeam = generatePrivateKey("team");
    const keyNoPrefix = generatePrivateKey();

    expect(key1).toMatch(/^adj_[a-z0-9]{12}$/);
    expect(key2).toMatch(/^adj_[a-z0-9]{12}$/);
    expect(keyTeam).toMatch(/^team_[a-z0-9]{12}$/);
    expect(keyNoPrefix).toMatch(/^[a-z0-9]{12}$/);
    expect(key1).not.toBe(key2);
  });

  it("builds correct adjudicator private path", () => {
    const path = getAdjudicatorPrivatePath("wudc-2026", "adj_abc123xyz");
    expect(path).toBe("/wudc-2026/private/adjudicator/adj_abc123xyz");
  });

  it("builds correct team private path", () => {
    const path = getTeamPrivatePath("wudc-2026", "team_xyz789");
    expect(path).toBe("/wudc-2026/private/team/team_xyz789");
  });

  it("handles getAbsolutePrivateUrl fallback when window is not defined", () => {
    const url = getAbsolutePrivateUrl("australs-2026", "adjudicator", "adj_key123");
    expect(url).toBe("/australs-2026/private/adjudicator/adj_key123");
  });
});

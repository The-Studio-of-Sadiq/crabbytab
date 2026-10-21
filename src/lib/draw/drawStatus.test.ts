import { describe, expect, it } from "vitest";
import type { DrawStatus } from "@/types";
import {
  drawStageActionChangesVisibility,
  drawStageActions,
  drawStageOf,
  drawStatusAfter,
  isDrawLocked,
  isDrawPubliclyReleased,
  isDrawReleasedToTeams,
  PUBLIC_RELEASE_STATUS,
} from "./drawStatus";

const round = (drawStatus: DrawStatus | string | undefined) => ({ drawStatus: drawStatus as DrawStatus });

describe("draw stages: compatibility with stored statuses", () => {
  it("keeps every pre-existing stored status at exactly its old visibility", () => {
    // Before this change "confirmed" and "released" were both public; "none" and "draft" were not.
    for (const status of ["confirmed", "released"]) {
      expect(drawStageOf(round(status))).toBe("released");
      expect(isDrawPubliclyReleased(round(status))).toBe(true);
      expect(isDrawReleasedToTeams(round(status))).toBe(true);
    }
    for (const status of ["none", "draft", undefined]) {
      expect(isDrawPubliclyReleased(round(status))).toBe(false);
      expect(isDrawReleasedToTeams(round(status))).toBe(false);
    }
    expect(drawStageOf(round(undefined))).toBe("none");
    expect(drawStageOf(round("draft"))).toBe("draft");
  });

  it("never makes the new stages public", () => {
    expect(drawStageOf(round("locked"))).toBe("locked");
    expect(isDrawPubliclyReleased(round("locked"))).toBe(false);
    expect(isDrawReleasedToTeams(round("locked"))).toBe(false);
    expect(isDrawLocked(round("locked"))).toBe(true);

    expect(drawStageOf(round("teams_released"))).toBe("teams_released");
    expect(isDrawPubliclyReleased(round("teams_released"))).toBe(false);
    expect(isDrawReleasedToTeams(round("teams_released"))).toBe(true);
  });

  it("treats an unknown stored value as an unreleased draft", () => {
    expect(drawStageOf(round("bogus"))).toBe("draft");
    expect(isDrawReleasedToTeams(round("bogus"))).toBe(false);
    expect(isDrawLocked(round("bogus"))).toBe(false);
  });

  it("writes the backward-compatible 'confirmed' for a public release", () => {
    expect(PUBLIC_RELEASE_STATUS).toBe("confirmed");
    expect(drawStatusAfter("release")).toBe("confirmed");
    expect(drawStatusAfter("release_teams")).toBe("teams_released");
    expect(drawStatusAfter("lock")).toBe("locked");
    expect(drawStatusAfter("unrelease")).toBe("locked");
    expect(drawStatusAfter("unlock")).toBe("draft");
  });
});

describe("draw stage actions", () => {
  it("offers Tabbycat's transitions from each stage", () => {
    expect(drawStageActions("none")).toEqual([]);
    expect(drawStageActions("draft")).toEqual(["lock", "release_teams", "release"]);
    expect(drawStageActions("locked")).toEqual(["unlock", "release_teams", "release"]);
    expect(drawStageActions("teams_released")).toEqual(["release", "unrelease"]);
    expect(drawStageActions("released")).toEqual(["unrelease"]);
  });

  it("marks only the actions that change what participants see", () => {
    expect(drawStageActionChangesVisibility("lock")).toBe(false);
    expect(drawStageActionChangesVisibility("unlock")).toBe(false);
    expect(drawStageActionChangesVisibility("release_teams")).toBe(true);
    expect(drawStageActionChangesVisibility("release")).toBe(true);
    expect(drawStageActionChangesVisibility("unrelease")).toBe(true);
  });
});

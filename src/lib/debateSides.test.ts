import { describe, expect, it } from "vitest";
import type { Debate } from "@/types";
import {
  BP_SIDES,
  DEFAULT_POLY_TEAMS_IN_DEBATE,
  TWO_TEAM_SIDES,
  compareSides,
  debateSides,
  isPolySide,
  isSideOfFormat,
  isTwoTeamFormat,
  polySideNumber,
  sidesForFormat,
  teamsInDebateFor,
  validatePolyTeamsInDebate,
} from "./debateSides";
import { sideLabel, sideMessage, translatedSideName } from "./sideNames";

const slot = (teamId: string, side: string) => ({ teamId, teamName: teamId, side });

describe("debate sides", () => {
  it("keeps the two-team and BP codes and order", () => {
    expect(sidesForFormat("uadc")).toEqual(["AFF", "NEG"]);
    expect(sidesForFormat("custom_2team")).toEqual(TWO_TEAM_SIDES);
    expect(sidesForFormat("bp")).toEqual(["OG", "OO", "CG", "CO"]);
    expect(sidesForFormat("bp")).toBe(BP_SIDES);
    expect(teamsInDebateFor({ format: "bp", preferences: { teamsInDebate: 4 } })).toBe(4);
    expect(teamsInDebateFor({ format: "wsdc", preferences: { teamsInDebate: 2 } })).toBe(2);
    expect(isTwoTeamFormat("wsdc")).toBe(true);
    expect(isTwoTeamFormat("bp")).toBe(false);
    expect(isTwoTeamFormat("poly")).toBe(false);
  });

  it("numbers poly positions P1 … PN from the tournament's count", () => {
    expect(sidesForFormat("poly", 6)).toEqual(["P1", "P2", "P3", "P4", "P5", "P6"]);
    expect(sidesForFormat("poly", 3)).toEqual(["P1", "P2", "P3"]);
    expect(sidesForFormat("poly", 1)).toEqual(["P1"]);
    // An invalid stored count falls back to Tabbycat's Public Speaking six.
    expect(teamsInDebateFor({ format: "poly", preferences: { teamsInDebate: 4 } })).toBe(DEFAULT_POLY_TEAMS_IN_DEBATE);
    expect(teamsInDebateFor({ format: "poly", preferences: { teamsInDebate: 5 } })).toBe(5);
    expect(isPolySide("P12")).toBe(true);
    expect(isPolySide("P0")).toBe(false);
    expect(isPolySide("AFF")).toBe(false);
    expect(polySideNumber("P12")).toBe(12);
    expect(isSideOfFormat("P3", "poly")).toBe(true);
    expect(isSideOfFormat("AFF", "poly")).toBe(false);
    expect(isSideOfFormat("P3", "uadc")).toBe(false);
    expect(["P10", "P2", "P1"].sort(compareSides)).toEqual(["P1", "P2", "P10"]);
  });

  it("accepts any whole number of teams except 2 and 4 for the poly format", () => {
    expect(validatePolyTeamsInDebate(1)).toBe("");
    expect(validatePolyTeamsInDebate(3)).toBe("");
    expect(validatePolyTeamsInDebate(6)).toBe("");
    expect(validatePolyTeamsInDebate(2)).toMatch(/two-team/);
    expect(validatePolyTeamsInDebate(4)).toMatch(/British Parliamentary/);
    expect(validatePolyTeamsInDebate(0)).toMatch(/at least 1/);
    expect(validatePolyTeamsInDebate(2.5)).toMatch(/whole number/);
  });

  it("gives a short poly room its own positions and ignores empty slots", () => {
    const tournament = { format: "poly", preferences: { teamsInDebate: 6 } } as const;
    const short = { teams: { P1: slot("a", "P1"), P2: slot("b", "P2"), P3: slot("c", "P3") } } as unknown as Debate;
    expect(debateSides(short, tournament)).toEqual(["P1", "P2", "P3"]);
    const editing = { teams: { P1: slot("a", "P1"), P2: slot("", "P2") } } as unknown as Debate;
    expect(debateSides(editing, tournament)).toEqual(["P1"]);
    const empty = { teams: { P1: slot("", "P1") } } as unknown as Debate;
    expect(debateSides(empty, tournament)).toHaveLength(6);
    // Two-team and BP debates always use the format's sides.
    expect(debateSides({ teams: {} } as unknown as Debate, { format: "bp" })).toEqual(BP_SIDES);
  });

  it("names poly positions Team 1, Team 2, … as Tabbycat's get_side_name", () => {
    expect(sideLabel("P3")).toBe("Team 3");
    expect(sideLabel("P3", { sideNames: "gov-opp" }, "full")).toBe("Team 3");
    const t = (key: string, values?: Record<string, string | number>) => `${key}:${JSON.stringify(values ?? {})}`;
    expect(sideMessage(t, "P2")).toBe('side.position:{"number":2}');
    expect(translatedSideName(t, "P2", { sideNames: "prop-opp" })).toBe('side.position:{"number":2}');
    // Unchanged for two-team and BP sides.
    expect(sideMessage(t, "OG")).toBe("side.OG:{}");
    expect(translatedSideName(t, "AFF", { sideNames: "prop-opp" })).toBe("Proposition");
  });
});

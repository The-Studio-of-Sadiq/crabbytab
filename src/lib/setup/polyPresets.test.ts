import { describe, expect, it } from "vitest";
import {
  UNSUPPORTED_TABBYCAT_PRESETS,
  buildRounds,
  defaultPreferences,
  eliminationRoundCount,
  getFormatPreset,
  getRulesPreset,
  rulesPresetPreferences,
  validateBreakSize,
} from "./presets";
import { buildConfigFile, parseConfigFile, planConfigApply } from "./configTransfer";

describe("Tabbycat's Public Speaking preset", () => {
  it("is offered, with Tabbycat's settings", () => {
    const preset = getRulesPreset("public_speaking");
    expect(preset).toBeDefined();
    expect(UNSUPPORTED_TABBYCAT_PRESETS).not.toHaveProperty("Public Speaking");
    const preferences = rulesPresetPreferences(preset!);
    expect(preset!.format).toBe("poly");
    expect(preferences).toMatchObject({
      teamsInDebate: 6,
      substantiveSpeakers: 1,
      replyScoresEnabled: false,
      minSpeakerScore: 50,
      maxSpeakerScore: 99,
      stepSpeakerScore: 1,
      maximumMargin: 0,
      marginIncludesDissenters: true,
      ballotMode: "voting",
      eliminationBallotMode: "voting",
      speakersInBallots: "prelim",
      sideNames: "1-2",
      enableMotions: false,
      enableMotionVetoes: false,
      avoidSameInstitution: false,
      avoidTeamHistory: false,
      teamStandingsPrecedence: ["speaks_avg"],
      drawRule: "random",
    });
  });

  it("has a format with six teams per room by default", () => {
    expect(getFormatPreset("poly").teamsInDebate).toBe(6);
    expect(defaultPreferences("poly").teamsInDebate).toBe(6);
  });
});

describe("rounds and breaks for N teams per room", () => {
  it("plans no elimination rounds (Tabbycat has no poly elimination draw) and accepts any break size", () => {
    expect(eliminationRoundCount(8, 6)).toBe(0);
    expect(eliminationRoundCount(8, 3)).toBe(0);
    expect(validateBreakSize(1, 6)).toBe("");
    expect(validateBreakSize(0, 6)).toMatch(/at least 1/);
    const rounds = buildRounds({ tournamentId: "t", prelimRounds: 3, maxBreakSize: 12, teamsInDebate: 6, drawRule: "random" });
    expect(rounds.map((round) => [round.stage, round.drawType])).toEqual([
      ["preliminary", "random"],
      ["preliminary", "random"],
      ["preliminary", "random"],
    ]);
  });

  it("refuses a power-paired or round-robin plan", () => {
    expect(() => buildRounds({ tournamentId: "t", prelimRounds: 3, maxBreakSize: 0, teamsInDebate: 6, drawRule: "power_paired" })).toThrow(
      /only use random draws/
    );
  });

  it("keeps two-team and BP plans unchanged", () => {
    expect(eliminationRoundCount(8, 2)).toBe(3);
    expect(eliminationRoundCount(16, 4)).toBe(3);
    expect(validateBreakSize(3, 4)).toMatch(/BP break sizes/);
  });
});

describe("configuration files for N teams per room", () => {
  const poly = { name: "Speech Open", format: "poly" as const, preferences: { ...defaultPreferences("poly"), teamsInDebate: 5 } };

  it("round-trips the team count", () => {
    const parsed = parseConfigFile(JSON.stringify(buildConfigFile(poly)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.file.preferences.teamsInDebate).toBe(5);
  });

  it("refuses 2 or 4 teams for the poly format and other counts for two-team formats", () => {
    const bad = buildConfigFile({ ...poly, preferences: { ...poly.preferences, teamsInDebate: 4 } });
    const parsed = parseConfigFile(JSON.stringify(bad));
    expect(parsed.ok).toBe(false);
    const twoTeam = buildConfigFile({ name: "x", format: "uadc", preferences: { ...defaultPreferences("uadc"), teamsInDebate: 6 } });
    expect(parseConfigFile(JSON.stringify(twoTeam)).ok).toBe(false);
  });

  it("will not change the team count once a draw exists", () => {
    const current = { format: "poly" as const, preferences: { ...defaultPreferences("poly") } };
    const plan = planConfigApply(current, { format: "poly", preferences: { teamsInDebate: 5 } }, { lockedFields: [], hasDebates: true });
    expect(plan.blocked.map((item) => item.key)).toEqual(["teamsInDebate"]);
    const fresh = planConfigApply(current, { format: "poly", preferences: { teamsInDebate: 5 } }, { lockedFields: [], hasDebates: false });
    expect(fresh.next.preferences.teamsInDebate).toBe(5);
    expect(fresh.errors).toEqual([]);
    const toBp = planConfigApply(current, { format: "bp", preferences: { teamsInDebate: 4 } }, { lockedFields: [], hasDebates: true });
    expect(toBp.blocked.map((item) => item.key)).toContain("format");
  });
});

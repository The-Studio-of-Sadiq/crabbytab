import { describe, expect, it } from "vitest";
import type { TournamentPreferences } from "@/types";
import {
  changedConfigPreferences,
  configFormDefaults,
  configFormPreferences,
  configFormProblems,
  configPreferencesToSave,
  numberFieldValue,
  parseNumberField,
  rebaseConfigPreferences,
} from "./configForm";
import { DEFAULT_TWO_TEAM_DRAW_CONFIG } from "@/lib/draw/twoTeamDraw";

// A tournament that saved only a handful of preferences (as one created without a rules preset).
const stored = {
  teamsInDebate: 2,
  substantiveSpeakers: 3,
  replyScoresEnabled: true,
  minSpeakerScore: 70,
  maxSpeakerScore: 80,
  stepSpeakerScore: 1,
  feedbackQuestions: [{ id: "q1", label: "Clear?", type: "yes_no", required: false }],
} as unknown as TournamentPreferences;

describe("config form saving", () => {
  it("an untouched save leaves the stored preferences byte-identical", () => {
    const baseline = configFormPreferences(stored, "australs");
    const saved = configPreferencesToSave(stored, baseline, { ...baseline });
    expect(JSON.stringify(saved)).toBe(JSON.stringify(stored));
    expect(changedConfigPreferences(baseline, { ...baseline })).toEqual({});
  });

  it("writes only the field the organiser changed", () => {
    const baseline = configFormPreferences(stored, "australs");
    const saved = configPreferencesToSave(stored, baseline, { ...baseline, maxSpeakerScore: 82 });
    expect(saved).toEqual({ ...stored, maxSpeakerScore: 82 });
    // Fallbacks shown on the page (margin dissenters, odd brackets...) are not written.
    expect(saved).not.toHaveProperty("marginIncludesDissenters");
    expect(saved).not.toHaveProperty("oddBracketMethod");
  });

  it("keeps changes saved elsewhere since the form loaded", () => {
    const baseline = configFormPreferences(stored, "australs");
    const newer = { ...stored, publicResults: false } as TournamentPreferences;
    const saved = configPreferencesToSave(newer, baseline, { ...baseline, minSpeakerScore: 0 });
    expect(saved).toEqual({ ...stored, publicResults: false, minSpeakerScore: 0 });
  });

  it("rebases unsaved edits onto preferences that changed remotely", () => {
    const oldBaseline = configFormPreferences(stored, "australs");
    const edited = { ...oldBaseline, renyiOrder: 0 };
    const newBaseline = configFormPreferences({ ...stored, minSpeakerScore: 60 }, "australs");
    const rebased = rebaseConfigPreferences(oldBaseline, newBaseline, edited);
    expect(rebased.minSpeakerScore).toBe(60);
    expect(rebased.renyiOrder).toBe(0);
  });
});

describe("config form defaults match the engine fallbacks", () => {
  it("shows margin-includes-dissenters off and the generator's odd-bracket fallback", () => {
    const defaults = configFormDefaults("australs");
    expect(defaults.marginIncludesDissenters).toBe(false);
    expect(defaults.oddBracketMethod).toBe(DEFAULT_TWO_TEAM_DRAW_CONFIG.oddBracketMethod);
    expect(defaults.teamInstitutionPenalty).toBe(200);
    expect(defaults.substantiveSpeakers).toBe(3);
    expect(configFormDefaults("bp").substantiveSpeakers).toBe(2);
  });
});

describe("config form validation", () => {
  const valid = configFormPreferences(stored, "australs");

  it("accepts the defaults and zero values Tabbycat allows", () => {
    expect(configFormProblems(valid, "australs")).toEqual([]);
    expect(configFormProblems({ ...valid, minSpeakerScore: 0, feedbackMinScore: 0, renyiOrder: 0, bpPositionCostExponent: 0, minAdjScoreToVote: 0 }, "australs")).toEqual([]);
    expect(configFormProblems({ ...valid, stepSpeakerScore: 0.25 }, "australs")).toEqual([]);
  });

  it("refuses minimums at or above their maximums", () => {
    expect(configFormProblems({ ...valid, minSpeakerScore: 80, maxSpeakerScore: 80 }, "australs")).toContain("speakerScoreRange");
    expect(configFormProblems({ ...valid, minReplyScore: 50, maxReplyScore: 40 }, "australs")).toContain("replyScoreRange");
    expect(configFormProblems({ ...valid, feedbackMinScore: 10, feedbackMaxScore: 5 }, "australs")).toContain("feedbackScoreRange");
  });

  it("refuses empty fields instead of saving NaN", () => {
    expect(configFormProblems({ ...valid, substantiveSpeakers: parseNumberField("") }, "australs")).toContain("substantiveSpeakers");
    expect(configFormProblems({ ...valid, minSpeakerScore: parseNumberField("") }, "australs")).toContain("speakerScoreNumbers");
    expect(configFormProblems({ ...valid, stepSpeakerScore: 0 }, "australs")).toContain("speakerScoreStep");
    expect(configFormProblems({ ...valid, renyiOrder: -1 }, "australs")).toContain("renyiOrder");
  });

  it("parses and shows number fields", () => {
    expect(parseNumberField("0")).toBe(0);
    expect(parseNumberField("0.25")).toBe(0.25);
    expect(Number.isNaN(parseNumberField(" "))).toBe(true);
    expect(numberFieldValue(Number.NaN)).toBe("");
    expect(numberFieldValue(0)).toBe(0);
  });
});

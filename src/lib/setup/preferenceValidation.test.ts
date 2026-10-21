import { describe, expect, it } from "vitest";
import { saveTournamentCommand } from "@/features/tournament/application/settings";
import { RULES_PRESETS, defaultPreferences, rulesPresetPreferences } from "@/lib/setup/presets";
import { KNOWN_PREFERENCE_KEYS } from "@/lib/setup/configTransfer";
import type { Tournament, TournamentPreferences } from "@/types";
import { isKnownPreference, preferenceChangeProblems, preferenceValueProblems } from "./preferenceValidation";

const context = { format: "wsdc" as const, rounds: [{ id: "r1" }] };

describe("preference validation", () => {
  it("knows every preference the configuration file knows", () => {
    expect(KNOWN_PREFERENCE_KEYS.filter((key) => !isKnownPreference(key))).toEqual([]);
  });

  it("accepts every format's defaults", () => {
    for (const format of ["bp", "wsdc", "australs", "uadc", "custom_2team", "poly"] as const) {
      expect(preferenceChangeProblems(undefined, defaultPreferences(format), { format })).toEqual([]);
    }
    for (const preset of RULES_PRESETS) {
      const preferences = { ...defaultPreferences(preset.format), ...rulesPresetPreferences(preset) };
      expect(preferenceChangeProblems(undefined, preferences, { format: preset.format }), preset.id).toEqual([]);
    }
  });

  it("checks enumerated settings, types and structured settings", () => {
    expect(preferenceValueProblems("drawRule", "bogus", context)).toHaveLength(1);
    expect(preferenceValueProblems("publicDraw", "yes", context)).toEqual(["must be true or false"]);
    expect(preferenceValueProblems("teamsInDebate", 4, context)).toEqual(["must be 2 for this format"]);
    expect(preferenceValueProblems("currentRoundId", "r9", context)).toEqual(["does not name a round of this tournament"]);
    expect(preferenceValueProblems("feedbackSourceWeights", { team_on_chair: 2, judge_on_chair: 1 }, context)).toEqual([
      "judge_on_chair is not a source_on_target pair",
    ]);
    expect(preferenceValueProblems("teamFeedbackQuestions", [{ id: "q", label: "Pick", type: "select_one", required: true }], context))
      .toHaveLength(1);
    expect(preferenceValueProblems("scheduleEvents", [{ id: "e", type: "debate", startTime: "nope" }], context)).toHaveLength(1);
    expect(preferenceValueProblems("venueCategories", [{ name: "A", colour: "red" }], context)).toEqual([
      "category 1: colour is not a known field",
    ]);
    expect(preferenceValueProblems("madeUp", 1, context)).toEqual(["is not a known preference"]);
    expect(preferenceValueProblems("publicHomepage", "# Welcome\n\n$x^2$", context)).toEqual([]);
    expect(preferenceValueProblems("publicHomepage", "x".repeat(20_001), context)).toEqual(["must be at most 20000 characters"]);
    expect(preferenceValueProblems("publicHomepage", 5, context)).toEqual(["must be text"]);
  });

  it("checks only what changes, so older saved values still save", () => {
    const legacy = { ...defaultPreferences("wsdc"), drawRule: "legacy-value" } as unknown as TournamentPreferences;
    expect(preferenceChangeProblems(legacy, { ...legacy, publicDraw: false }, context)).toEqual([]);
    expect(preferenceChangeProblems(legacy, { ...legacy, sideAllocationRule: "sideways" as never }, context))
      .toEqual([expect.objectContaining({ key: "sideAllocationRule" })]);
    expect(preferenceChangeProblems(legacy, { ...legacy, minSpeakerScore: 90 }, context))
      .toEqual([{ key: "minSpeakerScore", message: "must be below maxSpeakerScore" }]);
  });
});

describe("saveTournamentCommand", () => {
  const tournament: Tournament = {
    id: "t1", name: "T", shortName: "T", slug: "t", format: "wsdc", active: true, ownerId: "o", admins: {},
    preferences: defaultPreferences("wsdc"), createdAt: "", updatedAt: "",
  };

  it("refuses an invalid change before saving anything", async () => {
    let saved = false;
    await expect(saveTournamentCommand(
      { ...tournament, preferences: { ...tournament.preferences, speakersInBallots: "sometimes" as never } },
      tournament,
      {
        ballots: [],
        localRepository: { saveTournament() { saved = true; } },
        async recordAuditEvent() {},
        warn() {},
      }
    )).rejects.toThrow(/speakersInBallots/);
    expect(saved).toBe(false);
  });
});

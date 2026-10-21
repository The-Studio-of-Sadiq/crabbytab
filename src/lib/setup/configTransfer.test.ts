import { describe, expect, it } from "vitest";
import type { TournamentPreferences } from "@/types";
import { defaultPreferences, getRulesPreset } from "./presets";
import { buildConfigFile, parseConfigFile, planConfigApply, planPresetApply } from "./configTransfer";

const prefs = (extra: Partial<TournamentPreferences> = {}): TournamentPreferences => ({
  ...defaultPreferences("wsdc"),
  ...extra,
});

const unlocked = { lockedFields: [], hasDebates: false };

describe("tournament configuration files", () => {
  it("round-trips settings without tournament-specific state", () => {
    const file = buildConfigFile({
      name: "Open",
      format: "wsdc",
      preferences: prefs({
        avoidSameInstitution: false,
        releaseTeamTab: true,
        currentRoundId: "r3",
        releasedBreakCategoryIds: ["b1"],
        publicHomepage: "# Welcome\n\nhttps://youtu.be/dQw4w9WgXcQ",
      }),
    });
    expect(file.preferences).not.toHaveProperty("releaseTeamTab");
    expect(file.preferences).not.toHaveProperty("currentRoundId");
    const parsed = parseConfigFile(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.file.preferences.avoidSameInstitution).toBe(false);
    // The public homepage is a setting, carried by settings export and import.
    if (parsed.ok) expect(parsed.file.preferences.publicHomepage).toBe("# Welcome\n\nhttps://youtu.be/dQw4w9WgXcQ");
  });

  it("refuses files that are not configuration files or have wrong types", () => {
    expect(parseConfigFile("not json").ok).toBe(false);
    expect(parseConfigFile(JSON.stringify({ kind: "other" })).ok).toBe(false);
    const base = { kind: "crabbytab.tournament-config", version: 1, format: "wsdc" };
    expect(parseConfigFile(JSON.stringify({ ...base, version: 99, preferences: {} })).ok).toBe(false);
    expect(parseConfigFile(JSON.stringify({ ...base, format: "parliamentary", preferences: {} })).ok).toBe(false);
    const wrongType = parseConfigFile(JSON.stringify({ ...base, preferences: { minSpeakerScore: "seventy" } }));
    expect(wrongType.ok).toBe(false);
    expect(parseConfigFile(JSON.stringify({ ...base, preferences: { teamsInDebate: 4 } })).ok).toBe(false);
  });

  it("skips unknown and tournament-specific settings, listing them", () => {
    const parsed = parseConfigFile(JSON.stringify({
      kind: "crabbytab.tournament-config",
      version: 1,
      format: "wsdc",
      preferences: { fancyNewThing: true, releaseSpeakerTab: true, avoidTeamHistory: false },
    }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.skipped.map((item) => item.key).sort()).toEqual(["fancyNewThing", "releaseSpeakerTab"]);
    expect(parsed.file.preferences).toEqual({ avoidTeamHistory: false });
  });

  it("previews only real changes and keeps settings fixed by ballots", () => {
    const plan = planConfigApply(
      { format: "wsdc", preferences: prefs() },
      { format: "wsdc", preferences: { avoidTeamHistory: false, minSpeakerScore: 60, ballotMode: "voting" } },
      { lockedFields: ["ballotMode"], hasDebates: true }
    );
    expect(plan.changes.map((change) => change.key)).toEqual(["avoidTeamHistory"]);
    expect(plan.blocked.map((item) => item.key)).toEqual(["ballotMode"]);
    expect(plan.next.preferences.avoidTeamHistory).toBe(false);
    expect(plan.next.preferences.ballotMode).toBeUndefined();
  });

  it("refuses a result with inverted score bounds", () => {
    const plan = planConfigApply({ format: "wsdc", preferences: prefs() }, { format: "wsdc", preferences: { minSpeakerScore: 99 } }, unlocked);
    expect(plan.errors).not.toEqual([]);
  });
});

describe("applying a rules preset to an existing tournament", () => {
  it("changes the format and settings when nothing is drawn yet", () => {
    const plan = planPresetApply({ format: "wsdc", preferences: prefs() }, getRulesPreset("australs")!, unlocked);
    expect(plan.changes[0]).toEqual({ key: "format", from: "wsdc", to: "australs" });
    expect(plan.next.format).toBe("australs");
    expect(plan.errors).toEqual([]);
  });

  it("does not change teams per debate once a draw exists", () => {
    const plan = planPresetApply({ format: "wsdc", preferences: prefs() }, getRulesPreset("bp")!, { lockedFields: [], hasDebates: true });
    expect(plan.next.format).toBe("wsdc");
    expect(plan.blocked.map((item) => item.key)).toEqual(expect.arrayContaining(["format", "teamsInDebate"]));
    expect(plan.next.preferences.teamsInDebate).toBe(2);
    // Another format's settings are refused as a whole rather than half applied.
    expect(plan.errors).not.toEqual([]);
  });
});

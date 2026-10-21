import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  RESERVED_SLUGS,
  validateSlug,
  slugify,
  eliminationRoundCount,
  buildBreakCategorySchedule,
  isPowerOfTwo,
  eliminationRoundLabels,
} from "./presets";

describe("Setup Presets (setup/presets)", () => {
  it("starts smaller breaks later in the pre-created elimination sequence", () => {
    const categories = [
      { id: "open", breakSize: 32 },
      { id: "esl", breakSize: 16 },
      { id: "novice", breakSize: 8 },
    ].map((category) => ({
      ...category,
      tournamentId: "t1",
      name: category.id,
      slug: category.id,
      seq: 1,
      reserveSize: 0,
      isGeneral: false,
      priority: 1,
    }));

    expect(buildBreakCategorySchedule(categories, 4, 4)).toEqual([
      ["open"],
      ["open", "esl"],
      ["open", "esl", "novice"],
      ["open", "esl", "novice"],
    ]);
  });

  describe("slugify", () => {
    it("converts strings to clean url slugs", () => {
      expect(slugify("Australasian Debating Championship 2026")).toBe(
        "australasian-debating-championship-2026"
      );
      expect(slugify("  Hello   World! 123  ")).toBe("hello-world-123");
      expect(slugify("---special---chars---")).toBe("special-chars");
    });
  });

  describe("validateSlug", () => {
    it("validates valid slugs", () => {
      expect(validateSlug("wudc-2026")).toBe("");
      expect(validateSlug("australs26")).toBe("");
      expect(validateSlug("round-1")).toBe("");
    });

    it("rejects too short or too long slugs", () => {
      expect(validateSlug("ab")).toBe("The URL slug must be at least 3 characters.");
      expect(validateSlug("a".repeat(41))).toBe("The URL slug must be 40 characters or fewer.");
    });

    it("rejects invalid characters or uppercase", () => {
      expect(validateSlug("WUDC-2026")).toBe("Use only lowercase letters, numbers and single hyphens.");
      expect(validateSlug("wudc_2026")).toBe("Use only lowercase letters, numbers and single hyphens.");
      expect(validateSlug("wudc--2026")).toBe("Use only lowercase letters, numbers and single hyphens.");
    });

    it("rejects reserved slugs", () => {
      expect(validateSlug("login")).toBe('"login" is reserved. Please choose another slug.');
      expect(validateSlug("tournaments")).toBe('"tournaments" is reserved. Please choose another slug.');
    });

    it("reserves every top-level app route and the shared-view segments", () => {
      // A tournament with one of these slugs could never be opened at its own URL.
      const topLevelRoutes = readdirSync(join(process.cwd(), "src", "app"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("[") && !entry.name.startsWith("("))
        .map((entry) => entry.name);
      expect(topLevelRoutes.length).toBeGreaterThan(0);
      for (const route of [...topLevelRoutes, "public", "display", "private", "invite"]) {
        expect(RESERVED_SLUGS.has(route), route).toBe(true);
      }
      expect(validateSlug("public")).toContain("reserved");
      expect(validateSlug("public-speaking-open")).toBe("");
    });
  });

  describe("isPowerOfTwo", () => {
    it("identifies powers of two correctly", () => {
      expect(isPowerOfTwo(1)).toBe(true);
      expect(isPowerOfTwo(2)).toBe(true);
      expect(isPowerOfTwo(4)).toBe(true);
      expect(isPowerOfTwo(8)).toBe(true);
      expect(isPowerOfTwo(16)).toBe(true);
      expect(isPowerOfTwo(32)).toBe(true);
      expect(isPowerOfTwo(64)).toBe(true);

      expect(isPowerOfTwo(0)).toBe(false);
      expect(isPowerOfTwo(-4)).toBe(false);
      expect(isPowerOfTwo(3)).toBe(false);
      expect(isPowerOfTwo(6)).toBe(false);
      expect(isPowerOfTwo(12)).toBe(false);
    });
  });

  describe("eliminationRoundCount", () => {
    it("calculates elimination round counts for BP (teamsPerDebate = 4)", () => {
      // In BP, 4 teams = 1 round (Grand Final)
      // 8 teams = 2 rounds (SF, GF)
      // 16 teams = 3 rounds (QF, SF, GF)
      // 32 teams = 4 rounds (OF, QF, SF, GF)
      expect(eliminationRoundCount(4, 4)).toBe(1);
      expect(eliminationRoundCount(8, 4)).toBe(2);
      expect(eliminationRoundCount(16, 4)).toBe(3);
      expect(eliminationRoundCount(32, 4)).toBe(4);
      expect(eliminationRoundCount(2, 4)).toBe(0); // < 4 teams cannot form a BP room
    });

    it("calculates elimination round counts for Two-Team (teamsPerDebate = 2)", () => {
      // In 2-team, 2 teams = 1 round (GF)
      // 4 teams = 2 rounds (SF, GF)
      // 8 teams = 3 rounds (QF, SF, GF)
      // 16 teams = 4 rounds (OF, QF, SF, GF)
      expect(eliminationRoundCount(2, 2)).toBe(1);
      expect(eliminationRoundCount(4, 2)).toBe(2);
      expect(eliminationRoundCount(8, 2)).toBe(3);
      expect(eliminationRoundCount(16, 2)).toBe(4);
    });
  });

  describe("eliminationRoundLabels", () => {
    it("returns correct round names in chronological order", () => {
      const labels = eliminationRoundLabels(3);
      expect(labels).toEqual([
        { name: "Quarterfinals", abbr: "QF" },
        { name: "Semifinals", abbr: "SF" },
        { name: "Grand Final", abbr: "GF" },
      ]);
    });
  });
});

describe("per-format score scales", () => {
  it("gives each format its conventional speaker-score range", async () => {
    const { scoreDefaultsFor, defaultPreferences } = await import("./presets");
    expect(scoreDefaultsFor("bp")).toMatchObject({ minSpeakerScore: 50, maxSpeakerScore: 100 });
    expect(scoreDefaultsFor("wsdc")).toMatchObject({ minSpeakerScore: 60, maxSpeakerScore: 80, minReplyScore: 30, maxReplyScore: 40 });
    expect(scoreDefaultsFor("australs")).toMatchObject({ minSpeakerScore: 70, maxSpeakerScore: 80, minReplyScore: 35, maxReplyScore: 40 });
    expect(scoreDefaultsFor("custom_2team")).toMatchObject({ minSpeakerScore: 68, maxSpeakerScore: 84 });
    expect(defaultPreferences("wsdc")).toMatchObject({ minSpeakerScore: 60, maxSpeakerScore: 80 });
  });
});

describe("Tabbycat rule presets (tabbycat/options/presets.py, v2.12.1)", () => {
  it("includes the missing Tabbycat presets with Tabbycat's team, speaker and score settings", async () => {
    const { getRulesPreset, rulesPresetPreferences } = await import("./presets");
    const nz = getRulesPreset("nz_easters")!;
    expect(rulesPresetPreferences(nz)).toMatchObject({
      teamsInDebate: 2,
      substantiveSpeakers: 2,
      replyScoresEnabled: true,
      minSpeakerScore: 60,
      maxSpeakerScore: 80,
      minReplyScore: 30,
      maxReplyScore: 40,
      ballotMode: "voting",
      eliminationBallotMode: "voting",
      enableMotionVetoes: true,
      teamStandingsPrecedence: ["wins", "wbw", "speaks_sum", "wbw", "draw_strength", "wbw"],
      standingsMissedDebates: 2,
      sideAllocationRule: "manual_ballot",
    });
    const joynt = getRulesPreset("joynt")!;
    expect(rulesPresetPreferences(joynt)).toMatchObject({
      substantiveSpeakers: 3,
      replyScoresEnabled: true,
      sideAllocationRule: "preallocated",
      oddBracketMethod: "intermediate2",
      enableMotionVetoes: false,
      teamStandingsPrecedence: ["wins", "wbw", "speaks_sum", "wbw", "draw_strength", "wbw"],
    });
    expect(rulesPresetPreferences(getRulesPreset("canadian")!)).toMatchObject({
      teamsInDebate: 2,
      substantiveSpeakers: 2,
      replyScoresEnabled: false,
      minSpeakerScore: 50,
      maxSpeakerScore: 100,
      ballotMode: "consensus",
      eliminationBallotMode: "consensus",
      enableMotionVetoes: false,
    });
    // Australian Easters: consensus in preliminary rounds, voting in elimination rounds.
    expect(rulesPresetPreferences(getRulesPreset("australian_easters")!)).toMatchObject({
      replyScoresEnabled: false,
      ballotMode: "consensus",
      eliminationBallotMode: "voting",
    });
    expect(rulesPresetPreferences(getRulesPreset("wsdc")!)).toMatchObject({
      stepSpeakerScore: 0.5,
      teamStandingsPrecedence: ["wins", "num_adjs", "speaks_avg"],
      marginIncludesDissenters: true,
    });
    expect(rulesPresetPreferences(getRulesPreset("bp")!)).toMatchObject({
      teamsInDebate: 4,
      ballotMode: "consensus",
      teamScoreIncludesGhosts: true,
      speakerStandingsPrecedence: ["speaks_sum"],
    });
  });

  it("only uses precedence metrics, draw options and formats CrabbyTab knows", async () => {
    const { RULES_PRESETS, FORMAT_PRESETS } = await import("./presets");
    const { resolveTeamPrecedence, resolveSpeakerPrecedence } = await import("@/lib/standings/precedence");
    const formats = new Set(FORMAT_PRESETS.map((format) => format.id));
    for (const preset of RULES_PRESETS) {
      expect(formats.has(preset.format), preset.id).toBe(true);
      const { teamStandingsPrecedence, speakerStandingsPrecedence } = preset.preferences;
      if (teamStandingsPrecedence) {
        expect(resolveTeamPrecedence(preset.format, preset.preferences), preset.id).toEqual(teamStandingsPrecedence);
      }
      if (speakerStandingsPrecedence) {
        expect(resolveSpeakerPrecedence(preset.preferences), preset.id).toEqual(speakerStandingsPrecedence);
      }
      expect(preset.scores.minSpeakerScore).toBeLessThan(preset.scores.maxSpeakerScore);
      if (preset.format === "bp") expect(preset.preferences.ballotMode ?? "consensus").toBe("consensus");
    }
    expect(new Set(RULES_PRESETS.map((preset) => preset.id)).size).toBe(RULES_PRESETS.length);
  });
});

describe("wave 5 results settings in presets", () => {
  it("applies Tabbycat's side names, motions, margins, criteria and APDA ballots", async () => {
    const { getRulesPreset, rulesPresetPreferences } = await import("./presets");
    const { validateScoreCriteria } = await import("@/lib/ballots/ballotRules");
    const wsdc = rulesPresetPreferences(getRulesPreset("wsdc")!);
    expect(wsdc).toMatchObject({ sideNames: "prop-opp", enableMotions: false, stepReplyScore: 0.5 });
    expect(wsdc.scoreCriteria?.map((criterion) => criterion.name)).toEqual(["Style", "Content", "Strategy", "POIs", "Style", "Content", "Strategy"]);
    expect(validateScoreCriteria(wsdc.scoreCriteria ?? [])).toEqual([]);
    expect(rulesPresetPreferences(getRulesPreset("australian_easters")!).maximumMargin).toBe(15);
    expect(rulesPresetPreferences(getRulesPreset("bp")!)).toMatchObject({ speakersInBallots: "prelim", enableMotions: false });
    expect(rulesPresetPreferences(getRulesPreset("apda")!)).toMatchObject({
      winnersInBallots: "tied-points",
      speakerRanks: "any",
      speakersInBallots: "prelim",
      sideNames: "gov-opp",
      speakerStandingsPrecedence: ["speaks_avg", "srank", "speaks_trimmed_mean"],
    });
  });
});

describe("Karl Popper preset", () => {
  it("applies median scoring, voting individual ballots and self-split ballots", async () => {
    const { getRulesPreset, rulesPresetPreferences, UNSUPPORTED_TABBYCAT_PRESETS } = await import("./presets");
    const preset = getRulesPreset("karl_popper")!;
    expect(preset.tabbycatName).toBe("Karl Popper (Czechia)");
    expect(rulesPresetPreferences(preset)).toMatchObject({
      teamsInDebate: 2,
      substantiveSpeakers: 3,
      replyScoresEnabled: false,
      minSpeakerScore: 50,
      maxSpeakerScore: 100,
      scoreAggregation: "median",
      marginIncludesDissenters: true,
      ballotMode: "voting",
      eliminationBallotMode: "voting",
      winnersInBallots: "high-points",
      individualBallots: true,
      allowSelfSplitBallots: true,
      privateUrlBallots: true,
      teamStandingsPrecedence: ["wins", "num_adjs", "wbw", "speaks_sum", "draw_strength"],
    });
    expect(UNSUPPORTED_TABBYCAT_PRESETS["Karl Popper (Czechia)"]).toBeUndefined();
  });
});

describe("every Tabbycat preset setting CrabbyTab supports is applied", () => {
  it("applies the UI options, preparation time, side allocations page, feedback paths and seeds", async () => {
    const { getRulesPreset, rulesPresetPreferences, RULES_PRESETS } = await import("./presets");
    const prefs = (id: string) => rulesPresetPreferences(getRulesPreset(id)!);
    // ui_options of AustralsPreferences, inherited by its subclasses; WSDC hides both.
    for (const id of ["australs", "australian_easters", "nz_easters", "joynt", "uadc"]) {
      expect(prefs(id), id).toMatchObject({ showTeamInstitutions: false, showAdjudicatorInstitutions: true });
    }
    expect(prefs("wsdc")).toMatchObject({ showTeamInstitutions: false, showAdjudicatorInstitutions: false });
    expect(prefs("bp")).toMatchObject({
      preparationTime: 15,
      standingsMissedDebates: -1,
      feedbackMaxScore: 10,
      showTeamInstitutions: false,
      showAdjudicatorInstitutions: true,
    });
    expect(prefs("joynt")).toMatchObject({ publicSideAllocations: true });
    expect(prefs("uadc")).toMatchObject({ publicFeedbackProgress: true, feedbackPaths: { teams: "all_adjudicators" } });
    expect(prefs("apda")).toMatchObject({ teamSeedMode: "title" });
    expect(getRulesPreset("apda")!.firstPrelimDrawType).toBe("seeded");
    expect(prefs("karl_popper")).toMatchObject({
      enableMotionReuse: true,
      privateUrlFeedback: false,
      publicFeedbackForm: true,
      showUnaccredited: true,
    });
    // Nothing CrabbyTab supports is listed as unsupported any more.
    for (const preset of RULES_PRESETS) expect(preset.unsupported, preset.id).toEqual([]);
  });

  it("seeds the first preliminary round for APDA, otherwise draws it at random", async () => {
    const { buildRounds } = await import("./presets");
    const base = { tournamentId: "t", prelimRounds: 3, maxBreakSize: 0, teamsInDebate: 2, drawRule: "power_paired" as const };
    expect(buildRounds({ ...base, firstPrelimDrawType: "seeded" }).map((round) => round.drawType)).toEqual(["seeded", "power_paired", "power_paired"]);
    expect(buildRounds(base).map((round) => round.drawType)).toEqual(["random", "power_paired", "power_paired"]);
  });
});

describe("Tabbycat's hidden presets", () => {
  it("PublicInformation, TabRelease, participant data entry and round robin", async () => {
    const { PUBLIC_INFORMATION_PREFERENCES, tabReleasePreferences, participantDataEntryPreferences, ROUND_ROBIN_PREFERENCES } = await import("./presets");
    expect(PUBLIC_INFORMATION_PREFERENCES).toEqual({
      publicDraw: true, publicDrawMode: "current", publicBreakCategories: true, publicResults: true, publicMotions: true, publicStandings: true,
    });
    expect(tabReleasePreferences(["b", "a", "b"])).toMatchObject({
      releaseTeamTab: true, releaseSpeakerTab: true, motionTabReleased: true, releaseBallots: true, releaseAllResults: true,
      publicDiversity: true, publicResults: true, releasedBreakCategoryIds: ["a", "b"], publicBreakingAdjudicators: true,
      publicCheckInStatus: false, publicStandings: false, publicDrawMode: "off", publicBreakCategories: false,
    });
    expect(participantDataEntryPreferences("default")).toEqual({});
    expect(participantDataEntryPreferences("public_forms")).toEqual({
      privateUrlBallots: false, privateUrlFeedback: false, publicBallotForm: true, publicFeedbackForm: true,
    });
    expect(participantDataEntryPreferences("private_urls")).toMatchObject({ privateUrlBallots: true, publicBallotForm: false });
    expect(participantDataEntryPreferences("tab_staff")).toEqual({
      privateUrlBallots: false, privateUrlFeedback: false, publicBallotForm: false, publicFeedbackForm: false,
    });
    expect(ROUND_ROBIN_PREFERENCES).toEqual({ avoidTeamHistory: false, avoidSameInstitution: false, teamSeedMode: "numeric" });
  });
});

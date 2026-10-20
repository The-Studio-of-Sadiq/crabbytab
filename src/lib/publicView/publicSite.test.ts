import { describe, expect, it } from "vitest";
import { stableStringify } from "@/lib/publicView/hash";
import { buildPublicProjection, needsPublicFeedback, type PublicSourceData, type SourceRecord } from "@/lib/publicView/projection";
import { assembleProjection, buildPublicViewSections } from "@/lib/publicView/snapshot";
import { buildAdminDiversity } from "@/lib/publicView/derived";
import { createPublicNamer } from "@/lib/publicView/names";
import type { Adjudicator, BallotSubmission, Debate, FeedbackSubmission, Institution, Round, Team, Tournament } from "@/types";

/**
 * Gating of the wave 4–5 public-site fields: every new field is absent from the projection until
 * its setting is on, and hidden names never appear anywhere in it.
 */

const tournament = (preferences: Record<string, unknown> = {}): SourceRecord => ({
  id: "t1",
  name: "Test Open",
  shortName: "TO",
  slug: "test-open",
  format: "australs",
  ownerId: "owner",
  admins: {},
  preferences: {
    teamsInDebate: 2,
    substantiveSpeakers: 3,
    replyScoresEnabled: false,
    publicResults: true,
    publicMotions: true,
    ...preferences,
  },
});

const speaker = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, ...extra });
const entries = (side: "AFF" | "NEG", ids: string[], scores: number[], names: string[]) =>
  ids.map((speakerId, index) => ({ speakerId, speakerName: names[index], position: index + 1, score: scores[index] }));

function source(): PublicSourceData {
  const affScores = [76, 75, 74];
  const negScores = [74, 73, 72];
  return {
    rounds: [
      { id: "r1", seq: 1, name: "Round 1", stage: "preliminary", drawStatus: "released", adjudicatorsRevealed: true, resultsReleased: true, teamSpeaksReleased: true, completed: true, feedbackWeight: 0.5 },
      { id: "r2", seq: 2, name: "Round 2", stage: "preliminary", drawStatus: "released", adjudicatorsRevealed: true, resultsReleased: false, completed: true, silent: true, feedbackWeight: 0.5, preallocatedSides: { "team-a": "NEG", "team-b": "AFF" } },
    ],
    teams: [
      {
        id: "team-a", name: "Alpha Real", codeName: "Fox", emoji: "🦊", institutionId: "inst-1", institutionName: "Alpha Uni",
        breakCategories: ["open"], speakerCategories: [],
        speakers: [speaker("a1", "Ann Secret", { anonymous: true, gender: "F" }), speaker("a2", "Abe", { codeName: "Code A2", gender: "M" }), speaker("a3", "Aya", { gender: "F" })],
      },
      {
        id: "team-b", name: "Beta Real", codeName: "Beta Real", institutionId: "inst-2", institutionName: "Beta Uni",
        breakCategories: ["open"], speakerCategories: [],
        speakers: [speaker("b1", "Bo", { gender: "M" }), speaker("b2", "Bea", { gender: "F" }), speaker("b3", "Ben", { gender: "M" })],
      },
    ],
    adjudicators: [
      { id: "adj-1", name: "Chair Person", institutionId: "inst-1", institutionName: "Alpha Uni", baseScore: 7, gender: "F", conflicts: [] },
      { id: "adj-2", name: "Hidden Judge", anonymous: true, baseScore: 6, gender: "M", conflicts: [] },
      { id: "adj-3", name: "Wing Three", codeName: "Code J3", baseScore: 5, conflicts: [] },
    ],
    debates: ["r1", "r2"].map((roundId, index) => ({
      id: `d${index + 1}`,
      roundId,
      roundSeq: index + 1,
      teams: {
        AFF: { teamId: "team-a", teamName: "Alpha Real", side: "AFF", points: 1 },
        NEG: { teamId: "team-b", teamName: "Beta Real", side: "NEG", points: 0 },
      },
      adjudicators: {
        chairId: "adj-1", chairName: "Chair Person",
        panellistIds: ["adj-2", "adj-3"], panellistNames: ["Hidden Judge", "Wing Three"],
        traineeIds: [], traineeNames: [],
      },
    })),
    ballots: ["r1", "r2"].map((roundId, index) => {
      const aff = entries("AFF", ["a1", "a2", "a3"], affScores, ["Ann Secret", "Abe", "Aya"]);
      const neg = entries("NEG", ["b1", "b2", "b3"], negScores, ["Bo", "Bea", "Ben"]);
      // adj-3 scored NEG higher: a split.
      const split = { AFF: entries("AFF", ["a1", "a2", "a3"], [70, 70, 70], ["Ann Secret", "Abe", "Aya"]), NEG: neg };
      return {
        id: `b${index + 1}`,
        roundId,
        debateId: `d${index + 1}`,
        version: 1,
        confirmed: true,
        discarded: false,
        submitterName: "Secret Submitter",
        speakerScores: { AFF: aff, NEG: neg },
        teamScores: {
          AFF: { side: "AFF", teamId: "team-a", points: 1, win: true, totalSpeakerScore: 225 },
          NEG: { side: "NEG", teamId: "team-b", points: 0, win: false, totalSpeakerScore: 219 },
        },
        sheets: [
          { adjudicatorId: "adj-1", adjudicatorName: "Chair Person", speakerScores: { AFF: aff, NEG: neg }, comment: "free text note", criteria: { clarity: 4 } },
          { adjudicatorId: "adj-2", adjudicatorName: "Hidden Judge", speakerScores: { AFF: aff, NEG: neg } },
          { adjudicatorId: "adj-3", adjudicatorName: "Wing Three", speakerScores: split },
        ],
        vetoes: { AFF: "m2", NEG: "m2" },
        motionId: "m1",
      };
    }),
    motions: [
      { id: "m1", text: "THW test", released: true, rounds: ["r1"], seq: 1 },
      { id: "m2", text: "THW veto", released: true, rounds: ["r1"], seq: 2 },
    ],
    breakCategories: [{ id: "open", name: "Open", seq: 1, breakSize: 2, priority: 1 }],
    institutions: [
      { id: "inst-1", name: "Alpha Uni", code: "AU", region: "North" },
      { id: "inst-2", name: "Beta Uni", code: "BU", region: "South" },
    ],
    venues: [],
    feedback: [
      { id: "f1", roundId: "r1", debateId: "d1", targetType: "adjudicator", targetAdjudicatorId: "adj-1", sourceType: "team", sourceId: "team-a", sourceName: "Alpha Real", score: 8, confirmed: true, comments: "secret comment" },
    ],
  };
}

const project = (preferences: Record<string, unknown> = {}, data = source()) => buildPublicProjection(tournament(preferences), data);
const text = (value: unknown) => stableStringify(value);

describe("public draw mode", () => {
  it("publishes every released draw by default and marks each round", () => {
    const projection = project();
    expect(projection.collections.rounds.map((round) => [round.id, round.drawPublic])).toEqual([["r1", true], ["r2", true]]);
  });

  it("shows only the current round's draw in current mode, keeping earlier public results", () => {
    const data = source();
    data.rounds[1] = { ...data.rounds[1], resultsReleased: false };
    const projection = project({ publicDrawMode: "current" }, data);
    expect(projection.collections.rounds.map((round) => [round.id, round.drawPublic])).toEqual([["r1", false], ["r2", true]]);
    // Round 1 stays because its results are public.
    expect(projection.collections.debates.map((debate) => debate.id).sort()).toEqual(["d1", "d2"]);

    data.rounds[0] = { ...data.rounds[0], resultsReleased: false };
    expect(project({ publicDrawMode: "current" }, data).collections.debates.map((debate) => debate.id)).toEqual(["d2"]);
  });

  it("turns the draw off with the mode or the legacy switch", () => {
    for (const preferences of [{ publicDrawMode: "off" }, { publicDraw: false }]) {
      const projection = project(preferences);
      expect(projection.collections.rounds.every((round) => round.drawPublic === false)).toBe(true);
      // Panels are part of the draw.
      expect(projection.collections.adjudicators).toEqual([]);
    }
  });
});

describe("anonymity and code names", () => {
  it("redacts anonymous speakers and adjudicators everywhere", () => {
    const projection = project({ releaseBallots: true, releaseSpeakerTab: true });
    const json = text(projection);
    expect(json).not.toContain("Ann Secret");
    expect(json).not.toContain("Hidden Judge");
    const alpha = projection.collections.teams.find((team) => team.id === "team-a") as { speakers: Array<Record<string, unknown>> };
    expect(alpha.speakers[0]).toEqual({ id: "a1", name: "", anonymous: true });
    expect(projection.collections.adjudicators.find((adjudicator) => adjudicator.id === "adj-2")).toMatchObject({ name: "", anonymous: true });
    const tabRow = projection.tabs?.speakerTab?.find((row) => row.anonymous);
    expect(tabRow).toMatchObject({ speakerName: "", teamId: "", teamName: "" });
    expect(tabRow?.speakerId).not.toBe("a1");
  });

  it("publishes only team code names in code-name modes, never the real name", () => {
    const projection = project({ teamCodeNames: "everywhere", releaseTeamTab: true });
    const json = text(projection);
    expect(json).not.toContain("Alpha Real");
    expect(json).not.toContain("Beta Real");
    expect(projection.collections.teams.find((team) => team.id === "team-a")).toMatchObject({ name: "Fox" });
    expect(projection.collections.teams.find((team) => team.id === "team-a")).not.toHaveProperty("codeName");
    // A code name equal to the team name (stored by older versions) is no code name.
    expect(projection.collections.teams.find((team) => team.id === "team-b")).toMatchObject({ name: "" });
    const slots = projection.collections.debates[0].teams as Record<string, { teamName?: string }>;
    expect(slots.AFF.teamName).toBe("Fox");
    expect(projection.tabs?.teamTab?.map((row) => row.teamName).sort()).toEqual(["", "Fox"]);
  });

  it("keeps real names with code-name tooltips, and drops code names when off", () => {
    const tooltips = project({ teamCodeNames: "all-tooltips" }).collections.teams.find((team) => team.id === "team-a");
    expect(tooltips).toMatchObject({ name: "Alpha Real", codeName: "Fox" });
    const off = project().collections.teams.find((team) => team.id === "team-a");
    expect(off).toMatchObject({ name: "Alpha Real" });
    expect(off).not.toHaveProperty("codeName");
  });

  it("uses participant code names for speakers and adjudicators", () => {
    const projection = project({ participantCodeNames: "everywhere" });
    const json = text(projection);
    expect(json).not.toContain("\"Abe\"");
    expect(json).not.toContain("Wing Three");
    expect(json).toContain("Code A2");
    expect(json).toContain("Code J3");
    const panel = projection.collections.debates[0].adjudicators as { chairName?: string };
    expect(panel.chairName).toBe("");
  });

  it("hides institutions and emoji when switched off", () => {
    const shown = project({ releaseTeamTab: true });
    expect(text(shown)).toContain("Alpha Uni");
    expect(shown.collections.teams.find((team) => team.id === "team-a")).toHaveProperty("emoji", "🦊");
    const hidden = project({ releaseTeamTab: true, showTeamInstitutions: false, showAdjudicatorInstitutions: false, showEmoji: false });
    const teamsAndAdjs = text([hidden.collections.teams, hidden.collections.adjudicators, hidden.tabs]);
    expect(teamsAndAdjs).not.toContain("Alpha Uni");
    expect(teamsAndAdjs).not.toContain("inst-1");
    expect(hidden.collections.teams.find((team) => team.id === "team-a")).not.toHaveProperty("emoji");
  });

  it("publishes break eligibility only when asked", () => {
    expect(project().collections.teams[0]).not.toHaveProperty("breakCategories");
    expect(project({ publicBreakCategories: true }).collections.teams[0]).toHaveProperty("breakCategories", ["open"]);
  });
});

describe("tabs and limits", () => {
  it("computes released tabs at publish time", () => {
    expect(project().tabs).toBeUndefined();
    const projection = project({ releaseTeamTab: true, releaseSpeakerTab: true });
    expect(projection.tabs?.roundCount).toBe(2);
    expect(projection.tabs?.teamTab?.map((row) => row.teamId)).toEqual(["team-a", "team-b"]);
    expect(projection.tabs?.speakerTab).toHaveLength(6);
    expect(projection.tabs?.repliesTab).toBeUndefined();
  });

  it("applies top-N limits and stops publishing results seen only through the tab", () => {
    const unlimited = project({ releaseTeamTab: true });
    // The silent round 2 is public through the released tab.
    expect(unlimited.collections.ballots.map((ballot) => ballot.id)).toEqual(["b1", "b2"]);

    const limited = project({ releaseTeamTab: true, releaseSpeakerTab: true, teamTabLimit: 1, speakerTabLimit: 2 });
    expect(limited.tabs?.teamTab?.map((row) => row.teamId)).toEqual(["team-a"]);
    expect(limited.tabs?.speakerTab?.every((row) => row.rank <= 2)).toBe(true);
    expect(limited.collections.ballots.map((ballot) => ballot.id)).toEqual(["b1"]);
    const silent = limited.collections.debates.find((debate) => debate.id === "d2")!.teams as Record<string, Record<string, unknown>>;
    expect(silent.AFF).not.toHaveProperty("points");
  });

  it("publishes break category team tabs on request", () => {
    expect(project({ releaseTeamTab: true }).tabs?.breakCategoryTabs).toBeUndefined();
    const projection = project({ releaseBreakCategoryTabs: true });
    expect(projection.tabs?.breakCategoryTabs?.open.map((row) => [row.teamId, row.rank])).toEqual([["team-a", 1], ["team-b", 2]]);
    expect(projection.tabs?.teamTab).toBeUndefined();
  });

  it("publishes break metrics for breaking teams only", () => {
    const data = source();
    data.breakCategories = [{ ...data.breakCategories[0], generatedBreak: { breakingTeamIds: ["team-a"], reserveTeamIds: [], generatedAt: "x" } }];
    const projection = project({ releasedBreakCategoryIds: ["open"], publicBreakMetrics: 1 }, data);
    expect(projection.derived.breakMetrics?.metricIds).toHaveLength(1);
    expect(Object.keys(projection.derived.breakMetrics?.teams ?? {})).toEqual(["team-a"]);
    expect(project({ releasedBreakCategoryIds: ["open"], publicBreakMetrics: 0 }, data).derived.breakMetrics).toBeUndefined();
  });
});

describe("scoresheets and splits", () => {
  it("publishes each adjudicator's sheet only when ballots are released, without free text", () => {
    expect(project().collections.ballots[0]).not.toHaveProperty("sheets");
    const projection = project({ releaseBallots: true });
    const sheets = projection.collections.ballots[0].sheets as Array<Record<string, unknown>>;
    expect(sheets).toHaveLength(3);
    expect(sheets[0]).toMatchObject({ adjudicatorId: "adj-1", adjudicatorName: "Chair Person", criteria: { clarity: 4 } });
    expect(sheets[0]).not.toHaveProperty("comment");
    expect(sheets[1]).toMatchObject({ adjudicatorName: "" });
    expect(text(projection)).not.toContain("Secret Submitter");
  });

  it("needs the round's speaker scores and panel to be public", () => {
    const data = source();
    data.rounds[0] = { ...data.rounds[0], teamSpeaksReleased: false };
    expect(project({ releaseBallots: true }, data).collections.ballots.find((ballot) => ballot.id === "b1")).not.toHaveProperty("sheets");
    const hiddenPanel = source();
    hiddenPanel.rounds[0] = { ...hiddenPanel.rounds[0], adjudicatorsRevealed: false };
    expect(project({ releaseBallots: true }, hiddenPanel).collections.ballots.find((ballot) => ballot.id === "b1")).not.toHaveProperty("sheets");
  });

  it("names splitting adjudicators only when the setting is on", () => {
    expect(project().collections.ballots[0]).not.toHaveProperty("splitAdjudicatorIds");
    expect(project({ showSplittingAdjudicators: true }).collections.ballots[0].splitAdjudicatorIds).toEqual(["adj-3"]);
  });
});

describe("derived public data", () => {
  it("is empty by default and never publishes feedback records", () => {
    const projection = project();
    expect(projection.derived).toEqual({});
    expect(projection.collections.feedback).toEqual([]);
    expect(text(projection)).not.toContain("secret comment");
  });

  it("publishes the adjudicator tab with the configured scores", () => {
    const test = project({ releaseAdjudicatorTab: true, adjudicatorTabShows: "test" }).derived.adjudicatorTab!;
    expect(test.rows.find((row) => row.adjudicatorId === "adj-1")).toMatchObject({ baseScore: 7 });
    expect(test.rows[0]).not.toHaveProperty("finalScore");
    const final = project({ releaseAdjudicatorTab: true }).derived.adjudicatorTab!;
    const chair = final.rows.find((row) => row.adjudicatorId === "adj-1")!;
    expect(chair).not.toHaveProperty("baseScore");
    expect(chair.feedbackCount).toBe(1);
    expect(chair.finalScore).not.toBe(7);
    const all = project({ releaseAdjudicatorTab: true, adjudicatorTabShows: "all" }).derived.adjudicatorTab!;
    expect(all.rounds.map((round) => round.id)).toEqual(["r1", "r2"]);
    expect(all.rows.find((row) => row.adjudicatorId === "adj-1")?.roundScores).toEqual({ r1: 8 });
    expect(all.rows.find((row) => row.adjudicatorId === "adj-2")).toMatchObject({ name: "", anonymous: true });
  });

  it("publishes pre-allocated sides on request", () => {
    expect(project().derived.sideAllocations).toBeUndefined();
    expect(project({ publicSideAllocations: true }).derived.sideAllocations).toEqual({
      rounds: [{ id: "r2", name: "Round 2", seq: 2 }],
      teams: { "team-a": { r2: "NEG" }, "team-b": { r2: "AFF" } },
    });
  });

  it("counts vetoes from public results only, when vetoes are enabled", () => {
    expect(project({ publicVetoStatistics: true }).derived.vetoes).toBeUndefined();
    expect(project({ publicVetoStatistics: true, enableMotionVetoes: true }).derived.vetoes).toEqual({ m2: { AFF: 1, NEG: 1 } });
  });

  it("publishes diversity as counts and averages only", () => {
    const diversity = project({ publicDiversity: true }).derived.diversity!;
    expect(diversity.speakers.total).toBe(6);
    expect(diversity.speakers.gender).toEqual([{ label: "F", count: 3 }, { label: "M", count: 3 }]);
    expect(diversity.speakers.region).toEqual([{ label: "North", count: 3 }, { label: "South", count: 3 }]);
    expect(diversity.adjudicators.gender).toContainEqual({ label: null, count: 1 });
    // Only round 1's speaker scores are public.
    expect(diversity.speakerScores.reduce((sum, row) => sum + row.count, 0)).toBe(6);
    expect(diversity.feedbackReceived).toEqual([{ label: "F", count: 1, average: 8 }]);
    expect(text(diversity)).not.toContain("Ann");
  });

  it("publishes feedback progress for public participants", () => {
    const progress = project({ publicFeedbackProgress: true }).derived.feedbackProgress!;
    expect(progress.roundIds).toEqual(["r1", "r2"]);
    const alpha = progress.rows.find((row) => row.sourceId === "team-a")!;
    expect(alpha).toMatchObject({ sourceType: "team", name: "Alpha Real", submitted: 1 });
    expect(alpha.expected).toBeGreaterThan(1);
  });

  it("reads feedback only when a public feature needs it", () => {
    expect(needsPublicFeedback({})).toBe(false);
    expect(needsPublicFeedback({ releaseAdjudicatorTab: true, adjudicatorTabShows: "test" })).toBe(false);
    expect(needsPublicFeedback({ releaseAdjudicatorTab: true })).toBe(true);
    expect(needsPublicFeedback({ publicDiversity: true })).toBe(true);
    expect(needsPublicFeedback({ publicFeedbackProgress: true })).toBe(true);
  });

  it("stores tabs and derived data in their own sections and reassembles them", () => {
    const sections = buildPublicViewSections(tournament({ releaseTeamTab: true, publicDiversity: true }), source());
    expect(sections.tabs).toBeTruthy();
    expect(sections.derived).toHaveProperty("diversity");
    const assembled = assembleProjection(sections);
    expect(assembled.tabs?.teamTab).toHaveLength(2);
    expect(assembled.derived.diversity).toBeTruthy();
    // A view published before these sections existed reads as having none.
    const { tabs: _tabs, derived: _derived, ...older } = sections;
    expect(assembleProjection(older).derived).toEqual({});
  });
});

describe("admin diversity statistics", () => {
  it("cover every round, released or not", () => {
    const data = source();
    const cast = <T,>(records: unknown[]) => records as T[];
    const teams = cast<Team>(data.teams);
    const adjudicators = cast<Adjudicator>(data.adjudicators);
    const statistics = buildAdminDiversity(
      tournament() as unknown as Tournament,
      {
        rounds: cast<Round>(data.rounds),
        teams,
        adjudicators,
        debates: cast<Debate>(data.debates),
        ballots: cast<BallotSubmission>(data.ballots),
        institutions: cast<Institution>(data.institutions),
        feedback: cast<FeedbackSubmission>(data.feedback ?? []),
      },
      createPublicNamer(teams, adjudicators, { teamCodeNames: "off", participantCodeNames: "off" })
    );
    // Both rounds' speaker scores count, including the silent round 2.
    expect(statistics.speakerScores.reduce((sum, row) => sum + row.count, 0)).toBe(12);
  });
});

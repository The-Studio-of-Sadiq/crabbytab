import { describe, expect, it } from "vitest";
import type { Adjudicator, BreakCategory, Debate, FeedbackSubmission, Institution, Round, Team } from "@/types";
import {
  codeNameRows,
  duplicateFeedbackGroups,
  institutionAdjudicatorRequirements,
  institutionGenderTable,
  isShortOfAdjudicators,
  requirementRounds,
  teamsWithEligibilityChanges,
  teamEligibleCategoryIds,
  generalCategoryEligibilityChanges,
} from "./reports";

const team = (id: string, overrides: Partial<Team> = {}): Team => ({
  id,
  tournamentId: "t",
  name: id,
  speakers: [],
  breakCategories: [],
  speakerCategories: [],
  ...overrides,
});

const adjudicator = (id: string, overrides: Partial<Adjudicator> = {}): Adjudicator => ({
  id,
  tournamentId: "t",
  name: id,
  baseScore: 5,
  trainee: false,
  independent: false,
  conflicts: [],
  ...overrides,
});

const round = (id: string, seq: number, overrides: Partial<Round> = {}): Round => ({
  id,
  tournamentId: "t",
  seq,
  name: `Round ${seq}`,
  abbreviation: `R${seq}`,
  stage: "preliminary",
  drawType: "power_paired",
  drawStatus: "released",
  feedbackWeight: 0,
  silent: false,
  motionsReleased: false,
  resultsReleased: false,
  completed: false,
  createdAt: "",
  ...overrides,
});

const debate = (roundId: string, teamIds: string[], adjudicatorIds: string[]): Debate =>
  ({
    id: `${roundId}-${teamIds.join("-")}`,
    tournamentId: "t",
    roundId,
    roundSeq: 1,
    bracket: 0,
    roomRank: 1,
    importance: 0,
    resultStatus: "none",
    sidesConfirmed: true,
    flags: [],
    teams: Object.fromEntries(teamIds.map((teamId, index) => [index === 0 ? "AFF" : "NEG", { teamId, teamName: teamId, side: index === 0 ? "AFF" : "NEG" }])),
    adjudicators: { chairId: adjudicatorIds[0], panellistIds: adjudicatorIds.slice(1), panellistNames: [], traineeIds: [], traineeNames: [] },
  }) as unknown as Debate;

const institutions: Institution[] = [
  { id: "i1", tournamentId: "t", name: "Uni One", code: "ONE" },
  { id: "i2", tournamentId: "t", name: "Uni Two", code: "TWO" },
  { id: "i3", tournamentId: "t", name: "Empty", code: "EMP" },
];

describe("break eligibility grid", () => {
  const categories = [{ id: "open", seq: 1 }, { id: "esl", seq: 2 }];

  it("returns only teams whose eligibility changed, in category order", () => {
    const teams = [team("a", { breakCategories: ["open"] }), team("b", { breakCategories: ["open"] })];
    const draft = new Map([
      ["a", new Set(["esl", "open"])],
      ["b", new Set(["open"])],
    ]);
    expect(teamsWithEligibilityChanges(teams, draft, categories)).toEqual([{ ...teams[0], breakCategories: ["open", "esl"] }]);
  });

  it("keeps ids of categories that are not in the grid", () => {
    const teams = [team("a", { breakCategories: ["deleted", "open"] })];
    const changed = teamsWithEligibilityChanges(teams, new Map([["a", new Set<string>()]]), categories);
    expect(changed[0].breakCategories).toEqual(["deleted"]);
  });
});

describe("code-name decoder", () => {
  it("lists code names first and treats the team name as no code name", () => {
    const rows = codeNameRows([
      team("x", { name: "Zeta", codeName: "Zeta" }),
      team("y", { name: "Beta", codeName: "Owl", institutionName: "Uni", speakers: [{ id: "s", name: "Sam" }] }),
      team("z", { name: "Alpha", codeName: "Fox" }),
    ]);
    expect(rows.map((row) => [row.codeName, row.teamName])).toEqual([
      ["Fox", "Alpha"],
      ["Owl", "Beta"],
      [undefined, "Zeta"],
    ]);
    expect(rows[1]).toMatchObject({ institutionName: "Uni", speakers: ["Sam"] });
  });
});

describe("institution adjudicator requirement (N-1)", () => {
  it("applies Tabbycat's rule", () => {
    expect(isShortOfAdjudicators(1, 3)).toBe(true);
    expect(isShortOfAdjudicators(2, 3)).toBe(false);
    expect(isShortOfAdjudicators(0, 1)).toBe(false);
  });

  it("counts registered and per-round teams and adjudicators", () => {
    const teams = [team("a", { institutionId: "i1" }), team("b", { institutionId: "i1" }), team("c", { institutionId: "i1" }), team("d", { institutionId: "i2" })];
    const adjudicators = [
      adjudicator("j1", { institutionId: "i1" }),
      adjudicator("j2", { institutionId: "i2" }),
      adjudicator("j3", { institutionId: "i1", independent: true }),
    ];
    const rounds = [round("r1", 1), round("r2", 2, { drawStatus: "none" }), round("e1", 3, { stage: "elimination" })];
    const debates = [debate("r1", ["a", "d"], ["j1", "j3"]), debate("r1", ["b", "c"], ["j2"]), debate("e1", ["a", "b"], ["j1"])];
    const rows = institutionAdjudicatorRequirements({ institutions, teams, adjudicators, rounds, debates });
    expect(requirementRounds(rounds).map((item) => item.id)).toEqual(["r1"]);
    expect(rows.map((row) => row.code)).toEqual(["ONE", "TWO"]);
    // Registered: independents excluded (Tabbycat); 3 teams, 1 adjudicator -> short.
    expect(rows[0].registered).toEqual({ teams: 3, adjudicators: 1, short: true });
    // Round 1: three teams debating; j1 and the independent j3 (still from i1) allocated.
    expect(rows[0].byRound.r1).toEqual({ teams: 3, adjudicators: 2, short: false });
    expect(rows[1].byRound.r1).toEqual({ teams: 1, adjudicators: 1, short: false });
  });
});

describe("gender by institution", () => {
  it("groups free-text genders and skips independents", () => {
    const table = institutionGenderTable({
      institutions,
      teams: [team("a", { institutionId: "i1", speakers: [{ id: "1", name: "A", gender: "F" }, { id: "2", name: "B", gender: " f " }, { id: "3", name: "C" }] })],
      adjudicators: [
        adjudicator("j1", { institutionId: "i2", gender: "M" }),
        adjudicator("j2", { institutionId: "i2", gender: "M", independent: true }),
      ],
    });
    expect(table.genders).toEqual(["F", "M", ""]);
    expect(table.rows).toEqual([
      { institutionId: "i1", name: "Uni One", speakers: { F: 2, "": 1 }, adjudicators: {} },
      { institutionId: "i2", name: "Uni Two", speakers: {}, adjudicators: { M: 1 } },
    ]);
  });
});

describe("duplicate feedback", () => {
  const item = (id: string, overrides: Partial<FeedbackSubmission> = {}): FeedbackSubmission => ({
    id,
    tournamentId: "t",
    roundId: "r1",
    debateId: "d1",
    targetType: "adjudicator",
    targetAdjudicatorId: "j1",
    targetAdjudicatorName: "Judge",
    sourceType: "team",
    sourceId: "a",
    sourceName: "Alpha",
    score: 3,
    confirmed: true,
    timestamp: `2026-01-01T00:00:0${id.length}Z`,
    ...overrides,
  });

  it("groups repeated submissions from one source on one target in one debate", () => {
    const groups = duplicateFeedbackGroups([
      item("1"),
      item("22"),
      item("x", { sourceId: "b", sourceName: "Beta" }),
      item("y", { debateId: "d2" }),
      item("t", { targetType: "team", targetAdjudicatorId: undefined, targetTeamId: "a" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ sourceName: "Alpha", targetName: "Judge" });
    expect(groups[0].submissions.map((submission) => submission.id)).toEqual(["1", "22"]);
  });

  it("honours the minimum number of versions", () => {
    expect(duplicateFeedbackGroups([item("1"), item("22")], 3)).toEqual([]);
    expect(duplicateFeedbackGroups([item("1")], 1)).toEqual([]);
  });
});

describe("general break categories in the eligibility grid", () => {
  type GridCategory = Pick<BreakCategory, "id" | "isGeneral" | "teamOverrides">;
  const open: GridCategory = { id: "open", isGeneral: true, teamOverrides: { b: "ineligible", c: "withdrawn" } };
  const esl: GridCategory = { id: "esl", isGeneral: false };

  it("reads a general category from its Ineligible overrides, not the team's own list", () => {
    expect([...teamEligibleCategoryIds(team("a"), [open, esl])]).toEqual(["open"]);
    expect([...teamEligibleCategoryIds(team("b", { breakCategories: ["open", "esl"] }), [open, esl])]).toEqual(["esl"]);
  });

  it("writes unticking as an Ineligible override and ticking as clearing it", () => {
    const draft = new Map<string, Set<string>>([
      ["a", new Set()],
      ["b", new Set(["open"])],
    ]);
    const [changed] = generalCategoryEligibilityChanges([open, esl], draft);
    expect(changed.id).toBe("open");
    expect(changed.teamOverrides).toEqual({ a: "ineligible", c: "withdrawn" });
  });

  it("returns nothing when the draft leaves general categories as they are", () => {
    expect(generalCategoryEligibilityChanges([open, esl], new Map([["a", new Set(["open"])]]))).toEqual([]);
  });
});

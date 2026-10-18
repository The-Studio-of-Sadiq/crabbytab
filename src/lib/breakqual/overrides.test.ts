import { describe, expect, it } from "vitest";

import type { BreakCategory, Team, TeamStandingRow } from "@/types";
import {
  applyCategoryBreakStatus,
  calculateBreaks,
  isGeneratedBreakStale,
  snapshotBreak,
} from "./calculator";

function team(id: string, overrides: Partial<Team> = {}): Team {
  return {
    id,
    tournamentId: "t1",
    name: id.toUpperCase(),
    speakers: [],
    breakCategories: [],
    speakerCategories: [],
    ...overrides,
  };
}

function standing(teamId: string, rank: number, wins: number): TeamStandingRow {
  return {
    rank,
    teamId,
    teamName: teamId,
    points: wins,
    wins,
    totalSpeakerScore: 300 - rank,
    averageSpeakerScore: 150,
    breakCategories: [],
    roundResults: [],
    metrics: { wins, speaks_sum: 300 - rank } as TeamStandingRow["metrics"],
  };
}

function category(overrides: Partial<BreakCategory> = {}): BreakCategory {
  return {
    id: "open",
    tournamentId: "t1",
    name: "Open",
    slug: "open",
    seq: 1,
    breakSize: 2,
    reserveSize: 1,
    isGeneral: true,
    priority: 10,
    ...overrides,
  };
}

const ids = (entries: { team: Team }[]) => entries.map((entry) => entry.team.id);

describe("break overrides", () => {
  const teams = ["a", "b", "c", "d", "e"].map((id) => team(id));
  const standings = teams.map((item, index) => standing(item.id, index + 1, 5 - index));

  it("excludes a team with a remark and lets the next team take its place", () => {
    const [result] = calculateBreaks([category({ teamOverrides: { a: "withdrawn" } })], teams, standings);
    expect(ids(result.breakingTeams)).toEqual(["b", "c"]);
    expect(result.breakingTeams.map((entry) => entry.seed)).toEqual([1, 2]);
    expect(ids(result.reserveTeams)).toEqual(["d"]);
    expect(result.excludedTeams.map((entry) => [entry.team.id, entry.reason, entry.manual])).toEqual([
      ["a", "withdrawn", true],
    ]);
  });

  it("forces a manually included team into the break, seeded by rank", () => {
    const [result] = calculateBreaks([category({ teamOverrides: { e: "include" } })], teams, standings);
    expect(ids(result.breakingTeams)).toEqual(["a", "e"]);
    expect(result.breakingTeams[1]).toMatchObject({ seed: 2, manuallyIncluded: true });
    // The team pushed out of the break becomes the first reserve.
    expect(ids(result.reserveTeams)).toEqual(["b"]);
  });

  it("includes a team that is not eligible for a specific category", () => {
    const esl = category({ id: "esl", isGeneral: false, breakSize: 1, reserveSize: 0, teamOverrides: { c: "include" } });
    const [result] = calculateBreaks([esl], teams, standings);
    expect(ids(result.breakingTeams)).toEqual(["c"]);
  });

  it("never lets an include override break a team in two categories", () => {
    const open = category({ breakSize: 1, reserveSize: 0 });
    const esl = category({ id: "esl", priority: 1, isGeneral: false, breakSize: 1, reserveSize: 0, teamOverrides: { a: "include" } });
    const results = calculateBreaks([open, esl], teams, standings);
    expect(ids(results[0].breakingTeams)).toEqual(["a"]);
    expect(ids(results[1].breakingTeams)).toEqual([]);
    expect(results[1].excludedTeams).toEqual([]);
  });

  it("reports teams above the cutoff that broke in a higher-priority category", () => {
    const eslTeams = teams.map((item) => ({ ...item, breakCategories: ["esl"] }));
    const open = category({ breakSize: 1, reserveSize: 0 });
    const esl = category({ id: "esl", priority: 1, isGeneral: false, breakSize: 2, reserveSize: 0 });
    const [, eslResult] = calculateBreaks([open, esl], eslTeams, standings);
    expect(ids(eslResult.breakingTeams)).toEqual(["b", "c"]);
    expect(eslResult.excludedTeams.map((entry) => [entry.team.id, entry.reason, entry.manual])).toEqual([
      ["a", "different_break", false],
    ]);
  });

  it("reports institution-capped teams that ranked inside the break", () => {
    const capped = teams.map((item, index) => ({ ...item, institutionId: index < 3 ? "x" : "y" }));
    const [result] = calculateBreaks(
      [category({ breakSize: 3, reserveSize: 0, maxPerInstitution: 2 })],
      capped,
      standings
    );
    expect(ids(result.breakingTeams)).toEqual(["a", "b", "d"]);
    expect(result.excludedTeams.map((entry) => [entry.team.id, entry.reason])).toEqual([["c", "capped"]]);
  });
});

describe("AIDA 2016 reserves", () => {
  it("keeps reserves after the breaking set instead of dropping them", () => {
    const aidaTeams = Array.from({ length: 6 }, (_, index) =>
      team(`t${index + 1}`, { institutionId: `inst-${index + 1}` })
    );
    const aidaStandings = aidaTeams.map((item, index) => standing(item.id, index + 1, 6 - index));
    const [result] = calculateBreaks(
      [category({ breakSize: 2, reserveSize: 2, qualificationRule: "aida_2016_australs" })],
      aidaTeams,
      aidaStandings,
      "uadc"
    );
    expect(ids(result.breakingTeams)).toEqual(["t1", "t2"]);
    expect(ids(result.reserveTeams)).toEqual(["t3", "t4"]);
  });

  it("does not offer a reserve place to a team the institution cap removes", () => {
    const aidaTeams = [
      team("a1", { institutionId: "a" }),
      team("b1", { institutionId: "b" }),
      team("a2", { institutionId: "a" }),
      team("c1", { institutionId: "c" }),
    ];
    const aidaStandings = aidaTeams.map((item, index) => standing(item.id, index + 1, 4 - index));
    const [result] = calculateBreaks(
      [category({ breakSize: 2, reserveSize: 2, qualificationRule: "aida_2016_australs" })],
      aidaTeams,
      aidaStandings,
      "uadc"
    );
    expect(ids(result.breakingTeams)).toEqual(["a1", "b1"]);
    expect(ids(result.reserveTeams)).toEqual(["c1"]);
  });
});

describe("applyCategoryBreakStatus", () => {
  const open = category({ breakSize: 1, reserveSize: 0 });
  const esl = category({ id: "esl", priority: 1, isGeneral: false, breakSize: 1, reserveSize: 0 });
  const teams = [team("a"), team("b", { breakCategories: ["esl"] }), team("c")];
  const standings = teams.map((item, index) => standing(item.id, index + 1, 3 - index));

  it("applies only the generated category and leaves others untouched", () => {
    const results = calculateBreaks([open, esl], teams, standings);
    const afterOpen = applyCategoryBreakStatus(teams, results[0]);
    expect(afterOpen.map((item) => [item.id, item.breakStatus, item.breakCategoryIds])).toEqual([
      ["a", "breaking", ["open"]],
      ["b", "eliminated", []],
      ["c", "eliminated", []],
    ]);
    const afterEsl = applyCategoryBreakStatus(afterOpen, results[1]);
    expect(afterEsl.map((item) => [item.id, item.breakStatus, item.breakCategoryIds])).toEqual([
      ["a", "breaking", ["open"]],
      ["b", "breaking", ["esl"]],
      ["c", "eliminated", []],
    ]);
  });

  it("keeps elimination history of teams the category does not affect", () => {
    const history = [
      team("a", { breakStatus: "eliminated", breakCategoryIds: ["esl"], eliminatedInRoundId: "qf" }),
      team("b", { breakStatus: "breaking", breakCategoryIds: ["open"] }),
    ];
    const regenerated = applyCategoryBreakStatus(history, {
      category: open,
      breakingTeams: [],
      reserveTeams: [],
      excludedTeams: [],
    });
    expect(regenerated[0]).toBe(history[0]);
    expect(regenerated[1]).toMatchObject({ breakStatus: "eliminated", breakCategoryIds: [] });
  });
});

describe("generated break snapshots", () => {
  it("detects when the current calculation differs from the generated break", () => {
    const teams = [team("a"), team("b")];
    const [result] = calculateBreaks([category({ breakSize: 1, reserveSize: 0 })], teams, [
      standing("a", 1, 2),
      standing("b", 2, 1),
    ]);
    const generated = snapshotBreak(result, "2026-01-01T00:00:00.000Z");
    expect(generated.breakingTeamIds).toEqual(["a"]);
    expect(isGeneratedBreakStale({ ...result, category: { ...result.category, generatedBreak: generated } })).toBe(false);
    expect(
      isGeneratedBreakStale({
        ...result,
        category: { ...result.category, generatedBreak: { ...generated, breakingTeamIds: ["b"] } },
      })
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { BreakCategory, BreakQualificationRule, Team, TeamStandingRow } from "@/types";
import { calculateBreaks, institutionRanks } from "./calculator";

/**
 * Regression cases checked against Tabbycat v2.12.1 breakqual/base.py, breakqual/aida.py and
 * standings/ranking.py (RankFromInstitutionAnnotator).
 */

function team(id: string, institutionId: string, breakCategories: string[] = []): Team {
  return { id, tournamentId: "t", name: id, institutionId, speakers: [], breakCategories, speakerCategories: [] };
}

/** `rank` is the shared standings rank; `wins` doubles as points. */
function standing(teamId: string, rank: number, wins: number): TeamStandingRow {
  return {
    rank,
    teamId,
    teamName: teamId,
    points: wins,
    wins,
    totalSpeakerScore: 300 - rank,
    averageSpeakerScore: 0,
    breakCategories: [],
    roundResults: [],
    metrics: { points: wins, wins, speaks_sum: 300 - rank } as TeamStandingRow["metrics"],
  };
}

function category(id: string, overrides: Partial<BreakCategory> = {}): BreakCategory {
  return {
    id,
    tournamentId: "t",
    name: id,
    slug: id,
    seq: 1,
    breakSize: 2,
    reserveSize: 0,
    isGeneral: false,
    priority: 1,
    ...overrides,
  };
}

const ids = (entries: { team: Team }[]) => entries.map((entry) => entry.team.id);

describe("break categories of equal priority (Tabbycat priority__gt)", () => {
  it("lets a team break in two categories of the same priority", () => {
    const teams = ["a", "b", "c", "d"].map((id) => team(id, id, ["esl", "efl"]));
    const standings = teams.map((item, index) => standing(item.id, index + 1, 4 - index));
    const [esl, efl] = calculateBreaks(
      [category("esl", { priority: 2 }), category("efl", { priority: 2, seq: 2 })],
      teams,
      standings,
      "australs"
    );
    expect(ids(esl.breakingTeams)).toEqual(["a", "b"]);
    expect(ids(efl.breakingTeams)).toEqual(["a", "b"]);
  });

  it("still excludes teams that broke in a strictly higher-priority category", () => {
    const teams = ["a", "b", "c", "d"].map((id) => team(id, id, ["esl", "efl"]));
    const standings = teams.map((item, index) => standing(item.id, index + 1, 4 - index));
    const [esl, efl] = calculateBreaks(
      [category("esl", { priority: 2 }), category("efl", { priority: 1, seq: 2 })],
      teams,
      standings,
      "australs"
    );
    expect(ids(esl.breakingTeams)).toEqual(["a", "b"]);
    expect(ids(efl.breakingTeams)).toEqual(["c", "d"]);
    expect(efl.excludedTeams.map((entry) => [entry.team.id, entry.reason])).toEqual([
      ["a", "different_break"],
      ["b", "different_break"],
    ]);
  });
});

describe("institution rank (Tabbycat RankFromInstitutionAnnotator)", () => {
  it("gives tied teams of one institution the same rank", () => {
    const teams = ["a", "b", "c", "d"].map((id) => team(id, "uni"));
    const map = new Map(teams.map((item) => [item.id, item]));
    const ranks = institutionRanks(
      [standing("a", 1, 4), standing("b", 2, 3), standing("c", 3, 2), standing("d", 3, 2)],
      map
    );
    expect([...ranks.entries()]).toEqual([["a", 1], ["b", 2], ["c", 3], ["d", 3]]);
  });

  it("AIDA 1996: tied 3rd/4th teams of one institution are both under the cap", () => {
    const teams = ["a", "b", "c", "d"].map((id) => team(id, "uni")).concat([team("e", "other")]);
    const standings = [standing("a", 1, 5), standing("b", 2, 4), standing("c", 3, 3), standing("d", 3, 3), standing("e", 5, 1)];
    const [open] = calculateBreaks(
      [category("open", { isGeneral: true, breakSize: 4, qualificationRule: "aida_1996" as BreakQualificationRule })],
      teams,
      standings,
      "australs"
    );
    expect(ids(open.breakingTeams)).toEqual(["a", "b", "c", "d"]);
    expect(open.excludedTeams).toEqual([]);
  });

  it("AIDA 1996 (general category): an ineligible team still counts towards its institution's rank", () => {
    const teams = ["a", "b", "c", "d"].map((id) => team(id, "uni")).concat([team("e", "other")]);
    const standings = teams.map((item, index) => standing(item.id, index + 1, 5 - index));
    const [open] = calculateBreaks(
      [category("open", { isGeneral: true, breakSize: 3, qualificationRule: "aida_1996", teamOverrides: { a: "ineligible" } })],
      teams,
      standings,
      "australs"
    );
    // a (ineligible) holds institution rank 1, so d is the institution's 4th team and is capped.
    expect(ids(open.breakingTeams)).toEqual(["b", "c", "e"]);
  });
});

describe("AIDA 2016 reserves", () => {
  it("never takes reserves from teams with fewer wins than the last breaking place", () => {
    const teams = ["a", "b", "c"].map((id) => team(id, id));
    const standings = [standing("a", 1, 3), standing("b", 2, 2), standing("c", 3, 1)];
    const [open] = calculateBreaks(
      [category("open", { isGeneral: true, breakSize: 2, reserveSize: 1, qualificationRule: "aida_2016_australs" })],
      teams,
      standings,
      "australs"
    );
    expect(ids(open.breakingTeams)).toEqual(["a", "b"]);
    expect(open.reserveTeams).toEqual([]);
  });
});

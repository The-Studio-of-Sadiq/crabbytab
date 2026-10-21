import { describe, expect, it } from "vitest";
import type { BreakCategory, BreakTeamOverride, Team, TeamMetricId, TeamStandingRow } from "@/types";
import { calculateBreaks } from "./calculator";
import { checkBreakGeneration } from "@/features/tournament/application/stateGuards";
import { rankTeamSubset } from "@/lib/standings/subset";

/*
 * Tabbycat's BaseBreakGenerator: a general category ranks every team in the overall standings and
 * excludes the teams that are not eligible; a non-general category generates standings for its own
 * teams only, so ranks restart and who-beat-whom compares the teams tied inside the category.
 * Fewer eligible teams than the break size is an error.
 */

function team(id: string, breakCategories: string[] = []): Team {
  return { id, tournamentId: "t", name: id, institutionId: id, speakers: [], breakCategories, speakerCategories: [] };
}

function row(
  teamId: string,
  rank: number,
  points: number,
  speaks: number,
  results: { opponent: string; points: number }[] = []
): TeamStandingRow {
  return {
    rank,
    teamId,
    teamName: teamId,
    points,
    totalSpeakerScore: speaks,
    averageSpeakerScore: 0,
    breakCategories: [],
    roundResults: results.map((result, index) => ({
      roundSeq: index + 1,
      side: "AFF",
      points: result.points,
      speakerScore: 0,
      opponentTeamIds: [result.opponent],
    })),
    metrics: { points, speaks_sum: speaks } as TeamStandingRow["metrics"],
  };
}

function category(
  id: string,
  breakSize: number,
  isGeneral: boolean,
  priority: number,
  teamOverrides: Record<string, BreakTeamOverride> = {}
): BreakCategory {
  return { id, tournamentId: "t", name: id.toUpperCase(), slug: id, seq: priority, breakSize, reserveSize: 0, isGeneral, priority, teamOverrides };
}

const ids = (entries: { team: Team }[]) => entries.map((entry) => entry.team.id);

describe("non-general categories are ranked within the category", () => {
  // Points, then who-beat-whom, then speaks. a, b and c are all on 2 points: overall, three teams
  // are tied so who-beat-whom is n/a and speaks decide (b, c, a). Within ESL only a and c are tied,
  // and a beat c, so a ranks first in ESL.
  const precedence: TeamMetricId[] = ["points", "wbw", "speaks_sum"];
  const teams = [team("a", ["esl"]), team("b"), team("c", ["esl"]), team("d", ["esl"])];
  const overall = [
    row("b", 1, 2, 300),
    row("c", 2, 2, 290, [{ opponent: "a", points: 0 }]),
    row("a", 3, 2, 280, [{ opponent: "c", points: 1 }]),
    row("d", 4, 1, 310),
  ];

  it("re-evaluates who-beat-whom inside the category", () => {
    const ranked = rankTeamSubset(overall.filter((standing) => standing.teamId !== "b"), precedence);
    expect(ranked.map((standing) => [standing.teamId, standing.rank, standing.whoBeatWhom])).toEqual([
      ["a", 1, [1]],
      ["c", 2, [0]],
      ["d", 3, [null]],
    ]);
    // The overall rows are left untouched.
    expect(overall[2].rank).toBe(3);
  });

  it("breaks the team that ranks first within the category, with its category rank", () => {
    const [result] = calculateBreaks([category("esl", 1, false, 5)], teams, overall, "australs", precedence);
    expect(ids(result.breakingTeams)).toEqual(["a"]);
    expect(result.breakingTeams[0]).toMatchObject({ rank: 1, breakRank: 1, seed: 1 });
  });

  it("keeps overall ranks for a general category", () => {
    const [result] = calculateBreaks([category("open", 2, true, 10)], teams, overall, "australs", precedence);
    expect(result.breakingTeams.map((entry) => [entry.team.id, entry.rank])).toEqual([["b", 1], ["c", 2]]);
  });

  it("ranks teams within the category after a higher-priority break takes some", () => {
    // Open (break 1) takes b. ESL then ranks a, c, d among themselves: a first again.
    const results = calculateBreaks(
      [category("open", 1, true, 10), category("esl", 2, false, 5)],
      teams,
      overall,
      "australs",
      precedence
    );
    const esl = results.find((result) => result.category.id === "esl")!;
    expect(esl.breakingTeams.map((entry) => [entry.team.id, entry.rank])).toEqual([["a", 1], ["c", 2]]);
  });
});

describe("eligibility", () => {
  const teams = [team("a", ["esl"]), team("b"), team("c", ["esl"]), team("d", ["esl"])];
  const overall = [row("a", 1, 3, 300), row("b", 2, 2, 300), row("c", 3, 1, 300), row("d", 4, 0, 300)];

  it("a general category excludes a team the director marked ineligible, keeping overall ranks", () => {
    const [result] = calculateBreaks([category("open", 2, true, 10, { a: "ineligible" })], teams, overall);
    expect(result.breakingTeams.map((entry) => [entry.team.id, entry.rank])).toEqual([["b", 2], ["c", 3]]);
    expect(result.excludedTeams.map((entry) => [entry.team.id, entry.reason])).toEqual([["a", "ineligible"]]);
    expect(result.eligibleCount).toBe(3);
    expect(result.tooFewEligible).toBeUndefined();
  });

  it("reports too few eligible teams and refuses to generate the break", () => {
    // ESL has three eligible teams; a breaks in the higher-priority open break and d is withdrawn,
    // leaving one team for a break of two.
    const results = calculateBreaks(
      [category("open", 1, true, 10), category("esl", 2, false, 5, { d: "withdrawn" })],
      teams,
      overall
    );
    const esl = results.find((result) => result.category.id === "esl")!;
    expect(esl.eligibleCount).toBe(1);
    expect(esl.tooFewEligible).toEqual({ eligible: 1, breakSize: 2 });
    const violations = checkBreakGeneration(esl.category, { rounds: [], debates: [], ballots: [] } as never, [], esl);
    expect(violations.map((violation) => [violation.rule, violation.overridable])).toEqual([["break_too_few_eligible", false]]);
    expect(violations[0].message).toContain("1 eligible for a break of 2");
  });

  it("counts manually included teams as eligible", () => {
    const [result] = calculateBreaks([category("esl", 4, false, 5, { b: "include" })], teams, overall);
    expect(result.eligibleCount).toBe(4);
    expect(result.tooFewEligible).toBeUndefined();
  });
});

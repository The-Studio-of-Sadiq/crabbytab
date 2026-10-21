import { describe, expect, it } from "vitest";
import type { Team, TeamMetricId, TeamStandingRow } from "@/types";
import { breakCategoryStandings } from "./categoryStandings";

const row = (teamId: string, rank: number, points: number, speaks: number): TeamStandingRow => ({
  rank,
  teamId,
  teamName: teamId,
  points,
  totalSpeakerScore: speaks,
  averageSpeakerScore: 0,
  breakCategories: [],
  roundResults: [],
  metrics: { points, speaks_sum: speaks } as TeamStandingRow["metrics"],
}) as TeamStandingRow;

const team = (id: string, breakCategories: string[] = []) => ({ id, breakCategories }) as Pick<Team, "id" | "breakCategories">;

describe("standings by break category", () => {
  const precedence: TeamMetricId[] = ["points", "speaks_sum"];
  const overall = [row("a", 1, 9, 600), row("b", 2, 8, 590), row("c", 3, 7, 580), row("d", 4, 7, 570)];
  const teamsById = new Map([team("a"), team("b", ["esl"]), team("c"), team("d", ["esl"])].map((item) => [item.id, item]));

  // Regression: the admin page filtered the overall rows and kept overall ranks (2, 4).
  it("ranks a category's teams among themselves", () => {
    const esl = breakCategoryStandings(overall, { id: "esl", isGeneral: false }, teamsById, precedence);
    expect(esl.map((item) => [item.teamId, item.rank])).toEqual([["b", 1], ["d", 2]]);
    // The overall rows are untouched.
    expect(overall[1].rank).toBe(2);
  });

  it("keeps every eligible team in a general category", () => {
    const open = breakCategoryStandings(overall, { id: "open", isGeneral: true, teamOverrides: { c: "ineligible" } }, teamsById, precedence);
    expect(open.map((item) => [item.teamId, item.rank])).toEqual([["a", 1], ["b", 2], ["d", 3]]);
  });
});

import { describe, expect, it } from "vitest";
import type { BreakCategory, BreakQualificationRule, BreakTeamOverride, Team, TeamStandingRow } from "@/types";
import { calculateBreaks } from "./calculator";
import { checkBreakGeneration } from "@/features/tournament/application/stateGuards";

/* Golden cases: teams tied on every precedence metric (equal tab rank) across the break or reserve cutoff. */

function team(id: string, institutionId = id): Team {
  return { id, tournamentId: "t", name: `Team ${id}`, institutionId, speakers: [], breakCategories: [], speakerCategories: [] };
}

/** Standings from [teamId, rank] pairs, best first; equal ranks are ties on every precedence metric. */
function standings(ranks: [string, number][]): TeamStandingRow[] {
  return ranks.map(([teamId, rank]) => ({
    rank,
    teamId,
    teamName: `Team ${teamId}`,
    points: 10 - rank,
    wins: 10 - rank,
    totalSpeakerScore: 300 - rank,
    averageSpeakerScore: 0,
    breakCategories: [],
    roundResults: [],
    metrics: { wins: 10 - rank, speaks_sum: 300 - rank } as TeamStandingRow["metrics"],
  }));
}

function category(
  breakSize: number,
  reserveSize = 0,
  teamOverrides: Record<string, BreakTeamOverride> = {},
  qualificationRule: BreakQualificationRule = "standard"
): BreakCategory {
  return {
    id: "open",
    tournamentId: "t",
    name: "Open",
    slug: "open",
    seq: 1,
    breakSize,
    reserveSize,
    isGeneral: true,
    priority: 10,
    teamOverrides,
    qualificationRule,
  };
}

const ids = (entries: { team: Team }[]) => entries.map((entry) => entry.team.id);

describe("ties at the break cutoff", () => {
  const teams = ["a", "b", "c", "d", "e", "f"].map((id) => team(id));
  // b, c and d are tied 2nd; a break of 3 has room for two of them.
  const table = standings([["a", 1], ["b", 2], ["c", 2], ["d", 2], ["e", 5], ["f", 6]]);

  it("holds the whole tied group out of the break and reports it instead of slicing by name", () => {
    const [result] = calculateBreaks([category(3)], teams, table);
    expect(ids(result.breakingTeams)).toEqual(["a"]);
    expect(result.cutoffTies).toHaveLength(1);
    expect(result.cutoffTies[0]).toMatchObject({ cutoff: "break", places: 2 });
    expect(ids(result.cutoffTies[0].teams)).toEqual(["b", "c", "d"]);
    // Tied teams are not reported as excluded.
    expect(result.excludedTeams).toEqual([]);
  });

  it("is resolved by manually including the teams that go through; the loser stays a reserve candidate", () => {
    const [result] = calculateBreaks([category(3, 1, { b: "include", d: "include" })], teams, table);
    expect(result.cutoffTies).toEqual([]);
    expect(ids(result.breakingTeams)).toEqual(["a", "b", "d"]);
    expect(ids(result.reserveTeams)).toEqual(["c"]);
  });

  it("is resolved by marking the loser 'lost coin toss'", () => {
    const [result] = calculateBreaks([category(3, 1, { c: "lost_coin_toss" })], teams, table);
    expect(result.cutoffTies).toEqual([]);
    expect(ids(result.breakingTeams)).toEqual(["a", "b", "d"]);
    expect(ids(result.reserveTeams)).toEqual(["e"]);
    expect(result.excludedTeams.map((entry) => [entry.team.id, entry.reason])).toEqual([["c", "lost_coin_toss"]]);
  });

  it("is no tie when the tied group fits inside the break, or starts just after it", () => {
    expect(calculateBreaks([category(4)], teams, table)[0].cutoffTies).toEqual([]);
    expect(ids(calculateBreaks([category(4)], teams, table)[0].breakingTeams)).toEqual(["a", "b", "c", "d"]);
    expect(calculateBreaks([category(1)], teams, table)[0].cutoffTies).toEqual([]);
  });

  it("fills reserve places after the tied group, counting the group's extra teams", () => {
    // Break 3 + 2 reserves = 5 places: the tie takes places 2-4 (with a team over), leaving e as reserve 1.
    const [result] = calculateBreaks([category(3, 2)], teams, table);
    expect(ids(result.breakingTeams)).toEqual(["a"]);
    expect(ids(result.reserveTeams)).toEqual(["e"]);
  });

  it("refuses to generate the break while the tie is unresolved", () => {
    const [result] = calculateBreaks([category(3)], teams, table);
    const violations = checkBreakGeneration(result.category, { rounds: [], debates: [], ballots: [] } as never, [], result);
    expect(violations.map((violation) => [violation.rule, violation.overridable])).toEqual([["break_cutoff_tie", false]]);
    expect(violations[0].message).toContain("Team b, Team c, Team d are tied (rank 2) for 2 breaking places");
  });
});

describe("ties at the reserve cutoff", () => {
  it("holds the tied group out of the reserves and reports it", () => {
    const teams = ["a", "b", "c", "d", "e"].map((id) => team(id));
    const table = standings([["a", 1], ["b", 2], ["c", 3], ["d", 3], ["e", 5]]);
    const [result] = calculateBreaks([category(2, 1)], teams, table);
    expect(ids(result.breakingTeams)).toEqual(["a", "b"]);
    expect(ids(result.reserveTeams)).toEqual([]);
    expect(result.cutoffTies).toHaveLength(1);
    expect(result.cutoffTies[0]).toMatchObject({ cutoff: "reserve", places: 1 });
    expect(ids(result.cutoffTies[0].teams)).toEqual(["c", "d"]);
    const violations = checkBreakGeneration(result.category, { rounds: [], debates: [], ballots: [] } as never, [], result);
    expect(violations.map((violation) => violation.rule)).toEqual(["reserve_cutoff_tie"]);
  });
});

describe("ties at the cutoff under AIDA rules", () => {
  it("AIDA 1996: a tie among teams the cap allows is reported, capped teams are not part of it", () => {
    // x1-x4 share an institution, so x4 (its 4th team) is capped. x4, y and w tie 4th; the cap
    // removes x4, leaving y and w tied for the one remaining place.
    const teams = [
      team("x1", "X"), team("x2", "X"), team("x3", "X"), team("x4", "X"), team("y", "Y"), team("w", "W"), team("z", "Z"),
    ];
    const table = standings([["x1", 1], ["x2", 2], ["x3", 3], ["x4", 4], ["y", 4], ["w", 4], ["z", 7]]);
    const [result] = calculateBreaks([category(4, 0, {}, "aida_1996")], teams, table);
    expect(ids(result.breakingTeams)).toEqual(["x1", "x2", "x3"]);
    expect(ids(result.cutoffTies[0].teams)).toEqual(["y", "w"]);
    expect(result.cutoffTies[0].places).toBe(1);
  });

  it("AIDA 2016 (Australs): a tie at the cutoff is reported", () => {
    const teams = ["a", "b", "c", "d"].map((id) => team(id));
    const table = standings([["a", 1], ["b", 2], ["c", 2], ["d", 4]]);
    const [result] = calculateBreaks([category(2, 0, {}, "aida_2016_australs")], teams, table, "australs");
    expect(ids(result.breakingTeams)).toEqual(["a"]);
    expect(ids(result.cutoffTies[0].teams)).toEqual(["b", "c"]);
  });
});

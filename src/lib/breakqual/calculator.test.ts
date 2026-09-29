import { describe, it, expect } from "vitest";
import { applyBreakStatuses, calculateBreaks } from "./calculator";
import { BreakCategory, Team, TeamStandingRow } from "@/types";

function createTeam(id: string, name: string, breakCategories: string[]): Team {
  return {
    id,
    tournamentId: "t1",
    name,
    speakers: [],
    breakCategories,
    speakerCategories: [],
  };
}

function createStanding(teamId: string, teamName: string, rank: number, points: number): TeamStandingRow {
  return {
    rank,
    teamId,
    teamName,
    points,
    totalSpeakerScore: 300 - rank * 2,
    averageSpeakerScore: (300 - rank * 2) / 2,
    breakCategories: [],
    roundResults: [],
    metrics: {} as any,
  };
}

describe("Break Qualification Calculator (breakqual/calculator)", () => {
  it("assigns qualified categories and eliminates reserves and non-qualifiers", () => {
    const category: BreakCategory = {
      id: "open",
      tournamentId: "t1",
      name: "Open",
      slug: "open",
      seq: 1,
      breakSize: 1,
      reserveSize: 1,
      isGeneral: true,
      priority: 1,
    };
    const teams = [
      createTeam("t1", "Team 1", []),
      createTeam("t2", "Team 2", []),
      createTeam("t3", "Team 3", []),
    ];
    const results = calculateBreaks(
      [category],
      teams,
      teams.map((team, index) => createStanding(team.id, team.name, index + 1, 3 - index))
    );

    const generated = applyBreakStatuses(teams, results);
    expect(generated.map((team) => [team.breakStatus, team.breakCategoryIds])).toEqual([
      ["breaking", ["open"]],
      ["eliminated", []],
      ["eliminated", []],
    ]);
  });

  it("replaces old break statuses when qualification changes", () => {
    const category: BreakCategory = {
      id: "open",
      tournamentId: "t1",
      name: "Open",
      slug: "open",
      seq: 1,
      breakSize: 1,
      reserveSize: 0,
      isGeneral: true,
      priority: 1,
    };
    const teams = [createTeam("t1", "Team 1", []), createTeam("t2", "Team 2", [])];
    const reversedStandings = [
      createStanding("t2", "Team 2", 1, 3),
      createStanding("t1", "Team 1", 2, 2),
    ];
    const updatedResults = calculateBreaks([category], teams, reversedStandings);

    const regenerated = applyBreakStatuses(teams, updatedResults);
    expect(regenerated.map((team) => team.breakStatus)).toEqual(["eliminated", "breaking"]);
    expect(regenerated[0].breakCategoryIds).toEqual([]);
  });

  it("prioritizes higher-priority categories and excludes broken teams from lower ones", () => {
    // Categories: Open (priority 10, size 2, reserve 1), ESL (priority 5, size 2, reserve 1)
    const openCat: BreakCategory = {
      id: "cat-open",
      tournamentId: "t1",
      name: "Open",
      slug: "open",
      seq: 1,
      breakSize: 2,
      reserveSize: 1,
      isGeneral: true,
      priority: 10,
    };

    const eslCat: BreakCategory = {
      id: "cat-esl",
      tournamentId: "t1",
      name: "ESL",
      slug: "esl",
      seq: 2,
      breakSize: 2,
      reserveSize: 1,
      isGeneral: false,
      priority: 5,
    };

    // Teams:
    // t1: ESL eligible, Rank 1
    // t2: Open only, Rank 2
    // t3: ESL eligible, Rank 3
    // t4: ESL eligible, Rank 4
    // t5: ESL eligible, Rank 5
    const teams = [
      createTeam("t1", "Team 1 (ESL)", ["cat-esl"]),
      createTeam("t2", "Team 2 (Open)", []),
      createTeam("t3", "Team 3 (ESL)", ["cat-esl"]),
      createTeam("t4", "Team 4 (ESL)", ["cat-esl"]),
      createTeam("t5", "Team 5 (ESL)", ["cat-esl"]),
    ];

    const standings = teams.map((t, idx) => createStanding(t.id, t.name, idx + 1, 10 - idx * 2));

    const results = calculateBreaks([eslCat, openCat], teams, standings);

    // Results should process openCat first because priority 10 > 5
    const openResult = results.find((r) => r.category.id === "cat-open")!;
    const eslResult = results.find((r) => r.category.id === "cat-esl")!;

    // Open breaking teams: Top 2 teams (t1 and t2)
    expect(openResult.breakingTeams).toHaveLength(2);
    expect(openResult.breakingTeams[0].team.id).toBe("t1");
    expect(openResult.breakingTeams[1].team.id).toBe("t2");
    // Open reserves: 1 reserve (t3)
    expect(openResult.reserveTeams).toHaveLength(1);
    expect(openResult.reserveTeams[0].team.id).toBe("t3");

    // ESL breaking teams: t1 already broke in Open! So ESL must skip t1 and pick next eligible teams.
    // Eligible remaining: t3 (since reserve doesn't exclude, only breaking does), t4, t5
    expect(eslResult.breakingTeams).toHaveLength(2);
    expect(eslResult.breakingTeams.map((b) => b.team.id)).toEqual(["t3", "t4"]);

    // ESL reserves: t5
    expect(eslResult.reserveTeams).toHaveLength(1);
    expect(eslResult.reserveTeams[0].team.id).toBe("t5");
  });
});

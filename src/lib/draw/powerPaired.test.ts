import { describe, it, expect } from "vitest";
import { generatePowerPairedDraw, MatchupHistory } from "./powerPaired";
import { Team, TeamStandingRow } from "@/types";

function createTeam(id: string, name: string, institutionId?: string): Team {
  return {
    id,
    tournamentId: "t1",
    name,
    institutionId,
    institutionName: institutionId ? `Inst ${institutionId}` : undefined,
    speakers: [],
    breakCategories: [],
    speakerCategories: [],
  };
}

function createStanding(teamId: string, teamName: string, points: number, speaks: number): TeamStandingRow {
  return {
    rank: 1,
    teamId,
    teamName,
    points,
    totalSpeakerScore: speaks,
    averageSpeakerScore: speaks / 2,
    breakCategories: [],
    roundResults: [],
  };
}

describe("Power-Paired Draw (powerPaired)", () => {
  it("throws when team count is not divisible by teams-per-debate", () => {
    const teams = [
      createTeam("t1", "T1"),
      createTeam("t2", "T2"),
      createTeam("t3", "T3"),
    ];
    const history: MatchupHistory = {
      opponents: new Map(),
      sides: new Map(),
    };
    expect(() => generatePowerPairedDraw(teams, [], history, "bp")).toThrow(
      "must be a multiple of 4"
    );
    expect(() => generatePowerPairedDraw(teams, [], history, "uadc")).toThrow(
      "must be a multiple of 2"
    );
  });

  it("places all teams exactly once in debates", () => {
    const teams = Array.from({ length: 8 }, (_, i) => createTeam(`t${i + 1}`, `Team ${i + 1}`));
    const standings = teams.map((t, idx) => createStanding(t.id, t.name, 6 - Math.floor(idx / 2), 300 - idx * 5));
    const history: MatchupHistory = {
      opponents: new Map(),
      sides: new Map(),
    };

    const draw = generatePowerPairedDraw(teams, standings, history, "bp");
    expect(draw).toHaveLength(2); // 8 teams / 4 = 2 rooms

    const allPlacedTeams: string[] = [];
    draw.forEach((d) => {
      expect(d.teams).toHaveLength(4);
      d.teams.forEach((t) => allPlacedTeams.push(t.id));
    });

    expect(allPlacedTeams).toHaveLength(8);
    expect(new Set(allPlacedTeams).size).toBe(8);
  });

  it("avoids repeat matchups when avoidable", () => {
    // 4 teams in 2-team format (2 debates)
    // t1 and t2 previously debated each other
    const t1 = createTeam("t1", "Team 1");
    const t2 = createTeam("t2", "Team 2");
    const t3 = createTeam("t3", "Team 3");
    const t4 = createTeam("t4", "Team 4");
    const teams = [t1, t2, t3, t4];

    // All on 3 points so they are in the same bracket
    const standings = [
      createStanding("t1", "Team 1", 3, 150),
      createStanding("t2", "Team 2", 3, 149),
      createStanding("t3", "Team 3", 3, 148),
      createStanding("t4", "Team 4", 3, 147),
    ];

    const history: MatchupHistory = {
      opponents: new Map([
        ["t1", new Set(["t2"])],
        ["t2", new Set(["t1"])],
        ["t3", new Set(["t4"])],
        ["t4", new Set(["t3"])],
      ]),
      sides: new Map(),
    };

    const draw = generatePowerPairedDraw(teams, standings, history, "uadc");
    expect(draw).toHaveLength(2);

    // Verify t1 is not paired with t2
    draw.forEach((d) => {
      const ids = d.teams.map((t) => t.id);
      expect(ids.includes("t1") && ids.includes("t2")).toBe(false);
      expect(ids.includes("t3") && ids.includes("t4")).toBe(false);
    });
  });

  it("avoids institution clashes within debates when avoidable", () => {
    // 4 teams: t1 and t2 from Inst A, t3 and t4 from Inst B
    const t1 = createTeam("t1", "Team 1", "instA");
    const t2 = createTeam("t2", "Team 2", "instA");
    const t3 = createTeam("t3", "Team 3", "instB");
    const t4 = createTeam("t4", "Team 4", "instB");
    const teams = [t1, t2, t3, t4];

    const standings = [
      createStanding("t1", "Team 1", 3, 150),
      createStanding("t2", "Team 2", 3, 149),
      createStanding("t3", "Team 3", 3, 148),
      createStanding("t4", "Team 4", 3, 147),
    ];

    const history: MatchupHistory = {
      opponents: new Map(),
      sides: new Map(),
    };

    const draw = generatePowerPairedDraw(teams, standings, history, "uadc");
    expect(draw).toHaveLength(2);

    // In a 2-team draw, t1 and t2 (instA) should not face each other, nor t3 and t4 (instB)
    draw.forEach((d) => {
      const insts = d.teams.map((t) => t.institutionId);
      expect(new Set(insts).size).toBe(2); // Both rooms should have 1 instA and 1 instB
    });
  });
});

import { describe, it, expect } from "vitest";
import { generateRoundRobinDraw } from "./roundRobin";
import { Team, DebateSide } from "@/types";

function makeTeam(id: string, name: string): Team {
  return {
    id,
    tournamentId: "t1",
    name,
    speakers: [],
    breakCategories: [],
    speakerCategories: [],
  };
}

describe("Round Robin Draw (draw/roundRobin)", () => {
  it("schedules all unique pairings across N-1 rounds using circle method", () => {
    const teams = [
      makeTeam("t1", "Team 1"),
      makeTeam("t2", "Team 2"),
      makeTeam("t3", "Team 3"),
      makeTeam("t4", "Team 4"),
    ];
    const sideHistories = new Map<string, DebateSide[]>();

    const playedPairings = new Set<string>();

    // 4 teams = 3 rounds in a complete round-robin
    for (let roundSeq = 1; roundSeq <= 3; roundSeq++) {
      const draw = generateRoundRobinDraw(teams, roundSeq, sideHistories, "uadc");
      expect(draw).toHaveLength(2); // 4 teams / 2 = 2 debates per round

      draw.forEach((m) => {
        const pair = [m.teamsWithSides.AFF.id, m.teamsWithSides.NEG.id].sort().join(" vs ");
        expect(playedPairings.has(pair)).toBe(false); // No repeat matchups in a single cycle!
        playedPairings.add(pair);
      });
    }

    // 4 teams have 4*3/2 = 6 unique matchups. All 6 must be played!
    expect(playedPairings.size).toBe(6);
  });

  it("throws if team count is odd or less than 2", () => {
    const teams3 = [makeTeam("t1", "T1"), makeTeam("t2", "T2"), makeTeam("t3", "T3")];
    const sideHistories = new Map<string, DebateSide[]>();
    expect(() => generateRoundRobinDraw(teams3, 1, sideHistories, "uadc")).toThrow(
      "requires an even number of teams"
    );
  });
});

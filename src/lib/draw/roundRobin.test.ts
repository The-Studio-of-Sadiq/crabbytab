import { describe, it, expect } from "vitest";
import {
  BP_ROUND_ROBIN_TABLES,
  bergerPairings,
  generateBPRoundRobinDraw,
  generateRoundRobinDraw,
  orderForRoundRobin,
} from "./roundRobin";
import { createSeededRng } from "./rng";
import { Team, DebateSide } from "@/types";

function makeTeam(id: string, name: string, seed?: number): Team {
  return {
    id,
    tournamentId: "t1",
    name,
    seed,
    speakers: [],
    breakCategories: [],
    speakerCategories: [],
  };
}

const seeded = (count: number) =>
  Array.from({ length: count }, (_, index) => makeTeam(`t${index + 1}`, `Team ${index + 1}`, index + 1));
const pairKey = (a: string, b: string) => [a, b].sort().join(" v ");

describe("Round Robin Draw (draw/roundRobin)", () => {
  it("schedules all unique pairings across N-1 rounds using the Berger method", () => {
    const teams = seeded(6);
    const sideHistories = new Map<string, DebateSide[]>();
    const played = new Set<string>();
    for (let roundIndex = 1; roundIndex <= 5; roundIndex++) {
      const draw = generateRoundRobinDraw(teams, roundIndex, sideHistories, "uadc");
      expect(draw).toHaveLength(3);
      for (const m of draw) {
        const pair = pairKey(m.teamsWithSides.AFF.id, m.teamsWithSides.NEG.id);
        expect(played.has(pair)).toBe(false);
        played.add(pair);
      }
    }
    expect(played.size).toBe(15);
  });

  it("matches Tabbycat's berger_pairings_for_round for seeds 1-4", () => {
    const teams = seeded(4);
    const ids = (round: number) => bergerPairings(teams, round).map(([a, b]) => `${a.id}-${b.id}`);
    expect(ids(1)).toEqual(["t1-t2", "t3-t4"]);
    expect(ids(2)).toEqual(["t1-t3", "t4-t2"]);
    expect(ids(3)).toEqual(["t1-t4", "t2-t3"]);
  });

  it("orders teams by seed, not by the order they are listed in", () => {
    const teams = seeded(4);
    const reversed = [...teams].reverse();
    const sides = new Map<string, DebateSide[]>();
    const pairs = (list: Team[]) =>
      generateRoundRobinDraw(list, 2, sides, "uadc", "balanced", undefined, createSeededRng(1))
        .map((m) => pairKey(m.teamsWithSides.AFF.id, m.teamsWithSides.NEG.id))
        .sort();
    expect(pairs(reversed)).toEqual(pairs(teams));
    // Equal seeds fall back to team id.
    expect(orderForRoundRobin([makeTeam("b", "B", 1), makeTeam("a", "A", 1)]).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("is reproducible: the same seed gives the same sides", () => {
    const teams = seeded(8);
    const run = () =>
      generateRoundRobinDraw(teams, 3, new Map(), "uadc", "random", undefined, createSeededRng(42)).map((m) => [
        m.teamsWithSides.AFF.id,
        m.teamsWithSides.NEG.id,
      ]);
    expect(run()).toEqual(run());
  });

  it("refuses unseeded teams and names them", () => {
    const teams = [...seeded(3), makeTeam("x", "Unseeded Team")];
    expect(() => generateRoundRobinDraw(teams, 1, new Map(), "uadc")).toThrow(/must have a seed.*Unseeded Team/);
  });

  it("reports an error past the end of the schedule instead of wrapping", () => {
    const teams = seeded(4);
    expect(() => generateRoundRobinDraw(teams, 4, new Map(), "uadc")).toThrow(/expected between 1 and 3/);
    expect(() => generateRoundRobinDraw(teams, 0, new Map(), "uadc")).toThrow(/expected between 1 and 3/);
  });

  it("throws if team count is odd or less than 2", () => {
    expect(() => generateRoundRobinDraw(seeded(3), 1, new Map(), "uadc")).toThrow("requires an even number of teams");
  });
});

describe("BP round robin (Tabbycat's preset tables)", () => {
  it("covers each table round exactly once per team, with seats from the table", () => {
    const teams = seeded(16);
    for (let roundIndex = 1; roundIndex <= BP_ROUND_ROBIN_TABLES[16].length; roundIndex++) {
      const draw = generateBPRoundRobinDraw(teams, roundIndex, new Map());
      expect(draw).toHaveLength(4);
      const placed = draw.flatMap((room) => Object.values(room.teamsWithSides).map((team) => team.id));
      expect(new Set(placed).size).toBe(16);
    }
    const first = generateBPRoundRobinDraw(teams, 1, new Map())[0].teamsWithSides;
    expect([first.OG.seed, first.OO.seed, first.CG.seed, first.CO.seed]).toEqual([12, 14, 1, 7]);
  });

  it("is deterministic: the same field gives the same rooms", () => {
    const teams = seeded(28);
    const run = () => generateBPRoundRobinDraw(teams, 4, new Map()).map((room) => Object.values(room.teamsWithSides).map((t) => t.id));
    expect(run()).toEqual(run());
  });

  it("refuses unsupported team counts, bad round indices and invalid seeds", () => {
    expect(() => generateBPRoundRobinDraw(seeded(8), 1, new Map())).toThrow(/only available for 16, 28 teams/);
    expect(() => generateBPRoundRobinDraw(seeded(16), 6, new Map())).toThrow(/expected between 1 and 5/);
    const duplicate = seeded(16).map((team, index) => (index === 15 ? { ...team, seed: 1 } : team));
    expect(() => generateBPRoundRobinDraw(duplicate, 1, new Map())).toThrow(/1 through 16/);
    const unseeded = seeded(16).map((team, index) => (index === 0 ? { ...team, seed: undefined } : team));
    expect(() => generateBPRoundRobinDraw(unseeded, 1, new Map())).toThrow(/must have a seed/);
  });

  it("keeps side limits hard: a table seat that breaks one is an error", () => {
    const teams = seeded(16);
    // Seed 12 sits in OG in round 1; with two OGs already and a limit of 2 it cannot.
    const history = new Map<string, DebateSide[]>([["t12", ["OG", "OG"]]]);
    expect(() => generateBPRoundRobinDraw(teams, 1, history, { maxTimesPerSide: 2 })).toThrow(/Team 12 in OG/);
  });
});

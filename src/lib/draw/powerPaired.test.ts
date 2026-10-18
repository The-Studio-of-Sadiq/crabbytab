import { describe, it, expect } from "vitest";
import { defineBPRooms, generatePowerPairedDraw, MatchupHistory, PairedDebateDraft } from "./powerPaired";
import { BP_SIDES, computeBPSideCost } from "./sideAllocator";
import { createSeededRng, shuffle } from "./rng";
import { BPSide, DebateSide, Team, TeamStandingRow } from "@/types";

function createTeam(id: string): Team {
  return { id, tournamentId: "t1", name: id, speakers: [], breakCategories: [], speakerCategories: [] };
}

function standing(teamId: string, points: number, pullups = 0): TeamStandingRow {
  return {
    rank: 1,
    teamId,
    teamName: teamId,
    points,
    totalSpeakerScore: 0,
    averageSpeakerScore: 0,
    breakCategories: [],
    roundResults: [],
    metrics: { pullups } as TeamStandingRow["metrics"],
  };
}

const emptyHistory = (): MatchupHistory => ({ opponents: new Map(), sides: new Map() });
const field = (points: number[]) => {
  const teams = points.map((_, i) => createTeam(`t${i}`));
  return { teams, standings: teams.map((t, i) => standing(t.id, points[i])) };
};
const allowedSummary = (points: number[], distribution?: "anywhere" | "top" | "bottom") =>
  defineBPRooms(points, distribution).map((room) => `${room.level}:${[...room.allowed].sort((a, b) => b - a).join(",")}`);
const sideOf = (draft: PairedDebateDraft, teamId: string) =>
  (Object.entries(draft.teamsWithSides).find(([, team]) => team.id === teamId)?.[0]) as BPSide;

describe("defineBPRooms (Tabbycat bracket construction)", () => {
  it("completes an odd-sized bracket with pull-ups from the bracket below", () => {
    expect(allowedSummary([6, 6, 6, 5, 5, 5, 5, 5])).toEqual(["6:6,5", "5:5"]);
  });

  it("merges a whole lower bracket when it is needed to fill a room", () => {
    expect(allowedSummary([6, 5, 5, 4, 4, 4, 4, 4])).toEqual(["6:6,5,4", "4:4"]);
  });

  it("confines pull-ups to the top or bottom room of the bracket", () => {
    const points = [6, 6, 6, 6, 6, 5, 5, 5, 5, 5, 5, 5];
    expect(allowedSummary(points, "anywhere")).toEqual(["6:6,5", "6:6,5", "5:5"]);
    expect(allowedSummary(points, "top")).toEqual(["6:6,5", "6:6", "5:5"]);
    expect(allowedSummary(points, "bottom")).toEqual(["6:6", "6:6,5", "5:5"]);
  });
});

describe("generatePowerPairedDraw (BP Hungarian)", () => {
  it("throws when team count is not a multiple of 4", () => {
    const { teams, standings } = field([0, 0, 0, 0, 0, 0]);
    expect(() => generatePowerPairedDraw(teams, standings, emptyHistory())).toThrow(/multiple of 4/);
  });

  it("places every team exactly once and pulls up exactly one team from below", () => {
    const { teams, standings } = field([3, 3, 3, 2, 2, 2, 2, 2]);
    const draw = generatePowerPairedDraw(teams, standings, emptyHistory(), {}, createSeededRng(1));
    expect(draw.flatMap((d) => d.teams.map((t) => t.id)).sort()).toEqual(teams.map((t) => t.id).sort());
    expect(draw[0].bracket).toBe(3);
    expect(draw[0].teams.filter((t) => ["t0", "t1", "t2"].includes(t.id))).toHaveLength(3);
    // The pulled-up team is the one with fewer points than its room, from the 2-point bracket.
    expect(draw[0].pulledUpTeamIds).toHaveLength(1);
    expect(["t3", "t4", "t5", "t6", "t7"]).toContain(draw[0].pulledUpTeamIds![0]);
    expect(draw[1].pulledUpTeamIds).toEqual([]);
  });

  it("prefers pulling up the team with fewer previous pull-ups when pullupPenalty is set", () => {
    const { teams } = field([3, 3, 3, 2, 2, 2, 2, 2]);
    const standings = teams.map((t, i) => standing(t.id, i < 3 ? 3 : 2, t.id === "t6" ? 0 : 2));
    for (let seed = 0; seed < 10; seed++) {
      const draw = generatePowerPairedDraw(teams, standings, emptyHistory(), { pullupPenalty: 100000 }, createSeededRng(seed));
      expect(draw[0].pulledUpTeamIds).toEqual(["t6"]);
    }
  });

  it("gives each team the position its history most needs", () => {
    const { teams, standings } = field([0, 0, 0, 0]);
    const history = emptyHistory();
    history.sides.set("t0", ["OG", "OO", "CG"]);
    history.sides.set("t1", ["OO", "CG", "CO"]);
    history.sides.set("t2", ["OG", "CG", "CO"]);
    history.sides.set("t3", ["OG", "OO", "CO"]);
    const [room] = generatePowerPairedDraw(teams, standings, history, {}, createSeededRng(3));
    expect(room.teamsWithSides).toMatchObject({ CO: { id: "t0" }, OG: { id: "t1" }, OO: { id: "t2" }, CG: { id: "t3" } });
  });

  it("finds the minimum total position cost (checked by brute force)", () => {
    const rng = createSeededRng(11);
    for (let trial = 0; trial < 15; trial++) {
      const points = [2, 2, 2, 1, 1, 1, 1, 1];
      const { teams, standings } = field(points);
      const history = emptyHistory();
      teams.forEach((t) => history.sides.set(t.id, Array.from({ length: 4 }, () => BP_SIDES[Math.floor(rng() * 4)])));
      const draw = generatePowerPairedDraw(teams, standings, history, {}, rng);
      const total = (d: PairedDebateDraft[]) =>
        d.reduce((sum, room) => sum + BP_SIDES.reduce((s, side) => s + computeBPSideCost(history.sides.get(room.teamsWithSides[side].id)!, side), 0), 0);

      // Brute force: every split that keeps the 2-point teams in the top room, every position order.
      let best = Infinity;
      const lower = teams.slice(3);
      const perms = (xs: Team[]): Team[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
      for (let k = 0; k < lower.length; k++) {
        const topTeams = [...teams.slice(0, 3), lower[k]];
        const bottomTeams = lower.filter((_, i) => i !== k);
        const roomCost = (roomTeams: Team[]) =>
          Math.min(...perms(roomTeams).map((order) => order.reduce((s, t, i) => s + computeBPSideCost(history.sides.get(t.id)!, BP_SIDES[i]), 0)));
        best = Math.min(best, roomCost(topTeams) + roomCost(bottomTeams));
      }
      expect(total(draw)).toBeCloseTo(best, 6);
    }
  });

  it("keeps position histories balanced over a nine-round tournament", () => {
    const rng = createSeededRng(2024);
    const teams = Array.from({ length: 24 }, (_, i) => createTeam(`t${i}`));
    const points = new Map(teams.map((t) => [t.id, 0]));
    const history = emptyHistory();
    for (let round = 0; round < 9; round++) {
      const standings = [...teams]
        .sort((a, b) => points.get(b.id)! - points.get(a.id)!)
        .map((t) => standing(t.id, points.get(t.id)!));
      const draw = generatePowerPairedDraw(teams, standings, history, {}, rng);
      for (const room of draw) {
        const order = shuffle(BP_SIDES, rng);
        order.forEach((side, rank) => {
          const team = room.teamsWithSides[side];
          points.set(team.id, points.get(team.id)! + 3 - rank);
          history.sides.set(team.id, [...(history.sides.get(team.id) ?? []), side as DebateSide]);
        });
      }
    }
    for (const team of teams) {
      const counts = BP_SIDES.map((side) => history.sides.get(team.id)!.filter((s) => s === side).length);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      expect(Math.max(...counts)).toBeLessThanOrEqual(3);
    }
  });

  it("is reproducible for a seed", () => {
    const { teams, standings } = field([3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 1]);
    const ids = (seed: number) =>
      generatePowerPairedDraw(teams, standings, emptyHistory(), {}, createSeededRng(seed)).map((d) => BP_SIDES.map((s) => d.teamsWithSides[s].id).join(","));
    expect(ids(42)).toEqual(ids(42));
    expect(new Set(Array.from({ length: 8 }, (_, seed) => ids(seed).join("|"))).size).toBeGreaterThan(1);
  });

  it("random assignment keeps brackets but ignores position history", () => {
    const { teams, standings } = field([1, 1, 1, 1, 0, 0, 0, 0]);
    const history = emptyHistory();
    teams.forEach((t) => history.sides.set(t.id, ["OG", "OG", "OG"]));
    const draw = generatePowerPairedDraw(teams, standings, history, { bpAssignmentMethod: "random" }, createSeededRng(9));
    expect(draw[0].teams.map((t) => t.id).sort()).toEqual(["t0", "t1", "t2", "t3"]);
    expect(draw.every((d) => d.pulledUpTeamIds!.length === 0)).toBe(true);
  });

  it("treats side limits as hard constraints and reports when they cannot be met", () => {
    const { teams, standings } = field([0, 0, 0, 0]);
    const history = emptyHistory();
    history.sides.set("t0", ["OG"]);
    const [room] = generatePowerPairedDraw(teams, standings, history, { maxTimesPerSide: 1 }, createSeededRng(1));
    expect(sideOf(room, "t0")).not.toBe("OG");

    teams.forEach((t) => history.sides.set(t.id, ["OG"]));
    expect(() => generatePowerPairedDraw(teams, standings, history, { maxTimesPerSide: 1 }, createSeededRng(1))).toThrow(
      /side limits \(at most 1 times per side\)/
    );
  });
});

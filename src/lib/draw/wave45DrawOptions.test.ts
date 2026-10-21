import { describe, expect, it } from "vitest";
import type { DebateSide, OddBracketMethod, Team, TeamStandingRow } from "@/types";
import { MatchupHistory, PairedDebateDraft, generatePowerPairedDraw } from "./powerPaired";
import { createSeededRng } from "./rng";
import { bpPositionBaseCost, sideCounts, TWO_TEAM_SIDES } from "./sideAllocator";
import { TwoTeamDrawConfig, generateTwoTeamDraw } from "./twoTeamDraw";

/*
 * Wave 4/5 draw options, worked from Tabbycat v2.12.1 draw/generator: graph_one
 * (SingleGraphPowerPairedDrawGenerator) with its pull-up orders and pull-up penalty, the draw
 * strength rank pull-ups, side limits as a pairing constraint, and the BP "simple" position cost
 * and unshuffled Hungarian assignment.
 */

function team(id: string, institutionId?: string): Team {
  return { id, tournamentId: "t", name: id, institutionId, speakers: [], breakCategories: [], speakerCategories: [] };
}

function standing(teamId: string, wins: number, rank: number, extra: Partial<TeamStandingRow["metrics"]> = {}): TeamStandingRow {
  return {
    rank,
    teamId,
    teamName: teamId,
    points: wins,
    totalSpeakerScore: 0,
    averageSpeakerScore: 0,
    breakCategories: [],
    roundResults: [],
    metrics: { wins, points: wins, draw_strength: 0, draw_strength_wins: 0, draw_strength_speaks: 0, pullups: 0, ...extra } as TeamStandingRow["metrics"],
  };
}

const emptyHistory = (): MatchupHistory => ({ opponents: new Map(), sides: new Map() });
const rooms = (draw: PairedDebateDraft[]) => draw.map((d) => d.teams.map((t) => t.id).sort().join("v"));
const pulledUp = (draw: PairedDebateDraft[]) => draw.flatMap((d) => d.pulledUpTeamIds ?? []).sort();

/** T1 (2 wins), T2-T4 (1 win), T5-T6 (0 wins): the top bracket needs one pull-up from the 1-win bracket. */
const field = () => ["T1", "T2", "T3", "T4", "T5", "T6"].map((id) => team(id));
const wins = [2, 1, 1, 1, 0, 0];
const fieldStandings = (extra: Record<string, Partial<TeamStandingRow["metrics"]>> = {}) =>
  field().map((t, i) => standing(t.id, wins[i], i + 1, extra[t.id]));

const graphOne = (oddBracketMethod: OddBracketMethod, more: Partial<TwoTeamDrawConfig> = {}): Partial<TwoTeamDrawConfig> => ({
  conflictAvoidance: "min_cost_with_pullups",
  pairingMethod: "fold",
  oddBracketMethod,
  ...more,
});

describe("min-cost matching including pull-ups (Tabbycat graph_one)", () => {
  it("pulls up the top team of the next bracket with pullup_top", () => {
    const draw = generateTwoTeamDraw(field(), fieldStandings(), emptyHistory(), "uadc", graphOne("pullup_top"), createSeededRng(1));
    expect(rooms(draw)).toEqual(["T1vT2", "T3vT4", "T5vT6"]);
    expect(pulledUp(draw)).toEqual(["T2"]);
    expect(draw[0].bracket).toBe(2);
  });

  it("pulls up the bottom team with pullup_bottom, then folds the rest", () => {
    const draw = generateTwoTeamDraw(field(), fieldStandings(), emptyHistory(), "uadc", graphOne("pullup_bottom"), createSeededRng(1));
    expect(rooms(draw)).toEqual(["T1vT4", "T2vT3", "T5vT6"]);
  });

  it("pulls up another team rather than create an institution clash", () => {
    const teams = field().map((t) => (t.id === "T1" || t.id === "T2" ? { ...t, institutionId: "U" } : t));
    const draw = generateTwoTeamDraw(teams, fieldStandings(), emptyHistory(), "uadc", graphOne("pullup_top", {
      penalties: { repeatMatchupPenalty: 1000, institutionClashPenalty: 1 },
    }), createSeededRng(1));
    expect(pulledUp(draw)).toEqual(["T3"]);
    expect(rooms(draw)).toContain("T1vT3");
  });

  it("uses the pull-up penalty to weigh the odd-bracket order against clashes", () => {
    const teams = field().map((t) => (t.id === "T1" || t.id === "T2" ? { ...t, institutionId: "U" } : t));
    // Institution clash 1 < pulling the second team in order (1 × 5): Tabbycat keeps T2 and the clash.
    const draw = generateTwoTeamDraw(teams, fieldStandings(), emptyHistory(), "uadc", graphOne("pullup_top", {
      penalties: { repeatMatchupPenalty: 1000, institutionClashPenalty: 1 },
      pullupPenalty: 5,
    }), createSeededRng(1));
    expect(pulledUp(draw)).toEqual(["T2"]);
  });

  it("pulls up the team with the weakest opponents (highest mean opponent rank) with pullup_lowest_ds_rank", () => {
    const standings = fieldStandings({ T2: { draw_strength_rank: 3 }, T3: { draw_strength_rank: 4.5 }, T4: { draw_strength_rank: 2 } });
    const draw = generateTwoTeamDraw(field(), standings, emptyHistory(), "uadc", graphOne("pullup_lowest_ds_rank"), createSeededRng(1));
    expect(pulledUp(draw)).toEqual(["T3"]);
  });

  it("treats a team with no opponents as the lowest draw strength", () => {
    const standings = fieldStandings({ T2: { draw_strength_rank: 3 }, T3: { draw_strength_rank: 4.5 } });
    const draw = generateTwoTeamDraw(field(), standings, emptyHistory(), "uadc", graphOne("pullup_lowest_ds_rank"), createSeededRng(1));
    expect(pulledUp(draw)).toEqual(["T4"]);
  });

  it("prefers the least pulled-up team first with pullup_lowest_ds_rank_npulls", () => {
    const standings = fieldStandings({
      T2: { draw_strength_rank: 3, pullups: 0 },
      T3: { draw_strength_rank: 4.5, pullups: 1 },
      T4: { draw_strength_rank: 2, pullups: 0 },
    });
    const draw = generateTwoTeamDraw(field(), standings, emptyHistory(), "uadc", graphOne("pullup_lowest_ds_rank_npulls"), createSeededRng(1));
    expect(pulledUp(draw)).toEqual(["T2"]);
  });

  it("never pulls a team over a non-empty bracket", () => {
    // T1 (3 wins), T2 (2), T3-T4 (1)... T1 may meet T2 only (the 1-win bracket is not adjacent).
    const teams = ["T1", "T2", "T3", "T4"].map((id) => team(id));
    const standings = [standing("T1", 3, 1), standing("T2", 2, 2), standing("T3", 1, 3), standing("T4", 1, 4)];
    const history: MatchupHistory = { opponents: new Map([["T1", new Set(["T2"])], ["T2", new Set(["T1"])]]), sides: new Map() };
    const draw = generateTwoTeamDraw(teams, standings, history, "uadc", graphOne("pullup_top"), createSeededRng(1));
    // History is a penalty (as in min_cost), so the only allowed pairing is drawn despite the rematch.
    expect(rooms(draw)).toEqual(["T1vT2", "T3vT4"]);
  });

  it("is reproducible for a seed, including pullup_random", () => {
    const run = (seed: number) =>
      rooms(generateTwoTeamDraw(field(), fieldStandings(), emptyHistory(), "uadc", graphOne("pullup_random", { pairingMethod: "random" }), createSeededRng(seed)));
    expect(run(7)).toEqual(run(7));
    const pulled = new Set(Array.from({ length: 20 }, (_, seed) =>
      pulledUp(generateTwoTeamDraw(field(), fieldStandings(), emptyHistory(), "uadc", graphOne("pullup_random"), createSeededRng(seed)))[0]));
    expect([...pulled].every((id) => ["T2", "T3", "T4"].includes(id))).toBe(true);
    expect(pulled.size).toBeGreaterThan(1);
  });

  it("refuses intermediate brackets, as Tabbycat does", () => {
    expect(() => generateTwoTeamDraw(field(), fieldStandings(), emptyHistory(), "uadc", graphOne("intermediate"), createSeededRng(1)))
      .toThrow(/Intermediate brackets/);
  });

  it("refuses draw strength rank pull-ups without min_cost_with_pullups", () => {
    expect(() =>
      generateTwoTeamDraw(field(), fieldStandings(), emptyHistory(), "uadc", {
        conflictAvoidance: "one_up_one_down",
        oddBracketMethod: "pullup_lowest_ds_rank",
      }, createSeededRng(1))
    ).toThrow(/draw strength rank/);
  });
});

describe("graph_one properties over random fields", () => {
  const methods: OddBracketMethod[] = ["pullup_top", "pullup_bottom", "pullup_middle", "pullup_random", "pullup_lowest_ds_rank", "pullup_lowest_ds_rank_npulls"];
  it("places every team once, pulls up only between adjacent brackets, and keeps side limits", () => {
    let infeasible = 0;
    for (let trial = 0; trial < 40; trial++) {
      const rng = createSeededRng(1000 + trial);
      const n = 2 * (3 + Math.floor(rng() * 10));
      const teams = Array.from({ length: n }, (_, i) => team(`t${i}`, `u${Math.floor(rng() * 4)}`));
      const teamWins = teams.map(() => Math.floor(rng() * 4)).sort((a, b) => b - a);
      const standings = teams.map((t, i) => standing(t.id, teamWins[i], i + 1, { draw_strength_rank: rng() < 0.2 ? Number.NaN : 1 + rng() * n, pullups: Math.floor(rng() * 2) }));
      const history: MatchupHistory = {
        opponents: new Map(),
        sides: new Map(teams.map((t) => [t.id, Array.from({ length: 3 }, () => (rng() < 0.5 ? "AFF" : "NEG") as DebateSide)])),
      };
      const config = graphOne(methods[trial % methods.length], { maxAllowedSideImbalance: 3, pairingMethod: trial % 2 ? "slide" : "fold", pairingDeviationPenalty: trial % 3 === 0 ? 1 : 0 });
      let draw: PairedDebateDraft[];
      try {
        draw = generateTwoTeamDraw(teams, standings, history, "uadc", config, createSeededRng(trial));
      } catch (error) {
        // Random side histories can make the field infeasible; that must be reported, not drawn.
        expect(String(error)).toMatch(/side limits/);
        infeasible++;
        continue;
      }
      expect(draw.flatMap((d) => d.teams.map((t) => t.id)).sort()).toEqual(teams.map((t) => t.id).sort());
      const levels = [...new Set(teamWins)].sort((a, b) => b - a);
      const winsOf = new Map(teams.map((t, i) => [t.id, teamWins[i]]));
      for (const debate of draw) {
        const [a, b] = debate.teams.map((t) => levels.indexOf(winsOf.get(t.id)!));
        expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
        for (const side of TWO_TEAM_SIDES) {
          const id = debate.teamsWithSides[side].id;
          expect(sideCounts([...(history.sides.get(id) ?? []), side], TWO_TEAM_SIDES).every((count) => count <= 3)).toBe(true);
        }
      }
      expect(rooms(generateTwoTeamDraw(teams, standings, history, "uadc", config, createSeededRng(trial)))).toEqual(rooms(draw));
    }
    expect(infeasible).toBeLessThan(10);
  });
});

// The hard side limit is the imbalance cap (maxAllowedSideImbalance); with three earlier rounds, a
// cap of 3 forbids a fourth round on the same side. maxTimesPerSide is never a hard limit.
describe("side limits as a pairing constraint (one-up-one-down and fold)", () => {
  function sides(entries: Record<string, DebateSide[]>): MatchupHistory {
    return { opponents: new Map(), sides: new Map(Object.entries(entries)) };
  }

  it("re-pairs inside the bracket when fold meets two teams that cannot take opposite sides", () => {
    // Fold pairs A-D and B-C; A and D have both been affirmative three times (the cap).
    const teams = ["A", "B", "C", "D"].map((id) => team(id));
    const standings = teams.map((t, i) => standing(t.id, 1, i + 1));
    const history = sides({ A: ["AFF", "AFF", "AFF"], D: ["AFF", "AFF", "AFF"], B: ["NEG", "NEG"], C: ["NEG", "NEG"] });
    const config: Partial<TwoTeamDrawConfig> = { pairingMethod: "fold", conflictAvoidance: "one_up_one_down", maxAllowedSideImbalance: 3 };
    const draw = generateTwoTeamDraw(teams, standings, history, "uadc", config, createSeededRng(3));
    for (const debate of draw) {
      for (const side of TWO_TEAM_SIDES) {
        const t = debate.teamsWithSides[side];
        expect(sideCounts([...(history.sides.get(t.id) ?? []), side], TWO_TEAM_SIDES)[TWO_TEAM_SIDES.indexOf(side)]).toBeLessThanOrEqual(3);
      }
    }
    expect(rooms(draw)).not.toContain("AvD");
  });

  it("widens to the next bracket when a one-room bracket cannot fit", () => {
    // Bracket 2: A and B, both affirmative three times. Bracket 1: C and D, who can go either way.
    const teams = ["A", "B", "C", "D"].map((id) => team(id));
    const standings = [standing("A", 2, 1), standing("B", 2, 2), standing("C", 1, 3), standing("D", 1, 4)];
    const history = sides({ A: ["AFF", "AFF", "AFF"], B: ["AFF", "AFF", "AFF"], C: ["AFF", "NEG"], D: ["NEG", "AFF"] });
    const draw = generateTwoTeamDraw(teams, standings, history, "uadc", {
      pairingMethod: "fold",
      conflictAvoidance: "one_up_one_down",
      maxAllowedSideImbalance: 3,
    }, createSeededRng(3));
    expect(rooms(draw)).not.toContain("AvB");
    for (const debate of draw) expect(["A", "B"]).not.toContain(debate.teamsWithSides.AFF.id);
    expect(pulledUp(draw)).toHaveLength(2);
  });

  it("still fails clearly when no pairing of the field fits", () => {
    const teams = ["A", "B"].map((id) => team(id));
    const standings = [standing("A", 1, 1), standing("B", 1, 2)];
    const history = sides({ A: ["AFF", "AFF", "AFF"], B: ["AFF", "AFF", "AFF"] });
    expect(() => generateTwoTeamDraw(teams, standings, history, "uadc", { maxAllowedSideImbalance: 3 }, createSeededRng(1)))
      .toThrow(/side limits/);
  });

  // Regression: maxTimesPerSide was a hard limit (default 5), so these fields could not be drawn.
  it("never fails a draw over maxTimesPerSide, with any conflict avoidance", () => {
    const teams = ["A", "B", "C", "D"].map((id) => team(id));
    const standings = teams.map((t, i) => standing(t.id, 1, i + 1));
    const history = sides({ A: ["AFF", "AFF", "AFF"], B: ["AFF", "AFF", "AFF"], C: ["AFF", "AFF", "AFF"], D: ["AFF", "AFF", "AFF"] });
    for (const conflictAvoidance of ["one_up_one_down", "min_cost", "off"] as const) {
      const draw = generateTwoTeamDraw(teams, standings, history, "uadc", {
        conflictAvoidance,
        sideBalancePenalty: 100,
        maxTimesPerSide: 2,
      }, createSeededRng(1));
      expect(draw.flatMap((debate) => debate.teams.map((t) => t.id)).sort()).toEqual(["A", "B", "C", "D"]);
    }
  });
});

describe("BP position cost 'simple' and the unshuffled Hungarian assignment", () => {
  it("costs a position by how often the team has already held it", () => {
    const history: DebateSide[] = ["OG", "OG", "OO"];
    expect(bpPositionBaseCost(history, "OG", { bpPositionCost: "simple" })).toBe(2);
    expect(bpPositionBaseCost(history, "OO", { bpPositionCost: "simple" })).toBe(1);
    expect(bpPositionBaseCost(history, "CG", { bpPositionCost: "simple" })).toBe(0);
  });

  it("does not depend on the seed without the pre-shuffle", () => {
    const teams = Array.from({ length: 8 }, (_, i) => team(`b${i}`));
    const standings = teams.map((t, i) => ({ ...standing(t.id, 0, i + 1), points: i < 4 ? 3 : 0 }));
    const draw = (seed: number) =>
      generatePowerPairedDraw(teams, standings, emptyHistory(), { bpAssignmentMethod: "hungarian_unshuffled" }, createSeededRng(seed))
        .map((room) => ["OG", "OO", "CG", "CO"].map((side) => room.teamsWithSides[side as DebateSide].id).join(","));
    expect(draw(1)).toEqual(draw(2));
    expect(draw(1)).toEqual(draw(99));
  });

  it("places teams by standings order, not input order, without the pre-shuffle", () => {
    const teams = Array.from({ length: 4 }, (_, i) => team(`b${i}`));
    const standings = teams.map((t, i) => standing(t.id, 0, i + 1));
    const forward = generatePowerPairedDraw(teams, standings, emptyHistory(), { bpAssignmentMethod: "hungarian_unshuffled" });
    const reversed = generatePowerPairedDraw([...teams].reverse(), standings, emptyHistory(), { bpAssignmentMethod: "hungarian_unshuffled" });
    expect(reversed[0].teamsWithSides).toEqual(forward[0].teamsWithSides);
  });
});

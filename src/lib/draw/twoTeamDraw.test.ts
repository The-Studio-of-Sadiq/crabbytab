import { describe, it, expect } from "vitest";
import { generateRandomTwoTeamDraw, generateTwoTeamDraw, orderBySeed, rankForDraw } from "./twoTeamDraw";
import { MatchupHistory, PairedDebateDraft } from "./powerPaired";
import { createSeededRng } from "./rng";
import {
  ConflictAvoidance,
  OddBracketMethod,
  PairingMethod,
  PullupRestriction,
  Team,
  TeamStandingRow,
  TwoTeamSide,
} from "@/types";

function team(id: string, institutionId?: string, seed?: number): Team {
  return { id, tournamentId: "t", name: id, institutionId, seed, speakers: [], breakCategories: [], speakerCategories: [] };
}

function standing(teamId: string, wins: number, rank: number, pullups = 0): TeamStandingRow {
  return {
    rank,
    teamId,
    teamName: teamId,
    points: wins,
    totalSpeakerScore: 0,
    averageSpeakerScore: 0,
    breakCategories: [],
    roundResults: [],
    metrics: { wins, points: wins, draw_strength_wins: 0, draw_strength_speaks: 0, pullups } as TeamStandingRow["metrics"],
  };
}

/** Standings in the given order, with distinct ranks (1, 2, 3, ...). */
const rankedStandings = (entries: [string, number][]) => entries.map(([id, wins], i) => standing(id, wins, i + 1));

const emptyHistory = (): MatchupHistory => ({ opponents: new Map(), sides: new Map() });
function historyOf(pairs: [string, string][]): MatchupHistory {
  const history = emptyHistory();
  for (const [a, b] of pairs) {
    for (const [x, y] of [[a, b], [b, a]] as const) {
      if (!history.opponents.has(x)) history.opponents.set(x, new Set());
      history.opponents.get(x)!.add(y);
    }
  }
  return history;
}

const rooms = (draw: PairedDebateDraft[]) => draw.map((d) => d.teams.map((t) => t.id).sort().join("v"));
const allIds = (draw: PairedDebateDraft[]) => draw.flatMap((d) => d.teams.map((t) => t.id)).sort();
const met = (draw: PairedDebateDraft[], a: string, b: string) => rooms(draw).includes([a, b].sort().join("v"));

describe("generateTwoTeamDraw: basic correctness", () => {
  it("throws on an odd number of teams", () => {
    expect(() => generateTwoTeamDraw([team("a"), team("b"), team("c")], [], emptyHistory(), "uadc")).toThrow("must be even");
  });

  it("places every team exactly once with default config", () => {
    const teams = Array.from({ length: 12 }, (_, i) => team(`t${i}`));
    const standings = rankedStandings(teams.map((t, i) => [t.id, 3 - Math.floor(i / 3)]));
    const draw = generateTwoTeamDraw(teams, standings, emptyHistory(), "uadc");
    expect(allIds(draw)).toEqual(teams.map((t) => t.id).sort());
    expect(draw.every((d) => d.teams.length === 2 && d.teamsWithSides.AFF && d.teamsWithSides.NEG)).toBe(true);
  });
});

describe("generateTwoTeamDraw: golden draws", () => {
  // 3 teams on 2 wins, 5 on 1 win.
  const teams = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => team(id));
  const standings = rankedStandings([["a", 2], ["b", 2], ["c", 2], ["d", 1], ["e", 1], ["f", 1], ["g", 1], ["h", 1]]);

  it("pullup_top + fold", () => {
    const draw = generateTwoTeamDraw(teams, standings, emptyHistory(), "uadc", {
      oddBracketMethod: "pullup_top",
      pairingMethod: "fold",
      conflictAvoidance: "off",
    });
    expect(rooms(draw)).toEqual(["avd", "bvc", "evh", "fvg"]);
    expect(draw.map((d) => d.bracket)).toEqual([2, 2, 1, 1]);
    expect(draw.map((d) => d.pulledUpTeamIds)).toEqual([["d"], [], [], []]);
  });

  it("pullup_bottom + slide", () => {
    const draw = generateTwoTeamDraw(teams, standings, emptyHistory(), "uadc", {
      oddBracketMethod: "pullup_bottom",
      pairingMethod: "slide",
      conflictAvoidance: "off",
    });
    expect(rooms(draw)).toEqual(["avc", "bvh", "dvf", "evg"]);
    expect(draw[1].pulledUpTeamIds).toEqual(["h"]);
  });

  it("intermediate + adjacent", () => {
    const draw = generateTwoTeamDraw(teams, standings, emptyHistory(), "uadc", {
      oddBracketMethod: "intermediate",
      pairingMethod: "adjacent",
      conflictAvoidance: "off",
    });
    expect(rooms(draw)).toEqual(["avb", "cvd", "evf", "gvh"]);
    expect(draw.map((d) => d.bracket)).toEqual([2, 1.5, 1, 1]);
    expect(draw[1].pulledUpTeamIds).toEqual(["d"]);
  });

  it("intermediate_bubble swaps a clashing intermediate debate up", () => {
    const draw = generateTwoTeamDraw(teams, standings, historyOf([["c", "d"]]), "uadc", {
      oddBracketMethod: "intermediate_bubble",
      pairingMethod: "adjacent",
      conflictAvoidance: "off",
    });
    expect(rooms(draw)).toEqual(["avc", "bvd", "evf", "gvh"]);
    expect(met(draw, "c", "d")).toBe(false);
  });

  it("fold_top_adjacent_rest folds only the top bracket", () => {
    const eight = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => team(id));
    const s = rankedStandings([["a", 1], ["b", 1], ["c", 1], ["d", 1], ["e", 0], ["f", 0], ["g", 0], ["h", 0]]);
    const draw = generateTwoTeamDraw(eight, s, emptyHistory(), "uadc", {
      oddBracketMethod: "pullup_top",
      pairingMethod: "fold_top_adjacent_rest",
      conflictAvoidance: "off",
    });
    expect(rooms(draw)).toEqual(["avd", "bvc", "evf", "gvh"]);
  });

  it("one_up_one_down removes a rematch the pairing method would create", () => {
    const four = ["a", "b", "c", "d"].map((id) => team(id));
    const s = rankedStandings([["a", 0], ["b", 0], ["c", 0], ["d", 0]]);
    const history = historyOf([["a", "b"]]);
    const off = generateTwoTeamDraw(four, s, history, "uadc", { pairingMethod: "adjacent", conflictAvoidance: "off" });
    expect(met(off, "a", "b")).toBe(true);
    const avoided = generateTwoTeamDraw(four, s, history, "uadc", { pairingMethod: "adjacent", conflictAvoidance: "one_up_one_down" });
    expect(met(avoided, "a", "b")).toBe(false);
  });

  it("min_cost avoids rematches across the whole bracket and otherwise follows the pairing method", () => {
    const six = ["a", "b", "c", "d", "e", "f"].map((id) => team(id));
    const s = rankedStandings(six.map((t) => [t.id, 0]));
    const clean = generateTwoTeamDraw(six, s, emptyHistory(), "uadc", { pairingMethod: "fold", conflictAvoidance: "min_cost" });
    expect(rooms(clean)).toEqual(["avf", "bve", "cvd"]);
    // Every fold room is a rematch: one-up-one-down could not fix all three, min_cost can.
    const history = historyOf([["a", "f"], ["b", "e"], ["c", "d"]]);
    const draw = generateTwoTeamDraw(six, s, history, "uadc", { pairingMethod: "fold", conflictAvoidance: "min_cost" });
    expect(["a", "b", "c"].some((x) => ["d", "e", "f"].some((y) => met(draw, x, y) && history.opponents.get(x)?.has(y)))).toBe(false);
  });

  it("pullupRestriction narrows who can be pulled up", () => {
    const s = [
      standing("a", 2, 1), standing("b", 2, 2), standing("c", 2, 3),
      standing("d", 1, 4, 3), standing("e", 1, 5), standing("f", 1, 6), standing("g", 1, 7), standing("h", 1, 8),
    ];
    const draw = generateTwoTeamDraw(teams, s, emptyHistory(), "uadc", {
      oddBracketMethod: "pullup_top",
      pullupRestriction: "least_pulled",
      pairingMethod: "adjacent",
      conflictAvoidance: "off",
    });
    expect(draw.filter((d) => d.bracket === 2).flatMap((d) => d.pulledUpTeamIds)).toEqual(["e"]);
  });

  it("history pull-up counts take precedence over the standings metric for least_pulled", () => {
    const s = rankedStandings([["a", 2], ["b", 2], ["c", 2], ["d", 1], ["e", 1], ["f", 1], ["g", 1], ["h", 1]]);
    const history: MatchupHistory = { ...emptyHistory(), pullups: new Map([["d", 1], ["e", 1]]) };
    const draw = generateTwoTeamDraw(teams, s, history, "uadc", {
      oddBracketMethod: "pullup_top",
      pullupRestriction: "least_pulled",
      conflictAvoidance: "off",
    });
    expect(draw[0].pulledUpTeamIds?.concat(draw[1].pulledUpTeamIds ?? [])).toEqual(["f"]);
  });
});

describe("generateTwoTeamDraw: properties", () => {
  const oddBracketMethods: OddBracketMethod[] = ["pullup_top", "pullup_bottom", "pullup_middle", "pullup_random", "intermediate", "intermediate_bubble"];
  const pairingMethods: PairingMethod[] = ["slide", "fold", "adjacent", "random", "fold_top_adjacent_rest"];
  const conflictAvoidances: ConflictAvoidance[] = ["off", "one_up_one_down", "min_cost"];
  const pullupRestrictions: PullupRestriction[] = ["none", "least_pulled", "lowest_draw_strength_wins"];

  it("every option combination places every team once, records pull-ups correctly, and is reproducible", () => {
    for (const teamCount of [6, 10, 14]) {
      const teams = Array.from({ length: teamCount }, (_, i) => team(`t${i}`, i % 3 === 0 ? "instA" : undefined));
      const winsOf = (i: number) => [2, 2, 1, 1, 1, 0][i % 6];
      const order = [...teams].sort((a, b) => winsOf(Number(b.id.slice(1))) - winsOf(Number(a.id.slice(1))));
      const standings = rankedStandings(order.map((t) => [t.id, winsOf(Number(t.id.slice(1)))]));
      const winMap = new Map(standings.map((s) => [s.teamId, s.metrics.wins]));
      const history = historyOf([["t0", "t1"], ["t2", "t4"]]);

      for (const oddBracketMethod of oddBracketMethods) {
        for (const pairingMethod of pairingMethods) {
          for (const conflictAvoidance of conflictAvoidances) {
            for (const pullupRestriction of pullupRestrictions) {
              const config = { oddBracketMethod, pairingMethod, conflictAvoidance, pullupRestriction };
              const draw = generateTwoTeamDraw(teams, standings, history, "uadc", config, createSeededRng(7));
              expect(allIds(draw)).toEqual(teams.map((t) => t.id).sort());
              for (const debate of draw) {
                const top = Math.max(...debate.teams.map((t) => winMap.get(t.id)!));
                const expected = debate.teams.filter((t) => winMap.get(t.id)! < top).map((t) => t.id);
                expect(debate.pulledUpTeamIds).toEqual(expected);
              }
              const again = generateTwoTeamDraw(teams, standings, history, "uadc", config, createSeededRng(7));
              expect(again.map((d) => `${d.teamsWithSides.AFF.id}-${d.teamsWithSides.NEG.id}`)).toEqual(
                draw.map((d) => `${d.teamsWithSides.AFF.id}-${d.teamsWithSides.NEG.id}`)
              );
            }
          }
        }
      }
    }
  });
});

describe("generateTwoTeamDraw: preallocated sides", () => {
  const teams = ["a1", "a2", "a3", "n1", "n2", "n3"].map((id) => team(id));
  const sides: Record<string, TwoTeamSide> = { a1: "AFF", a2: "AFF", a3: "AFF", n1: "NEG", n2: "NEG", n3: "NEG" };
  const standings = rankedStandings([["a1", 2], ["a2", 2], ["n1", 2], ["a3", 1], ["n2", 1], ["n3", 1]]);

  for (const oddBracketMethod of ["pullup_top", "pullup_bottom", "pullup_random", "intermediate1", "intermediate2"] as OddBracketMethod[]) {
    for (const conflictAvoidance of ["off", "one_up_one_down", "min_cost"] as ConflictAvoidance[]) {
      it(`${oddBracketMethod} / ${conflictAvoidance}: every team debates on its allocated side`, () => {
        const draw = generateTwoTeamDraw(teams, standings, historyOf([["a1", "n1"]]), "uadc", {
          sideRule: "preallocated",
          preallocatedSides: sides,
          oddBracketMethod,
          conflictAvoidance,
        }, createSeededRng(1));
        expect(allIds(draw)).toEqual(teams.map((t) => t.id).sort());
        expect(draw.every((d) => sides[d.teamsWithSides.AFF.id] === "AFF" && sides[d.teamsWithSides.NEG.id] === "NEG")).toBe(true);
      });
    }
  }

  it("pullup_top pulls the top negative team up to the affirmative surplus", () => {
    const draw = generateTwoTeamDraw(teams, standings, emptyHistory(), "uadc", {
      sideRule: "preallocated",
      preallocatedSides: sides,
      oddBracketMethod: "pullup_top",
      pairingMethod: "slide",
      conflictAvoidance: "off",
    });
    expect(rooms(draw)).toEqual(["a1vn1", "a2vn2", "a3vn3"]);
    expect(draw[1].pulledUpTeamIds).toEqual(["n2"]);
  });

  it("rejects missing or unbalanced allocations and unsupported odd bracket methods", () => {
    expect(() => generateTwoTeamDraw(teams, standings, emptyHistory(), "uadc", {
      sideRule: "preallocated",
      preallocatedSides: { ...sides, n3: undefined as unknown as TwoTeamSide },
    })).toThrow(/no side for this round: n3/);
    expect(() => generateTwoTeamDraw(teams, standings, emptyHistory(), "uadc", {
      sideRule: "preallocated",
      preallocatedSides: { ...sides, n3: "AFF" },
    })).toThrow(/4 affirmative and 2 negative/);
    expect(() => generateTwoTeamDraw(teams, standings, emptyHistory(), "uadc", {
      sideRule: "preallocated",
      preallocatedSides: sides,
      oddBracketMethod: "intermediate_bubble",
    })).toThrow(/not available with preallocated sides/);
  });
});

describe("rankForDraw", () => {
  it("keeps standings order but shuffles teams that share a rank", () => {
    const teams = ["a", "b", "c", "d"].map((id) => team(id));
    const s = [standing("a", 1, 1), standing("b", 1, 2), standing("c", 0, 3), standing("d", 0, 3)];
    const orders = new Set(Array.from({ length: 20 }, (_, seed) => rankForDraw(teams, s, createSeededRng(seed)).map((t) => t.id).join("")));
    expect([...orders].sort()).toEqual(["abcd", "abdc"]);
  });
});

describe("seeded draws", () => {
  it("orders by seed, highest first, and requires every seed", () => {
    const teams = [team("a", undefined, 1), team("b", undefined, 4), team("c", undefined, 3), team("d", undefined, 2)];
    expect(orderBySeed(teams, createSeededRng(1)).map((t) => t.id)).toEqual(["b", "c", "d", "a"]);
    expect(() => orderBySeed([...teams, team("e")], createSeededRng(1))).toThrow(/needs a seed.*e/);
  });

  it("pairs the seeded order with the configured pairing method", () => {
    const teams = [team("a", undefined, 1), team("b", undefined, 4), team("c", undefined, 3), team("d", undefined, 2)];
    const draw = generateTwoTeamDraw(teams, [], emptyHistory(), "uadc", { pairingMethod: "fold", conflictAvoidance: "off" }, createSeededRng(1), orderBySeed(teams, createSeededRng(1)));
    expect(rooms(draw)).toEqual(["avb", "cvd"]);
    expect(draw.every((d) => d.pulledUpTeamIds!.length === 0)).toBe(true);
  });
});

describe("generateRandomTwoTeamDraw", () => {
  const teams = Array.from({ length: 10 }, (_, i) => team(`t${i}`, i < 4 ? "same" : undefined));

  it("avoids rematches and institution clashes when it can", () => {
    const history = historyOf([["t4", "t5"], ["t6", "t7"], ["t8", "t9"], ["t4", "t6"]]);
    for (let seed = 0; seed < 20; seed++) {
      const draw = generateRandomTwoTeamDraw(teams, history, "uadc", {}, createSeededRng(seed));
      expect(allIds(draw)).toEqual(teams.map((t) => t.id).sort());
      for (const d of draw) {
        const [x, y] = d.teams;
        expect(history.opponents.get(x.id)?.has(y.id) ?? false).toBe(false);
        expect(x.institutionId !== undefined && x.institutionId === y.institutionId).toBe(false);
      }
    }
  });

  it("is reproducible for a seed and varies between seeds", () => {
    const run = (seed: number) => rooms(generateRandomTwoTeamDraw(teams, emptyHistory(), "uadc", {}, createSeededRng(seed))).join();
    expect(run(5)).toBe(run(5));
    expect(new Set(Array.from({ length: 10 }, (_, seed) => run(seed))).size).toBeGreaterThan(1);
  });

  it("matches affirmative to negative teams with preallocated sides", () => {
    const sides = Object.fromEntries(teams.map((t, i) => [t.id, i % 2 === 0 ? "AFF" : "NEG"])) as Record<string, TwoTeamSide>;
    const draw = generateRandomTwoTeamDraw(teams, emptyHistory(), "uadc", { sideRule: "preallocated", preallocatedSides: sides }, createSeededRng(2));
    expect(draw.every((d) => sides[d.teamsWithSides.AFF.id] === "AFF" && sides[d.teamsWithSides.NEG.id] === "NEG")).toBe(true);
  });
});

describe("two-team draws at 1000 teams", () => {
  // Regression: one 1000-team bracket (round 1, or a random draw) gave the
  // matching ~500k edges, spread into Math.max, which overflowed the call stack from ~500 teams.
  const teams = Array.from({ length: 1000 }, (_, i) => team(`t${i}`, `inst${i % 120}`));

  it("power-pairs a single 1000-team bracket by min-cost matching, deterministically per seed", () => {
    const standings = rankedStandings(teams.map((t) => [t.id, 0]));
    const run = () =>
      generateTwoTeamDraw(teams, standings, emptyHistory(), "uadc", { conflictAvoidance: "min_cost" }, createSeededRng(42));
    const draw = run();
    expect(draw).toHaveLength(500);
    expect(allIds(draw)).toEqual(teams.map((t) => t.id).sort());
    expect(rooms(run())).toEqual(rooms(draw));
  }, 120_000);

  it("draws a 1000-team random round", () => {
    const draw = generateRandomTwoTeamDraw(teams, emptyHistory(), "uadc", {}, createSeededRng(7));
    expect(draw).toHaveLength(500);
    expect(allIds(draw)).toEqual(teams.map((t) => t.id).sort());
  }, 120_000);
});

import { describe, it, expect } from "vitest";
import {
  RankedTeamStats,
  SidedBracket,
  WinBracket,
  applyPullupRestriction,
  resolveOddBrackets,
  resolveOddBracketsWithSides,
} from "./oddBrackets";
import { OddBracketMethod, PullupRestriction, Team } from "@/types";
import { createSeededRng } from "./rng";

function stats(id: string, opts: Partial<Omit<RankedTeamStats, "team">> = {}): RankedTeamStats {
  return {
    team: { id, tournamentId: "t", name: id, speakers: [], breakCategories: [], speakerCategories: [] } as Team,
    pullups: 0,
    drawStrengthWins: 0,
    drawStrengthSpeaks: 0,
    ...opts,
  };
}

const ids = (teams: Team[]) => teams.map((t) => t.id);
const summary = (groups: { bracket: number; teams: Team[] }[]) =>
  groups.map((g) => `${g.bracket}:${ids(g.teams).join(",")}`);

describe("applyPullupRestriction", () => {
  const candidates = [
    stats("a", { pullups: 2, drawStrengthWins: 5 }),
    stats("b", { pullups: 0, drawStrengthWins: 1 }),
    stats("c", { pullups: 0, drawStrengthWins: 3 }),
  ];

  it("none: returns everything unchanged", () => {
    expect(applyPullupRestriction(candidates, "none").map((c) => c.team.id)).toEqual(["a", "b", "c"]);
  });

  it("least_pulled: keeps only the minimum pullup count", () => {
    expect(applyPullupRestriction(candidates, "least_pulled").map((c) => c.team.id)).toEqual(["b", "c"]);
  });

  it("lowest_draw_strength_wins: keeps only the minimum", () => {
    expect(applyPullupRestriction(candidates, "lowest_draw_strength_wins").map((c) => c.team.id)).toEqual(["b"]);
  });
});

describe("resolveOddBrackets: pull-up methods (golden)", () => {
  // 3 teams on 3 wins (odd), 5 on 2 wins: 8 in total.
  const bracketsFor = (): WinBracket[] => [
    { wins: 3, teams: [stats("A1"), stats("A2"), stats("A3")] },
    {
      wins: 2,
      teams: [
        stats("B1", { pullups: 1 }),
        stats("B2", { pullups: 0 }),
        stats("B3", { pullups: 0 }),
        stats("B4", { pullups: 2 }),
        stats("B5", { pullups: 3 }),
      ],
    },
  ];

  const cases: [OddBracketMethod, string][] = [
    ["pullup_top", "B1"],
    ["pullup_bottom", "B5"],
    ["pullup_middle", "B3"], // 5 eligible: the exact middle (index 2)
  ];
  for (const [method, expectedPick] of cases) {
    it(`${method} pulls up ${expectedPick} and appends it to the bracket`, () => {
      const groups = resolveOddBrackets(bracketsFor(), method, "none");
      expect(summary(groups)[0]).toBe(`3:A1,A2,A3,${expectedPick}`);
      expect(groups[0].pulledUp).toEqual([expectedPick]);
      expect(groups[1].teams).toHaveLength(4);
    });
  }

  it("pullup_middle picks one of the two middle teams of an even candidate list", () => {
    const picks = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const brackets: WinBracket[] = [
        { wins: 2, teams: [stats("A1"), stats("A2"), stats("A3")] },
        { wins: 1, teams: [stats("B1"), stats("B2"), stats("B3"), stats("B4")] },
        { wins: 0, teams: [stats("C1")] },
      ];
      picks.add(resolveOddBrackets(brackets, "pullup_middle", "none", createSeededRng(seed))[0].pulledUp[0]);
    }
    expect([...picks].sort()).toEqual(["B2", "B3"]);
  });

  it("pullup_random is reproducible for a seed and covers every candidate across seeds", () => {
    const pickFor = (seed: number) => resolveOddBrackets(bracketsFor(), "pullup_random", "none", createSeededRng(seed))[0].pulledUp[0];
    expect(pickFor(7)).toBe(pickFor(7));
    const picks = new Set(Array.from({ length: 60 }, (_, seed) => pickFor(seed)));
    expect([...picks].sort()).toEqual(["B1", "B2", "B3", "B4", "B5"]);
  });

  it("pullup_top with least_pulled takes the top team among the least-pulled", () => {
    const groups = resolveOddBrackets(bracketsFor(), "pullup_top", "least_pulled");
    expect(summary(groups)[0]).toBe("3:A1,A2,A3,B2");
  });

  it("cascades: a bracket emptied or made odd by a pull-up is resolved in turn", () => {
    const brackets: WinBracket[] = [
      { wins: 2, teams: [stats("A1")] },
      { wins: 1, teams: [stats("B1")] },
      { wins: 0, teams: [stats("C1"), stats("C2")] },
    ];
    expect(summary(resolveOddBrackets(brackets, "pullup_top", "none"))).toEqual(["2:A1,B1", "0:C1,C2"]);
    const brackets2: WinBracket[] = [
      { wins: 2, teams: [stats("A1")] },
      { wins: 1, teams: [stats("B1"), stats("B2")] },
      { wins: 0, teams: [stats("C1"), stats("C2"), stats("C3")] },
    ];
    expect(summary(resolveOddBrackets(brackets2, "pullup_top", "none"))).toEqual(["2:A1,B1", "1:B2,C1", "0:C2,C3"]);
  });

  it("throws when the bottom bracket is odd with nothing below (odd field)", () => {
    const brackets: WinBracket[] = [{ wins: 1, teams: [stats("X1"), stats("X2"), stats("X3")] }];
    expect(() => resolveOddBrackets(brackets, "pullup_top", "none")).toThrow(/no bracket below/);
    expect(() => resolveOddBrackets(brackets, "intermediate", "none")).toThrow(/no bracket below/);
  });

  it("intermediate1/2 require preallocated sides", () => {
    expect(() => resolveOddBrackets([], "intermediate1", "none")).toThrow(/preallocated sides/);
    expect(() => resolveOddBrackets([], "intermediate2", "none")).toThrow(/preallocated sides/);
  });
});

describe("resolveOddBrackets: intermediate brackets (golden)", () => {
  const brackets = (): WinBracket[] => [
    { wins: 3, teams: [stats("A1"), stats("A2"), stats("A3")] },
    { wins: 2, teams: [stats("B1"), stats("B2"), stats("B3"), stats("B4"), stats("B5")] },
  ];

  it("bottom of the odd bracket meets the top of the next, half a bracket below", () => {
    expect(summary(resolveOddBrackets(brackets(), "intermediate", "least_pulled"))).toEqual([
      "3:A1,A2",
      "2.5:A3,B1",
      "2:B2,B3,B4,B5",
    ]);
  });

  it("chains: taking the top of a bracket can make it odd, creating the next intermediate bracket", () => {
    const chained: WinBracket[] = [
      { wins: 2, teams: [stats("A1")] },
      { wins: 1, teams: [stats("B1"), stats("B2")] },
      { wins: 0, teams: [stats("C1"), stats("C2"), stats("C3")] },
    ];
    expect(summary(resolveOddBrackets(chained, "intermediate", "none"))).toEqual([
      "1.5:A1,B1",
      "0.5:B2,C1",
      "0:C2,C3",
    ]);
  });

  it("intermediate_bubble: bubbles up when the intermediate pair conflicts", () => {
    const conflict = (a: Team, b: Team) => [a.id, b.id].sort().join() === "A3,B1";
    expect(summary(resolveOddBrackets(brackets(), "intermediate_bubble", "none", Math.random, conflict))).toEqual([
      "3:A1,A3",
      "2.5:A2,B1",
      "2:B2,B3,B4,B5",
    ]);
  });

  it("intermediate_bubble: bubbles down when bubbling up would still conflict", () => {
    const pairs = new Set(["A3,B1", "A2,B1"]);
    const conflict = (a: Team, b: Team) => pairs.has([a.id, b.id].sort().join());
    expect(summary(resolveOddBrackets(brackets(), "intermediate_bubble", "none", Math.random, conflict))).toEqual([
      "3:A1,A2",
      "2.5:A3,B2",
      "2:B1,B3,B4,B5",
    ]);
  });

  it("intermediate_bubble: leaves the conflict when neither swap is clean", () => {
    const conflict = () => true;
    expect(summary(resolveOddBrackets(brackets(), "intermediate_bubble", "none", Math.random, conflict))).toEqual([
      "3:A1,A2",
      "2.5:A3,B1",
      "2:B2,B3,B4,B5",
    ]);
  });

  it("intermediate (without bubble) ignores conflicts", () => {
    const conflict = () => true;
    expect(summary(resolveOddBrackets(brackets(), "intermediate", "none", Math.random, conflict))[1]).toBe("2.5:A3,B1");
  });
});

describe("resolveOddBrackets: property tests (every team exactly once, even groups)", () => {
  const methods: OddBracketMethod[] = [
    "pullup_top",
    "pullup_bottom",
    "pullup_middle",
    "pullup_random",
    "intermediate",
    "intermediate_bubble",
  ];
  const restrictions: PullupRestriction[] = ["none", "least_pulled", "lowest_draw_strength_speaks", "lowest_draw_strength_wins"];

  for (const method of methods) {
    for (const restriction of restrictions) {
      it(`${method} / ${restriction}`, () => {
        const rng = createSeededRng(method.length * 31 + restriction.length);
        for (let iter = 0; iter < 300; iter++) {
          const numBrackets = 1 + Math.floor(rng() * 5);
          const sizes = Array.from({ length: numBrackets }, () => 1 + Math.floor(rng() * 5));
          if (sizes.reduce((a, b) => a + b, 0) % 2 !== 0) sizes[sizes.length - 1] += 1;
          let counter = 0;
          const brackets: WinBracket[] = sizes.map((size, i) => ({
            wins: numBrackets - i,
            teams: Array.from({ length: size }, () =>
              stats(`t${counter++}`, {
                pullups: Math.floor(rng() * 3),
                drawStrengthWins: Math.floor(rng() * 5),
                drawStrengthSpeaks: Math.floor(rng() * 500),
              })
            ),
          }));
          const expected = brackets.flatMap((b) => b.teams.map((t) => t.team.id)).sort();
          const conflict = (a: Team, b: Team) => (Number(a.id.slice(1)) + Number(b.id.slice(1))) % 3 === 0;
          const groups = resolveOddBrackets(brackets, method, restriction, rng, conflict);
          expect(groups.flatMap((g) => ids(g.teams)).sort()).toEqual(expected);
          expect(groups.every((g) => g.teams.length > 0 && g.teams.length % 2 === 0)).toBe(true);
          // Brackets are listed highest first.
          expect(groups.map((g) => g.bracket)).toEqual([...groups.map((g) => g.bracket)].sort((a, b) => b - a));
        }
      });
    }
  }
});

describe("resolveOddBracketsWithSides (preallocated sides)", () => {
  const sided = (wins: number, aff: string[], neg: string[]): SidedBracket => ({
    wins,
    aff: aff.map((id) => stats(id)),
    neg: neg.map((id) => stats(id)),
  });
  const show = (groups: { bracket: number; aff: Team[]; neg: Team[] }[]) =>
    groups.map((g) => `${g.bracket}:${ids(g.aff).join(",")}/${ids(g.neg).join(",")}`);

  // 3 wins: 3 aff + 1 neg (2 surplus aff); 2 wins: 1 aff + 1 neg; 1 wins: 0 aff + 2 neg.
  const field = () => [
    sided(3, ["A1", "A2", "A3"], ["N1"]),
    sided(2, ["A4"], ["N2"]),
    sided(1, [], ["N3", "N4"]),
  ];

  it("pullup_top pulls negative teams from as many brackets as needed", () => {
    expect(show(resolveOddBracketsWithSides(field(), "pullup_top", "none"))).toEqual([
      "3:A1,A2,A3/N1,N2,N3",
      "2:A4/N4",
    ]);
  });

  it("intermediate1: one intermediate bracket filled from below", () => {
    expect(show(resolveOddBracketsWithSides(field(), "intermediate1", "none"))).toEqual([
      "3:A1/N1",
      "2.5:A2,A3/N2,N3",
      // Bracket 2's lone affirmative has no negative left in its own bracket, so it
      // starts its own intermediate bracket (Tabbycat behaviour).
      "1.5:A4/N4",
    ]);
  });

  it("intermediate2: a separate intermediate bracket per contributing bracket", () => {
    const groups = resolveOddBracketsWithSides(field(), "intermediate2", "none");
    expect(show(groups)).toEqual([
      "3:A1/N1",
      `${3 - 1 / 3}:A2/N2`,
      `${3 - 2 / 3}:A3/N3`,
      "1.5:A4/N4",
    ]);
  });

  it("rejects methods Tabbycat does not support with allocated sides", () => {
    expect(() => resolveOddBracketsWithSides(field(), "intermediate_bubble", "none")).toThrow(/not available/);
    expect(() => resolveOddBracketsWithSides(field(), "pullup_middle", "none")).toThrow(/not available/);
  });

  it("fails clearly when the sides cannot balance", () => {
    expect(() => resolveOddBracketsWithSides([sided(1, ["A1", "A2"], [])], "pullup_top", "none")).toThrow(
      /not enough teams allocated/
    );
    expect(() => resolveOddBracketsWithSides([sided(1, ["A1", "A2"], [])], "intermediate1", "none")).toThrow(
      /unfilled intermediate/
    );
  });

  it("property: every method keeps every team once with balanced sides", () => {
    const rng = createSeededRng(99);
    for (const method of ["pullup_top", "pullup_bottom", "pullup_random", "intermediate1", "intermediate2"] as OddBracketMethod[]) {
      for (let iter = 0; iter < 200; iter++) {
        const n = 2 * (1 + Math.floor(rng() * 8));
        const sides = Array.from({ length: n }, (_, i) => (i < n / 2 ? "aff" : "neg"));
        const shuffledSides = sides.sort(() => rng() - 0.5);
        const wins = Array.from({ length: n }, () => Math.floor(rng() * 4));
        const brackets: SidedBracket[] = [3, 2, 1, 0].map((w) => ({
          wins: w,
          aff: wins.flatMap((x, i) => (x === w && shuffledSides[i] === "aff" ? [stats(`t${i}`)] : [])),
          neg: wins.flatMap((x, i) => (x === w && shuffledSides[i] === "neg" ? [stats(`t${i}`)] : [])),
        }));
        const groups = resolveOddBracketsWithSides(brackets, method, "none", rng);
        const all = groups.flatMap((g) => [...ids(g.aff), ...ids(g.neg)]).sort();
        expect(all).toEqual(Array.from({ length: n }, (_, i) => `t${i}`).sort());
        expect(groups.every((g) => g.aff.length === g.neg.length && g.aff.length > 0)).toBe(true);
        const affIds = new Set(groups.flatMap((g) => ids(g.aff)));
        expect([...affIds].every((id) => shuffledSides[Number(id.slice(1))] === "aff")).toBe(true);
      }
    }
  });
});

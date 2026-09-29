import { describe, it, expect } from "vitest";
import { RankedTeamStats, WinBracket, applyPullupRestriction, resolveOddBrackets } from "./oddBrackets";
import { OddBracketMethod, PullupRestriction, Team } from "@/types";

function stats(id: string, opts: Partial<Omit<RankedTeamStats, "team">> = {}): RankedTeamStats {
  return {
    team: { id, tournamentId: "t", name: id, speakers: [], breakCategories: [], speakerCategories: [] } as Team,
    pullups: 0,
    drawStrengthWins: 0,
    drawStrengthSpeaks: 0,
    ...opts,
  };
}

const names = (groups: { bracket: number; teams: Team[] }[]) =>
  groups.map((g) => `${g.bracket}:${g.teams.map((t) => t.id).join(",")}`).join(" | ");

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

describe("resolveOddBrackets: exact selection per method", () => {
  // Bracket of 3 wins has 3 teams (odd); bracket of 2 wins has 5 teams below it
  // (5, not 4, so the total is even -- 3 + 5 = 8 -- matching a real tournament).
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
    ["pullup_middle", "B3"], // index floor((5-1)/2) = 2 -> B3
  ];
  for (const [method, expectedPick] of cases) {
    it(`${method} pulls up ${expectedPick} (no restriction)`, () => {
      const groups = resolveOddBrackets(bracketsFor(), method, "none");
      const top = groups.find((g) => g.bracket === 3)!;
      expect(top.teams.map((t) => t.id)).toEqual(["A1", "A2", "A3", expectedPick]);
      expect(top.pulledUp).toEqual([expectedPick]);
      const bottom = groups.find((g) => g.bracket === 2)!;
      expect(bottom.teams).toHaveLength(4); // one of 5 pulled out, evenly resolved on its own
    });
  }

  it("pullup_top composed with least_pulled restriction picks the least-pulled team's top position", () => {
    const groups = resolveOddBrackets(bracketsFor(), "pullup_top", "least_pulled");
    // B2 and B3 both have 0 pullups (the minimum); "top" of that filtered pair is B2.
    const top = groups.find((g) => g.bracket === 3)!;
    expect(top.teams.map((t) => t.id)).toEqual(["A1", "A2", "A3", "B2"]);
  });

  it("intermediate: leftover pairs with the top team of the bracket below, at bracket - 0.5", () => {
    const groups = resolveOddBrackets(bracketsFor(), "intermediate", "none");
    // A1, A2 form a normal room at bracket 3; the leftover (A3) is not in this group.
    const top = groups.find((g) => g.bracket === 3)!;
    expect(top.teams.map((t) => t.id)).toEqual(["A1", "A2"]);
    const bubble = groups.find((g) => g.bracket === 2.5)!;
    expect(bubble.teams.map((t) => t.id)).toEqual(["A3", "B1"]);
  });

  it("intermediate_bubble uses the restriction to choose who joins the bubble room", () => {
    const groups = resolveOddBrackets(bracketsFor(), "intermediate_bubble", "least_pulled");
    const bubble = groups.find((g) => g.bracket === 2.5)!;
    expect(bubble.teams.map((t) => t.id)).toEqual(["A3", "B2"]); // B2/B3 tie on 0 pullups, "top" of that pair is B2
  });

  it("throws for pullup_* when the bottom bracket is itself odd with nothing below", () => {
    const brackets: WinBracket[] = [{ wins: 1, teams: [stats("X1"), stats("X2"), stats("X3")] }];
    expect(() => resolveOddBrackets(brackets, "pullup_top", "none")).toThrow(/no bracket below/);
  });

  it("intermediate does not throw with nothing below: the leftover plays alone", () => {
    const brackets: WinBracket[] = [{ wins: 1, teams: [stats("X1"), stats("X2"), stats("X3")] }];
    const groups = resolveOddBrackets(brackets, "intermediate", "none");
    const solo = groups.find((g) => g.teams.length === 1)!;
    expect(solo.teams[0].id).toBe("X3");
  });
});

describe("resolveOddBrackets: cascading pull-ups never lose or duplicate a team", () => {
  const methods: OddBracketMethod[] = [
    "pullup_top",
    "pullup_bottom",
    "pullup_middle",
    "pullup_random",
    "intermediate",
    "intermediate_bubble",
  ];
  const restrictions: PullupRestriction[] = [
    "none",
    "least_pulled",
    "lowest_draw_strength_speaks",
    "lowest_draw_strength_wins",
  ];

  for (const method of methods) {
    for (const restriction of restrictions) {
      it(`${method} / ${restriction}: 300 random bracket shapes, every team exactly once, every group evenly sized`, () => {
        let bad = 0;
        for (let iter = 0; iter < 300; iter++) {
          const numBrackets = 2 + Math.floor(Math.random() * 4);
          const sizes = Array.from({ length: numBrackets }, () => Math.floor(Math.random() * 5));
          const total = sizes.reduce((a, b) => a + b, 0);
          if (total === 0) continue;
          if (total % 2 !== 0) sizes[sizes.length - 1] += 1; // guarantee an even total

          let counter = 0;
          const brackets: WinBracket[] = sizes.map((size, i) => ({
            wins: numBrackets - i,
            teams: Array.from({ length: size }, () =>
              stats(`t${counter++}`, {
                pullups: Math.floor(Math.random() * 3),
                drawStrengthWins: Math.floor(Math.random() * 5),
                drawStrengthSpeaks: Math.floor(Math.random() * 500),
              })
            ),
          }));

          const expectedIds = brackets.flatMap((b) => b.teams.map((t) => t.team.id)).sort();

          try {
            const groups = resolveOddBrackets(brackets, method, restriction);
            const gotIds = groups.flatMap((g) => g.teams.map((t) => t.id)).sort();
            // Every group must be splittable into rooms of 2 by pairTeams -- i.e. even --
            // except a genuine solo "bye" leftover, which only intermediate* methods produce.
            const sizesOk = groups.every(
              (g) =>
                g.teams.length > 0 &&
                (g.teams.length % 2 === 0 ||
                  (g.teams.length === 1 && (method === "intermediate" || method === "intermediate_bubble")))
            );
            if (gotIds.join() !== expectedIds.join() || !sizesOk) bad++;
          } catch {
            // pullup_* with nothing below the bottom-most odd bracket is a
            // legitimate, documented failure mode; only count unexpected throws.
            const bottomOdd = brackets[brackets.length - 1].teams.length % 2 !== 0;
            const isPullupMethod = method.startsWith("pullup_");
            if (!(bottomOdd && isPullupMethod)) bad++;
          }
        }
        expect(bad).toBe(0);
      });
    }
  }
});

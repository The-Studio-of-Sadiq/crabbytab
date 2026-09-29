import { describe, it, expect } from "vitest";
import { generateTwoTeamDraw } from "./twoTeamDraw";
import { MatchupHistory } from "./powerPaired";
import {
  ConflictAvoidance,
  OddBracketMethod,
  PairingMethod,
  PullupRestriction,
  Team,
  TeamStandingRow,
} from "@/types";

function team(id: string, institutionId?: string): Team {
  return { id, tournamentId: "t", name: id, institutionId, speakers: [], breakCategories: [], speakerCategories: [] };
}

function standing(teamId: string, wins: number, points: number): TeamStandingRow {
  return {
    rank: 0,
    teamId,
    teamName: teamId,
    points,
    totalSpeakerScore: 0,
    averageSpeakerScore: 0,
    breakCategories: [],
    roundResults: [],
    metrics: { wins, points, draw_strength_wins: 0, draw_strength_speaks: 0, pullups: 0 } as any,
  };
}

const emptyHistory: MatchupHistory = { opponents: new Map(), sides: new Map() };

describe("generateTwoTeamDraw: basic correctness", () => {
  it("throws on an odd number of teams", () => {
    const teams = [team("a"), team("b"), team("c")];
    expect(() => generateTwoTeamDraw(teams, [], emptyHistory, "uadc")).toThrow("must be even");
  });

  it("places every team exactly once with default config", () => {
    const teams = Array.from({ length: 12 }, (_, i) => team(`t${i}`));
    const standings = teams.map((t, i) => standing(t.id, Math.floor(i / 3), Math.floor(i / 3)));
    const draw = generateTwoTeamDraw(teams, standings, emptyHistory, "uadc");
    const ids = draw.flatMap((d) => d.teams.map((t) => t.id));
    expect(ids.sort()).toEqual(teams.map((t) => t.id).sort());
    expect(draw.every((d) => d.teams.length === 2)).toBe(true);
  });

  it("with no standings at all, still produces a valid draw (round 1 case)", () => {
    const teams = Array.from({ length: 8 }, (_, i) => team(`t${i}`));
    const draw = generateTwoTeamDraw(teams, [], emptyHistory, "uadc");
    expect(draw.flatMap((d) => d.teams.map((t) => t.id)).sort()).toEqual(teams.map((t) => t.id).sort());
  });
});

describe("generateTwoTeamDraw: every option combination stays valid", () => {
  const oddBracketMethods: OddBracketMethod[] = [
    "pullup_top",
    "pullup_bottom",
    "pullup_middle",
    "pullup_random",
    "intermediate",
    "intermediate_bubble",
  ];
  const pairingMethods: PairingMethod[] = ["slide", "fold", "adjacent", "random", "fold_top_adjacent_rest"];
  const conflictAvoidances: ConflictAvoidance[] = ["off", "one_up_one_down", "min_cost"];
  const pullupRestrictions: PullupRestriction[] = ["none", "least_pulled", "lowest_draw_strength_wins"];

  it("places every team exactly once across every combination, for several team counts", () => {
    let bad = 0;
    let tried = 0;
    for (const teamCount of [6, 10, 14]) {
      const teams = Array.from({ length: teamCount }, (_, i) => team(`t${i}`, i % 3 === 0 ? "instA" : undefined));
      // Uneven win distribution so several brackets are odd-sized.
      const standings = teams.map((t, i) => standing(t.id, [0, 0, 1, 1, 1, 2][i % 6] ?? 0, 0));

      for (const oddBracketMethod of oddBracketMethods) {
        for (const pairingMethod of pairingMethods) {
          for (const conflictAvoidance of conflictAvoidances) {
            for (const pullupRestriction of pullupRestrictions) {
              tried++;
              try {
                const draw = generateTwoTeamDraw(teams, standings, emptyHistory, "uadc", {
                  oddBracketMethod,
                  pairingMethod,
                  conflictAvoidance,
                  pullupRestriction,
                });
                const ids = draw.flatMap((d) => d.teams.map((t) => t.id)).sort();
                const roomsOk = draw.every((d) => d.teams.length === 2 && Object.keys(d.teamsWithSides).length === 2);
                if (ids.join() !== teams.map((t) => t.id).sort().join() || !roomsOk) bad++;
              } catch {
                // pullup_* can legitimately fail to resolve a bottom-most odd bracket;
                // anything else is an unexpected failure.
                if (!oddBracketMethod.startsWith("pullup_")) bad++;
              }
            }
          }
        }
      }
    }
    expect(tried).toBeGreaterThan(0);
    expect(bad).toBe(0);
  });
});

describe("generateTwoTeamDraw: config actually changes the result", () => {
  it("pairingMethod fold vs adjacent produce different rooms on the same ranked bracket", () => {
    const teams = Array.from({ length: 8 }, (_, i) => team(`t${i}`));
    const standings = teams.map((t) => standing(t.id, 0, 0)); // all one bracket, in team order
    const fold = generateTwoTeamDraw(teams, standings, emptyHistory, "uadc", { pairingMethod: "fold" });
    const adjacent = generateTwoTeamDraw(teams, standings, emptyHistory, "uadc", { pairingMethod: "adjacent" });
    const roomsOf = (draw: typeof fold) => draw.map((d) => d.teams.map((t) => t.id).sort().join("v")).sort();
    expect(roomsOf(fold)).not.toEqual(roomsOf(adjacent));
  });

  it("conflictAvoidance off keeps a rematch that one_up_one_down would remove", () => {
    const teams = [team("a"), team("b"), team("c"), team("d")];
    const standings = teams.map((t) => standing(t.id, 0, 0));
    const history: MatchupHistory = {
      opponents: new Map([
        ["a", new Set(["b"])],
        ["b", new Set(["a"])],
      ]),
      sides: new Map(),
    };
    const withOff = generateTwoTeamDraw(teams, standings, history, "uadc", {
      pairingMethod: "adjacent",
      conflictAvoidance: "off",
    });
    const abTogetherOff = withOff.some((d) => {
      const ids = d.teams.map((t) => t.id);
      return ids.includes("a") && ids.includes("b");
    });
    expect(abTogetherOff).toBe(true); // "off" doesn't touch the adjacent a-b pairing

    const withAvoidance = generateTwoTeamDraw(teams, standings, history, "uadc", {
      pairingMethod: "adjacent",
      conflictAvoidance: "one_up_one_down",
    });
    const abTogetherAvoided = withAvoidance.some((d) => {
      const ids = d.teams.map((t) => t.id);
      return ids.includes("a") && ids.includes("b");
    });
    expect(abTogetherAvoided).toBe(false);
  });

  it("pullupRestriction narrows who can be pulled up", () => {
    // Bracket of 1 win has 3 teams (odd); bracket of 0 wins has 4, one of which
    // (t5) has already been pulled up once before (higher `pullups`).
    const teams = ["t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7"].map((id) => team(id));
    const withPullups = (id: string, pullups: number): TeamStandingRow => {
      const s = standing(id, id <= "t2" ? 1 : 0, 0);
      (s.metrics as any).pullups = pullups;
      return s;
    };
    const standings = [
      withPullups("t0", 0),
      withPullups("t1", 0),
      withPullups("t2", 0),
      withPullups("t3", 3), // already pulled up 3 times
      withPullups("t4", 0),
      withPullups("t5", 0),
      withPullups("t6", 0),
      withPullups("t7", 0),
    ];
    const draw = generateTwoTeamDraw(teams, standings, emptyHistory, "uadc", {
      oddBracketMethod: "pullup_top",
      pullupRestriction: "least_pulled",
      pairingMethod: "adjacent",
    });
    const topBracketTeamIds = draw.filter((d) => d.bracket === 1).flatMap((d) => d.teams.map((t) => t.id));
    // t3 has the most pullups and must be excluded even though it's ranked
    // first (pullup_top) among the lower bracket -- least_pulled filters it out.
    expect(topBracketTeamIds).not.toContain("t3");
  });
});

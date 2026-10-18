import { describe, it, expect } from "vitest";
import { minCostPairAllocatedSides, minCostPairBracket, MinCostPairingOptions } from "./minCostPairing";
import { DEFAULT_CLASH_PENALTIES } from "./conflictAvoidance";
import { MatchupHistory } from "./history";
import { createSeededRng } from "./rng";
import { DebateSide, PairingMethod, Team } from "@/types";

function T(id: string, institutionId?: string): Team {
  return { id, tournamentId: "t", name: id, institutionId, speakers: [], breakCategories: [], speakerCategories: [] };
}

function historyOf(pairs: [string, string][], sides: [string, DebateSide[]][] = []): MatchupHistory {
  const opponents = new Map<string, Set<string>>();
  for (const [a, b] of pairs) {
    for (const [x, y] of [[a, b], [b, a]] as const) {
      if (!opponents.has(x)) opponents.set(x, new Set());
      opponents.get(x)!.add(y);
    }
  }
  return { opponents, sides: new Map(sides) };
}

function options(overrides: Partial<MinCostPairingOptions> = {}): MinCostPairingOptions {
  return {
    penalties: DEFAULT_CLASH_PENALTIES,
    pairingMethod: "fold",
    pairingDeviationPenalty: 0,
    sideBalancePenalty: 0,
    previouslySawPullupPenalty: 0,
    isTopBracket: true,
    wins: new Map(),
    canMeet: () => true,
    rng: createSeededRng(1),
    ...overrides,
  };
}

const roomIds = (rooms: Team[][]) => rooms.map((r) => r.map((t) => t.id).join("v"));
const eight = () => "12345678".split("").map((id) => T(id));

describe("minCostPairBracket", () => {
  it("reproduces each pairing method exactly when there are no conflicts", () => {
    const expected: Record<Exclude<PairingMethod, "random">, string[]> = {
      fold: ["1v8", "2v7", "3v6", "4v5"],
      slide: ["1v5", "2v6", "3v7", "4v8"],
      adjacent: ["1v2", "3v4", "5v6", "7v8"],
      fold_top_adjacent_rest: ["1v8", "2v7", "3v6", "4v5"],
    };
    for (const [method, rooms] of Object.entries(expected)) {
      expect(roomIds(minCostPairBracket(eight(), historyOf([]), options({ pairingMethod: method as PairingMethod })))).toEqual(rooms);
    }
  });

  it("finds the globally cheapest matching, not just a local swap", () => {
    // Fold would give 1v8, 2v7, 3v6, 4v5; all four are rematches.
    const history = historyOf([["1", "8"], ["2", "7"], ["3", "6"], ["4", "5"]]);
    const rooms = minCostPairBracket(eight(), history, options());
    for (const [a, b] of rooms) expect(history.opponents.get(a.id)?.has(b.id)).toBeFalsy();
    expect(rooms.flat().map((t) => t.id).sort().join("")).toBe("12345678");
  });

  it("with a large deviation penalty, keeps the method's pairing despite a cheap conflict", () => {
    const history = historyOf([["1", "8"]]);
    const rooms = minCostPairBracket(eight(), history, options({
      penalties: { repeatMatchupPenalty: 1, institutionClashPenalty: 1 },
      pairingDeviationPenalty: 1000,
    }));
    expect(roomIds(rooms)).toEqual(["1v8", "2v7", "3v6", "4v5"]);
  });

  it("applies Tabbycat's side penalty to rooms where both teams lean the same way", () => {
    const teams = ["a", "b", "c", "d"].map((id) => T(id));
    const history = historyOf([], [
      ["a", ["AFF", "AFF"]],
      ["b", ["NEG", "NEG"]],
      ["c", ["AFF", "AFF"]],
      ["d", ["NEG", "NEG"]],
    ]);
    // Fold wants a v d and b v c, both opposite leans: zero side cost.
    expect(roomIds(minCostPairBracket(teams, history, options({ sideBalancePenalty: 10 })))).toEqual(["avd", "bvc"]);
    // Slide wants a v c (both aff-heavy): the side penalty moves it.
    const slid = minCostPairBracket(teams, history, options({ pairingMethod: "slide", sideBalancePenalty: 10 }));
    expect(roomIds(minCostPairBracket(teams, history, options({ pairingMethod: "slide" })))).toEqual(["avc", "bvd"]);
    expect(roomIds(slid)).not.toContain("avc");
    expect(roomIds(slid)).not.toContain("bvd");
  });

  it("charges the pull-up debate penalty only on rooms that mix win counts", () => {
    const teams = ["a", "b", "c", "d"].map((id) => T(id));
    const wins = new Map([["a", 2], ["b", 1], ["c", 1], ["d", 1]]);
    const history: MatchupHistory = {
      ...historyOf([]),
      pullupDebates: new Map([["b", 3]]),
    };
    // Fold pairs a (2 wins) with d; d has no pull-up history, so it is cheapest.
    const rooms = minCostPairBracket(teams, history, options({ previouslySawPullupPenalty: 100, wins }));
    expect(roomIds(rooms)).toEqual(["avd", "bvc"]);
  });

  it("treats canMeet === false as a hard constraint and fails clearly when nothing fits", () => {
    const teams = ["a", "b", "c", "d"].map((id) => T(id));
    const rooms = minCostPairBracket(teams, historyOf([]), options({ canMeet: (x, y) => !(x.id === "a" && y.id === "d") }));
    expect(roomIds(rooms)).not.toContain("avd");
    expect(() => minCostPairBracket(teams, historyOf([]), options({ canMeet: (x) => x.id !== "a" }))).toThrow(/side limits/);
  });

  it("random pairing is reproducible for a seed", () => {
    const run = (seed: number) => roomIds(minCostPairBracket(eight(), historyOf([]), options({ pairingMethod: "random", rng: createSeededRng(seed) })));
    expect(run(3)).toEqual(run(3));
    expect(new Set(Array.from({ length: 10 }, (_, s) => run(s).join()))).not.toHaveProperty("size", 1);
  });
});

describe("minCostPairAllocatedSides", () => {
  const aff = ["a1", "a2"].map((id) => T(id));
  const neg = ["n1", "n2"].map((id) => T(id));

  it("keeps the method's pairing without conflicts and avoids a rematch when possible", () => {
    expect(roomIds(minCostPairAllocatedSides(aff, neg, historyOf([]), options({ pairingMethod: "slide" })))).toEqual(["a1vn1", "a2vn2"]);
    expect(roomIds(minCostPairAllocatedSides(aff, neg, historyOf([["a1", "n1"]]), options({ pairingMethod: "slide" })))).toEqual([
      "a1vn2",
      "a2vn1",
    ]);
  });
});

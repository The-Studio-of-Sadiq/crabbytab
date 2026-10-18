import { describe, it, expect } from "vitest";
import { avoidConflicts, bestSwapSet, DEFAULT_CLASH_PENALTIES } from "./conflictAvoidance";
import { MatchupHistory } from "./history";
import { Team } from "@/types";

function T(id: string, institutionId?: string): Team {
  return { id, tournamentId: "t", name: id, institutionId, speakers: [], breakCategories: [], speakerCategories: [] };
}

function historyOf(pairs: [string, string][]): MatchupHistory {
  const opponents = new Map<string, Set<string>>();
  for (const [a, b] of pairs) {
    for (const [x, y] of [[a, b], [b, a]] as const) {
      if (!opponents.has(x)) opponents.set(x, new Set());
      opponents.get(x)!.add(y);
    }
  }
  return { opponents, sides: new Map() };
}

const roomIds = (rooms: Team[][]) => rooms.map((r) => r.map((t) => t.id).join("v"));

describe("bestSwapSet (one-up-one-down dynamic programme)", () => {
  it("chooses the best non-adjacent set of positive gains", () => {
    expect(bestSwapSet([5, 6, 5])).toEqual([0, 2]);
    expect(bestSwapSet([1, 10, 1])).toEqual([1]);
    expect(bestSwapSet([-1, -Infinity, 3])).toEqual([2]);
    expect(bestSwapSet([])).toEqual([]);
  });
});

describe("avoidConflicts: off", () => {
  it("returns rooms unchanged even when they clash", () => {
    const rooms = [[T("a"), T("b")], [T("c"), T("d")]];
    expect(roomIds(avoidConflicts(rooms, historyOf([["a", "b"]]), "off"))).toEqual(["avb", "cvd"]);
  });
});

describe("avoidConflicts: one_up_one_down (Tabbycat OneUpOneDownSwapper)", () => {
  it("swaps the second teams of adjacent rooms to remove a rematch", () => {
    const rooms = [[T("a"), T("b")], [T("c"), T("d")]];
    expect(roomIds(avoidConflicts(rooms, historyOf([["a", "b"]]), "one_up_one_down"))).toEqual(["avd", "cvb"]);
  });

  it("swaps to remove an institution clash", () => {
    const rooms = [[T("a", "X"), T("b", "X")], [T("c"), T("d")]];
    expect(roomIds(avoidConflicts(rooms, historyOf([]), "one_up_one_down"))).toEqual(["avd", "cvb"]);
  });

  it("does not swap when that would create more history conflicts", () => {
    const rooms = [[T("a"), T("b")], [T("c"), T("d")]];
    const history = historyOf([["a", "b"], ["a", "d"], ["c", "b"]]);
    expect(roomIds(avoidConflicts(rooms, history, "one_up_one_down"))).toEqual(["avb", "cvd"]);
  });

  it("prefers the swap higher up when two swaps are equally good, and never chains overlapping swaps", () => {
    const rooms = [[T("a"), T("b")], [T("c"), T("d")], [T("e"), T("f")]];
    // Room 2 (c v d) clashes; swapping with room 1 or room 3 both fix it.
    const result = avoidConflicts(rooms, historyOf([["c", "d"]]), "one_up_one_down");
    expect(roomIds(result)).toEqual(["avd", "cvb", "evf"]);
  });

  it("ignores history when its penalty is 0 (avoid team history off)", () => {
    const rooms = [[T("a"), T("b")], [T("c"), T("d")]];
    const result = avoidConflicts(rooms, historyOf([["a", "b"]]), "one_up_one_down", {
      ...DEFAULT_CLASH_PENALTIES,
      repeatMatchupPenalty: 0,
    });
    expect(roomIds(result)).toEqual(["avb", "cvd"]);
  });

  it("never loses or duplicates a team when it cannot resolve everything", () => {
    const [a, b, c, d] = [T("a", "X"), T("b", "X"), T("c", "X"), T("d", "X")];
    const history = historyOf([["a", "b"], ["a", "c"], ["a", "d"], ["b", "c"], ["b", "d"], ["c", "d"]]);
    const result = avoidConflicts([[a, b], [c, d]], history, "one_up_one_down");
    expect(result.flat().map((t) => t.id).sort()).toEqual(["a", "b", "c", "d"]);
  });
});

describe("avoidConflicts: min_cost", () => {
  it("is not a post-processing step (pairing is done by minCostPairBracket)", () => {
    const rooms = [[T("a"), T("b")], [T("c"), T("d")]];
    expect(avoidConflicts(rooms, historyOf([["a", "b"]]), "min_cost")).toEqual(rooms);
  });
});

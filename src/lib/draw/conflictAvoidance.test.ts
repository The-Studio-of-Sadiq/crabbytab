import { describe, it, expect } from "vitest";
import { avoidConflicts } from "./conflictAvoidance";
import { MatchupHistory } from "./powerPaired";
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

const roomIds = (rooms: Team[][]) => rooms.map((r) => r.map((t) => t.id).sort().join("v"));
const hasClash = (room: Team[], history: MatchupHistory) =>
  history.opponents.get(room[0].id)?.has(room[1].id) || (room[0].institutionId && room[0].institutionId === room[1].institutionId);

describe("avoidConflicts: off", () => {
  it("returns rooms unchanged even when they clash", () => {
    const rooms = [[T("a"), T("b")], [T("c"), T("d")]];
    const history = historyOf([["a", "b"]]);
    expect(roomIds(avoidConflicts(rooms, history, "off"))).toEqual(roomIds(rooms));
  });
});

describe("avoidConflicts: one_up_one_down", () => {
  it("swaps to remove a single rematch between adjacent rooms", () => {
    const [a, b, c, d] = [T("a"), T("b"), T("c"), T("d")];
    const rooms = [[a, b], [c, d]];
    const history = historyOf([["a", "b"]]);
    const result = avoidConflicts(rooms, history, "one_up_one_down");
    expect(result.flat().map((t) => t.id).sort()).toEqual(["a", "b", "c", "d"]);
    expect(hasClash(result[0], history)).toBeFalsy();
  });

  it("leaves already-clean rooms alone", () => {
    const rooms = [[T("a"), T("b")], [T("c"), T("d")]];
    const history = historyOf([]);
    expect(roomIds(avoidConflicts(rooms, history, "one_up_one_down"))).toEqual(roomIds(rooms));
  });

  it("never loses or duplicates a team even when it can't fully resolve", () => {
    // Every possible pairing clashes; the algorithm must still return a valid set of rooms.
    const [a, b, c, d] = [T("a", "X"), T("b", "X"), T("c", "X"), T("d", "X")];
    const rooms = [[a, b], [c, d]];
    const history = historyOf([["a", "b"], ["a", "c"], ["a", "d"], ["b", "c"], ["b", "d"], ["c", "d"]]);
    const result = avoidConflicts(rooms, history, "one_up_one_down");
    expect(result.flat().map((t) => t.id).sort()).toEqual(["a", "b", "c", "d"]);
  });
});

describe("avoidConflicts: min_cost", () => {
  it("preserves every pairing from the selected method", () => {
    const rooms = [[T("a"), T("b")], [T("c"), T("d")]];
    const history = historyOf([["a", "b"]]);
    expect(avoidConflicts(rooms, history, "min_cost")).toEqual(rooms);
  });
});

import { describe, it, expect } from "vitest";
import { pairTeams, shuffle } from "./pairing";
import { Team } from "@/types";

function T(id: string): Team {
  return { id, tournamentId: "t", name: id, speakers: [], breakCategories: [], speakerCategories: [] };
}

const ids = (rooms: Team[][]) => rooms.map((r) => r.map((t) => t.id).join("v"));

describe("pairTeams", () => {
  const ranked8 = "12345678".split("").map((n) => T(n));

  it("adjacent: 1v2, 3v4, ...", () => {
    expect(ids(pairTeams(ranked8, "adjacent"))).toEqual(["1v2", "3v4", "5v6", "7v8"]);
  });

  it("slide: top half vs bottom half in order", () => {
    expect(ids(pairTeams(ranked8, "slide"))).toEqual(["1v5", "2v6", "3v7", "4v8"]);
  });

  it("fold: strongest vs weakest", () => {
    expect(ids(pairTeams(ranked8, "fold"))).toEqual(["1v8", "2v7", "3v6", "4v5"]);
  });

  it("fold_top_adjacent_rest: top room folds, the rest pair adjacently", () => {
    expect(ids(pairTeams(ranked8, "fold_top_adjacent_rest"))).toEqual(["1v8", "2v3", "4v5", "6v7"]);
  });

  it("random: every team appears exactly once across the rooms", () => {
    for (let i = 0; i < 20; i++) {
      const rooms = pairTeams(ranked8, "random");
      const flat = rooms.flat().map((t) => t.id).sort();
      expect(flat).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
      expect(rooms).toHaveLength(4);
    }
  });

  it("throws on an odd number of teams", () => {
    expect(() => pairTeams(ranked8.slice(0, 3), "adjacent")).toThrow("even number");
  });

  it("returns no rooms for zero teams", () => {
    expect(pairTeams([], "fold")).toEqual([]);
  });

  it("handles the smallest case (2 teams) identically for every method", () => {
    const pair = ranked8.slice(0, 2);
    for (const method of ["adjacent", "slide", "fold", "fold_top_adjacent_rest"] as const) {
      expect(ids(pairTeams(pair, method))).toEqual(["1v2"]);
    }
  });
});

describe("shuffle", () => {
  it("preserves every element exactly once", () => {
    const arr = Array.from({ length: 10 }, (_, i) => i);
    const s = shuffle(arr);
    expect([...s].sort((a, b) => a - b)).toEqual(arr);
  });

  it("is not the identity permutation every time (sanity check it actually shuffles)", () => {
    const arr = Array.from({ length: 20 }, (_, i) => i);
    const anyDifferent = Array.from({ length: 10 }, () => shuffle(arr)).some(
      (s) => s.join() !== arr.join()
    );
    expect(anyDifferent).toBe(true);
  });
});

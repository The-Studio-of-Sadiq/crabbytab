import { describe, expect, it } from "vitest";
import { maxWeightMatching, minCostPerfectMatching, WeightedEdge } from "./weightedMatching";
import { createSeededRng, randomInt } from "./rng";

// Golden cases from the original mwmatching.py test suite (integer-weight ones).
const cases: [string, WeightedEdge[], boolean, number[]][] = [
  ["single edge", [[0, 1, 1]], false, [1, 0]],
  ["path", [[1, 2, 10], [2, 3, 11]], false, [-1, -1, 3, 2]],
  ["path 2", [[1, 2, 5], [2, 3, 11], [3, 4, 5]], false, [-1, -1, 3, 2, -1]],
  ["max cardinality", [[1, 2, 5], [2, 3, 11], [3, 4, 5]], true, [-1, 2, 1, 4, 3]],
  ["negative", [[1, 2, 2], [1, 3, -2], [2, 3, 1], [2, 4, -1], [3, 4, -6]], false, [-1, 2, 1, -1, -1]],
  ["negative maxcard", [[1, 2, 2], [1, 3, -2], [2, 3, 1], [2, 4, -1], [3, 4, -6]], true, [-1, 3, 4, 1, 2]],
  ["S-blossom", [[1, 2, 8], [1, 3, 9], [2, 3, 10], [3, 4, 7]], false, [-1, 2, 1, 4, 3]],
  ["S-blossom 2", [[1, 2, 8], [1, 3, 9], [2, 3, 10], [3, 4, 7], [1, 6, 5], [4, 5, 6]], false, [-1, 6, 3, 2, 5, 4, 1]],
  ["T-blossom", [[1, 2, 9], [1, 3, 8], [2, 3, 10], [1, 4, 5], [4, 5, 4], [1, 6, 3]], false, [-1, 6, 3, 2, 5, 4, 1]],
  ["T-blossom 2", [[1, 2, 9], [1, 3, 8], [2, 3, 10], [1, 4, 5], [4, 5, 3], [1, 6, 4]], false, [-1, 6, 3, 2, 5, 4, 1]],
  ["T-blossom 3", [[1, 2, 9], [1, 3, 8], [2, 3, 10], [1, 4, 5], [4, 5, 3], [3, 6, 4]], false, [-1, 2, 1, 6, 5, 4, 3]],
  ["nested S", [[1, 2, 9], [1, 3, 9], [2, 3, 10], [2, 4, 8], [3, 5, 8], [4, 5, 10], [5, 6, 6]], false, [-1, 3, 4, 1, 2, 6, 5]],
  ["S relabel nest", [[1, 2, 10], [1, 7, 10], [2, 3, 12], [3, 4, 20], [3, 5, 20], [4, 5, 25], [5, 6, 10], [6, 7, 10], [7, 8, 8]], false, [-1, 2, 1, 4, 3, 6, 5, 8, 7]],
  ["nested S expand", [[1, 2, 8], [1, 3, 8], [2, 3, 10], [2, 4, 12], [3, 5, 12], [4, 5, 14], [4, 6, 12], [5, 7, 12], [6, 7, 14], [7, 8, 12]], false, [-1, 2, 1, 5, 6, 3, 4, 8, 7]],
  ["S-T expand", [[1, 2, 23], [1, 5, 22], [1, 6, 15], [2, 3, 25], [3, 4, 22], [4, 5, 25], [4, 8, 14], [5, 7, 13]], false, [-1, 6, 3, 2, 8, 7, 1, 5, 4]],
  ["nested S, T expand", [[1, 2, 19], [1, 3, 20], [1, 8, 8], [2, 3, 25], [2, 4, 18], [3, 5, 18], [4, 5, 13], [4, 7, 7], [5, 6, 7]], false, [-1, 8, 3, 2, 7, 6, 5, 4, 1]],
  ["T nasty expand", [[1, 2, 45], [1, 5, 45], [2, 3, 50], [3, 4, 45], [4, 5, 50], [1, 6, 30], [3, 9, 35], [4, 8, 35], [5, 7, 26], [9, 10, 5]], false, [-1, 6, 3, 2, 8, 7, 1, 5, 4, 10, 9]],
  ["T nasty 2", [[1, 2, 45], [1, 5, 45], [2, 3, 50], [3, 4, 45], [4, 5, 50], [1, 6, 30], [3, 9, 35], [4, 8, 26], [5, 7, 40], [9, 10, 5]], false, [-1, 6, 3, 2, 8, 7, 1, 5, 4, 10, 9]],
  ["T expand least slack", [[1, 2, 45], [1, 5, 45], [2, 3, 50], [3, 4, 45], [4, 5, 50], [1, 6, 30], [3, 9, 35], [4, 8, 28], [5, 7, 26], [9, 10, 5]], false, [-1, 6, 3, 2, 8, 7, 1, 5, 4, 10, 9]],
  ["nested T nasty", [[1, 2, 45], [1, 7, 45], [2, 3, 50], [3, 4, 45], [4, 5, 95], [4, 6, 94], [5, 6, 94], [6, 7, 50], [1, 8, 30], [3, 11, 35], [5, 9, 36], [7, 10, 26], [11, 12, 5]], false, [-1, 8, 3, 2, 6, 9, 4, 10, 1, 5, 7, 12, 11]],
  ["nested relabel expand", [[1, 2, 40], [1, 3, 40], [2, 3, 60], [2, 4, 55], [3, 5, 55], [4, 5, 50], [1, 8, 15], [5, 7, 30], [7, 6, 10], [8, 10, 10], [4, 9, 30]], false, [-1, 2, 1, 5, 9, 3, 7, 6, 10, 4, 8]],
];

describe("maxWeightMatching (port of mwmatching.py)", () => {
  it("returns an empty matching for an empty graph", () => {
    expect(maxWeightMatching([])).toEqual([]);
  });

  for (const [name, edges, maxCardinality, expected] of cases) {
    it(name, () => {
      expect(maxWeightMatching(edges, maxCardinality)).toEqual(expected);
    });
  }

  it("rejects fractional weights", () => {
    expect(() => maxWeightMatching([[0, 1, 0.5]])).toThrow(/integers/);
  });
});

function bruteForceMinCost(n: number, cost: (i: number, j: number) => number | null): number | null {
  const used = new Array(n).fill(false);
  let best: number | null = null;
  const go = (acc: number) => {
    const i = used.indexOf(false);
    if (i === -1) {
      if (best === null || acc < best) best = acc;
      return;
    }
    used[i] = true;
    for (let j = i + 1; j < n; j++) {
      if (used[j]) continue;
      const c = cost(i, j);
      if (c === null) continue;
      used[j] = true;
      go(acc + c);
      used[j] = false;
    }
    used[i] = false;
  };
  go(0);
  return best;
}

describe("minCostPerfectMatching", () => {
  it("matches brute force on random complete and sparse graphs", () => {
    const rng = createSeededRng(42);
    for (let trial = 0; trial < 300; trial++) {
      const n = 2 * (1 + randomInt(rng, 5));
      const table = Array.from({ length: n }, () => new Array<number | null>(n).fill(null));
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          table[i][j] = table[j][i] = rng() < 0.2 ? null : randomInt(rng, 50);
        }
      }
      const cost = (i: number, j: number) => table[i][j];
      const pairs = minCostPerfectMatching(n, cost);
      const expected = bruteForceMinCost(n, cost);
      if (expected === null) {
        expect(pairs).toBeNull();
        continue;
      }
      expect(pairs).not.toBeNull();
      const seen = new Set(pairs!.flat());
      expect(seen.size).toBe(n);
      expect(pairs!.reduce((sum, [i, j]) => sum + table[i][j]!, 0)).toBe(expected);
    }
  });

  it("returns null when no perfect matching exists", () => {
    expect(minCostPerfectMatching(4, (i, j) => (i === 0 || j === 0 ? null : 1))).toBeNull();
    expect(minCostPerfectMatching(3, () => 1)).toBeNull();
  });
});

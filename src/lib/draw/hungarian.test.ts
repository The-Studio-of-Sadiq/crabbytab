import { describe, it, expect } from "vitest";
import { solveHungarian } from "./hungarian";
import { createSeededRng } from "./rng";

describe("Hungarian Algorithm (solveHungarian)", () => {
  it("solves standard square cost matrix correctly", () => {
    // 4x4 matrix with clear optimal assignment
    // Row 0: costs [10, 19, 8, 15] -> min 8 at col 2
    // Row 1: costs [10, 18, 7, 17] -> col 1 (18) or col 2 (7), etc.
    const costMatrix = [
      [10, 19, 8, 15],
      [10, 18, 7, 17],
      [13, 16, 9, 14],
      [12, 19, 8, 18],
    ];
    const matching = solveHungarian(costMatrix);
    expect(matching).toHaveLength(4);
    // Each row must be assigned a unique column
    expect(new Set(matching).size).toBe(4);
    matching.forEach((col) => {
      expect(col).toBeGreaterThanOrEqual(0);
      expect(col).toBeLessThan(4);
    });

    // Total cost verification:
    // Optimal matching for this matrix:
    // row 0 -> col 3 (15) or col 2 (8), etc.
    const totalCost = matching.reduce((sum, col, row) => sum + costMatrix[row][col], 0);
    // Hand-calculated optimal: row 0->3 (15), row 1->2 (7), row 2->1 (16), row 3->0 (12) => 50
    // or row 0->2 (8), row 1->0 (10), row 2->1 (16), row 3->3 (18) => 52
    expect(totalCost).toBeLessThanOrEqual(50);
  });

  it("handles known 3x3 cost matrix", () => {
    const costMatrix = [
      [1, 2, 3],
      [2, 4, 6],
      [3, 6, 9],
    ];
    const matching = solveHungarian(costMatrix);
    // Diagonal or minimal: row 0->2 (3), row 1->1 (4), row 2->0 (3) => sum 10
    expect(matching).toHaveLength(3);
    expect(new Set(matching).size).toBe(3);
    const totalCost = matching.reduce((sum, col, row) => sum + costMatrix[row][col], 0);
    expect(totalCost).toBe(10);
  });

  it("handles rectangular matrix with more rows than columns (N > M)", () => {
    // 3 rows, 2 columns. Only 2 rows can be matched to valid columns; one gets -1.
    const costMatrix = [
      [5, 9],
      [1, 10],
      [8, 2],
    ];
    const matching = solveHungarian(costMatrix);
    expect(matching).toHaveLength(3);
    // Row 1 should pick col 0 (cost 1), Row 2 should pick col 1 (cost 2)
    expect(matching[1]).toBe(0);
    expect(matching[2]).toBe(1);
    expect(matching[0]).toBe(-1);
  });

  it("handles rectangular matrix with more columns than rows (N < M)", () => {
    // 2 rows, 3 columns. Both rows must be matched to distinct columns.
    const costMatrix = [
      [10, 2, 8],
      [4, 15, 6],
    ];
    const matching = solveHungarian(costMatrix);
    expect(matching).toHaveLength(2);
    expect(matching[0]).toBe(1); // cost 2
    expect(matching[1]).toBe(0); // cost 4
  });

  it("handles empty matrix", () => {
    expect(solveHungarian([])).toEqual([]);
    expect(solveHungarian([[]])).toEqual([]);
  });
});

/** The solver as it was before the wave 4 speed work, kept to prove the results are unchanged. */
function referenceHungarian(costMatrix: number[][]): number[] {
  const n = costMatrix.length;
  if (n === 0) return [];
  const m = costMatrix[0].length;
  if (m === 0) return [];

  // If rectangular with n > m, pad columns with 0
  const dim = Math.max(n, m);
  const matrix: number[][] = Array.from({ length: dim }, (_, r) =>
    Array.from({ length: dim }, (_, c) => (r < n && c < m ? costMatrix[r][c] : 0))
  );

  const u = new Array(dim + 1).fill(0);
  const v = new Array(dim + 1).fill(0);
  const p = new Array(dim + 1).fill(0);
  const way = new Array(dim + 1).fill(0);

  for (let i = 1; i <= dim; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(dim + 1).fill(Infinity);
    const used = new Array(dim + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;

      for (let j = 1; j <= dim; j++) {
        if (!used[j]) {
          const cur = matrix[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      }

      for (let j = 0; j <= dim; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }

      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const result = new Array(n).fill(-1);
  for (let j = 1; j <= dim; j++) {
    if (p[j] <= n && j <= m) {
      result[p[j] - 1] = j - 1;
    }
  }

  return result;
}

describe("solveHungarian matches the original solver exactly", () => {
  it("on random matrices with many ties, fractional costs, and rectangular shapes", () => {
    const rng = createSeededRng(2026);
    for (let trial = 0; trial < 300; trial++) {
      const rows = 1 + Math.floor(rng() * 25);
      const columns = 1 + Math.floor(rng() * 25);
      const levels = 1 + Math.floor(rng() * 4);
      const matrix = Array.from({ length: rows }, () =>
        Array.from({ length: columns }, () => (trial % 3 === 0 ? Math.floor(rng() * levels) : rng() * 1000 * 0.05))
      );
      expect(solveHungarian(matrix), `trial ${trial}`).toEqual(referenceHungarian(matrix));
    }
  });
});

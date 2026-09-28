import { describe, it, expect } from "vitest";
import { solveHungarian } from "./hungarian";

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

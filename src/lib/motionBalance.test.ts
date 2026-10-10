import { describe, expect, it } from "vitest";

import { analyzeMotionBalance } from "./motionBalance";

describe("motion win-balance analysis", () => {
  it("reports no deviation for a uniform BP position distribution", () => {
    expect(analyzeMotionBalance([25, 25, 25, 25])).toMatchObject({
      observations: 100,
      expectedPerPosition: 25,
      chiSquared: 0,
      degreesOfFreedom: 3,
      pValue: 1,
      lowExpectedCount: false,
    });
  });

  it("calculates the two-position chi-square p-value", () => {
    const result = analyzeMotionBalance([30, 20]);
    expect(result.chiSquared).toBe(2);
    expect(result.degreesOfFreedom).toBe(1);
    expect(result.pValue).toBeCloseTo(0.1573, 3);
  });

  it("flags small expected counts without suppressing the descriptive statistic", () => {
    expect(analyzeMotionBalance([2, 1, 1, 0])).toMatchObject({
      observations: 4,
      chiSquared: expect.any(Number),
      pValue: expect.any(Number),
      lowExpectedCount: true,
    });
  });

  it("returns no test for empty observations", () => {
    expect(analyzeMotionBalance([0, 0])).toMatchObject({
      observations: 0,
      chiSquared: null,
      pValue: null,
      lowExpectedCount: true,
    });
  });
});

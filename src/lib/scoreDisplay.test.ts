import { describe, expect, it } from "vitest";
import { formatScore } from "./scoreDisplay";

describe("formatScore", () => {
  it("shows at most two decimals without trailing zeros", () => {
    expect(formatScore(224 / 3)).toBe("74.67");
    expect(formatScore(259)).toBe("259");
    expect(formatScore(74.5)).toBe("74.5");
    expect(formatScore(-11 / 3)).toBe("-3.67");
    expect(formatScore(1234.5)).toBe("1234.5");
    expect(formatScore(undefined)).toBe("—");
  });
});

import { describe, expect, it } from "vitest";
import { encodeCode39 } from "./code39";

describe("encodeCode39", () => {
  it("encodes a hyphenated tournament ID with start and stop characters", () => {
    const result = encodeCode39("team-123");
    expect(result[0]).toEqual({ bar: true, width: 1 });
    expect(result.at(-1)).toEqual({ bar: true, width: 1 });
    expect(result.some((element) => element.width === 3)).toBe(true);
    expect(result.length).toBeGreaterThan(9 * 9);
  });

  it("normalizes lower-case IDs", () => {
    expect(encodeCode39("abc-1")).toEqual(encodeCode39("ABC-1"));
  });

  it("rejects IDs that cannot be represented by Code 39", () => {
    expect(() => encodeCode39("team_id")).toThrow("Barcode IDs must contain only Code 39 characters");
  });

  it("uses nine alternating bar/space elements per supported Code 39 symbol", () => {
    const symbols = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%";
    const encodedLength = encodeCode39(symbols).length;
    expect(encodedLength).toBe((symbols.length + 2) * 10 - 1);
  });
});

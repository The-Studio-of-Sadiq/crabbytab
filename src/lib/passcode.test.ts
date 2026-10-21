import { describe, expect, it } from "vitest";
import { passcodesMatch } from "./passcode";

describe("passcodesMatch", () => {
  it("matches identical passcodes", () => {
    expect(passcodesMatch("abc123", "abc123")).toBe(true);
  });

  it("rejects different, differently sized or missing passcodes", () => {
    expect(passcodesMatch("abc123", "abc124")).toBe(false);
    expect(passcodesMatch("abc123", "abc1234")).toBe(false);
    expect(passcodesMatch("abc123", "")).toBe(false);
    expect(passcodesMatch(undefined, "abc123")).toBe(false);
    expect(passcodesMatch("", "")).toBe(false);
    expect(passcodesMatch("abc123", 123)).toBe(false);
  });
});

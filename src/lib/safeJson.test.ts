import { describe, expect, it } from "vitest";
import { safeJsonParse } from "./safeJson";

describe("safeJsonParse", () => {
  it("returns parsed values for valid JSON", () => {
    expect(safeJsonParse('{"slug":"sample"}', { slug: "fallback" })).toEqual({ slug: "sample" });
  });

  it("returns fallback for malformed JSON", () => {
    expect(safeJsonParse("{not valid json", { slug: "fallback" })).toEqual({ slug: "fallback" });
  });

  it("returns fallback for null or undefined values", () => {
    expect(safeJsonParse(null, { slug: "fallback" })).toEqual({ slug: "fallback" });
    expect(safeJsonParse(undefined, { slug: "fallback" })).toEqual({ slug: "fallback" });
  });
});

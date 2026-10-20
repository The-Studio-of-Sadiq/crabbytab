import { describe, expect, it } from "vitest";
import { s, SchemaValidationError } from "./schema";

function issues(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof SchemaValidationError) return error.issues;
    throw error;
  }
  return [];
}

describe("API schemas", () => {
  const team = s.object({
    name: s.string({ min: 1, max: 10 }),
    seed: s.optional(s.integer({ min: 0 })),
    speakers: s.array(s.object({ name: s.string({ min: 1 }) }), { max: 2 }),
  });

  it("parses valid values, trimming strings and keeping only known fields", () => {
    expect(team.parse({ name: "  Alpha ", speakers: [{ name: "A" }] })).toEqual({ name: "Alpha", speakers: [{ name: "A" }] });
  });

  it("reports every issue with its path", () => {
    expect(issues(() => team.parse({ name: "", seed: 1.5, speakers: [{}, { name: "x" }, { name: "y" }], extra: 1 }))).toEqual(
      expect.arrayContaining([
        { path: "extra", message: "is not a known field" },
        { path: "name", message: "must not be empty" },
        { path: "seed", message: "must be an integer" },
        { path: "speakers", message: "must have at most 2 items" },
      ])
    );
    expect(issues(() => team.parse({ name: "A", speakers: [{}] }))).toEqual([{ path: "speakers/0/name", message: "is required" }]);
  });

  it("rejects non-finite numbers and wrong types", () => {
    expect(issues(() => s.number().parse(Number.NaN))).toHaveLength(1);
    expect(issues(() => s.boolean().parse("true"))).toHaveLength(1);
    expect(issues(() => s.enum(["a", "b"] as const).parse("c"))).toHaveLength(1);
  });

  it("enforces minProperties for partial updates", () => {
    const patch = s.object({ name: s.optional(s.string()) }, { minProperties: 1 });
    expect(issues(() => patch.parse({}))).toHaveLength(1);
  });

  it("describes itself as JSON Schema", () => {
    expect(team.json()).toMatchObject({
      type: "object",
      required: ["name", "speakers"],
      additionalProperties: false,
      properties: { seed: { type: "integer", minimum: 0 }, speakers: { type: "array", maxItems: 2 } },
    });
    expect(s.nullable(s.string()).json()).toMatchObject({ type: ["string", "null"] });
  });
});

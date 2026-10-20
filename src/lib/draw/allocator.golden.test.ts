import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { autoAllocateAdjudicators } from "./allocator";
import { ALLOCATION_FIXTURES, buildAllocationFixture, summariseAllocation } from "./allocatorFixtures";

/**
 * The allocator's output on seeded fixtures must not change when it is optimised: the golden file
 * was produced by the allocator before the wave 4 performance work. Regenerate it (only for an
 * intentional behaviour change) with CRABBYTAB_UPDATE_ALLOCATOR_GOLDEN=1.
 */
const GOLDEN_PATH = join(__dirname, "allocator.golden.json");
const update = process.env.CRABBYTAB_UPDATE_ALLOCATOR_GOLDEN === "1";
const golden: Record<string, string[]> = existsSync(GOLDEN_PATH)
  ? JSON.parse(readFileSync(GOLDEN_PATH, "utf8"))
  : {};
const produced: Record<string, string[]> = {};

describe("auto-allocation golden output", () => {
  for (const spec of ALLOCATION_FIXTURES) {
    it(spec.name, () => {
      const fixture = buildAllocationFixture(spec);
      const results = autoAllocateAdjudicators(
        fixture.debates,
        fixture.teamsMap,
        fixture.adjudicators,
        fixture.pastAdjudicatorTeams,
        fixture.options,
        fixture.context
      );
      produced[spec.name] = results.map(summariseAllocation);
      if (update) {
        writeFileSync(GOLDEN_PATH, `${JSON.stringify({ ...golden, ...produced }, null, 1)}\n`);
        return;
      }
      expect(golden[spec.name], "missing golden output").toBeDefined();
      expect(produced[spec.name]).toEqual(golden[spec.name]);
    }, 120_000);
  }
});

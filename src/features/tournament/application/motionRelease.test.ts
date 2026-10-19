import { describe, expect, it } from "vitest";
import type { Round } from "@/types";
import { applyMotionReleaseSync, roundsNeedingMotionReleaseSync } from "./motionRelease";

const round = (id: string, motionsReleased = false) => ({ id, motionsReleased }) as Round;

describe("round motion release", () => {
  it("marks a round released once any of its motions is released, and unmarks it again", () => {
    const rounds = [round("r1"), round("r2", true), round("r3")];
    const motions = [
      { rounds: ["r1"], released: true },
      { rounds: ["r1", "r3"], released: false },
    ];
    const changed = roundsNeedingMotionReleaseSync(rounds, motions);
    expect(changed.map((item) => [item.id, item.motionsReleased])).toEqual([["r1", true], ["r2", false]]);
    const synced = applyMotionReleaseSync(rounds, changed);
    expect(synced.map((item) => item.motionsReleased)).toEqual([true, false, false]);
    expect(roundsNeedingMotionReleaseSync(synced, motions)).toEqual([]);
  });
});

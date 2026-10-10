import { describe, expect, it } from "vitest";

import { isAvailableForRound, setRoundAvailability } from "./roundAvailability";

describe("round-specific availability", () => {
  it("uses a round override and falls back to global check-in", () => {
    const participant = {
      checkedIn: true,
      roundAvailability: { "round-2": false },
    };

    expect(isAvailableForRound(participant, "round-1")).toBe(true);
    expect(isAvailableForRound(participant, "round-2")).toBe(false);
    expect(isAvailableForRound({ checkedIn: false }, "round-1")).toBe(false);
    expect(isAvailableForRound({ checkedIn: true }, null)).toBe(true);
  });

  it("updates one round without changing other overrides or global status", () => {
    const participant = {
      checkedIn: false,
      roundAvailability: { "round-1": true },
    };

    expect(setRoundAvailability(participant, "round-2", true)).toEqual({
      checkedIn: false,
      roundAvailability: { "round-1": true, "round-2": true },
    });
  });
});
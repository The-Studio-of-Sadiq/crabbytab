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

  it("expires timestamped check-ins only when an expiry window is configured", () => {
    const participant = {
      checkedIn: true,
      checkedInAt: "2026-10-10T10:00:00.000Z",
      roundAvailability: { "round-1": true },
      roundAvailabilityAt: { "round-1": "2026-10-10T10:00:00.000Z" },
    };
    const now = Date.parse("2026-10-10T13:00:00.000Z");
    expect(isAvailableForRound(participant, "round-1", 2, now)).toBe(false);
    expect(isAvailableForRound(participant, "round-1", 4, now)).toBe(true);
    expect(isAvailableForRound(participant, "round-1", 0, now)).toBe(true);
  });

  it("keeps records without timestamps backward compatible and rejects invalid stamped values", () => {
    expect(isAvailableForRound({ checkedIn: true }, "round-1", 1, Date.now())).toBe(true);
    expect(isAvailableForRound({
      checkedIn: true,
      checkedInAt: "not-a-date",
    }, null, 1, Date.now())).toBe(false);
  });
});
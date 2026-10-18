import { describe, expect, it } from "vitest";

import type { Round } from "@/types";
import { currentCheckInRound, parseSelfCheckInRequest, selfCheckInError, selfCheckInStatus } from "./selfCheckIn";

const round = (id: string, seq: number, overrides: Partial<Round> = {}): Round => ({
  id,
  tournamentId: "t1",
  seq,
  name: `Round ${seq}`,
  abbreviation: `R${seq}`,
  stage: "preliminary",
  drawType: "random",
  drawStatus: "none",
  feedbackWeight: 1,
  silent: false,
  motionsReleased: false,
  resultsReleased: false,
  completed: false,
  createdAt: "2026-10-18T00:00:00.000Z",
  ...overrides,
});

const rounds = [
  round("r3", 3),
  round("r1", 1, { completed: true }),
  round("r2", 2, { cancelled: true }),
];

describe("self check-in", () => {
  it("targets the earliest open round", () => {
    expect(currentCheckInRound(rounds)?.id).toBe("r3");
    expect(currentCheckInRound([round("r1", 1, { completed: true })])).toBeUndefined();
  });

  it("validates request shape", () => {
    expect(parseSelfCheckInRequest(undefined)).toBeNull();
    expect(parseSelfCheckInRequest({ roundId: "r3", available: true })).toEqual({ roundId: "r3", available: true });
    expect(parseSelfCheckInRequest({ roundId: "a/b", available: true })).toBe("invalid");
    expect(parseSelfCheckInRequest({ roundId: "r3", available: "yes" })).toBe("invalid");
    expect(parseSelfCheckInRequest([])).toBe("invalid");
  });

  it("is refused unless enabled and for the current round", () => {
    expect(selfCheckInError({}, rounds, { roundId: "r3", available: true })).toMatch(/not enabled/);
    expect(selfCheckInError({ allowSelfCheckIn: true }, rounds, { roundId: "r1", available: true })).toBe(
      "Check-in is only open for Round 3."
    );
    expect(selfCheckInError({ allowSelfCheckIn: true }, rounds, { roundId: "r3", available: false })).toBeNull();
    expect(selfCheckInError({ allowSelfCheckIn: true }, [], { roundId: "r3", available: true })).toMatch(/no round/);
  });

  it("reports availability for the current round, honouring expiry", () => {
    expect(selfCheckInStatus({}, rounds, {})).toBeNull();
    expect(selfCheckInStatus({ allowSelfCheckIn: true }, rounds, { roundAvailability: { r3: false } })).toEqual({
      roundId: "r3",
      roundName: "Round 3",
      available: false,
    });
    const now = Date.parse("2026-10-18T12:00:00.000Z");
    expect(
      selfCheckInStatus(
        { allowSelfCheckIn: true, checkInExpiresAfterHours: 1 },
        rounds,
        { roundAvailability: { r3: true }, roundAvailabilityAt: { r3: "2026-10-18T09:00:00.000Z" } },
        now
      )?.available
    ).toBe(false);
  });
});

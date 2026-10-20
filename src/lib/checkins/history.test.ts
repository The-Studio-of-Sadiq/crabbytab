import { describe, expect, it } from "vitest";
import type { Adjudicator, Round, Team, Venue } from "@/types";
import {
  appendCheckInEvent,
  availabilityFromPreviousRound,
  breakingAdjudicatorsAvailable,
  checkedInSpeakerCount,
  checkInEvent,
  MAX_CHECK_IN_EVENTS,
  previousRound,
  setParticipantAvailability,
  setSpeakerCheckIn,
  setVenueCheckIn,
} from "./history";
import { returnLocation } from "@/lib/printOptions";

const AT = "2026-10-20T09:00:00.000Z";
const r1 = { id: "r1" };
const r2 = { id: "r2" };

function team(id: string, overrides: Partial<Team> = {}): Team {
  return {
    id,
    tournamentId: "t1",
    name: id,
    speakers: [{ id: `${id}-s1`, name: "Ann" }, { id: `${id}-s2`, name: "Bo" }],
    breakCategories: [],
    speakerCategories: [],
    ...overrides,
  };
}

function adjudicator(id: string, overrides: Partial<Adjudicator> = {}): Adjudicator {
  return { id, tournamentId: "t1", name: id, baseScore: 5, trainee: false, independent: false, conflicts: [], ...overrides };
}

describe("check-in history", () => {
  it("records each change with its source, round and person", () => {
    const updated = setParticipantAvailability(team("a"), r1, true, { source: "scan", by: "Tab", at: AT });
    expect(updated.roundAvailability).toEqual({ r1: true });
    expect(updated.roundAvailabilityAt).toEqual({ r1: AT });
    expect(updated.checkInHistory).toEqual([{ at: AT, available: true, source: "scan", roundId: "r1", by: "Tab" }]);
    const venue = setVenueCheckIn({ id: "v", tournamentId: "t1", name: "Room", priority: 1 } as Venue, false, { source: "tab", at: AT });
    expect(venue).toMatchObject({ checkedIn: false, checkInHistory: [{ available: false, source: "tab" }] });
  });

  it("keeps only the newest events", () => {
    let record: { checkInHistory?: ReturnType<typeof checkInEvent>[] } = {};
    for (let index = 0; index < MAX_CHECK_IN_EVENTS + 5; index += 1) {
      record = appendCheckInEvent(record, checkInEvent({ available: true, source: "tab", at: String(index) }));
    }
    expect(record.checkInHistory).toHaveLength(MAX_CHECK_IN_EVENTS);
    expect(record.checkInHistory?.[0].at).toBe("5");
  });
});

describe("speaker-level check-in", () => {
  it("marks the team present once every speaker is in, and never withdraws it on a speaker check-out", () => {
    const one = setSpeakerCheckIn(team("a"), "a-s1", r1, true, { source: "scan", at: AT });
    expect(checkedInSpeakerCount(one, "r1")).toBe(1);
    expect(one.roundAvailability?.r1).toBeUndefined();
    const both = setSpeakerCheckIn(one, "a-s2", r1, true, { source: "scan", at: AT });
    expect(both.roundAvailability?.r1).toBe(true);
    const out = setSpeakerCheckIn(both, "a-s2", r1, false, { source: "tab", at: AT });
    expect(out.roundAvailability?.r1).toBe(true);
    expect(out.speakers[1].checkInHistory?.map((event) => event.available)).toEqual([true, false]);
    expect(() => setSpeakerCheckIn(team("a"), "nobody", r1, true, { source: "tab" })).toThrow();
  });
});

describe("bulk check-ins", () => {
  it("copies availability from the previous round, both ways", () => {
    // Present in R1 but checked out globally (so absent in R2 by default).
    const present = team("a", { checkedIn: false, roundAvailability: { r1: true } });
    // Absent in R1, present in R2 by default.
    const absent = team("b", { roundAvailability: { r1: false } });
    const explicit = team("c", { roundAvailability: { r1: false, r2: true } });
    const same = team("d");
    const updated = availabilityFromPreviousRound([present, absent, explicit, same], r1, r2, { by: "Tab", at: AT });
    expect(updated.map((item) => [item.id, item.roundAvailability?.r2])).toEqual([["a", true], ["b", false]]);
    expect(updated[0].checkInHistory?.[0]).toMatchObject({ source: "bulk", roundId: "r2", by: "Tab" });
  });

  it("checks in breaking adjudicators only", () => {
    const updated = breakingAdjudicatorsAvailable(
      [adjudicator("x", { breaking: true, roundAvailability: { r2: false } }), adjudicator("y")],
      r2,
      { at: AT }
    );
    expect(updated.map((item) => item.id)).toEqual(["x"]);
    expect(updated[0].roundAvailability?.r2).toBe(true);
  });

  it("finds the previous running round", () => {
    const rounds = [
      { id: "r1", seq: 1 },
      { id: "r2", seq: 2, cancelled: true },
      { id: "r3", seq: 3 },
    ] as Array<Pick<Round, "id" | "seq" | "cancelled">>;
    expect(previousRound(rounds, { seq: 3 })?.id).toBe("r1");
    expect(previousRound(rounds, { seq: 1 })).toBeUndefined();
  });
});

describe("print options", () => {
  it("hides empty and TBA return locations", () => {
    expect(returnLocation("  Tab room ")).toBe("Tab room");
    expect(returnLocation("tba")).toBeNull();
    expect(returnLocation(undefined)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { Debate, Venue } from "@/types";
import { allocateVenuesToDebates, getVenueIncompatibilities } from "./venueAllocator";

function makeDebate(id: string, overrides: Partial<Debate> = {}): Debate {
  return {
    id,
    tournamentId: "t1",
    roundId: "r1",
    roundSeq: 1,
    venueName: id,
    bracket: 0,
    roomRank: 1,
    importance: 0,
    resultStatus: "none",
    sidesConfirmed: false,
    flags: [],
    teams: {} as Debate["teams"],
    adjudicators: {
      panellistIds: [],
      panellistNames: [],
      traineeIds: [],
      traineeNames: [],
    },
    ...overrides,
  };
}

function makeVenue(id: string, overrides: Partial<Venue> = {}): Venue {
  return {
    id,
    tournamentId: "t1",
    name: id,
    priority: 1,
    ...overrides,
  };
}

describe("venue allocation", () => {
  it("assigns compatible rooms before using priority ordering", () => {
    const debates = [
      makeDebate("normal", { roomRank: 1 }),
      makeDebate("accessible", { roomRank: 2, requiresAccessibleVenue: true }),
    ];
    const venues = [
      makeVenue("main", { priority: 100 }),
      makeVenue("accessible-room", { priority: 1, accessible: true }),
    ];

    expect(allocateVenuesToDebates(debates, venues).get("accessible")?.id)
      .toBe("accessible-room");
    expect(allocateVenuesToDebates(debates, venues).get("normal")?.id).toBe("main");
  });

  it("matches category, capacity, accessibility, online, and location requirements", () => {
    const debate = makeDebate("special", {
      requiredVenueCategory: "Online",
      requiredVenueCapacity: 20,
      requiresAccessibleVenue: true,
      requiresOnlineVenue: true,
      requiresNearTabRoom: true,
    });
    const venue = makeVenue("online-room", {
      category: "online",
      capacity: 30,
      accessible: true,
      online: true,
      nearTabRoom: true,
    });

    expect(getVenueIncompatibilities(debate, venue)).toEqual([]);
    expect(getVenueIncompatibilities(debate, makeVenue("small"))).toEqual([
      "requires Online category",
      "requires capacity of at least 20",
      "requires an accessible venue",
      "requires an online-capable venue",
      "requires a venue near the tab room",
    ]);
  });

  it("rejects allocation when no compatible available room exists", () => {
    expect(() =>
      allocateVenuesToDebates(
        [makeDebate("needs-accessible", { requiresAccessibleVenue: true })],
        [makeVenue("standard")]
      )
    ).toThrow("No available venue meets the requirements");
  });

  it("does not assign unavailable venues", () => {
    const assignments = allocateVenuesToDebates(
      [makeDebate("debate")],
      [makeVenue("closed", { priority: 100, available: false }), makeVenue("open")]
    );
    expect(assignments.get("debate")?.id).toBe("open");
  });
});

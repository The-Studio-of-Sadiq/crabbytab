import { describe, expect, it } from "vitest";
import type { Debate, DebateSide, DebateTeamSlot, Team, Venue } from "@/types";
import {
  constraintLookup,
  debateVenueConstraints,
  isVenueAvailableForRound,
  isVenueCheckedIn,
  safeVenueUrl,
  setVenueRoundAvailability,
  unmetVenueConstraints,
  venueDisplayName,
  venueTooltip,
} from "./venues";
import { allocateVenuesToDebates } from "@/lib/draw/venueAllocator";
import { validateDraw } from "@/lib/draw/validateDraw";

function venue(id: string, priority: number, extra: Partial<Venue> = {}): Venue {
  return { id, tournamentId: "t", name: id, priority, ...extra };
}

function team(id: string, extra: Partial<Team> = {}): Team {
  return { id, tournamentId: "t", name: id, speakers: [], breakCategories: [], speakerCategories: [], ...extra };
}

function debate(id: string, teamIds: string[], extra: Partial<Debate> = {}): Debate {
  const sides: DebateSide[] = ["AFF", "NEG"];
  return {
    id,
    tournamentId: "t",
    roundId: "r1",
    roundSeq: 1,
    bracket: 0,
    roomRank: 1,
    importance: 0,
    resultStatus: "none",
    sidesConfirmed: true,
    flags: [],
    teams: Object.fromEntries(
      teamIds.map((teamId, index) => [sides[index], { teamId, teamName: teamId, side: sides[index] }])
    ) as Record<DebateSide, DebateTeamSlot>,
    adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    ...extra,
  };
}

describe("room availability and check-in", () => {
  it("lets a per-round entry override the default", () => {
    const room = venue("a", 1, { available: false });
    expect(isVenueAvailableForRound(room, "r1")).toBe(false);
    const open = setVenueRoundAvailability(room, "r1", true);
    expect(isVenueAvailableForRound(open, "r1")).toBe(true);
    expect(isVenueAvailableForRound(open, "r2")).toBe(false);
    expect(isVenueAvailableForRound(setVenueRoundAvailability(venue("b", 1), "r1", false), "r1")).toBe(false);
  });

  it("expires room check-ins after the window", () => {
    const now = Date.parse("2026-10-20T12:00:00Z");
    const room = { checkedIn: true, checkedInAt: "2026-10-20T09:00:00Z" };
    expect(isVenueCheckedIn(room, undefined, now)).toBe(true);
    expect(isVenueCheckedIn(room, 4, now)).toBe(true);
    expect(isVenueCheckedIn(room, 2, now)).toBe(false);
    expect(isVenueCheckedIn({ checkedIn: false }, 2, now)).toBe(false);
    // Older check-ins without a time stay valid.
    expect(isVenueCheckedIn({ checkedIn: true }, 2, now)).toBe(true);
  });
});

describe("soft ranked room constraints", () => {
  const teams = [
    team("t1", { venueConstraints: [{ category: "Ground floor", priority: 5 }], institutionId: "i1" }),
    team("t2"),
    team("t3", { venueConstraints: [{ category: "Purple", priority: 1 }] }),
    team("t4"),
  ];
  const institutions = [{ id: "i1", tournamentId: "t", name: "Inst", code: "I", venueConstraints: [{ category: "Purple", priority: 9 }] }];

  it("collects team, adjudicator and institution constraints, highest priority first", () => {
    const lookup = constraintLookup({
      teams,
      institutions,
      adjudicators: [{ id: "a1", tournamentId: "t", name: "Adj", baseScore: 5, trainee: false, independent: true, conflicts: [], venueConstraints: [{ category: "Lift", priority: 7 }] }],
    });
    const constraints = debateVenueConstraints(
      debate("d1", ["t1", "t2"], { adjudicators: { chairId: "a1", panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] } }),
      lookup
    );
    expect(constraints.map((constraint) => [constraint.subjectKind, constraint.category, constraint.priority])).toEqual([
      ["institution", "Purple", 9],
      ["adjudicator", "Lift", 7],
      ["team", "Ground floor", 5],
    ]);
    expect(unmetVenueConstraints(debate("d1", ["t1", "t2"]), { category: "purple" }, lookup).map((c) => c.category)).toEqual([
      "Ground floor",
    ]);
  });

  it("meets higher-priority constraints first and reports nothing when there are none", () => {
    // Two debates both want the single Purple room; the priority-9 institution constraint wins.
    const rooms = [venue("top", 10), venue("purple", 1, { category: "Purple" }), venue("ground", 2, { category: "Ground floor" })];
    const debates = [debate("high", ["t3", "t4"], { bracket: 3 }), debate("low", ["t1", "t2"], { bracket: 0, roomRank: 2 })];
    const plain = allocateVenuesToDebates(debates, rooms);
    expect(plain.get("high")!.id).toBe("top");
    const constrained = allocateVenuesToDebates(debates, rooms, { teams, institutions });
    expect(constrained.get("low")!.id).toBe("purple");
    expect(constrained.get("high")!.id).not.toBe("purple");
  });

  it("is lexicographic: one high-priority constraint beats several low ones", () => {
    const many = [
      team("x1", { venueConstraints: [{ category: "A", priority: 1 }] }),
      team("x2", { venueConstraints: [{ category: "A", priority: 1 }] }),
      team("y1", { venueConstraints: [{ category: "A", priority: 2 }] }),
      team("y2"),
    ];
    const rooms = [venue("a", 1, { category: "A" }), venue("b", 5)];
    const result = allocateVenuesToDebates(
      [debate("dx", ["x1", "x2"], { bracket: 5 }), debate("dy", ["y1", "y2"], { roomRank: 2 })],
      rooms,
      { teams: many }
    );
    expect(result.get("dy")!.id).toBe("a");
  });

  it("never breaks a hard requirement for a soft constraint", () => {
    const rooms = [venue("purple", 1, { category: "Purple" }), venue("access", 1, { accessible: true })];
    const result = allocateVenuesToDebates(
      [debate("d", ["t3", "t4"], { requiresAccessibleVenue: true }), debate("e", ["t2", "t4"], { roomRank: 2 })],
      rooms,
      { teams }
    );
    expect(result.get("d")!.id).toBe("access");
  });

  it("skips rooms unavailable in the debates' round", () => {
    const rooms = [venue("closed", 9, { roundAvailability: { r1: false } }), venue("open", 1)];
    expect(allocateVenuesToDebates([debate("d", ["t2", "t4"])], rooms).get("d")!.id).toBe("open");
  });

  it("warns in the draw check when a constraint is unmet", () => {
    const issues = validateDraw({
      tournament: { format: "wsdc", preferences: {} as never },
      round: { id: "r1", seq: 1, stage: "preliminary" } as never,
      debates: [debate("d", ["t3", "t4"], { venueId: "plain", venueName: "plain" })],
      teams,
      adjudicators: [],
      venues: [venue("plain", 1)],
    });
    const issue = issues.find((item) => item.code === "venue_constraint");
    expect(issue?.severity).toBe("warning");
    expect(issue?.message).toMatch(/t3 \(Purple, priority 1\)/);
  });
});

describe("room display", () => {
  const categories = [
    { name: "Purple", displayInName: "prefix" as const, description: "is close to the briefing hall", publicTooltip: true },
    { name: "Lift", displayInName: "suffix" as const, description: "has step-free access." },
  ];

  it("prefixes or suffixes the category", () => {
    expect(venueDisplayName({ name: "G05", category: "Purple" }, categories)).toBe("Purple G05");
    expect(venueDisplayName({ name: "G05", category: "lift" }, categories)).toBe("G05 lift");
    expect(venueDisplayName({ name: "G05", category: "Other" }, categories)).toBe("G05");
  });

  it("describes the room for admins, and for the public only when allowed", () => {
    expect(venueTooltip({ category: "Lift" }, categories, "admin")).toBe("This room has step-free access.");
    expect(venueTooltip({ category: "Lift" }, categories, "public")).toBeUndefined();
    expect(venueTooltip({ category: "Purple" }, categories, "public")).toBe("This room is close to the briefing hall.");
  });

  it("only links http(s) room URLs", () => {
    expect(safeVenueUrl(" https://meet.example.org/room-1 ")).toBe("https://meet.example.org/room-1");
    expect(safeVenueUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeVenueUrl("data:text/html,x")).toBeUndefined();
    expect(safeVenueUrl("not a url")).toBeUndefined();
    expect(safeVenueUrl(undefined)).toBeUndefined();
  });
});

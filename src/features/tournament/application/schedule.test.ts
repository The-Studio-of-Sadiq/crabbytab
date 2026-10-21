import { describe, expect, it } from "vitest";
import type { Debate, Round } from "@/types";
import {
  checkScheduleGroupChange,
  concurrentBookings,
  concurrentRoundClashes,
  concurrentRounds,
  currentRounds,
  debateStartTime,
  describeConcurrentClashes,
  groupPreliminaryRounds,
  isEarlierScheduleSlot,
  migrateSchedulePreferences,
  preliminaryPanelsOf,
  roundRobinIndex,
  roundsInSameSlot,
  scheduleGroupOf,
  slotNewPreliminaryRounds,
} from "./schedule";

function round(id: string, seq: number, overrides: Partial<Round> = {}): Round {
  return {
    id,
    tournamentId: "t",
    seq,
    name: `Round ${seq}`,
    abbreviation: `R${seq}`,
    stage: "preliminary",
    drawType: "power_paired",
    drawStatus: "none",
    feedbackWeight: 1,
    silent: false,
    motionsReleased: false,
    resultsReleased: false,
    completed: false,
    createdAt: "",
    ...overrides,
  };
}

function debate(id: string, roundId: string, teams: [string, string], extra: Partial<Debate> = {}): Debate {
  return {
    id,
    tournamentId: "t",
    roundId,
    roundSeq: 1,
    bracket: 0,
    roomRank: 1,
    importance: 0,
    resultStatus: "none",
    sidesConfirmed: true,
    flags: [],
    teams: {
      AFF: { teamId: teams[0], teamName: teams[0].toUpperCase(), side: "AFF" },
      NEG: { teamId: teams[1], teamName: teams[1].toUpperCase(), side: "NEG" },
    } as Debate["teams"],
    adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    ...extra,
  };
}

describe("schedule groups", () => {
  it("defaults a round's slot to its sequence number and ignores invalid groups", () => {
    expect(scheduleGroupOf(round("r3", 3))).toBe(3);
    expect(scheduleGroupOf(round("r3", 3, { scheduleGroup: 2 }))).toBe(2);
    expect(scheduleGroupOf(round("r3", 3, { scheduleGroup: 0 }))).toBe(3);
    expect(scheduleGroupOf(round("r3", 3, { scheduleGroup: 1.5 }))).toBe(3);
  });

  it("finds concurrent rounds in the same slot and stage, never cancelled ones", () => {
    const rounds = [
      round("a", 1, { scheduleGroup: 1 }),
      round("b", 2, { scheduleGroup: 1 }),
      round("c", 3, { scheduleGroup: 1, cancelled: true }),
      round("d", 4, { scheduleGroup: 2 }),
    ];
    expect(concurrentRounds(rounds[0], rounds).map((item) => item.id)).toEqual(["b"]);
    expect(roundsInSameSlot(rounds[1], rounds).map((item) => item.id)).toEqual(["a", "b"]);
    expect(roundsInSameSlot(rounds[3], rounds)).toEqual([]);
    expect(isEarlierScheduleSlot(rounds[1], rounds[3])).toBe(true);
    expect(isEarlierScheduleSlot(rounds[0], rounds[1])).toBe(false);
  });

  it("reports one current preliminary round when no groups are set, as before", () => {
    const rounds = [round("r1", 1, { completed: true }), round("r2", 2), round("r3", 3)];
    expect(currentRounds(rounds, []).map((item) => item.id)).toEqual(["r2"]);
  });

  it("makes every incomplete preliminary round of the earliest slot current (parallel panels)", () => {
    const rounds = [
      round("1a", 1, { scheduleGroup: 1, completed: true }),
      round("1b", 2, { scheduleGroup: 1 }),
      round("2a", 3, { scheduleGroup: 2 }),
      round("2b", 4, { scheduleGroup: 2 }),
    ];
    expect(currentRounds(rounds, []).map((item) => item.id)).toEqual(["1b"]);
    const done = rounds.map((item) => (item.id === "1b" ? { ...item, completed: true } : item));
    expect(currentRounds(done, []).map((item) => item.id)).toEqual(["2a", "2b"]);
  });

  it("after the prelims, the earliest drawn elimination round of each break category is current", () => {
    const rounds = [
      round("p1", 1, { completed: true }),
      round("open-qf", 2, { stage: "elimination", breakCategoryIds: ["open"], eliminationAdvanced: true }),
      round("open-sf", 3, { stage: "elimination", breakCategoryIds: ["open"] }),
      round("esl-sf", 4, { stage: "elimination", breakCategoryIds: ["esl"] }),
      round("esl-f", 5, { stage: "elimination", breakCategoryIds: ["esl"] }),
    ];
    const debates = [debate("d1", "open-qf", ["a", "b"]), debate("d2", "open-sf", ["a", "c"]), debate("d3", "esl-sf", ["e", "f"])];
    const categories = [{ id: "esl", seq: 2 }, { id: "open", seq: 1 }];
    expect(currentRounds(rounds, debates, categories).map((item) => item.id)).toEqual(["open-sf", "esl-sf"]);
    expect(currentRounds(rounds, [], categories)).toEqual([]);
  });

  it("gives parallel round-robin panels the same round-robin index", () => {
    const rounds = [
      round("1a", 1, { scheduleGroup: 1, drawType: "round_robin" }),
      round("1b", 2, { scheduleGroup: 1, drawType: "round_robin" }),
      round("2a", 3, { scheduleGroup: 2, drawType: "round_robin" }),
      round("2b", 4, { scheduleGroup: 2, drawType: "round_robin" }),
    ];
    expect(rounds.map((item) => roundRobinIndex(item, rounds))).toEqual([1, 1, 2, 2]);
    const plain = [round("r1", 1, { drawType: "round_robin" }), round("r2", 2, { drawType: "random" }), round("r3", 3, { drawType: "round_robin" })];
    expect(plain.map((item) => roundRobinIndex(item, plain))).toEqual([1, 2, 2]);
  });
});

describe("concurrent bookings and clashes", () => {
  const rounds = [round("a", 1, { scheduleGroup: 1 }), round("b", 2, { scheduleGroup: 1 }), round("c", 3)];
  const panel = (chairId: string) => ({ chairId, chairName: chairId.toUpperCase(), panellistIds: ["p1"], panellistNames: ["P1"], traineeIds: [], traineeNames: [] });

  it("lists who and what the concurrent rounds already use", () => {
    const debates = [
      debate("da", "a", ["t1", "t2"], { adjudicators: panel("j1"), venueId: "v1", venueName: "Room 1" }),
      debate("dc", "c", ["t3", "t4"], { adjudicators: panel("j2"), venueId: "v2" }),
    ];
    const booked = concurrentBookings(rounds[1], rounds, debates);
    expect([...booked.keys()].sort()).toEqual(["adjudicator:j1", "adjudicator:p1", "team:t1", "team:t2", "venue:v1"]);
    expect(booked.get("venue:v1")).toMatchObject({ roundId: "a", roundName: "Round 1", name: "Room 1" });
    expect(concurrentBookings(rounds[2], rounds, debates).size).toBe(0);
  });

  it("reports each shared team, adjudicator and venue once", () => {
    const debates = [
      debate("da", "a", ["t1", "t2"], { adjudicators: panel("j1"), venueId: "v1", venueName: "Room 1" }),
      debate("db1", "b", ["t1", "t5"], { adjudicators: panel("j9"), venueId: "v1", venueName: "Room 1" }),
      debate("db2", "b", ["t6", "t7"], { adjudicators: { ...panel("j1"), panellistIds: [] } }),
    ];
    const clashes = concurrentRoundClashes(rounds[1], rounds, debates);
    expect(clashes.map((clash) => `${clash.kind}:${clash.id}`).sort()).toEqual(["adjudicator:j1", "adjudicator:p1", "team:t1", "venue:v1"]);
    expect(describeConcurrentClashes(rounds[1], clashes)).toContain("runs at the same time as Round 1");
    expect(concurrentRoundClashes(rounds[2], rounds, debates)).toEqual([]);
  });
});

describe("preliminary panels", () => {
  it("reads the deprecated preference and migrates it", () => {
    expect(preliminaryPanelsOf(undefined)).toBe(1);
    expect(preliminaryPanelsOf({ preliminaryPanelsPerScheduleSlot: 2 })).toBe(2);
    expect(preliminaryPanelsOf({ preliminaryPanels: 3, preliminaryPanelsPerScheduleSlot: 2 })).toBe(3);
    expect(preliminaryPanelsOf({ preliminaryPanels: 0 })).toBe(1);
    expect(migrateSchedulePreferences({ preliminaryPanelsPerScheduleSlot: 2, publicDraw: true })).toEqual({ preliminaryPanels: 2, publicDraw: true });
    expect(migrateSchedulePreferences({ preliminaryPanelsPerScheduleSlot: 1 })).toEqual({});
    expect(migrateSchedulePreferences({ preliminaryPanels: 4, preliminaryPanelsPerScheduleSlot: 2 })).toEqual({ preliminaryPanels: 4 });
    const untouched = { publicDraw: true };
    expect(migrateSchedulePreferences(untouched)).toBe(untouched);
  });

  it("groups preliminary rounds into slots like Tabbycat, keeping custom names", () => {
    const rounds = [
      round("r1", 1),
      round("r2", 2),
      round("r3", 3, { name: "Rumble", abbreviation: "RMB" }),
      round("r4", 4),
      round("qf", 5, { stage: "elimination", name: "Quarterfinals", abbreviation: "QF" }),
    ];
    const changed = groupPreliminaryRounds(rounds, 2);
    expect(changed.map((item) => [item.id, item.name, item.abbreviation, item.scheduleGroup])).toEqual([
      ["r1", "Round 1 (A)", "R1A", 1],
      ["r2", "Round 1 (B)", "R1B", 1],
      ["r3", "Rumble", "RMB", 2],
      ["r4", "Round 2 (B)", "R2B", 2],
    ]);
    const regrouped = rounds.map((item) => changed.find((next) => next.id === item.id) ?? item);
    expect(groupPreliminaryRounds(regrouped, 2)).toEqual([]);
    expect(groupPreliminaryRounds(regrouped, 1).map((item) => [item.name, item.scheduleGroup])).toEqual([
      ["Round 1", 1],
      ["Round 2", 2],
      ["Rumble", 3],
      ["Round 4", 4],
    ]);
  });

  it("refuses slot changes that make drawn rounds clash or run out of order", () => {
    const rounds = [round("r1", 1), round("r2", 2), round("r3", 3)];
    const debates = [debate("d1", "r1", ["t1", "t2"]), debate("d2", "r2", ["t1", "t3"]), debate("d3", "r3", ["t4", "t5"])];
    expect(checkScheduleGroupChange(rounds[1], 1, rounds, debates)[0]).toContain("shares 1 team");
    expect(checkScheduleGroupChange(rounds[0], 3, rounds, debates).join(" ")).toContain("Round 2 would then run before Round 1");
    expect(checkScheduleGroupChange(rounds[2], 0, rounds, debates)).toEqual(["A schedule slot is a whole number from 1."]);
    expect(checkScheduleGroupChange(rounds[2], 2, rounds, [debates[0], debates[2]])).toEqual([]);
  });
});

describe("start times", () => {
  it("uses a debate's own time, else its round's", () => {
    const start = "2026-10-21T09:00:00.000Z";
    expect(debateStartTime({ scheduledTime: "2026-10-21T09:30:00.000Z" }, { startsAt: start })?.toISOString()).toBe("2026-10-21T09:30:00.000Z");
    expect(debateStartTime({}, { startsAt: start })?.toISOString()).toBe(start);
    expect(debateStartTime({ scheduledTime: "nonsense" }, undefined)).toBeUndefined();
  });
});

describe("slotNewPreliminaryRounds (prelim_panels at round creation)", () => {
  it("leaves rounds alone with one panel per slot", () => {
    const created = [round("r3", 3)];
    expect(slotNewPreliminaryRounds([round("r1", 1), round("r2", 2)], created, 1)).toBe(created);
  });

  it("groups new rounds into slots of prelim_panels, filling the last slot first", () => {
    const fresh = slotNewPreliminaryRounds([], [round("a", 1), round("b", 2), round("c", 3)], 2);
    expect(fresh.map((item) => [item.scheduleGroup, item.name, item.abbreviation])).toEqual([
      [1, "Round 1 (A)", "R1A"],
      [1, "Round 1 (B)", "R1B"],
      [2, "Round 2 (A)", "R2A"],
    ]);
    const existing = [round("a", 1, { scheduleGroup: 1 }), round("b", 2, { scheduleGroup: 1 }), round("c", 3, { scheduleGroup: 2 })];
    const added = slotNewPreliminaryRounds(existing, [round("d", 4), round("e", 5)], 2);
    expect(added.map((item) => item.scheduleGroup)).toEqual([2, 3]);
  });

  it("keeps a typed name when asked", () => {
    const [added] = slotNewPreliminaryRounds([round("a", 1)], [round("b", 2)], 2, { renameDefaults: false });
    expect(added).toMatchObject({ scheduleGroup: 1, name: "Round 2", abbreviation: "R2" });
  });
});

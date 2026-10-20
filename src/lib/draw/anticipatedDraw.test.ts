import { describe, expect, it } from "vitest";
import {
  bpCoefficients,
  calculateAnticipatedDraw,
  importanceByBracket,
  openLiveThresholds,
} from "./anticipatedDraw";
import { panelsFromAnticipatedDraw, prioritisePanels } from "@/features/tournament/application/preformedPanels";

describe("openLiveThresholds (Tabbycat breakqual/tests/test_liveness.py cases)", () => {
  const two = (roundSeq: number, breakSize: number, totalTeams: number, totalPrelimRounds: number) =>
    openLiveThresholds({ teamsPerDebate: 2, roundSeq, breakSize, totalTeams, totalPrelimRounds })!;
  const bp = (roundSeq: number, breakSize: number, totalTeams: number, totalPrelimRounds: number) =>
    openLiveThresholds({ teamsPerDebate: 4, roundSeq, breakSize, totalTeams, totalPrelimRounds })!;

  it.each([
    [two(7, 16, 79, 8), 6, 2],
    [two(8, 16, 79, 8), 6, 3],
    [bp(5, 24, 100, 6), 12, 4],
    [bp(6, 24, 100, 6), 12, 7],
    [bp(5, 16, 68, 6), 12, 4],
    [bp(6, 16, 68, 6), 12, 7],
    [bp(6, 16, 172, 6), 14, 9],
    [bp(5, 8, 20, 6), 11, 3],
    [bp(6, 8, 20, 6), 11, 6],
    [bp(4, 8, 30, 5), 10, 2],
    [bp(5, 8, 30, 5), 10, 5],
  ])("thresholds %#", (thresholds, minSafe, maxDead) => {
    expect(thresholds.safe).toBeGreaterThanOrEqual(minSafe);
    expect(thresholds.dead).toBeLessThanOrEqual(maxDead);
  });

  it("is null for meaningless break sizes", () => {
    expect(openLiveThresholds({ teamsPerDebate: 2, roundSeq: 1, breakSize: 1, totalTeams: 10, totalPrelimRounds: 5 })).toBeNull();
  });

  it("computes the quadrinomial coefficients", () => {
    expect(bpCoefficients(0)).toEqual([1]);
    expect(bpCoefficients(1)).toEqual([1, 1, 1, 1]);
    expect(bpCoefficients(2)).toEqual([1, 2, 3, 4, 3, 2, 1]);
    expect(bpCoefficients(10)).toEqual([
      1, 10, 55, 220, 705, 1902, 4455, 9240, 17205, 29050, 44803, 63460, 82885, 100110, 112035, 116304,
      112035, 100110, 82885, 63460, 44803, 29050, 17205, 9240, 4455, 1902, 705, 220, 55, 10, 1,
    ]);
  });
});

describe("calculateAnticipatedDraw", () => {
  it("gives empty rooms before any draw", () => {
    expect(calculateAnticipatedDraw({ teamsPerDebate: 2, pointsBefore: new Map(), teamCount: 9 })).toEqual(
      Array.from({ length: 4 }, (_, index) => ({ roomRank: index + 1, bracketMin: 0, bracketMax: 0, liveness: 0 }))
    );
  });

  it("anticipates two-team brackets from the previous draw", () => {
    // Previous round: two rooms on 1 point, one room 1 vs 0 (a pull-up), one room on 0.
    const points = new Map([
      ["a", 1], ["b", 1], ["c", 1], ["d", 1], ["e", 1], ["f", 0], ["g", 0], ["h", 0],
    ]);
    const rooms = calculateAnticipatedDraw({
      teamsPerDebate: 2,
      previousDebates: [["a", "b"], ["c", "d"], ["e", "f"], ["g", "h"]],
      pointsBefore: points,
      teamCount: 8,
    });
    // Lowers 1,2 | 1,2 | 0,1 | 0,1 sorted -> 2,2,1,1,1,1,0,0; uppers 1,2 | 1,2 | 1,2 | 0,1 -> 2,2,2,1,1,1,1,0.
    expect(rooms.map((room) => [room.bracketMin, room.bracketMax])).toEqual([
      [2, 2],
      [1, 2],
      [1, 1],
      [0, 1],
    ]);
  });

  it("brute-forces rooms spanning more than one point", () => {
    const rooms = calculateAnticipatedDraw({
      teamsPerDebate: 4,
      previousDebates: [["a", "b", "c", "d"]],
      pointsBefore: new Map([["a", 9], ["b", 8], ["c", 8], ["d", 7]]),
      teamCount: 4,
    });
    // The top team ends on at least 10 (9+0 forces someone else to 8+2) and at most 9+3.
    expect(rooms).toEqual([{ roomRank: 1, bracketMin: 10, bracketMax: 12, liveness: 0 }]);
  });

  it("counts live teams per room", () => {
    const rooms = calculateAnticipatedDraw({
      teamsPerDebate: 2,
      previousDebates: [["a", "b"], ["c", "d"]],
      pointsBefore: new Map([["a", 3], ["b", 3], ["c", 0], ["d", 0]]),
      teamCount: 4,
      thresholds: { safe: 4, dead: 0 },
    });
    // a/b end on 3-4 (one of them may stay live on 3); c/d end on 0-1 (one may be live on 1).
    expect(rooms.map((room) => room.liveness)).toEqual([1, 1]);
  });
});

describe("preformed panels from an anticipated draw", () => {
  it("keeps members of panels with the same room rank and adds new ones", () => {
    const existing = [
      { id: "p1", chairId: "x", panellistIds: [], traineeIds: [], importance: 5, roomRank: 1 },
      { id: "loose", panellistIds: [], traineeIds: [], importance: 0 },
    ];
    let next = 0;
    const panels = panelsFromAnticipatedDraw(
      existing,
      [
        { roomRank: 1, bracketMin: 2, bracketMax: 3, liveness: 2 },
        { roomRank: 2, bracketMin: 1, bracketMax: 2, liveness: 1 },
      ],
      () => `new-${++next}`
    );
    expect(panels.map((panel) => panel.id)).toEqual(["p1", "new-1", "loose"]);
    expect(panels[0]).toMatchObject({ chairId: "x", importance: 5, bracketMin: 2, bracketMax: 3, liveness: 2 });
  });

  it("prioritises by bracket in four levels and by liveness", () => {
    const panels = [0, 1, 2, 3, 4, 5, 6, 7].map((index) => ({
      id: `p${index}`,
      panellistIds: [],
      traineeIds: [],
      importance: 0,
      bracketMin: 7 - index,
      bracketMax: 7 - index,
      liveness: index % 2,
    }));
    expect(prioritisePanels(panels, "bracket").map((panel) => panel.importance)).toEqual([10, 10, 7, 7, 3, 3, 0, 0]);
    expect(prioritisePanels(panels, "liveness", { safe: 6, dead: 1 }).map((panel) => panel.importance)).toEqual([
      7, 10, 0, 10, 0, 10, 0, 10,
    ]);
    expect(() => prioritisePanels(panels, "liveness", null)).toThrow();
  });

  it("gives rooms on the same bracket the same importance", () => {
    const rooms = [5, 5, 5, 5, 1].map((bracket, index) => ({ index, bracket }));
    const levels = importanceByBracket(rooms, (room) => room.bracket);
    expect(rooms.map((room) => levels.get(room))).toEqual([10, 10, 10, 10, 7]);
  });
});

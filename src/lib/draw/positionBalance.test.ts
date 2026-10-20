import { describe, expect, it } from "vitest";
import type { BPSide, Debate, Round } from "@/types";
import { makeRound } from "@/test/tournamentFixtures";
import {
  buildPositionBalanceReport,
  positionBalanceStatus,
  positionBalanceUnavailable,
} from "./positionBalance";
import { computeBPSideCost } from "./sideAllocator";
import { MANUAL_SIDES_FLAG } from "./manualSides";

const T = "t-bp";
const SIDES: BPSide[] = ["OG", "OO", "CG", "CO"];

function debate(id: string, round: Round, teamIds: string[], extra: Partial<Debate> = {}): Debate {
  return {
    id,
    tournamentId: T,
    roundId: round.id,
    roundSeq: round.seq,
    bracket: 0,
    roomRank: 1,
    importance: 0,
    resultStatus: "none",
    sidesConfirmed: true,
    flags: [],
    teams: Object.fromEntries(
      SIDES.map((side, index) => [side, { teamId: teamIds[index], teamName: teamIds[index], side }])
    ) as Debate["teams"],
    adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    ...extra,
  };
}

const r1 = makeRound(T, 1, { drawStatus: "confirmed" });
const r2 = makeRound(T, 2, { drawStatus: "confirmed" });
const r3 = makeRound(T, 3, { drawStatus: "draft" });
const rounds = [r1, r2, r3];

describe("position balance status (Tabbycat categories)", () => {
  it("classifies balance changes", () => {
    expect(positionBalanceStatus([1, 1, 0, 0], [1, 1, 1, 0])).toBeUndefined();
    expect(positionBalanceStatus([1, 1, 0, 0], [2, 1, 0, 0])).toBe("regression");
    expect(positionBalanceStatus([2, 0, 0, 0], [2, 1, 0, 0])).toBe("improving");
    expect(positionBalanceStatus([2, 0, 0, 0], [3, 0, 0, 0])).toBe("still_bad");
    expect(positionBalanceStatus([2, 1, 1, 0], [2, 1, 1, 1])).toBe("resolved");
  });
});

describe("position balance report", () => {
  it("applies to BP preliminary rounds after the first only", () => {
    expect(positionBalanceUnavailable("wsdc", r2, rounds)).toBe("not_bp");
    expect(positionBalanceUnavailable("bp", r1, rounds)).toBe("first_round");
    expect(positionBalanceUnavailable("bp", { ...r2, stage: "elimination" }, rounds)).toBe("elimination");
    expect(positionBalanceUnavailable("bp", r2, rounds)).toBeUndefined();
  });

  it("reports each team's history before and after and its position cost", () => {
    // Team A was OG twice, and is OG again in round 3: a still-bad imbalance.
    const debates = [
      debate("d1", r1, ["A", "B", "C", "D"]),
      debate("d2", r2, ["A", "C", "D", "B"]),
      debate("d3", r3, ["A", "D", "B", "C"]),
    ];
    const report = buildPositionBalanceReport({
      round: r3,
      rounds,
      debates,
      teamName: (id) => `Team ${id}`,
      preferences: { bpPositionCost: "simple", bpPositionCostExponent: 1 },
    });
    expect(report.rows.map((row) => row.teamId)).toEqual(["A", "D", "B", "C"]);
    const a = report.rows.find((row) => row.teamId === "A")!;
    expect(a).toMatchObject({ side: "OG", before: [2, 0, 0, 0], after: [3, 0, 0, 0], cost: 2, status: "still_bad" });
    const d = report.rows.find((row) => row.teamId === "D")!;
    // D: CO then CG, now OO -> 0/1/1/1, balanced throughout.
    expect(d).toMatchObject({ before: [0, 0, 1, 1], after: [0, 1, 1, 1], cost: 0 });
    expect(d.status).toBeUndefined();
    expect(report.imbalanced.map((row) => row.teamId)).toEqual(["A"]);
  });

  it("uses the configured cost function and exponent (default Rényi entropy, exponent 4)", () => {
    const debates = [debate("d1", r1, ["A", "B", "C", "D"]), debate("d2", r2, ["A", "B", "C", "D"])];
    const report = buildPositionBalanceReport({ round: r2, rounds, debates, teamName: (id) => id });
    const a = report.rows.find((row) => row.teamId === "A")!;
    expect(a.cost).toBeCloseTo(computeBPSideCost(["OG"], "OG", {}));
    expect(a.status).toBe("regression");
  });

  it("leaves out debates whose positions are decided at the debate", () => {
    const pending = debate("d2", r2, ["A", "B", "C", "D"], { sidesConfirmed: false, flags: [MANUAL_SIDES_FLAG] });
    const report = buildPositionBalanceReport({
      round: r2,
      rounds,
      debates: [debate("d1", r1, ["A", "B", "C", "D"]), pending],
      teamName: (id) => id,
    });
    expect(report.rows).toEqual([]);
    expect(report.sidesPendingDebates).toBe(1);
  });
});

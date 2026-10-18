import { describe, expect, it } from "vitest";

import type { Debate, Motion } from "@/types";
import { buildAlphabeticalDraw, buildMotionRevealSteps, motionsForDisplay, nextRevealStep } from "./display";

function debate(id: string, teams: Debate["teams"], extra: Partial<Debate> = {}): Debate {
  return {
    id,
    tournamentId: "t1",
    roundId: "r1",
    roundSeq: 1,
    bracket: 0,
    roomRank: 1,
    importance: 0,
    resultStatus: "none",
    sidesConfirmed: true,
    flags: [],
    teams,
    adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    ...extra,
  };
}

const slot = (teamId: string, teamName: string, side: "AFF" | "NEG") => ({ teamId, teamName, side });

describe("buildAlphabeticalDraw", () => {
  it("lists every team once, sorted case-insensitively, with its opponents and room", () => {
    const rows = buildAlphabeticalDraw(
      [
        debate("d1", { AFF: slot("z", "zeta", "AFF"), NEG: slot("a", "Alpha", "NEG") } as Debate["teams"], { venueName: "Room 1" }),
        debate("d2", { AFF: slot("b", "beta", "AFF") } as Debate["teams"], { byeTeamId: "b" }),
      ],
      false
    );
    expect(rows.map((row) => row.teamName)).toEqual(["Alpha", "beta", "zeta"]);
    expect(rows[0]).toEqual({
      teamId: "a",
      teamName: "Alpha",
      side: "NEG",
      venueName: "Room 1",
      opponents: ["zeta"],
      bye: false,
    });
    expect(rows[1]).toMatchObject({ teamId: "b", bye: true, opponents: [] });
  });
});

describe("motion reveal", () => {
  const motion = (id: string, seq: number, infoSlide?: string): Motion => ({
    id,
    tournamentId: "t1",
    text: id,
    rounds: ["r1"],
    seq,
    released: id !== "hidden",
    ...(infoSlide ? { infoSlide } : {}),
  });

  it("shows a cover, then each info slide before its motion, in seq order", () => {
    const steps = buildMotionRevealSteps([motion("m2", 2), motion("m1", 1, "Context"), motion("m3", 3, "  ")]);
    expect(steps.map((step) => (step.kind === "cover" ? "cover" : `${step.kind}:${step.motion.id}`))).toEqual([
      "cover",
      "info:m1",
      "motion:m1",
      "motion:m2",
      "motion:m3",
    ]);
  });

  it("moves with the keyboard and stays in range", () => {
    expect(nextRevealStep(0, "ArrowRight", 3)).toBe(1);
    expect(nextRevealStep(2, " ", 3)).toBe(2);
    expect(nextRevealStep(1, "ArrowLeft", 3)).toBe(0);
    expect(nextRevealStep(0, "ArrowLeft", 3)).toBe(0);
    expect(nextRevealStep(0, "End", 3)).toBe(2);
    expect(nextRevealStep(2, "Home", 3)).toBe(0);
    expect(nextRevealStep(5, "x", 3)).toBe(2);
  });

  it("only offers unreleased motions to staff", () => {
    const motions = [motion("m1", 1), motion("hidden", 2), { ...motion("other", 3), rounds: ["r2"] }];
    expect(motionsForDisplay(motions, "r1", false).map((item) => item.id)).toEqual(["m1"]);
    expect(motionsForDisplay(motions, "r1", true).map((item) => item.id)).toEqual(["m1", "hidden"]);
    expect(motionsForDisplay(motions, undefined, true)).toEqual([]);
  });
});

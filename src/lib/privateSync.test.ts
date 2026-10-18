import { describe, expect, it } from "vitest";
import type { Debate } from "@/types";
import { selectAssignedDebates } from "./privateSync";

function debate(id: string, overrides: Partial<Debate> = {}): Debate {
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
    teams: {
      Gov: { teamId: "team-a", teamName: "A" },
      Opp: { teamId: "team-b", teamName: "B" },
    } as unknown as Debate["teams"],
    adjudicators: { chairId: "chair", panellistIds: ["panel"], traineeIds: ["trainee"] } as Debate["adjudicators"],
    ...overrides,
  };
}

describe("selectAssignedDebates", () => {
  const live = new Map([
    ["d1", debate("d1")],
    ["d2", debate("d2", {
      adjudicators: { chairId: "other" } as Debate["adjudicators"],
      teams: { Gov: { teamId: "team-c" }, Opp: { teamId: "team-d" } } as unknown as Debate["teams"],
    })],
  ]);

  it("returns only debates the adjudicator sits on, in any role", () => {
    for (const id of ["chair", "panel", "trainee"]) {
      expect([...selectAssignedDebates(live, "adjudicator", id).keys()]).toEqual(["d1"]);
    }
    expect(selectAssignedDebates(live, "adjudicator", "nobody").size).toBe(0);
  });

  it("returns only debates the team competes in", () => {
    expect([...selectAssignedDebates(live, "team", "team-d").keys()]).toEqual(["d2"]);
  });

  it("tolerates debates without panels or teams", () => {
    const sparse = new Map([["d3", debate("d3", {
      adjudicators: undefined as unknown as Debate["adjudicators"],
      teams: undefined as unknown as Debate["teams"],
    })]]);
    expect(selectAssignedDebates(sparse, "adjudicator", "chair").size).toBe(0);
    expect(selectAssignedDebates(sparse, "team", "team-a").size).toBe(0);
  });
});

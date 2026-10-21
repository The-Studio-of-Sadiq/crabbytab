import { describe, expect, it } from "vitest";
import { changedPanels, planAssistantAllocation, type AllocationDebateState } from "./assistantAllocation";

const names = new Map([["a", "Ann"], ["b", "Bo"], ["c", "Cy"], ["d", "Di"]]);
const round = { id: "r1" };

function debate(id: string, chairId: string | undefined, panellistIds: string[] = [], extra: Partial<AllocationDebateState> = {}): AllocationDebateState {
  return { id, roundId: "r1", adjudicators: { chairId, panellistIds, traineeIds: [] }, syncVersion: 2, ...extra };
}

describe("planAssistantAllocation", () => {
  const stored = [debate("d1", "a", ["b"]), debate("d2", "c")];

  it("finds only debates whose panel changed", () => {
    const byId = new Map(stored.map((item) => [item.id, item]));
    expect(changedPanels([debate("d1", "a", ["b"]), debate("d2", "d")], byId).map((item) => item.id)).toEqual(["d2"]);
  });

  it("writes a valid move between rooms with names and a new version", () => {
    const plan = planAssistantAllocation({
      round,
      roundDebates: stored,
      incoming: [debate("d1", "a"), debate("d2", "c", ["b"])],
      adjudicatorNames: names,
    });
    expect(plan.refused).toEqual([]);
    expect(plan.updates).toHaveLength(2);
    expect(plan.updates[1]).toMatchObject({
      debateId: "d2",
      syncVersion: 3,
      adjudicators: { chairId: "c", chairName: "Cy", panellistIds: ["b"], panellistNames: ["Bo"] },
    });
  });

  it("refuses an adjudicator in two rooms, and then every change of the round", () => {
    const plan = planAssistantAllocation({
      round,
      roundDebates: stored,
      incoming: [debate("d2", "c", ["b"])],
      adjudicatorNames: names,
    });
    expect(plan.updates).toEqual([]);
    expect(plan.refused[0].reason).toContain("Bo");
  });

  it("refuses unknown or repeated adjudicators, stale copies, closed rounds and confirmed results", () => {
    const refuse = (incoming: AllocationDebateState, overrides: Partial<Parameters<typeof planAssistantAllocation>[0]> = {}) =>
      planAssistantAllocation({ round, roundDebates: stored, incoming: [incoming], adjudicatorNames: names, ...overrides });
    expect(refuse(debate("d2", "zz")).updates).toEqual([]);
    expect(refuse(debate("d2", "c", ["c"])).updates).toEqual([]);
    expect(refuse(debate("d2", "d", [], { syncVersion: 1 })).refused[0].reason).toContain("Reload");
    expect(refuse(debate("d2", "d"), { round: { id: "r1", completed: true } }).updates).toEqual([]);
    expect(refuse(debate("d2", "d"), {
      roundDebates: [stored[0], { ...stored[1], resultStatus: "confirmed" }],
    }).updates).toEqual([]);
  });
});

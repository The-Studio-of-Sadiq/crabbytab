import { describe, expect, it } from "vitest";
import {
  AdjudicatorAllocationError,
  allocateTabbycatHungarian,
  hungarianStrengthCost,
  type HungarianCandidate,
  type TabbycatHungarianInput,
} from "./tabbycatHungarian";
import { autoAllocateAdjudicators } from "./allocator";
import { ALLOCATION_FIXTURES, buildAllocationFixture } from "./allocatorFixtures";

const voters = (scores: number[]): HungarianCandidate[] =>
  scores.map((score, index) => ({ id: `v${index + 1}`, score }));
const debates = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `d${index + 1}`, priority: 10 - index }));

function input(overrides: Partial<TabbycatHungarianInput>): TabbycatHungarianInput {
  return {
    mode: "voting",
    debates: debates(4),
    voters: [],
    trainees: [],
    noPanellists: false,
    noTrainees: false,
    conflictCost: () => 0,
    ...overrides,
  };
}

describe("Tabbycat voting Hungarian", () => {
  it("gives the strongest voters solo chairs in the top rooms and panels of three below", () => {
    // 4 debates, 8 voters: solos = 4 - floor((8 - 4) / 2) = 2, panellists = 6 -> 2 panels of 3.
    const { panels, warnings } = allocateTabbycatHungarian(
      input({ voters: voters([9, 8, 7, 6, 5, 4, 3, 2]), trainees: [{ id: "t1", score: 3 }] })
    );
    expect(warnings).toEqual([]);
    const byDebate = new Map(panels.map((panel) => [panel.debateId, panel]));
    expect(byDebate.get("d1")).toMatchObject({ chairId: "v1", panellistIds: [] });
    expect(byDebate.get("d2")).toMatchObject({ chairId: "v2", panellistIds: [] });
    expect(byDebate.get("d3")!.panellistIds).toHaveLength(2);
    expect(byDebate.get("d4")!.panellistIds).toHaveLength(2);
    // Trainees only go to solo debates.
    const traineeDebates = panels.filter((panel) => panel.traineeIds.length > 0).map((panel) => panel.debateId);
    expect(traineeDebates.every((id) => id === "d1" || id === "d2")).toBe(true);
    // The chair of a panel is its strongest member.
    for (const panel of panels) {
      const scores = new Map(voters([9, 8, 7, 6, 5, 4, 3, 2]).map((voter) => [voter.id, voter.score]));
      for (const id of panel.panellistIds) expect(scores.get(panel.chairId!)!).toBeGreaterThanOrEqual(scores.get(id)!);
    }
  });

  it("warns when there are fewer voters than debates or too few panellists", () => {
    // 3 voters for 4 debates: solos = 4 - floor(-1 / 2) = 5 (capped at 3), one panel debate, no panellists.
    const { warnings } = allocateTabbycatHungarian(input({ voters: voters([5, 5, 5]) }));
    expect(warnings[0]).toMatch(/4 debates but only 3 voting/);
    expect(warnings[1]).toMatch(/1 panel debates but only 0 available panellists/);
  });

  it("refuses to allocate with no voters (Tabbycat AdjudicatorAllocationError)", () => {
    expect(() => allocateTabbycatHungarian(input({ voters: [] }))).toThrow(AdjudicatorAllocationError);
  });

  it("avoids conflicted seats", () => {
    const { panels } = allocateTabbycatHungarian(
      input({
        debates: debates(2),
        voters: voters([9, 8]),
        conflictCost: (adj, debate) => (adj === "v1" && debate === "d1" ? 1_000_000 : 0),
      })
    );
    expect(panels.find((panel) => panel.debateId === "d1")!.chairId).toBe("v2");
  });
});

describe("Tabbycat consensus Hungarian", () => {
  it("spreads every voter evenly, extra members to the most important rooms", () => {
    const { panels } = allocateTabbycatHungarian(
      input({ mode: "consensus", voters: voters([9, 8, 7, 6, 5, 4, 3, 2, 1, 1]) })
    );
    const sizes = panels.map((panel) => (panel.chairId ? 1 : 0) + panel.panellistIds.length);
    // 10 voters over 4 debates: 3, 3, 2, 2 in priority order.
    expect(sizes).toEqual([3, 3, 2, 2]);
  });

  it("with no panellists uses one voter per room and seats the rest as trainees", () => {
    const { panels } = allocateTabbycatHungarian(
      input({ mode: "consensus", noPanellists: true, debates: debates(2), voters: voters([9, 8, 7, 6]) })
    );
    expect(panels.map((panel) => panel.panellistIds.length)).toEqual([0, 0]);
    expect(panels.flatMap((panel) => panel.traineeIds).sort()).toEqual(["v3", "v4"]);
  });
});

describe("hungarianStrengthCost", () => {
  it("prefers stronger adjudicators in more important debates", () => {
    expect(hungarianStrengthCost(10, 9)).toBeLessThan(hungarianStrengthCost(10, 4));
    // The gain from a stronger adjudicator is larger in a more important debate.
    expect(hungarianStrengthCost(10, 9) - hungarianStrengthCost(10, 4)).toBeLessThan(
      hungarianStrengthCost(0, 9) - hungarianStrengthCost(0, 4)
    );
  });
});

describe("Tabbycat strategies inside autoAllocateAdjudicators", () => {
  for (const strategy of ["tabbycat_voting", "tabbycat_consensus"] as const) {
    it(`${strategy}: seats nobody twice, is deterministic, and reports warnings`, () => {
      const fixture = buildAllocationFixture({ ...ALLOCATION_FIXTURES[0], options: { panelStrengthStrategy: strategy } });
      const run = (warnings: string[]) =>
        autoAllocateAdjudicators(
          fixture.debates,
          fixture.teamsMap,
          fixture.adjudicators,
          fixture.pastAdjudicatorTeams,
          { ...fixture.options, panelStrengthStrategy: strategy },
          { ...fixture.context, warnings }
        );
      const warnings: string[] = [];
      const first = run(warnings);
      const ids = first.flatMap((result) => [result.chairId, ...result.panellistIds, ...result.traineeIds]).filter(Boolean);
      expect(new Set(ids).size).toBe(ids.length);
      expect(first.every((result) => result.chairId)).toBe(true);
      expect(run([])).toEqual(first);
      expect(Array.isArray(warnings)).toBe(true);
    });
  }
});

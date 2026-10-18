import { describe, expect, it } from "vitest";
import {
  autoAllocateAdjudicators,
  calculateAdjDebateConflict,
  effectiveAdjScore,
  improvePanelAssignment,
  planPanelSizes,
  placePreformedPanels,
  getAllocationWeights,
  type AllocationOptions,
  type AdjudicatorAllocationResult,
} from "./allocator";
import type { Adjudicator, Debate, DebateSide, DebateTeamSlot, Team, TournamentPreferences } from "@/types";

function adj(id: string, baseScore = 5, extra: Partial<Adjudicator> = {}): Adjudicator {
  return {
    id,
    tournamentId: "t1",
    name: id,
    baseScore,
    checkedIn: true,
    trainee: false,
    independent: false,
    conflicts: [],
    ...extra,
  };
}

function team(id: string, institutionId?: string): Team {
  return {
    id,
    tournamentId: "t1",
    name: id,
    institutionId,
    institutionName: institutionId,
    speakers: [],
    breakCategories: [],
    speakerCategories: [],
  };
}

function debate(id: string, teams: Team[], extra: Partial<Debate> = {}): Debate {
  const sides: DebateSide[] = ["AFF", "NEG"];
  const slots = Object.fromEntries(
    teams.map((item, index) => [sides[index], { teamId: item.id, teamName: item.name, side: sides[index] }])
  ) as Record<DebateSide, DebateTeamSlot>;
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
    teams: slots,
    adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    ...extra,
  };
}

function options(extra: Partial<AllocationOptions> = {}, preferences?: Partial<TournamentPreferences>): AllocationOptions {
  return {
    panelSize: 1,
    balancePanels: true,
    respectInstitutionConflicts: true,
    respectPersonalConflicts: true,
    respectHistoryConflicts: true,
    preferences,
    ...extra,
  };
}

const members = (result: AdjudicatorAllocationResult) =>
  [result.chairId, ...result.panellistIds].filter((id): id is string => Boolean(id));

function setup(teamCount: number) {
  const teams = Array.from({ length: teamCount }, (_, index) => team(`team-${index}`, `inst-${index}`));
  return { teams, teamsMap: new Map(teams.map((item) => [item.id, item])) };
}

describe("adjudicator-adjudicator conflicts", () => {
  it("keeps conflicting adjudicators off the same panel when another arrangement exists", () => {
    const { teams, teamsMap } = setup(4);
    const debates = [
      debate("top", teams.slice(0, 2), { importance: 10 }),
      debate("bottom", teams.slice(2), { roomRank: 2 }),
    ];
    const adjudicators = [
      adj("a", 9, { conflicts: [{ adjudicatorId: "c", type: "personal" }] }),
      adj("b", 8),
      adj("c", 7),
      adj("d", 6),
    ];

    const result = autoAllocateAdjudicators(debates, teamsMap, adjudicators, new Map(), options({ panelSize: 2 }));
    for (const allocation of result) {
      expect(members(allocation).sort()).not.toEqual(["a", "c"]);
      expect(allocation.conflicts).toEqual([]);
    }
  });

  it("reports an unavoidable adjudicator conflict", () => {
    const { teams, teamsMap } = setup(2);
    const adjudicators = [adj("a", 9), adj("c", 7, { conflicts: [{ adjudicatorId: "a", type: "personal" }] })];
    const [result] = autoAllocateAdjudicators(
      [debate("only", teams)],
      teamsMap,
      adjudicators,
      new Map(),
      options({ panelSize: 2 })
    );
    expect(members(result).sort()).toEqual(["a", "c"]);
    expect(result.conflicts).toEqual(['a: Personal clash with adjudicator "c"']);
  });

  it("flags adjudicator clashes in the editor preview in either direction", () => {
    const first = adj("first");
    const second = adj("second", 5, { conflicts: [{ adjudicatorId: "first", type: "personal" }] });
    const preview = calculateAdjDebateConflict(first, [], new Map(), undefined, [second]);
    expect(preview.hasAdjudicatorClash).toBe(true);
    expect(preview.hasClash).toBe(true);
    expect(calculateAdjDebateConflict(first, [], new Map(), undefined, [adj("other")]).hasClash).toBe(false);
  });
});

describe("trainee conflicts", () => {
  it("does not seat a trainee in a debate with a team from their institution", () => {
    const { teams, teamsMap } = setup(4);
    const debates = [
      debate("top", teams.slice(0, 2), { importance: 10 }),
      debate("bottom", teams.slice(2), { roomRank: 2 }),
    ];
    // Without the conflict the trainee would go to the lowest-priority debate.
    const trainee = adj("trainee", 3, { trainee: true, institutionId: "inst-3", institutionName: "inst-3" });
    const result = autoAllocateAdjudicators(
      debates,
      teamsMap,
      [adj("chair-1", 8), adj("chair-2", 7), trainee],
      new Map(),
      options()
    );
    expect(result.find((item) => item.debateId === "top")!.traineeIds).toEqual(["trainee"]);
    expect(result.flatMap((item) => item.conflicts)).toEqual([]);
  });

  it("does not seat a trainee with an adjudicator they conflict with", () => {
    const { teams, teamsMap } = setup(4);
    const debates = [
      debate("top", teams.slice(0, 2), { importance: 10 }),
      debate("bottom", teams.slice(2), { roomRank: 2 }),
    ];
    const trainee = adj("trainee", 3, { trainee: true, conflicts: [{ adjudicatorId: "weaker", type: "personal" }] });
    const result = autoAllocateAdjudicators(
      debates,
      teamsMap,
      [adj("stronger", 9), adj("weaker", 4), trainee],
      new Map(),
      options()
    );
    const bottom = result.find((item) => item.debateId === "bottom")!;
    expect(bottom.chairId).toBe("weaker");
    expect(bottom.traineeIds).toEqual([]);
    expect(result.find((item) => item.debateId === "top")!.traineeIds).toEqual(["trainee"]);
  });
});

describe("configured weights", () => {
  const { teams, teamsMap } = setup(2);
  const conflicted = adj("conflicted", 10, { institutionId: "inst-0", institutionName: "inst-0" });
  const clean = adj("clean", 4);

  it("avoids an institutional clash with the default conflict penalty", () => {
    const [result] = autoAllocateAdjudicators([debate("d", teams)], teamsMap, [conflicted, clean], new Map(), options());
    expect(result.chairId).toBe("clean");
  });

  it("uses a low configured conflict penalty as given and reports the clash", () => {
    const [result] = autoAllocateAdjudicators(
      [debate("d", teams)],
      teamsMap,
      [conflicted, clean],
      new Map(),
      options({}, { adjConflictPenalty: 1 })
    );
    expect(result.chairId).toBe("conflicted");
    expect(result.conflicts).toEqual(["conflicted: Institutional clash with team-0 (inst-0)"]);
  });

  it("ignores institution clashes in matching when told not to respect them", () => {
    const [result] = autoAllocateAdjudicators(
      [debate("d", teams)],
      teamsMap,
      [conflicted, clean],
      new Map(),
      options({ respectInstitutionConflicts: false })
    );
    expect(result.chairId).toBe("conflicted");
    expect(result.conflicts).toHaveLength(1);
  });

  it("returns the configured penalties", () => {
    const weights = getAllocationWeights({ adjConflictPenalty: 7, adjHistoryPenalty: 3 });
    expect(weights.ADJUDICATOR_CONFLICT).toBe(7);
    expect(weights.REPEAT_TEAM).toBe(3);
  });
});

describe("feedback blend", () => {
  it("blends with the round feedback weight and prefers the test score", () => {
    const feedback = new Map([["a", 9]]);
    expect(effectiveAdjScore(adj("a", 5), feedback, 0)).toBe(5);
    expect(effectiveAdjScore(adj("a", 5), feedback, 1)).toBe(9);
    expect(effectiveAdjScore(adj("a", 5), feedback, 0.5)).toBe(7);
    expect(effectiveAdjScore(adj("a", 5, { testScore: 7 }), feedback, 0.5)).toBe(8);
    expect(effectiveAdjScore(adj("a", 5, { testScore: 7 }))).toBe(7);
    // No round weight: the historical 60% feedback blend.
    expect(effectiveAdjScore(adj("a", 5), feedback)).toBeCloseTo(7.4);
  });

  it("lets the round feedback weight decide who chairs the top room", () => {
    const { teams, teamsMap } = setup(4);
    const debates = [
      debate("top", teams.slice(0, 2), { importance: 10 }),
      debate("bottom", teams.slice(2), { roomRank: 2 }),
    ];
    const adjudicators = [adj("rated", 5), adj("unrated", 7)];
    const allocate = (feedbackWeight: number) =>
      autoAllocateAdjudicators(debates, teamsMap, adjudicators, new Map(), options(), {
        allPastDebates: [],
        standings: [],
        breakCategories: [],
        totalPrelimRounds: 1,
        completedRounds: 0,
        isBP: false,
        feedbackScores: new Map([["rated", 10]]),
        feedbackWeight,
      }).find((item) => item.debateId === "top")!.chairId;

    expect(allocate(0)).toBe("unrated");
    expect(allocate(1)).toBe("rated");
  });
});

describe("panel sizing", () => {
  it("grows odd panels in priority order", () => {
    expect(planPanelSizes(4, 10, 5, "by_priority")).toEqual([3, 3, 3, 1]);
    expect(planPanelSizes(4, 14, 5, "by_priority")).toEqual([5, 3, 3, 3]);
    expect(planPanelSizes(4, 3, 5, "by_priority")).toEqual([1, 1, 1, 1]);
    expect(planPanelSizes(3, 30, 4, "by_priority")).toEqual([3, 3, 3]);
    expect(planPanelSizes(2, 1, 3, "fixed")).toEqual([3, 3]);
  });

  it("gives the highest-priority debates the larger panels", () => {
    const { teams, teamsMap } = setup(6);
    const debates = [
      debate("low", teams.slice(0, 2), { roomRank: 3 }),
      debate("high", teams.slice(2, 4), { importance: 10 }),
      debate("mid", teams.slice(4), { importance: 5, roomRank: 2 }),
    ];
    const adjudicators = Array.from({ length: 7 }, (_, index) => adj(`adj-${index}`, 9 - index));
    const result = autoAllocateAdjudicators(
      debates,
      teamsMap,
      adjudicators,
      new Map(),
      options({ panelSize: 5, panelSizing: "by_priority" })
    );
    const size = (id: string) => members(result.find((item) => item.debateId === id)!).length;
    expect([size("high"), size("mid"), size("low")]).toEqual([3, 3, 1]);
    expect(new Set(result.flatMap(members)).size).toBe(7);
  });
});

describe("local search cap", () => {
  const problem = {
    slotCost: [
      [0, 0],
      [0, 0],
    ],
    groupOfSlot: [0, 0],
    slotsByGroup: [[0, 1]],
    groupCost: () => 0,
  };

  it("returns the seed unchanged when no passes are allowed", () => {
    const pairProblem = {
      slotCost: [[0, 0, 0]],
      groupOfSlot: [0],
      slotsByGroup: [[0]],
      groupCost: (_group: number, current: number[]) => (current[0] === 0 ? 10 : 0),
    };
    expect(improvePanelAssignment(pairProblem, [0], 0)).toMatchObject({
      assignment: [0],
      iterations: 0,
      stoppedEarly: true,
    });
    expect(improvePanelAssignment(pairProblem, [0], 5)).toMatchObject({
      assignment: [1],
      cost: 0,
      stoppedEarly: false,
    });
    expect(improvePanelAssignment(problem, [0, 1], 5).stoppedEarly).toBe(false);
  });

  it("stops when the evaluation budget runs out", () => {
    const result = improvePanelAssignment(
      { ...problem, groupCost: (_group: number, current: number[]) => current[0] },
      [1, 0],
      10,
      1
    );
    expect(result.stoppedEarly).toBe(true);
  });

  it("allocates a large tournament with heavy panel history quickly and deterministically", () => {
    const teams = Array.from({ length: 240 }, (_, index) => team(`team-${index}`, `inst-${index % 40}`));
    const teamsMap = new Map(teams.map((item) => [item.id, item]));
    const debates = Array.from({ length: 120 }, (_, index) =>
      debate(`d-${index}`, teams.slice(index * 2, index * 2 + 2), { roomRank: index + 1, bracket: index % 5 })
    );
    const adjudicators = Array.from({ length: 380 }, (_, index) =>
      adj(`adj-${index}`, 2 + (index % 8), {
        institutionId: `inst-${index % 40}`,
        institutionName: `inst-${index % 40}`,
        conflicts: index % 7 === 0 ? [{ adjudicatorId: `adj-${index + 1}`, type: "personal" }] : [],
      })
    );
    const pastDebates = Array.from({ length: 120 }, (_, index) =>
      debate(`past-${index}`, [], {
        roundId: "r0",
        adjudicators: {
          chairId: `adj-${index * 3}`,
          panellistIds: [`adj-${index * 3 + 1}`, `adj-${index * 3 + 2}`],
          panellistNames: [],
          traineeIds: [],
          traineeNames: [],
        },
      })
    );
    const context = {
      allPastDebates: pastDebates,
      standings: [],
      breakCategories: [],
      totalPrelimRounds: 5,
      completedRounds: 1,
      isBP: false,
    };

    const started = Date.now();
    const first = autoAllocateAdjudicators(debates, teamsMap, adjudicators, new Map(), options({ panelSize: 3 }), context);
    const elapsed = Date.now() - started;
    const second = autoAllocateAdjudicators(debates, teamsMap, adjudicators, new Map(), options({ panelSize: 3 }), context);

    expect(elapsed).toBeLessThan(15_000);
    expect(second).toEqual(first);
    const assigned = first.flatMap(members);
    expect(assigned).toHaveLength(360);
    expect(new Set(assigned).size).toBe(360);
  }, 60_000);
});

describe("preformed panels", () => {
  const { teams, teamsMap } = setup(6);
  const debates = [
    debate("high", teams.slice(0, 2), { importance: 10 }),
    debate("low", teams.slice(2, 4), { roomRank: 2 }),
    debate("open", teams.slice(4), { roomRank: 3 }),
  ];
  const adjudicators = [
    adj("p1-chair", 8),
    adj("p1-wing", 6),
    adj("p2-chair", 7),
    adj("p2-wing", 5, { institutionId: "inst-2", institutionName: "inst-2" }),
    adj("free", 4),
    adj("away", 9, { checkedIn: false }),
  ];
  const context = (preformedPanels: Parameters<typeof placePreformedPanels>[0]) => ({
    allPastDebates: [],
    standings: [],
    breakCategories: [],
    totalPrelimRounds: 1,
    completedRounds: 0,
    isBP: false,
    preformedPanels,
  });

  it("places panels as units by importance and fills other debates from the remaining pool", () => {
    const result = autoAllocateAdjudicators(
      debates,
      teamsMap,
      adjudicators,
      new Map(),
      options({ panelSize: 1 }),
      context([
        { id: "p2", chairId: "p2-chair", panellistIds: ["p2-wing"], traineeIds: [], importance: 0 },
        { id: "p1", chairId: "p1-chair", panellistIds: ["p1-wing", "away"], traineeIds: [], importance: 10 },
      ])
    );
    const byId = (id: string) => result.find((item) => item.debateId === id)!;
    expect(byId("high")).toMatchObject({ chairId: "p1-chair", panellistIds: ["p1-wing"] });
    // p2-wing is from inst-2, which is in "low"; the panel goes to the open debate instead.
    expect(byId("open")).toMatchObject({ chairId: "p2-chair", panellistIds: ["p2-wing"] });
    expect(byId("low")).toMatchObject({ chairId: "free", panellistIds: [] });
  });

  it("does not place a panel without available voting members", () => {
    const placements = placePreformedPanels(
      [{ id: "empty", chairId: "away", panellistIds: [], traineeIds: [], importance: 5 }],
      debates,
      {
        adjById: new Map(adjudicators.filter((item) => item.checkedIn).map((item) => [item.id, item])),
        adjScores: new Map(),
        priorityOf: () => 5,
        teamsOf: () => [],
        pastAdjTeams: new Map(),
        options: options(),
        weights: getAllocationWeights(),
        includePanellists: true,
        includeTrainees: true,
      }
    );
    expect(placements.size).toBe(0);
  });
});

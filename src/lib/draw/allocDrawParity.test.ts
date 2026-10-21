/**
 * Regression tests for the allocation and draw parity fixes against Tabbycat v2.12.1
 * (alloc-draw-bugs): room shortages, refused allocations, the adjudicator conflict model, the
 * Tabbycat-ported allocator costs, preformed panels, odd brackets, draw flags and swap random draws.
 */
import { describe, expect, it } from "vitest";
import type { Adjudicator, Debate, DebateSide, PreformedPanel, Team, Venue } from "@/types";
import {
  AdjudicatorAllocationError,
  adjudicatorsShareInstitution,
  allocateAdjudicatorsToPreformedPanels,
  autoAllocateAdjudicators,
  calculateAdjDebateConflict,
  createTabbycatCostModel,
  getAllocationWeights,
  placePreformedPanels,
  tabbycatAdjTeamConflict,
  type AllocationOptions,
} from "./allocator";
import {
  hungarianStrengthCost,
  normalisedAdjudicatorScore,
  scoreRangeWarnings,
} from "./tabbycatHungarian";
import { clampDebateImportance, tabbycatImportanceLevel } from "./importance";
import { allocateVenuesBestEffort, allocateVenuesToDebates, applyAdjudicatorVenueRequirements } from "./venueAllocator";
import { assertIntegerBracketsForIntermediate, resolveOddBrackets, type RankedTeamStats } from "./oddBrackets";
import { oneUpOneDown, oneUpOneDownFlags, swapRandomRooms } from "./conflictAvoidance";
import { generateRandomTwoTeamDraw } from "./twoTeamDraw";
import { minCostPairBracket } from "./minCostPairing";
import { bpPositionBaseCost } from "./sideAllocator";
import { createSeededRng } from "./rng";
import type { MatchupHistory } from "./history";

const T = "t1";

function team(id: string, institutionId?: string, extra: Partial<Team> = {}): Team {
  return {
    id,
    tournamentId: T,
    name: id,
    speakers: [],
    breakCategories: [],
    speakerCategories: [],
    ...(institutionId ? { institutionId, institutionName: institutionId } : {}),
    ...extra,
  };
}

function adj(id: string, baseScore = 5, extra: Partial<Adjudicator> = {}): Adjudicator {
  return { id, tournamentId: T, name: id, baseScore, checkedIn: true, trainee: false, independent: false, conflicts: [], ...extra };
}

function debate(id: string, teams: Team[], extra: Partial<Debate> = {}): Debate {
  const sides: DebateSide[] = ["AFF", "NEG"];
  return {
    id,
    tournamentId: T,
    roundId: "r1",
    roundSeq: 1,
    bracket: 0,
    roomRank: 1,
    importance: 0,
    resultStatus: "none",
    sidesConfirmed: true,
    flags: [],
    teams: Object.fromEntries(teams.map((item, index) => [sides[index], { teamId: item.id, teamName: item.name, side: sides[index] }])) as Debate["teams"],
    adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    ...extra,
  };
}

function venue(id: string, extra: Partial<Venue> = {}): Venue {
  return { id, tournamentId: T, name: id, priority: 10, available: true, ...extra };
}

const options = (extra: Partial<AllocationOptions> = {}): AllocationOptions => ({
  panelSize: 1,
  balancePanels: true,
  respectInstitutionConflicts: true,
  respectPersonalConflicts: true,
  respectHistoryConflicts: true,
  ...extra,
});

const emptyHistory = (): MatchupHistory => ({ opponents: new Map(), sides: new Map() });
const historyOf = (pairs: [string, string][]): MatchupHistory => {
  const history = emptyHistory();
  for (const [a, b] of pairs) {
    history.opponents.set(a, new Set([...(history.opponents.get(a) ?? []), b]));
    history.opponents.set(b, new Set([...(history.opponents.get(b) ?? []), a]));
  }
  return history;
};

describe("room allocation never aborts (Tabbycat VenueAllocator)", () => {
  it("allocates the rooms that fit and reports the debates left without one", () => {
    const debates = [debate("d1", [], { roomRank: 1, bracket: 2 }), debate("d2", [], { roomRank: 2, bracket: 1 }), debate("d3", [], { roomRank: 3 })];
    const outcome = allocateVenuesBestEffort(debates, [venue("v1", { priority: 20 }), venue("v2")]);
    expect([...outcome.assignments.keys()].sort()).toEqual(["d1", "d2"]);
    expect(outcome.unassigned).toEqual([{ debateId: "d3", message: expect.stringContaining("Not enough available venues") }]);
    // The strict wrapper keeps its old contract for callers that need every room.
    expect(() => allocateVenuesToDebates(debates, [venue("v1")])).toThrow("Not enough available venues: 3 required, but only 1 available.");
  });

  it("never gives a debate an unsuitable room; it is reported instead", () => {
    const debates = [debate("needs", [], { requiresAccessibleVenue: true }), debate("plain", [], { roomRank: 2 })];
    const outcome = allocateVenuesBestEffort(debates, [venue("stairs"), venue("other")]);
    expect(outcome.assignments.get("plain")).toBeDefined();
    expect(outcome.assignments.has("needs")).toBe(false);
    expect(outcome.unassigned[0].message).toMatch(/No available venue meets the requirements/);
  });

  it("reports a panel with clashing hard room categories instead of throwing", () => {
    const panel = debate("d", [], {
      adjudicators: { chairId: "a", panellistIds: ["b"], panellistNames: [], traineeIds: [], traineeNames: [] },
    });
    const result = applyAdjudicatorVenueRequirements(
      [panel],
      [adj("a", 5, { venueRequirements: { category: "Ground" } }), adj("b", 5, { venueRequirements: { category: "Online" } })]
    );
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].message).toMatch(/incompatible venue categories: Ground, Online/);
    expect(result.debates[0].requiredVenueCategory).toBeUndefined();
  });
});

describe("refusing an allocation instead of emptying panels (Tabbycat AdjudicatorAllocationError)", () => {
  const teams = [team("a"), team("b")];
  const teamsMap = new Map(teams.map((item) => [item.id, item]));
  it("throws when nobody is available", () => {
    expect(() => autoAllocateAdjudicators([debate("d", teams)], teamsMap, [adj("away", 5, { checkedIn: false })], new Map(), options()))
      .toThrow(AdjudicatorAllocationError);
  });

  it("throws when nobody may vote, in every strategy", () => {
    for (const strategy of ["crabbytab_v1", "tabbycat_voting", "tabbycat_consensus"] as const) {
      expect(() =>
        autoAllocateAdjudicators([debate("d", teams)], teamsMap, [adj("t", 5, { trainee: true })], new Map(), options({ panelStrengthStrategy: strategy }))
      ).toThrow(/no adjudicators eligible to be a chair or panellist/);
    }
  });
});

describe("Tabbycat's adjudicator conflict model", () => {
  it("adjudicators sharing a conflicted institution conflict; the clash is reported on the panel", () => {
    const chair = adj("chair", 8, { institutionId: "uni", institutionName: "Uni" });
    const trainee = adj("trainee", 3, { institutionId: "uni", institutionName: "Uni", trainee: true });
    expect(adjudicatorsShareInstitution(chair, trainee)).toBe(true);
    const report = calculateAdjDebateConflict(trainee, [], new Map(), undefined, [chair]);
    expect(report.hasAdjudicatorClash).toBe(true);
    expect(report.reasons).toEqual(['Institutional clash with adjudicator "chair"']);
    // A declared institution conflict counts too, and an independent adjudicator has no own institution.
    const declared = adj("declared", 5, { independent: true, conflicts: [{ type: "institution", institutionId: "uni" }] });
    expect(adjudicatorsShareInstitution(declared, chair)).toBe(true);
    expect(adjudicatorsShareInstitution(adj("free", 5, { independent: true, institutionId: "uni" }), chair)).toBe(false);
  });

  it("adjudicator-team conflicts intersect declared institutions and count once per team", () => {
    const judge = adj("j", 5, { institutionId: "own", conflicts: [{ type: "institution", institutionId: "old" }, { type: "personal", teamId: "x" }] });
    expect(tabbycatAdjTeamConflict(judge, team("x", "own"))).toBe(true);
    expect(tabbycatAdjTeamConflict(judge, team("y", "else", { institutionConflictIds: ["old"] }))).toBe(true);
    expect(tabbycatAdjTeamConflict(judge, team("z", "else"))).toBe(false);
    const weights = getAllocationWeights({ adjConflictPenalty: 100, adjHistoryPenalty: 7 });
    const model = createTabbycatCostModel([], new Map([["j", new Set(["x"])]]), options(), weights);
    // Personal and own-institution conflict with the same team: one conflict penalty, plus history.
    expect(model.teamCost(judge, [team("x", "own")])).toBe(107);
  });

  it("tabbycat_voting seats a trainee away from a chair of its own institution", () => {
    const teams = [team("a"), team("b"), team("c"), team("d")];
    const teamsMap = new Map(teams.map((item) => [item.id, item]));
    const debates = [debate("d1", teams.slice(0, 2), { importance: 10 }), debate("d2", teams.slice(2), { roomRank: 2 })];
    const adjudicators = [
      adj("chairA", 9, { institutionId: "A", institutionName: "A" }),
      adj("chairB", 8, { institutionId: "B", institutionName: "B" }),
      adj("traineeA", 3, { trainee: true, institutionId: "A", institutionName: "A" }),
    ];
    const results = autoAllocateAdjudicators(debates, teamsMap, adjudicators, new Map(), options({ panelStrengthStrategy: "tabbycat_voting" }));
    const withTrainee = results.find((result) => result.traineeIds.includes("traineeA"))!;
    expect(withTrainee.chairId).toBe("chairB");
    expect(results.flatMap((result) => result.conflicts)).toEqual([]);
  });
});

describe("Tabbycat strategies use Tabbycat's cost terms", () => {
  it("normalises scores from the adjudicator range and warns about scores outside it", () => {
    expect(normalisedAdjudicatorScore(1)).toBe(0);
    expect(normalisedAdjudicatorScore(10)).toBe(5);
    expect(scoreRangeWarnings([{ id: "a", score: 11 }, { id: "b", score: 0 }, { id: "c", score: 5 }])).toEqual([
      "1 score is larger than the maximum permitted adjudicator score (10.0).",
      "1 score is smaller than the minimum permitted adjudicator score (1.0).",
    ]);
    // Importance 10 (Tabbycat 1) with a perfect adjudicator: diff = 5 + 4 - 5 = 4 > 0.25.
    expect(hungarianStrengthCost(10, 10)).toBeCloseTo(1000 * Math.exp(3.75) + 5, 6);
  });

  it("maps importance onto Tabbycat's levels and clamps the old -2..10 API values", () => {
    expect([0, 3, 7, 10].map(tabbycatImportanceLevel)).toEqual([-2, -1, 0, 1]);
    expect(clampDebateImportance(-2)).toBe(0);
    expect(clampDebateImportance(12)).toBe(10);
    expect(clampDebateImportance(undefined)).toBe(0);
  });

  it("orders debates by their own importance, not CrabbyTab's composite priority", () => {
    const teams = [team("a"), team("b"), team("c"), team("d")];
    const teamsMap = new Map(teams.map((item) => [item.id, item]));
    // The high bracket debate has importance 0; the low bracket one importance 10.
    const debates = [debate("high-bracket", teams.slice(0, 2), { bracket: 5 }), debate("important", teams.slice(2), { bracket: 0, importance: 10, roomRank: 2 })];
    const results = autoAllocateAdjudicators(debates, teamsMap, [adj("best", 9), adj("weak", 2)], new Map(), options({ panelStrengthStrategy: "tabbycat_consensus" }));
    expect(results.find((result) => result.debateId === "important")!.chairId).toBe("best");
  });

  it("uses the base score for a round without a feedback weight (Tabbycat's default 0)", () => {
    const teams = [team("a"), team("b"), team("c"), team("d")];
    const teamsMap = new Map(teams.map((item) => [item.id, item]));
    const debates = [debate("top", teams.slice(0, 2), { importance: 10 }), debate("low", teams.slice(2), { roomRank: 2 })];
    const context = {
      allPastDebates: [], standings: [], breakCategories: [], totalPrelimRounds: 1, completedRounds: 0, isBP: false,
      feedbackScores: new Map([["rated", 10]]),
    };
    const tabbycat = autoAllocateAdjudicators(debates, teamsMap, [adj("rated", 3), adj("steady", 6)], new Map(), options({ panelStrengthStrategy: "tabbycat_consensus" }), context);
    expect(tabbycat.find((result) => result.debateId === "top")!.chairId).toBe("steady");
    // CrabbyTab's own strategy keeps the legacy 60% blend for such rounds.
    const own = autoAllocateAdjudicators(debates, teamsMap, [adj("rated", 3), adj("steady", 6)], new Map(), options(), context);
    expect(own.find((result) => result.debateId === "top")!.chairId).toBe("rated");
  });
});

describe("preformed panels", () => {
  const teams = [team("a"), team("b"), team("c"), team("d")];
  const teamsMap = new Map(teams.map((item) => [item.id, item]));
  const placementInput = (adjudicators: Adjudicator[], warnings: string[] = []) => ({
    adjById: new Map(adjudicators.map((item) => [item.id, item])),
    adjScores: new Map<string, number>(),
    priorityOf: (item: Debate) => item.bracket,
    teamsOf: (item: Debate) => Object.values(item.teams).map((slot) => teamsMap.get(slot.teamId)!),
    pastAdjTeams: new Map<string, Set<string>>(),
    options: options(),
    weights: getAllocationWeights(),
    includePanellists: true,
    includeTrainees: true,
    warnings,
    nameOf: (id: string) => id.toUpperCase(),
  });

  it("an importance-10 panel goes to the importance-10 debate, even in a lower bracket", () => {
    const debates = [debate("bracket-3", teams.slice(0, 2), { bracket: 3 }), debate("vital", teams.slice(2), { bracket: 0, importance: 10, roomRank: 2 })];
    const panels: PreformedPanel[] = [
      { id: "top", chairId: "x", panellistIds: [], traineeIds: [], importance: 10 },
      { id: "plain", chairId: "y", panellistIds: [], traineeIds: [], importance: 0 },
    ];
    const placements = placePreformedPanels(panels, debates, placementInput([adj("x"), adj("y")]));
    expect(placements.get("vital")?.id).toBe("top");
    expect(placements.get("bracket-3")?.id).toBe("plain");
  });

  it("reports members left out because they are unavailable", () => {
    const warnings: string[] = [];
    placePreformedPanels(
      [
        { id: "p1", chairId: "x", panellistIds: ["gone"], traineeIds: [], importance: 0, roomRank: 1 },
        { id: "p2", chairId: "absent", panellistIds: [], traineeIds: [], importance: 0, roomRank: 2 },
      ],
      [debate("d", teams.slice(0, 2))],
      placementInput([adj("x")], warnings)
    );
    expect(warnings).toEqual([
      "Preformed panel 1: GONE is not available this round and was left out.",
      "Preformed panel 2: ABSENT is not available this round and was left out.",
      "Preformed panel 2 has no available voting adjudicator and was not placed.",
    ]);
  });

  it("fills panels with Tabbycat's consensus allocator, strongest voters in the most important panels", () => {
    const panels: PreformedPanel[] = [
      { id: "low", panellistIds: [], traineeIds: [], importance: 0, roomRank: 2 },
      { id: "high", panellistIds: [], traineeIds: [], importance: 10, roomRank: 1 },
    ];
    const adjudicators = [adj("a", 9), adj("b", 8), adj("c", 4), adj("d", 3), adj("t", 2, { trainee: true })];
    const { panels: filled } = allocateAdjudicatorsToPreformedPanels(panels, adjudicators, { mode: "consensus", roundId: "r1" });
    const high = filled.find((panel) => panel.id === "high")!;
    expect(high.chairId).toBe("a");
    const seated = filled.flatMap((panel) => [panel.chairId, ...panel.panellistIds, ...panel.traineeIds]);
    expect(new Set(seated).size).toBe(seated.length);
    expect(seated.sort()).toEqual(["a", "b", "c", "d", "t"]);
    expect(filled.find((panel) => panel.traineeIds.includes("t"))).toBeDefined();
  });

  it("refuses to fill when there are no panels or nobody may vote", () => {
    expect(() => allocateAdjudicatorsToPreformedPanels([], [adj("a")], { mode: "voting", roundId: "r1" })).toThrow(/aren't any panels/);
    expect(() =>
      allocateAdjudicatorsToPreformedPanels(
        [{ id: "p", panellistIds: [], traineeIds: [], importance: 0 }],
        [adj("t", 5, { trainee: true })],
        { mode: "voting", roundId: "r1" }
      )
    ).toThrow(AdjudicatorAllocationError);
  });
});

describe("odd brackets (Tabbycat powerpair.py)", () => {
  const stats = (id: string, institution?: string): RankedTeamStats => ({ team: team(id, institution), pullups: 0, drawStrengthWins: 0, drawStrengthSpeaks: 0 });

  it("refuses intermediate brackets on a non-integer first metric", () => {
    expect(() => assertIntegerBracketsForIntermediate("intermediate", [2, 1.5, 1])).toThrow(
      "1 out of 3 teams have a noninteger first metric in the team standings."
    );
    expect(() => assertIntegerBracketsForIntermediate("pullup_top", [1.5])).not.toThrow();
  });

  it("labels an intermediate bracket the lower bracket + 0.5 and bubbles down when a points level is empty", () => {
    // Brackets 3 and 1 (nothing on 2): Tabbycat labels the intermediate 1.5; there is no bracket
    // 2 to bubble up into, so it bubbles down into bracket 1.
    const brackets = [
      { wins: 3, teams: [stats("A1"), stats("A2"), stats("A3", "X")] },
      { wins: 1, teams: [stats("C1", "X"), stats("C2"), stats("C3")] },
    ];
    const conflict = (a: Team, b: Team) => (a.institutionId && a.institutionId === b.institutionId ? "inst" as const : false);
    const groups = resolveOddBrackets(brackets, "intermediate_bubble", "none", Math.random, conflict);
    expect(groups.map((group) => `${group.bracket}:${group.teams.map((item) => item.id).join(",")}`)).toEqual([
      "3:A1,A2",
      "1.5:A3,C2",
      "1:C1,C3",
    ]);
    const flags = Object.assign({}, ...groups.map((group) => group.teamFlags ?? {}));
    expect(flags).toEqual({ C1: ["bub_dn_inst"], C2: ["bub_dn_accom"] });
  });

  it("flags an intermediate clash it cannot bubble away", () => {
    const brackets = [
      { wins: 2, teams: [stats("A1", "X")] },
      { wins: 1, teams: [stats("B1", "X")] },
    ];
    const groups = resolveOddBrackets(brackets, "intermediate_bubble", "none", Math.random, () => "hist");
    expect(groups[0].teamFlags).toEqual({ A1: ["no_bub_updn"] });
  });
});

describe("draw flags and swap random draws", () => {
  it("records Tabbycat's one-up-one-down flags on the swapped rooms", () => {
    const rooms = [[team("a1"), team("n1")], [team("a2"), team("n2")]];
    const history = historyOf([["a1", "n1"]]);
    const swapped = oneUpOneDown(rooms, history, { repeatMatchupPenalty: 1000, institutionClashPenalty: 1 });
    expect(swapped.map((room) => room.map((item) => item.id))).toEqual([["a1", "n2"], ["a2", "n1"]]);
    expect(oneUpOneDownFlags(rooms, swapped, history)).toEqual([["1u1d_hist"], ["1u1d_other"]]);
  });

  it("swaps random rooms to remove clashes, flagging max_swapped when it cannot", () => {
    const fixable = swapRandomRooms(
      [[team("a"), team("b")], [team("c"), team("d")]],
      historyOf([["a", "b"]]),
      { repeatMatchupPenalty: 1000, institutionClashPenalty: 1 },
      createSeededRng(3)
    );
    expect(fixable.rooms.map((room) => room.map((item) => item.id))).toEqual([["a", "d"], ["c", "b"]]);
    expect(fixable.flags).toEqual([[], []]);
    const hopeless = swapRandomRooms(
      [[team("a", "U"), team("b", "U")], [team("c", "U"), team("d", "U")]],
      emptyHistory(),
      { repeatMatchupPenalty: 1000, institutionClashPenalty: 1 },
      createSeededRng(3)
    );
    expect(hopeless.flags).toEqual([["max_swapped"], ["max_swapped"]]);
  });

  it("random two-team draws use the swap generator with one-up-one-down and min-cost matching on request", () => {
    const teams = ["a", "b", "c", "d", "e", "f"].map((id) => team(id, id === "a" || id === "b" ? "U" : undefined));
    const swap = generateRandomTwoTeamDraw(teams, emptyHistory(), "wsdc", { conflictAvoidance: "one_up_one_down" }, createSeededRng(1));
    const minCost = generateRandomTwoTeamDraw(teams, emptyHistory(), "wsdc", { conflictAvoidance: "min_cost" }, createSeededRng(1));
    for (const draw of [swap, minCost]) {
      expect(draw.flatMap((room) => room.teams.map((item) => item.id)).sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
      expect(draw.some((room) => room.teams.every((item) => item.institutionId === "U"))).toBe(false);
    }
  });

  it("pairing deviations use Tabbycat's subrank, so fully tied teams count as equal", () => {
    const teams = ["a", "b", "c", "d"].map((id) => team(id));
    const rooms = minCostPairBracket(teams, emptyHistory(), {
      penalties: { repeatMatchupPenalty: 0, institutionClashPenalty: 0 },
      pairingMethod: "adjacent",
      pairingDeviationPenalty: 1,
      sideBalancePenalty: 0,
      previouslySawPullupPenalty: 0,
      isTopBracket: true,
      wins: new Map(),
      canMeet: () => true,
      // Every team tied: subrank 1 for all, so every pairing is equally adjacent (no negative costs).
      subrankOf: () => 1,
      rng: createSeededRng(1),
    });
    expect(rooms).toHaveLength(2);
  });

  it("BP variance position cost is Tabbycat's population variance", () => {
    expect(bpPositionBaseCost(["OG", "OG", "OO"], "OG", { bpPositionCost: "sum_squared_deviations" })).toBe(1.5);
  });
});

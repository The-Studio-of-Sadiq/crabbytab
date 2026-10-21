import { describe, it, expect } from "vitest";
import { allocateSidesForDebate, bpPositionBaseCost, computeBPSideCost } from "./sideAllocator";
import { createSeededRng } from "./rng";
import { Team, DebateSide } from "@/types";

function makeTeam(id: string, name: string): Team {
  return {
    id,
    tournamentId: "t1",
    name,
    speakers: [],
    breakCategories: [],
    speakerCategories: [],
  };
}

describe("Side Allocator (sideAllocator)", () => {
  it("balances BP sides over several rounds", () => {
    const t1 = makeTeam("t1", "Team 1");
    const t2 = makeTeam("t2", "Team 2");
    const t3 = makeTeam("t3", "Team 3");
    const t4 = makeTeam("t4", "Team 4");
    const teams = [t1, t2, t3, t4];

    // History:
    // t1 was OG, OO
    // t2 was CG, CO
    // t3 was OG, CG
    // t4 was OO, CO
    const history = new Map<string, DebateSide[]>();
    history.set("t1", ["OG", "OO"]); // Needs closing (CG or CO)
    history.set("t2", ["CG", "CO"]); // Needs opening (OG or OO)
    history.set("t3", ["OG", "CG"]); // Gov heavy (needs Opp: OO or CO)
    history.set("t4", ["OO", "CO"]); // Opp heavy (needs Gov: OG or CG)

    const allocation = allocateSidesForDebate(teams, history, "bp", "balanced");

    // Check all 4 sides are assigned
    expect(allocation.OG).toBeDefined();
    expect(allocation.OO).toBeDefined();
    expect(allocation.CG).toBeDefined();
    expect(allocation.CO).toBeDefined();

    // Check all 4 teams placed
    const placedIds = new Set([allocation.OG.id, allocation.OO.id, allocation.CG.id, allocation.CO.id]);
    expect(placedIds.size).toBe(4);

    // t2 was both Closing, so it shouldn't get CG or CO if avoidable
    expect(["OG", "OO"]).toContain(
      Object.entries(allocation).find(([_, team]) => team.id === "t2")?.[0]
    );

    // t1 was both Opening, so it shouldn't get OG or OO if avoidable
    expect(["CG", "CO"]).toContain(
      Object.entries(allocation).find(([_, team]) => team.id === "t1")?.[0]
    );
  });

  it("balances Two-Team (AFF / NEG) sides over rounds", () => {
    const t1 = makeTeam("t1", "Team 1");
    const t2 = makeTeam("t2", "Team 2");
    const history = new Map<string, DebateSide[]>();
    history.set("t1", ["AFF", "AFF"]); // Needs NEG
    history.set("t2", ["NEG", "NEG"]); // Needs AFF

    const allocation = allocateSidesForDebate([t1, t2], history, "uadc", "balanced");
    expect(allocation.NEG.id).toBe("t1");
    expect(allocation.AFF.id).toBe("t2");
  });

  it("random mode still returns a valid assignment with all sides assigned", () => {
    const t1 = makeTeam("t1", "Team 1");
    const t2 = makeTeam("t2", "Team 2");
    const t3 = makeTeam("t3", "Team 3");
    const t4 = makeTeam("t4", "Team 4");
    const teams = [t1, t2, t3, t4];
    const history = new Map<string, DebateSide[]>();

    const allocation = allocateSidesForDebate(teams, history, "bp", "random");
    expect(allocation.OG).toBeDefined();
    expect(allocation.OO).toBeDefined();
    expect(allocation.CG).toBeDefined();
    expect(allocation.CO).toBeDefined();

    const placedIds = new Set([allocation.OG.id, allocation.OO.id, allocation.CG.id, allocation.CO.id]);
    expect(placedIds.size).toBe(4);
  });

  it("matches Tabbycat's position cost formulas", () => {
    // Shannon entropy (α = 1): C = n · (2 − H), H in bits, after adding the candidate position.
    expect(bpPositionBaseCost([], "OG")).toBe(2);
    expect(bpPositionBaseCost(["OG"], "OG")).toBe(4);
    expect(bpPositionBaseCost(["OG"], "OO")).toBe(2);
    expect(bpPositionBaseCost(["OG", "OO", "CG"], "CO")).toBe(0);
    // Hartley (α = 0) and collision (α = 2) entropy.
    expect(bpPositionBaseCost(["OG"], "OO", { renyiOrder: 0 })).toBe(2);
    expect(bpPositionBaseCost(["OG", "OG"], "OO", { renyiOrder: 0 })).toBeCloseTo(3, 10);
    expect(bpPositionBaseCost(["OG", "OG"], "OO", { renyiOrder: 2 })).toBeCloseTo((2 + Math.log2(5 / 9)) * 3, 10);
    // Tabbycat "variance" (statistics.pvariance): counts [3,1,0,0], mean 1, squared deviations 6, / 4.
    expect(bpPositionBaseCost(["OG", "OG", "OO"], "OG", { bpPositionCost: "sum_squared_deviations" })).toBe(1.5);
    // Legacy saved value.
    expect(bpPositionBaseCost(["OG", "OG", "OO"], "OG", { bpPositionCost: "std_dev" as never })).toBe(1.5);
    expect(() => bpPositionBaseCost([], "OG", { renyiOrder: -1 })).toThrow(/negative/);
  });

  it("raises the base cost to the exponent, with no extra repeat-position penalty", () => {
    expect(computeBPSideCost(["OG", "OG", "OO"], "OG", { bpPositionCost: "sum_squared_deviations" })).toBe(1.5 ** 4);
    expect(computeBPSideCost(["OG"], "OG", { bpPositionCostExponent: 2 })).toBe(16);
    expect(computeBPSideCost(["OG", "OO", "CG"], "CO")).toBe(0);
  });

  it("two-team balance: equal histories are decided by the seeded random source", () => {
    const teams = [makeTeam("t1", "Team 1"), makeTeam("t2", "Team 2")];
    const history = new Map<string, DebateSide[]>();
    const affFor = (seed: number) => allocateSidesForDebate(teams, history, "uadc", "balanced", {}, createSeededRng(seed)).AFF.id;
    expect(affFor(4)).toBe(affFor(4));
    expect(new Set(Array.from({ length: 20 }, (_, seed) => affFor(seed)))).toEqual(new Set(["t1", "t2"]));
  });

  it("throws if team count does not match format sides", () => {
    const t1 = makeTeam("t1", "Team 1");
    const history = new Map<string, DebateSide[]>();
    expect(() => allocateSidesForDebate([t1], history, "bp")).toThrow(
      "Expected 4 teams for side allocation, got 1"
    );
  });

  it("enforces maxTimesPerSide as a hard limit for BP assignments", () => {
    const teams = Array.from({ length: 4 }, (_, index) => makeTeam(`t${index}`, `Team ${index}`));
    const history = new Map<string, DebateSide[]>([["t0", ["OG"]]]);
    const allocation = allocateSidesForDebate(teams, history, "bp", "balanced", { maxTimesPerSide: 1 });
    expect(Object.entries(allocation).find(([, team]) => team.id === "t0")?.[0]).not.toBe("OG");
  });

  it("enforces maxAllowedSideImbalance as a hard limit for BP assignments", () => {
    const teams = Array.from({ length: 4 }, (_, index) => makeTeam(`t${index}`, `Team ${index}`));
    const history = new Map<string, DebateSide[]>([["t0", ["OG", "OG", "OG"]]]);
    const allocation = allocateSidesForDebate(teams, history, "bp", "balanced", {
      maxAllowedSideImbalance: 3,
    });
    expect(Object.entries(allocation).find(([, team]) => team.id === "t0")?.[0]).not.toBe("OG");
  });

  // Regression: maxTimesPerSide (default 5) was a hard limit, so an 11th two-team round could not
  // be drawn. As in Tabbycat it only steers minimum-cost pairing and is reported as a warning.
  it("still allocates an 11th two-team round with the default of 5 times per side", () => {
    const teams = [makeTeam("t1", "Team 1"), makeTeam("t2", "Team 2")];
    const history = new Map<string, DebateSide[]>([
      ["t1", ["AFF", "NEG", "AFF", "NEG", "AFF", "NEG", "AFF", "NEG", "AFF", "NEG"]],
      ["t2", ["AFF", "NEG", "AFF", "NEG", "AFF", "NEG", "AFF", "NEG", "AFF", "NEG"]],
    ]);
    const allocation = allocateSidesForDebate(teams, history, "uadc", "balanced", { maxTimesPerSide: 5 });
    expect(new Set([allocation.AFF.id, allocation.NEG.id])).toEqual(new Set(["t1", "t2"]));
  });

  it("throws for a two-team room where neither orientation fits the imbalance limit", () => {
    const teams = [makeTeam("t1", "Team 1"), makeTeam("t2", "Team 2")];
    const history = new Map<string, DebateSide[]>([
      ["t1", ["AFF", "AFF"]],
      ["t2", ["AFF", "AFF"]],
    ]);
    expect(() => allocateSidesForDebate(teams, history, "uadc", "balanced", { maxAllowedSideImbalance: 1 })).toThrow(
      /Team 1 vs Team 2/
    );
  });

  it("enforces side-imbalance limits for two-team assignments", () => {
    const teams = [makeTeam("t1", "Team 1"), makeTeam("t2", "Team 2")];
    const history = new Map<string, DebateSide[]>([["t1", ["AFF", "AFF", "AFF"]]]);
    const allocation = allocateSidesForDebate(teams, history, "uadc", "balanced", {
      maxAllowedSideImbalance: 2,
    });
    expect(allocation.NEG.id).toBe("t1");
  });

  it("never applies maxTimesPerSide to BP (Tabbycat does not)", () => {
    const teams = Array.from({ length: 4 }, (_, index) => makeTeam(`t${index}`, `Team ${index}`));
    const history = new Map<string, DebateSide[]>(
      teams.map((team) => [
        team.id,
        ["OG", "OO", "CG", "CO", "OG", "OO", "CG", "CO", "OG", "OO", "CG", "CO", "OG", "OO", "CG", "CO", "OG", "OO", "CG", "CO"],
      ])
    );
    const allocation = allocateSidesForDebate(teams, history, "bp", "random", { maxTimesPerSide: 5 });
    expect(Object.keys(allocation).sort()).toEqual(["CG", "CO", "OG", "OO"]);
  });

  it("throws explicitly when no BP assignment can satisfy the imbalance limit", () => {
    const teams = Array.from({ length: 4 }, (_, index) => makeTeam(`t${index}`, `Team ${index}`));
    const history = new Map<string, DebateSide[]>(teams.map((team) => [team.id, ["OG", "OO", "CG"]]));
    expect(() => allocateSidesForDebate(teams, history, "bp", "random", { maxAllowedSideImbalance: 1 }))
      .toThrow(/No side assignment satisfies the configured side limits \(a side imbalance of at most 1\)/);
  });
});

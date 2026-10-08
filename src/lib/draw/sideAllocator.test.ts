import { describe, it, expect } from "vitest";
import { allocateSidesForDebate, calculateSidePenalty, computeBPSideCost } from "./sideAllocator";
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

  it("calculates side penalties accurately", () => {
    // Repeated side incurs high penalty
    const penaltySame = calculateSidePenalty(["OG"], "OG", "bp");
    const penaltyDiff = calculateSidePenalty(["OG"], "OO", "bp");
    expect(penaltySame).toBeGreaterThan(penaltyDiff);
  });

  it("uses the configured sum-of-squared-deviations position cost", () => {
    expect(
      computeBPSideCost(["OG", "OG", "OO"], "OG", {
        bpPositionCost: "sum_squared_deviations",
      })
    ).toBe(1_296_000);
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

  it("enforces side-imbalance limits for two-team assignments", () => {
    const teams = [makeTeam("t1", "Team 1"), makeTeam("t2", "Team 2")];
    const history = new Map<string, DebateSide[]>([["t1", ["AFF", "AFF", "AFF"]]]);
    const allocation = allocateSidesForDebate(teams, history, "uadc", "balanced", {
      maxAllowedSideImbalance: 2,
    });
    expect(allocation.NEG.id).toBe("t1");
  });

  it("throws explicitly when no assignment can satisfy the configured hard limits", () => {
    const teams = Array.from({ length: 4 }, (_, index) => makeTeam(`t${index}`, `Team ${index}`));
    const history = new Map<string, DebateSide[]>(
      teams.map((team) => [
        team.id,
        ["OG", "OO", "CG", "CO", "OG", "OO", "CG", "CO", "OG", "OO", "CG", "CO", "OG", "OO", "CG", "CO", "OG", "OO", "CG", "CO"],
      ])
    );
    expect(() => allocateSidesForDebate(teams, history, "bp", "random", { maxTimesPerSide: 5 }))
      .toThrow("No side assignment satisfies the configured side limits.");
  });
});

import { describe, it, expect } from "vitest";
import { applyEliminationAdvancement, generateEliminationDraw, getAdvancingTeamIds } from "./elimination";
import { BallotSubmission, Debate, Team } from "@/types";

function makeBreakingTeam(seed: number): { team: Team; seed: number } {
  return {
    seed,
    team: {
      id: `team-${seed}`,
      tournamentId: "t1",
      name: `Team Seed ${seed}`,
      speakers: [],
      breakCategories: [],
      speakerCategories: [],
    },
  };
}

describe("Elimination Draw (draw/elimination)", () => {
  it("advances the top two BP teams from each completed debate", () => {
    const debate = {
      id: "bp-debate",
      teams: {
        OG: { teamId: "t1" }, OO: { teamId: "t2" },
        CG: { teamId: "t3" }, CO: { teamId: "t4" },
      },
    } as Debate;
    const ballot = {
      debateId: debate.id,
      confirmed: true,
      discarded: false,
      teamScores: {
        OG: { rank: 1, points: 3 }, OO: { rank: 2, points: 2 },
        CG: { rank: 3, points: 1 }, CO: { rank: 4, points: 0 },
      },
    } as BallotSubmission;

    expect([...getAdvancingTeamIds([debate], [ballot], "bp")].sort()).toEqual(["t1", "t2"]);
  });

  it("advances only the BP champion from the grand final", () => {
    const debate = {
      id: "bp-final",
      teams: {
        OG: { teamId: "t1" }, OO: { teamId: "t2" },
        CG: { teamId: "t3" }, CO: { teamId: "t4" },
      },
    } as Debate;
    const ballot = {
      debateId: debate.id,
      confirmed: true,
      discarded: false,
      teamScores: {
        OG: { rank: 1, points: 3 }, OO: { rank: 2, points: 2 },
        CG: { rank: 3, points: 1 }, CO: { rank: 4, points: 0 },
      },
    } as BallotSubmission;

    expect([...getAdvancingTeamIds([debate], [ballot], "bp", true)]).toEqual(["t1"]);
  });

  it("advances only the winner in two-team formats", () => {
    const debate = {
      id: "two-team-debate",
      teams: { AFF: { teamId: "aff" }, NEG: { teamId: "neg" } },
    } as Debate;
    const ballot = {
      debateId: debate.id,
      confirmed: true,
      discarded: false,
      teamScores: { AFF: { rank: 2, points: 0, win: false }, NEG: { rank: 1, points: 1, win: true } },
    } as BallotSubmission;

    expect([...getAdvancingTeamIds([debate], [ballot], "uadc")]).toEqual(["neg"]);
  });

  it("marks losing teams eliminated and retains the advancing team", () => {
    const debate = {
      id: "two-team-debate",
      teams: { AFF: { teamId: "aff" }, NEG: { teamId: "neg" } },
    } as Debate;
    const teams: Team[] = [
      { ...makeBreakingTeam(1).team, id: "aff", breakStatus: "breaking", breakCategoryIds: ["open"] },
      { ...makeBreakingTeam(2).team, id: "neg", breakStatus: "breaking", breakCategoryIds: ["open"] },
    ];

    const updated = applyEliminationAdvancement(teams, [debate], new Set(["neg"]), "r1");
    expect(updated.map((team) => [team.id, team.breakStatus, team.eliminatedInRoundId])).toEqual([
      ["aff", "eliminated", "r1"],
      ["neg", "breaking", undefined],
    ]);
  });

  describe("BP Elimination Draw", () => {
    it("builds a complete seeded BP round of 32", () => {
      const breaking = Array.from({ length: 32 }, (_, i) => makeBreakingTeam(i + 1));
      const draw = generateEliminationDraw(breaking, "bp", 32);

      expect(draw).toHaveLength(8);
      expect(draw[0].teams.map((entry) => entry.seed)).toEqual([1, 16, 17, 32]);
      expect(draw.flatMap((room) => room.teams.map((entry) => entry.team.id)).sort())
        .toEqual(breaking.map((entry) => entry.team.id).sort());
    });

    it("generates correct seedings for BP bracketSize 16 (Quarter-Finals)", () => {
      const breaking = Array.from({ length: 16 }, (_, i) => makeBreakingTeam(i + 1));
      const draw = generateEliminationDraw(breaking, "bp", 16);
      expect(draw).toHaveLength(4);

      // Standard BP 16 seedings:
      // Room 1: 1, 8, 9, 16
      // Room 2: 4, 5, 12, 13
      // Room 3: 2, 7, 10, 15
      // Room 4: 3, 6, 11, 14
      expect(draw[0].teams.map((t) => t.seed)).toEqual([1, 8, 9, 16]);
      expect(draw[1].teams.map((t) => t.seed)).toEqual([4, 5, 12, 13]);
      expect(draw[2].teams.map((t) => t.seed)).toEqual([2, 7, 10, 15]);
      expect(draw[3].teams.map((t) => t.seed)).toEqual([3, 6, 11, 14]);

      // Sides assigned
      expect(draw[0].teams.map((t) => t.side)).toEqual(["OG", "OO", "CG", "CO"]);
    });

    it("generates correct seedings for BP bracketSize 8 (Semi-Finals)", () => {
      const breaking = Array.from({ length: 8 }, (_, i) => makeBreakingTeam(i + 1));
      const draw = generateEliminationDraw(breaking, "bp", 8);
      expect(draw).toHaveLength(2);

      // Room 1: 1, 4, 5, 8
      // Room 2: 2, 3, 6, 7
      expect(draw[0].teams.map((t) => t.seed)).toEqual([1, 4, 5, 8]);
      expect(draw[1].teams.map((t) => t.seed)).toEqual([2, 3, 6, 7]);
    });

    it("generates correct seedings for BP bracketSize 4 (Grand Final)", () => {
      const breaking = Array.from({ length: 4 }, (_, i) => makeBreakingTeam(i + 1));
      const draw = generateEliminationDraw(breaking, "bp", 4);
      expect(draw).toHaveLength(1);
      expect(draw[0].bracketName).toBe("Grand Final");
      expect(draw[0].teams.map((t) => t.seed)).toEqual([1, 2, 3, 4]);
    });
  });

  describe("Two-Team Elimination Draw", () => {
    it("builds a complete seeded two-team round of 32", () => {
      const breaking = Array.from({ length: 32 }, (_, i) => makeBreakingTeam(i + 1));
      const draw = generateEliminationDraw(breaking, "uadc", 32);

      expect(draw).toHaveLength(16);
      expect(draw[0].teams.map((entry) => entry.seed)).toEqual([1, 32]);
      expect(draw.flatMap((room) => room.teams.map((entry) => entry.team.id)).sort())
        .toEqual(breaking.map((entry) => entry.team.id).sort());
    });

    it("generates correct seedings for Two-Team bracketSize 16 (Octo-Finals)", () => {
      const breaking = Array.from({ length: 16 }, (_, i) => makeBreakingTeam(i + 1));
      const draw = generateEliminationDraw(breaking, "uadc", 16);
      expect(draw).toHaveLength(8);

      // [1, 16], [8, 9], [4, 13], [5, 12], [2, 15], [7, 10], [3, 14], [6, 11]
      expect(draw[0].teams.map((t) => t.seed)).toEqual([1, 16]);
      expect(draw[1].teams.map((t) => t.seed)).toEqual([8, 9]);
      expect(draw[2].teams.map((t) => t.seed)).toEqual([4, 13]);
      expect(draw[3].teams.map((t) => t.seed)).toEqual([5, 12]);
      expect(draw[4].teams.map((t) => t.seed)).toEqual([2, 15]);
      expect(draw[5].teams.map((t) => t.seed)).toEqual([7, 10]);
      expect(draw[6].teams.map((t) => t.seed)).toEqual([3, 14]);
      expect(draw[7].teams.map((t) => t.seed)).toEqual([6, 11]);

      expect(draw[0].teams[0].side).toBe("AFF");
      expect(draw[0].teams[1].side).toBe("NEG");
    });

    it("generates correct seedings for Two-Team bracketSize 8 (Quarter-Finals)", () => {
      const breaking = Array.from({ length: 8 }, (_, i) => makeBreakingTeam(i + 1));
      const draw = generateEliminationDraw(breaking, "uadc", 8);
      expect(draw).toHaveLength(4);
      // [1, 8], [4, 5], [2, 7], [3, 6]
      expect(draw[0].teams.map((t) => t.seed)).toEqual([1, 8]);
      expect(draw[1].teams.map((t) => t.seed)).toEqual([4, 5]);
      expect(draw[2].teams.map((t) => t.seed)).toEqual([2, 7]);
      expect(draw[3].teams.map((t) => t.seed)).toEqual([3, 6]);
    });

    it("generates correct seedings for Two-Team bracketSize 4 (Semi-Finals)", () => {
      const breaking = Array.from({ length: 4 }, (_, i) => makeBreakingTeam(i + 1));
      const draw = generateEliminationDraw(breaking, "uadc", 4);
      expect(draw).toHaveLength(2);
      expect(draw[0].teams.map((t) => t.seed)).toEqual([1, 4]);
      expect(draw[1].teams.map((t) => t.seed)).toEqual([2, 3]);
    });

    it("generates correct seedings for Two-Team bracketSize 2 (Grand Final)", () => {
      const breaking = Array.from({ length: 2 }, (_, i) => makeBreakingTeam(i + 1));
      const draw = generateEliminationDraw(breaking, "uadc", 2);
      expect(draw).toHaveLength(1);
      expect(draw[0].teams.map((t) => t.seed)).toEqual([1, 2]);
    });
  });
});

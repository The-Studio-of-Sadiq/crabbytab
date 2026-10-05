import { describe, it, expect } from "vitest";
import {
  getAllocationWeights,
  autoAllocateAdjudicators,
  calculateAdjDebateConflict,
} from "./allocator";
import { Adjudicator, Debate, Team, TournamentPreferences } from "@/types";

function createAdj(id: string, name: string, score: number = 5, checkedIn: boolean = true, institutionId?: string): Adjudicator {
  return {
    id,
    tournamentId: "t1",
    name,
    score,
    checkedIn,
    trainee: false,
    independent: false,
    institutionId,
    institutionName: institutionId ? `Inst ${institutionId}` : undefined,
    conflicts: [],
  };
}

function createTeam(id: string, name: string, institutionId?: string): Team {
  return {
    id,
    tournamentId: "t1",
    name,
    institutionId,
    institutionName: institutionId ? `Inst ${institutionId}` : undefined,
    speakers: [],
    breakCategories: [],
    speakerCategories: [],
  };
}

function createDebate(id: string, teams: Team[]): Debate {
  const teamsMap: any = {};
  const sides = ["OG", "OO", "CG", "CO"];
  teams.forEach((t, i) => {
    teamsMap[sides[i] || `side-${i}`] = {
      teamId: t.id,
      teamName: t.name,
      side: sides[i] || `side-${i}`,
    };
  });
  return {
    id,
    tournamentId: "t1",
    roundId: "r1",
    roundSeq: 1,
    venueName: "Room 1",
    bracket: 0,
    roomRank: 1,
    importance: 0,
    resultStatus: "none",
    sidesConfirmed: true,
    flags: [],
    teams: teamsMap,
    adjudicators: {
      panellistIds: [],
      panellistNames: [],
      traineeIds: [],
      traineeNames: [],
    },
  };
}

describe("Adjudicator Allocator Preferences", () => {
  it("getAllocationWeights reflects configured penalties", () => {
    const customPrefs: TournamentPreferences = {
      adjConflictPenalty: 500_000,
      adjHistoryPenalty: 25_000,
      importanceMismatchPenalty: 2_000_000,
    };
    const weights = getAllocationWeights(customPrefs);
    expect(weights.INSTITUTION_CONFLICT).toBe(500_000);
    expect(weights.PERSONAL_CONFLICT).toBe(500_000);
    expect(weights.REPEAT_TEAM).toBe(25_000);
    expect(weights.PRIORITY_STRENGTH_MISMATCH).toBe(2_000_000);
  });

  it("respects minAdjScoreToVote by excluding judges below threshold from voting panel", () => {
    const teams = [createTeam("t1", "T1"), createTeam("t2", "T2")];
    const teamsMap = new Map<string, Team>();
    teams.forEach((t) => teamsMap.set(t.id, t));

    const debate = createDebate("d1", teams);
    const lowJudge = createAdj("adj-low", "Low Judge", 1.2); // Below 1.5
    const highJudge = createAdj("adj-high", "High Judge", 7.0);

    const result = autoAllocateAdjudicators(
      [debate],
      teamsMap,
      [lowJudge, highJudge],
      new Map(),
      {
        panelSize: 3,
        balancePanels: true,
        respectInstitutionConflicts: true,
        respectPersonalConflicts: true,
        respectHistoryConflicts: true,
        preferences: {
          minAdjScoreToVote: 2.0,
        },
      }
    );

    expect(result[0].chairId).toBe("adj-high");
    // lowJudge has score 1.2 < 2.0, so cannot be voting chair or panellist
    expect(result[0].panellistIds).not.toContain("adj-low");
    expect(result[0].traineeIds).toContain("adj-low");
  });

  it("respects skipAdjCheckins to allocate unchecked-in judges when true", () => {
    const teams = [createTeam("t1", "T1"), createTeam("t2", "T2")];
    const teamsMap = new Map<string, Team>();
    teams.forEach((t) => teamsMap.set(t.id, t));

    const debate = createDebate("d1", teams);
    const uncheckJudge = createAdj("adj-1", "Unchecked Judge", 6.0, false);

    // When skipAdjCheckins is false (default), unchecked judge is skipped
    const resSkipped = autoAllocateAdjudicators(
      [debate],
      teamsMap,
      [uncheckJudge],
      new Map(),
      {
        panelSize: 1,
        balancePanels: true,
        respectInstitutionConflicts: true,
        respectPersonalConflicts: true,
        respectHistoryConflicts: true,
        preferences: {
          skipAdjCheckins: false,
        },
      }
    );
    expect(resSkipped[0].chairId).toBeUndefined();

    // When skipAdjCheckins is true, unchecked judge is available and allocated
    const resAllowed = autoAllocateAdjudicators(
      [debate],
      teamsMap,
      [uncheckJudge],
      new Map(),
      {
        panelSize: 1,
        balancePanels: true,
        respectInstitutionConflicts: true,
        respectPersonalConflicts: true,
        respectHistoryConflicts: true,
        preferences: {
          skipAdjCheckins: true,
        },
      }
    );
    expect(resAllowed[0].chairId).toBe("adj-1");
  });

  it("respects noPanellistAdjs to hide and prevent panellist allocations", () => {
    const teams = [createTeam("t1", "T1"), createTeam("t2", "T2")];
    const teamsMap = new Map<string, Team>();
    teams.forEach((t) => teamsMap.set(t.id, t));

    const debate = createDebate("d1", teams);
    const j1 = createAdj("j1", "Judge 1", 7.0);
    const j2 = createAdj("j2", "Judge 2", 6.0);

    const res = autoAllocateAdjudicators(
      [debate],
      teamsMap,
      [j1, j2],
      new Map(),
      {
        panelSize: 3,
        balancePanels: true,
        respectInstitutionConflicts: true,
        respectPersonalConflicts: true,
        respectHistoryConflicts: true,
        preferences: {
          noPanellistAdjs: true,
        },
      }
    );

    expect(res[0].chairId).toBeDefined();
    expect(res[0].panellistIds).toHaveLength(0);
  });

  it("respects noTraineeAdjs to prevent trainee allocations", () => {
    const teams = [createTeam("t1", "T1"), createTeam("t2", "T2")];
    const teamsMap = new Map<string, Team>();
    teams.forEach((t) => teamsMap.set(t.id, t));

    const debate = createDebate("d1", teams);
    const j1 = createAdj("j1", "Chair", 7.0);
    const trainee = createAdj("tr", "Trainee", 1.0); // score < 1.5, will be trainee

    const res = autoAllocateAdjudicators(
      [debate],
      teamsMap,
      [j1, trainee],
      new Map(),
      {
        panelSize: 1,
        balancePanels: true,
        respectInstitutionConflicts: true,
        respectPersonalConflicts: true,
        respectHistoryConflicts: true,
        preferences: {
          noTraineeAdjs: true,
        },
      }
    );

    expect(res[0].chairId).toBe("j1");
    expect(res[0].traineeIds).toHaveLength(0);
  });
});

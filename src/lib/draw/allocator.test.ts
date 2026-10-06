import { describe, it, expect } from "vitest";
import {
  getAllocationWeights,
  autoAllocateAdjudicators,
  calculateAdjudicatorFeedbackScores,
  calculateAdjDebateConflict,
} from "./allocator";
import { Adjudicator, Debate, FeedbackSubmission, Team, TournamentPreferences } from "@/types";

function createAdj(id: string, name: string, baseScore: number = 5, checkedIn: boolean = true, institutionId?: string): Adjudicator {
  return {
    id,
    tournamentId: "t1",
    name,
    baseScore,
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
  it("averages confirmed feedback per adjudicator and ignores unconfirmed entries", () => {
    const submissions: FeedbackSubmission[] = [
      {
        id: "fb-1", tournamentId: "t1", roundId: "r1", debateId: "d1",
        targetAdjudicatorId: "adj-1", targetAdjudicatorName: "Judge",
        sourceType: "team", sourceId: "team-1", sourceName: "Team 1",
        score: 8, confirmed: true, timestamp: "",
      },
      {
        id: "fb-2", tournamentId: "t1", roundId: "r2", debateId: "d2",
        targetAdjudicatorId: "adj-1", targetAdjudicatorName: "Judge",
        sourceType: "team", sourceId: "team-2", sourceName: "Team 2",
        score: 10, confirmed: true, timestamp: "",
      },
      {
        id: "fb-3", tournamentId: "t1", roundId: "r3", debateId: "d3",
        targetAdjudicatorId: "adj-1", targetAdjudicatorName: "Judge",
        sourceType: "team", sourceId: "team-3", sourceName: "Team 3",
        score: 2, confirmed: false, timestamp: "",
      },
    ];

    expect(calculateAdjudicatorFeedbackScores(submissions).get("adj-1")).toBe(9);
    expect(calculateAdjudicatorFeedbackScores([]).size).toBe(0);
  });

  it("uses historical feedback ratings when assigning chairs", () => {
    const teamsMap = new Map<string, Team>();
    const lowPriorityTeams = [createTeam("t1", "T1"), createTeam("t2", "T2")];
    const highPriorityTeams = [createTeam("t3", "T3"), createTeam("t4", "T4")];
    [...lowPriorityTeams, ...highPriorityTeams].forEach((team) => teamsMap.set(team.id, team));

    const lowPriorityDebate = createDebate("d1", lowPriorityTeams);
    const highPriorityDebate = { ...createDebate("d2", highPriorityTeams), bracket: 2 };
    const feedbackHigh = createAdj("adj-feedback-high", "Feedback High", 1);
    const feedbackLow = createAdj("adj-feedback-low", "Feedback Low", 10);
    const submissions: FeedbackSubmission[] = [
      {
        id: "fb-high", tournamentId: "t1", roundId: "r1", debateId: "d1",
        targetAdjudicatorId: feedbackHigh.id, targetAdjudicatorName: feedbackHigh.name,
        sourceType: "team", sourceId: "team-1", sourceName: "Team 1",
        score: 10, confirmed: true, timestamp: "",
      },
      {
        id: "fb-low", tournamentId: "t1", roundId: "r1", debateId: "d1",
        targetAdjudicatorId: feedbackLow.id, targetAdjudicatorName: feedbackLow.name,
        sourceType: "team", sourceId: "team-2", sourceName: "Team 2",
        score: 1, confirmed: true, timestamp: "",
      },
    ];

    const allocations = autoAllocateAdjudicators(
      [lowPriorityDebate, highPriorityDebate],
      teamsMap,
      [feedbackHigh, feedbackLow],
      new Map(),
      {
        panelSize: 1,
        balancePanels: true,
        respectInstitutionConflicts: true,
        respectPersonalConflicts: true,
        respectHistoryConflicts: true,
      },
      {
        allPastDebates: [],
        standings: [],
        breakCategories: [],
        totalPrelimRounds: 2,
        completedRounds: 0,
        isBP: false,
        feedbackScores: calculateAdjudicatorFeedbackScores(submissions),
      }
    );

    expect(allocations.find((allocation) => allocation.debateId === highPriorityDebate.id)?.chairId)
      .toBe(feedbackHigh.id);
    expect(allocations.find((allocation) => allocation.debateId === lowPriorityDebate.id)?.chairId)
      .toBe(feedbackLow.id);
  });

  it("selects the strongest eligible adjudicator as chair after the full panel is chosen", () => {
    const teams = [createTeam("t1", "T1"), createTeam("t2", "T2")];
    const teamsMap = new Map(teams.map((team) => [team.id, team]));
    const debate = createDebate("d1", teams);
    const weak = createAdj("weak", "Weak", 3);
    const medium = createAdj("medium", "Medium", 5);
    const strong = createAdj("strong", "Strong", 9);

    const result = autoAllocateAdjudicators(
      [debate],
      teamsMap,
      [weak, medium, strong],
      new Map(),
      {
        panelSize: 3,
        balancePanels: true,
        respectInstitutionConflicts: true,
        respectPersonalConflicts: true,
        respectHistoryConflicts: true,
      }
    );

    expect(result[0].chairId).toBe("strong");
    expect(result[0].panellistIds).toEqual(expect.arrayContaining(["weak", "medium"]));
    expect(result[0].panellistIds).not.toContain("strong");
  });

  it("prefers a lower-rated chair over an institutionally conflicted adjudicator", () => {
    const team = createTeam("team", "Team", "team-institution");
    const debate = createDebate("debate", [team]);
    const conflicted = createAdj("conflicted", "Conflicted", 10, true, "team-institution");
    const eligible = createAdj("eligible", "Eligible", 4);

    const result = autoAllocateAdjudicators(
      [debate],
      new Map([[team.id, team]]),
      [conflicted, eligible],
      new Map(),
      {
        panelSize: 1,
        balancePanels: true,
        respectInstitutionConflicts: true,
        respectPersonalConflicts: true,
        respectHistoryConflicts: true,
      },
      {
        allPastDebates: [],
        standings: [],
        breakCategories: [],
        totalPrelimRounds: 1,
        completedRounds: 0,
        isBP: false,
      }
    );

    expect(result[0].chairId).toBe(eligible.id);
    expect(result[0].conflicts).toEqual([]);
  });

  it("prefers a lower-rated chair over an adjudicator with a repeat-team clash", () => {
    const team = createTeam("team", "Team");
    const debate = createDebate("debate", [team]);
    const conflicted = createAdj("conflicted", "Conflicted", 10);
    const eligible = createAdj("eligible", "Eligible", 4);
    const pastDebate = createDebate("past", [team]);
    pastDebate.adjudicators = {
      chairId: conflicted.id,
      chairName: conflicted.name,
      panellistIds: [],
      panellistNames: [],
      traineeIds: [],
      traineeNames: [],
    };

    const result = autoAllocateAdjudicators(
      [debate],
      new Map([[team.id, team]]),
      [conflicted, eligible],
      new Map(),
      {
        panelSize: 1,
        balancePanels: true,
        respectInstitutionConflicts: true,
        respectPersonalConflicts: true,
        respectHistoryConflicts: true,
      },
      {
        allPastDebates: [pastDebate],
        standings: [],
        breakCategories: [],
        totalPrelimRounds: 1,
        completedRounds: 0,
        isBP: false,
      }
    );

    expect(result[0].chairId).toBe(eligible.id);
    expect(result[0].conflicts).toEqual([]);
  });

  it("does not promote an institutionally conflicted panel member over a clean adjudicator", () => {
    const team = createTeam("team", "Team", "team-institution");
    const debate = createDebate("debate", [team]);
    const conflicted = createAdj("conflicted", "Conflicted", 10, true, "team-institution");
    const eligible = createAdj("eligible", "Eligible", 4);

    const result = autoAllocateAdjudicators(
      [debate],
      new Map([[team.id, team]]),
      [conflicted, eligible],
      new Map(),
      {
        panelSize: 2,
        balancePanels: true,
        respectInstitutionConflicts: true,
        respectPersonalConflicts: true,
        respectHistoryConflicts: true,
      }
    );

    expect(result[0].chairId).toBe(eligible.id);
    expect(result[0].panellistIds).toContain(conflicted.id);
  });

  it("does not promote a history-conflicted panel member over a clean adjudicator", () => {
    const team = createTeam("team", "Team");
    const debate = createDebate("debate", [team]);
    const conflicted = createAdj("conflicted", "Conflicted", 10);
    const eligible = createAdj("eligible", "Eligible", 4);
    const pastDebate = createDebate("past", [team]);
    pastDebate.adjudicators = {
      chairId: conflicted.id,
      chairName: conflicted.name,
      panellistIds: [],
      panellistNames: [],
      traineeIds: [],
      traineeNames: [],
    };

    const result = autoAllocateAdjudicators(
      [debate],
      new Map([[team.id, team]]),
      [conflicted, eligible],
      new Map(),
      {
        panelSize: 2,
        balancePanels: true,
        respectInstitutionConflicts: true,
        respectPersonalConflicts: true,
        respectHistoryConflicts: true,
      },
      {
        allPastDebates: [pastDebate],
        standings: [],
        breakCategories: [],
        totalPrelimRounds: 1,
        completedRounds: 0,
        isBP: false,
      }
    );

    expect(result[0].chairId).toBe(eligible.id);
    expect(result[0].panellistIds).toContain(conflicted.id);
  });

  it("preserves the global panel assignment while promoting the strongest panel member to chair", () => {
    const teamsMap = new Map<string, Team>();
    const highPriorityTeams = [createTeam("t1", "T1"), createTeam("t2", "T2")];
    const lowPriorityTeams = [createTeam("t3", "T3"), createTeam("t4", "T4")];
    [...highPriorityTeams, ...lowPriorityTeams].forEach((team) => teamsMap.set(team.id, team));

    const highPriorityDebate = { ...createDebate("d1", highPriorityTeams), importance: 10 };
    const lowPriorityDebate = createDebate("d2", lowPriorityTeams);
    const chairHigh = createAdj("chair-high", "Chair High", 4);
    const chairLow = createAdj("chair-low", "Chair Low", 2);
    const panelHigh = createAdj("panel-high", "Panel High", 4);
    const panelLow = createAdj("panel-low", "Panel Low", 2);
    const pastDebate = createDebate("past", [createTeam("past-1", "Past 1")]);
    pastDebate.adjudicators = {
      chairId: chairLow.id,
      chairName: chairLow.name,
      panellistIds: [panelLow.id],
      panellistNames: [panelLow.name],
      traineeIds: [],
      traineeNames: [],
    };

    const allocations = autoAllocateAdjudicators(
      [highPriorityDebate, lowPriorityDebate],
      teamsMap,
      [chairHigh, chairLow, panelHigh, panelLow],
      new Map(),
      {
        panelSize: 2,
        balancePanels: true,
        respectInstitutionConflicts: true,
        respectPersonalConflicts: true,
        respectHistoryConflicts: true,
        preferences: {
          importanceMismatchPenalty: 1,
          adjHistoryPenalty: 100,
        },
      },
      {
        allPastDebates: [pastDebate],
        standings: [],
        breakCategories: [],
        totalPrelimRounds: 2,
        completedRounds: 0,
        isBP: false,
      }
    );

    const highResult = allocations.find((allocation) => allocation.debateId === highPriorityDebate.id)!;
    const lowResult = allocations.find((allocation) => allocation.debateId === lowPriorityDebate.id)!;

    expect(highResult.chairId).toBe(chairHigh.id);
    expect(highResult.panellistIds).toEqual([panelLow.id]);
    expect(lowResult.chairId).toBe(panelHigh.id);
    expect(lowResult.panellistIds).toEqual([chairLow.id]);
  });

  it("avoids historical repeats between panellists on the same panel", () => {
    const teams = [createTeam("t1", "T1"), createTeam("t2", "T2")];
    const teamsMap = new Map(teams.map((team) => [team.id, team]));
    const debate = createDebate("d1", teams);
    const chair = createAdj("chair", "Chair");
    const panelA = createAdj("panel-a", "Panel A");
    const panelB = createAdj("panel-b", "Panel B");
    const panelC = createAdj("panel-c", "Panel C");
    const pastDebate = createDebate("past", [createTeam("past-team", "Past Team")]);
    pastDebate.adjudicators = {
      chairId: "past-chair",
      chairName: "Past Chair",
      panellistIds: [panelA.id, panelB.id],
      panellistNames: [panelA.name, panelB.name],
      traineeIds: [],
      traineeNames: [],
    };

    const result = autoAllocateAdjudicators(
      [debate],
      teamsMap,
      [chair, panelA, panelB, panelC],
      new Map(),
      {
        panelSize: 3,
        balancePanels: true,
        respectInstitutionConflicts: true,
        respectPersonalConflicts: true,
        respectHistoryConflicts: true,
      },
      {
        allPastDebates: [pastDebate],
        standings: [],
        breakCategories: [],
        totalPrelimRounds: 2,
        completedRounds: 0,
        isBP: false,
      }
    );

    expect(result[0].chairId).toBe(chair.id);
    expect(result[0].panellistIds).toHaveLength(2);
    expect(result[0].panellistIds).not.toEqual([panelA.id, panelB.id]);
  });

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

  it("does not allocate adjudicators to bye records", () => {
    const team = createTeam("t1", "T1");
    const bye = {
      ...createDebate("bye-1", [team]),
      byeTeamId: team.id,
      byeResult: "win" as const,
    };
    const result = autoAllocateAdjudicators(
      [bye],
      new Map([[team.id, team]]),
      [createAdj("adj-1", "Judge")],
      new Map()
    );

    expect(result).toHaveLength(1);
    expect(result[0].debateId).toBe("bye-1");
    expect(result[0].chairId).toBeUndefined();
    expect(result[0].panellistIds).toEqual([]);
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

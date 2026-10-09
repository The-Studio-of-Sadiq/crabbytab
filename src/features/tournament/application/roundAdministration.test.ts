import { describe, expect, it } from "vitest";

import type { BallotSubmission, Debate, FeedbackSubmission, Motion, Round } from "@/types";
import { createRoundRecord } from "./rounds";
import {
  deleteRoundCommand,
  setPreliminaryRoundCountCommand,
  type DeleteRoundDependencies,
  type PreliminaryRoundCountDependencies,
} from "./roundAdministration";

function createDependencies(rounds: PreliminaryRoundCountDependencies["rounds"] = []) {
  const calls: string[] = [];
  let savedRounds = rounds;
  let activeRound: import("@/types").Round | null = null;
  const dependencies: PreliminaryRoundCountDependencies = {
    rounds,
    debates: [],
    tournamentId: "tournament-1",
    drawRule: "power_paired",
    localRepository: {
      saveRounds(updatedRounds) {
        calls.push("local-rounds");
        savedRounds = updatedRounds;
      },
      saveDebates() {
        calls.push("local-debates");
      },
      setActiveRound(update) {
        calls.push("active-round");
        activeRound = update(activeRound);
      },
    },
    cloudRepository: {
      async saveRoundCountChanges() {
        calls.push("cloud");
      },
    },
    async recordAuditEvent(event) {
      calls.push("audit");
      expect(event.action).toBe("rounds.preliminary_count_updated");
    },
  };
  return { dependencies, calls, getRounds: () => savedRounds, getActiveRound: () => activeRound };
}

describe("setPreliminaryRoundCountCommand", () => {
  it("clamps and floors the count, with first-round defaults and prior write order", async () => {
    const { dependencies, calls, getRounds, getActiveRound } = createDependencies();

    await setPreliminaryRoundCountCommand(1.8, dependencies);

    expect(getRounds()).toHaveLength(1);
    expect(getRounds()[0]).toMatchObject({
      name: "Round 1",
      abbreviation: "R1",
      stage: "preliminary",
      drawType: "random",
    });
    expect(getRounds()[0].id).toMatch(/^round-tournament-1-\d+-1$/);
    expect(getActiveRound()).toEqual(getRounds()[0]);
    expect(calls).toEqual(["cloud", "local-rounds", "active-round", "audit"]);
  });

  it("restores canceled rounds instead of replacing their identities", async () => {
    const cancelledRound = {
      ...createRoundRecord({
        tournamentId: "tournament-1",
        roundSeq: 1,
        name: "Round 1",
        abbr: "R1",
        stage: "preliminary",
      }),
      cancelled: true,
    };
    const { dependencies, getRounds } = createDependencies([cancelledRound]);

    await setPreliminaryRoundCountCommand(1, dependencies);

    expect(getRounds()).toHaveLength(1);
    expect(getRounds()[0].id).toBe(cancelledRound.id);
    expect(getRounds()[0].cancelled).toBe(false);
  });
});

function makeDebate(id: string, roundId: string, roundSeq: number): Debate {
  const sides = ["OG", "OO", "CG", "CO", "AFF", "NEG"] as const;
  return {
    id,
    tournamentId: "tournament-1",
    roundId,
    roundSeq,
    bracket: 0,
    roomRank: 1,
    importance: 1,
    resultStatus: "none",
    sidesConfirmed: false,
    flags: [],
    teams: Object.fromEntries(sides.map((side) => [side, {
      teamId: `team-${side}`,
      teamName: `Team ${side}`,
      side,
    }])) as Debate["teams"],
    adjudicators: {
      panellistIds: [],
      panellistNames: [],
      traineeIds: [],
      traineeNames: [],
    },
  };
}

function makeBallot(id: string, roundId: string, debateId: string): BallotSubmission {
  const sides = ["OG", "OO", "CG", "CO", "AFF", "NEG"] as const;
  return {
    id,
    tournamentId: "tournament-1",
    roundId,
    debateId,
    version: 1,
    confirmed: false,
    discarded: false,
    submitterType: "tabroom",
    speakerScores: { OG: [], OO: [], CG: [], CO: [], AFF: [], NEG: [] },
    teamScores: Object.fromEntries(sides.map((side) => [side, {
      side,
      teamId: `team-${side}`,
      points: 0,
      totalSpeakerScore: 0,
    }])) as BallotSubmission["teamScores"],
    timestamp: "",
  };
}

describe("deleteRoundCommand", () => {
  it("removes dependent records and renumbers remaining round data", async () => {
    const deletedRound = createRoundRecord({
      tournamentId: "tournament-1",
      roundSeq: 1,
      name: "Round 1",
      abbr: "R1",
      stage: "preliminary",
    });
    const remainingRound = createRoundRecord({
      tournamentId: "tournament-1",
      roundSeq: 2,
      name: "Round 2",
      abbr: "R2",
      stage: "preliminary",
    });
    const removedDebate = makeDebate("debate-1", deletedRound.id, 1);
    const remainingDebate = makeDebate("debate-2", remainingRound.id, 2);
    const feedback: FeedbackSubmission = {
      id: "feedback-1",
      tournamentId: "tournament-1",
      roundId: deletedRound.id,
      debateId: removedDebate.id,
      sourceType: "team",
      sourceId: "team-OG",
      sourceName: "Team OG",
      score: 8,
      confirmed: false,
      timestamp: "",
    };
    const motion: Motion = {
      id: "motion-1",
      tournamentId: "tournament-1",
      text: "This house...",
      rounds: [deletedRound.id, remainingRound.id],
      released: false,
    };
    const calls: string[] = [];
    let savedRounds: Round[] = [];
    let savedDebates: Debate[] = [];
    let savedBallots: BallotSubmission[] = [];
    let savedFeedback: FeedbackSubmission[] = [];
    let savedMotions: Motion[] = [];
    let cloudChanges: Parameters<NonNullable<DeleteRoundDependencies["cloudRepository"]>["deleteRoundAndSaveChanges"]>[0] | undefined;
    const dependencies: DeleteRoundDependencies = {
      roundId: deletedRound.id,
      rounds: [deletedRound, remainingRound],
      debates: [removedDebate, remainingDebate],
      ballots: [makeBallot("ballot-1", deletedRound.id, removedDebate.id)],
      feedback: [feedback],
      motions: [motion],
      activeRound: deletedRound,
      localRepository: {
        saveRounds(items) { calls.push("rounds"); savedRounds = items; },
        saveDebates(items) { calls.push("debates"); savedDebates = items; },
        saveBallots(items) { calls.push("ballots"); savedBallots = items; },
        saveFeedback(items) { calls.push("feedback"); savedFeedback = items; },
        saveMotions(items) { calls.push("motions"); savedMotions = items; },
        setActiveRound(round) { calls.push("active"); expect(round).toEqual(savedRounds[0]); },
      },
      cloudRepository: {
        async deleteRoundAndSaveChanges(changes) { calls.push("cloud"); cloudChanges = changes; },
      },
      async recordAuditEvent(event) { calls.push("audit"); expect(event.details).toMatchObject({ deletedDebateCount: 1, deletedBallotCount: 1, deletedFeedbackCount: 1 }); },
    };

    await deleteRoundCommand(dependencies);

    expect(calls).toEqual(["cloud", "rounds", "debates", "ballots", "feedback", "motions", "active", "audit"]);
    expect(savedRounds).toHaveLength(1);
    expect(savedRounds[0]).toMatchObject({ id: remainingRound.id, seq: 1, name: "Round 1", abbreviation: "R1" });
    expect(savedDebates).toEqual([{ ...remainingDebate, roundSeq: 1 }]);
    expect(savedBallots).toEqual([]);
    expect(savedFeedback).toEqual([]);
    expect(savedMotions[0].rounds).toEqual([remainingRound.id]);
    expect(cloudChanges?.updatedDebates).toEqual([{ ...remainingDebate, roundSeq: 1 }]);
  });
});
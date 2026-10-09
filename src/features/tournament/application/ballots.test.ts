import { describe, expect, it } from "vitest";

import type { BallotSubmission } from "@/types";
import { submitBallotCommand, type BallotWorkflowDependencies } from "./ballots";

function makeBallot(overrides: Partial<BallotSubmission> = {}): BallotSubmission {
  const teamScore = (side: "OG" | "OO" | "CG" | "CO" | "AFF" | "NEG") => ({
    side,
    teamId: `team-${side}`,
    points: 0,
    totalSpeakerScore: 0,
  });
  return {
    id: "ballot-1",
    tournamentId: "tournament-1",
    roundId: "round-1",
    debateId: "debate-1",
    version: 1,
    confirmed: false,
    discarded: false,
    submitterType: "judge",
    speakerScores: { OG: [], OO: [], CG: [], CO: [], AFF: [], NEG: [] },
    teamScores: {
      OG: teamScore("OG"),
      OO: teamScore("OO"),
      CG: teamScore("CG"),
      CO: teamScore("CO"),
      AFF: teamScore("AFF"),
      NEG: teamScore("NEG"),
    },
    timestamp: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDependencies(overrides: Partial<BallotWorkflowDependencies> = {}) {
  const calls: string[] = [];
  let savedBallots: BallotSubmission[] = [];
  const dependencies: BallotWorkflowDependencies = {
    ballots: [],
    debates: [],
    rounds: [],
    adjudicators: [],
    repository: {
      saveBallots(ballots) {
        calls.push("ballots");
        savedBallots = ballots;
      },
      saveDebates() {
        calls.push("debates");
      },
    },
    async updateRound() {
      calls.push("round");
    },
    async recordAuditEvent(event) {
      calls.push(event.action);
    },
    async queuePrivateRecord() {
      calls.push("private-sync");
    },
    ...overrides,
  };
  return { dependencies, calls, getSavedBallots: () => savedBallots };
}

describe("submitBallotCommand", () => {
  it("replaces a ballot for the same debate and invalidates released results", async () => {
    const existing = makeBallot({ id: "existing-ballot" });
    const { dependencies, calls, getSavedBallots } = makeDependencies({
      ballots: [existing],
      rounds: [{
        id: "round-1",
        tournamentId: "tournament-1",
        seq: 1,
        name: "Round 1",
        abbreviation: "R1",
        stage: "preliminary",
        drawType: "random",
        drawStatus: "confirmed",
        feedbackWeight: 1,
        silent: false,
        motionsReleased: false,
        resultsReleased: true,
        teamSpeaksReleased: true,
        completed: false,
        createdAt: "",
      }],
    });

    await submitBallotCommand(
      makeBallot({ id: "", version: 2 }),
      undefined,
      dependencies
    );

    expect(getSavedBallots()).toHaveLength(1);
    expect(getSavedBallots()[0].id).toMatch(/^ballot-debate-1-\d+$/);
    expect(getSavedBallots()[0].version).toBe(2);
    expect(calls).toEqual(["ballots", "round", "ballot.submitted"]);
  });

  it("confirms submitted ballots before queuing private sync", async () => {
    const { dependencies, calls } = makeDependencies({
      adjudicators: [{ id: "judge-1", privateUrlKey: "judge-key" }],
    });

    await submitBallotCommand(
      makeBallot({ confirmed: true, submitterId: "judge-1" }),
      "passcode",
      dependencies
    );

    expect(calls).toEqual([
      "ballots",
      "ballot.submitted",
      "ballots",
      "ballot.confirmed",
      "private-sync",
    ]);
  });
});
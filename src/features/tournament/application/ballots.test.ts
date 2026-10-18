import { describe, expect, it } from "vitest";

import type { BallotSubmission } from "@/types";
import { discardBallotCommand, submitBallotCommand, type BallotWorkflowDependencies } from "./ballots";

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
  it("replaces a draft ballot for the same debate without withdrawing released results", async () => {
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
    expect(calls).toEqual(["ballots", "ballot.submitted"]);
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
const releasedRound = {
  id: "round-1",
  tournamentId: "tournament-1",
  seq: 1,
  name: "Round 1",
  abbreviation: "R1",
  stage: "preliminary" as const,
  drawType: "random" as const,
  drawStatus: "confirmed" as const,
  feedbackWeight: 1,
  silent: false,
  motionsReleased: false,
  resultsReleased: true,
  teamSpeaksReleased: true,
  completed: false,
  createdAt: "",
};

const debate = {
  id: "debate-1",
  tournamentId: "tournament-1",
  roundId: "round-1",
  roundSeq: 1,
  bracket: 0,
  roomRank: 0,
  importance: 0,
  resultStatus: "confirmed" as const,
  sidesConfirmed: true,
  flags: [],
  teams: { AFF: { teamId: "team-AFF", teamName: "Aff", side: "AFF" as const, points: 1 } } as never,
  adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
};

describe("result-changing ballot actions", () => {
  it("withdraws released results when a confirmed ballot is submitted", async () => {
    const { dependencies, calls } = makeDependencies({ rounds: [releasedRound] });
    await submitBallotCommand(makeBallot({ confirmed: true }), undefined, dependencies);
    expect(calls.slice(0, 2)).toEqual(["ballots", "round"]);
  });

  it("keeps a confirmed result when a new unconfirmed version is saved", async () => {
    let savedDebates: unknown[] = [];
    const confirmed = makeBallot({ id: "v1", confirmed: true });
    const { dependencies } = makeDependencies({
      ballots: [confirmed],
      debates: [debate as never],
      repository: { saveBallots() {}, saveDebates(items) { savedDebates = items; } },
    });
    await submitBallotCommand(makeBallot({ id: "v2", version: 2 }), undefined, dependencies);
    expect((savedDebates[0] as { resultStatus: string }).resultStatus).toBe("confirmed");
  });

  it("discarding the confirmed version withdraws the result and released results", async () => {
    let savedBallots: BallotSubmission[] = [];
    let savedDebates: Array<{ resultStatus: string; teams: Record<string, { points?: number }> }> = [];
    const calls: string[] = [];
    const { dependencies } = makeDependencies({
      ballots: [makeBallot({ id: "v1", confirmed: true })],
      debates: [debate as never],
      rounds: [releasedRound],
      repository: {
        saveBallots(items) { savedBallots = items; },
        saveDebates(items) { savedDebates = items as never; },
      },
      async updateRound() { calls.push("round"); },
      async recordAuditEvent(event) { calls.push(event.action); },
    });
    await discardBallotCommand("v1", "checker@example.com", dependencies);
    expect(savedBallots[0]).toMatchObject({ discarded: true, confirmed: false, discardedBy: "checker@example.com" });
    expect(savedDebates[0].resultStatus).toBe("none");
    expect(savedDebates[0].teams.AFF.points).toBeUndefined();
    expect(calls).toEqual(["round", "ballot.discarded"]);
  });
});

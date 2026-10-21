import { describe, expect, it } from "vitest";

import type { BallotSubmission } from "@/types";
import { isTabRoomConfirmed } from "@/lib/privateSync";
import { confirmBallotCommand, discardBallotCommand, submitBallotCommand, TAB_ROOM_CONFIRMER, type BallotWorkflowDependencies } from "./ballots";

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
      debates: [debate as never],
    });

    await submitBallotCommand(
      makeBallot({ confirmed: true, submitterId: "judge-1" }),
      "passcode",
      dependencies
    );

    expect(calls).toEqual([
      "ballots",
      "debates",
      "ballot.submitted",
      "ballots",
      "debates",
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
    const { dependencies, calls } = makeDependencies({ rounds: [releasedRound], debates: [debate as never] });
    await submitBallotCommand(makeBallot({ confirmed: true }), undefined, dependencies);
    expect(calls.slice(0, 2)).toEqual(["ballots", "round"]);
  });

  it("stamps one confirmation once: both saves of a ballot submitted confirmed carry the same record", async () => {
    const saves: BallotSubmission[][] = [];
    const { dependencies } = makeDependencies({ debates: [debate as never] });
    dependencies.repository.saveBallots = (items) => saves.push(items);
    const submitted = makeBallot({ confirmed: true, confirmedBy: "tab@example.org", confirmedTimestamp: "2026-01-01T00:00:01.000Z" });
    await submitBallotCommand(submitted, undefined, dependencies);
    expect(saves).toHaveLength(2);
    expect(saves[1][0]).toEqual(saves[0][0]);
    expect(saves[1][0].confirmedTimestamp).toBe("2026-01-01T00:00:01.000Z");
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

describe("confirmBallotCommand", () => {
  const saved = makeBallot({ id: "v1", debateId: "debate-1" });

  it("rejects unknown ballots, ballots of another debate and discarded ballots without writing", async () => {
    const writes: string[] = [];
    const { dependencies } = makeDependencies({
      ballots: [saved, makeBallot({ id: "old", discarded: true }), makeBallot({ id: "elsewhere", debateId: "debate-2" })],
      debates: [debate as never],
      repository: { saveBallots() { writes.push("ballots"); }, saveDebates() { writes.push("debates"); } },
      async recordAuditEvent(event) { writes.push(event.action); },
    });
    await expect(confirmBallotCommand("missing", "debate-1", undefined, dependencies)).rejects.toThrow(/could not be found/);
    await expect(confirmBallotCommand("elsewhere", "debate-1", undefined, dependencies)).rejects.toThrow(/different debate/);
    await expect(confirmBallotCommand("old", "debate-1", undefined, dependencies)).rejects.toThrow(/discarded ballot/);
    expect(writes).toEqual([]);
  });

  it("rejects a ballot whose teams no longer match the draw", async () => {
    const { dependencies } = makeDependencies({
      ballots: [makeBallot({ id: "v1", teamScores: { ...saved.teamScores, AFF: { side: "AFF", teamId: "someone-else", points: 1, totalSpeakerScore: 0 } } })],
      debates: [debate as never],
    });
    await expect(confirmBallotCommand("v1", "debate-1", undefined, dependencies)).rejects.toThrow(/different teams/);
  });

  it("confirms the identified ballot and keeps the debate's other versions (Tabbycat)", async () => {
    let savedBallots: BallotSubmission[] = [];
    let savedDebates: Array<{ resultStatus: string }> = [];
    const { dependencies } = makeDependencies({
      ballots: [saved, makeBallot({ id: "v2", version: 2 })],
      debates: [debate as never],
      repository: { saveBallots(items) { savedBallots = items; }, saveDebates(items) { savedDebates = items as never; } },
    });
    await confirmBallotCommand("v2", "debate-1", undefined, dependencies);
    expect(savedBallots.map((item) => [item.id, item.confirmed, item.discarded])).toEqual([["v1", false, false], ["v2", true, false]]);
    expect(savedDebates[0].resultStatus).toBe("confirmed");
  });

  it("only unconfirms the previously confirmed version and leaves drafts alone", async () => {
    let savedBallots: BallotSubmission[] = [];
    const { dependencies } = makeDependencies({
      ballots: [
        makeBallot({ id: "v1", confirmed: true, confirmedBy: "Someone" }),
        makeBallot({ id: "v2", version: 2 }),
        makeBallot({ id: "v3", version: 3 }),
      ],
      debates: [debate as never],
      repository: { saveBallots(items) { savedBallots = items; }, saveDebates() {} },
    });
    await confirmBallotCommand("v3", "debate-1", undefined, dependencies);
    expect(savedBallots.map((item) => [item.id, item.confirmed, item.discarded])).toEqual([
      ["v1", false, false],
      ["v2", false, false],
      ["v3", true, false],
    ]);
  });

  it("records who confirmed a stored ballot, so a judge's ballot confirmed by the tab room is protected", async () => {
    let savedBallots: BallotSubmission[] = [];
    const judgeBallot = makeBallot({ id: "j1", submitterType: "judge", submitterId: "chair", submitterName: "Chair" });
    const { dependencies } = makeDependencies({
      ballots: [judgeBallot],
      debates: [debate as never],
      repository: { saveBallots(items) { savedBallots = items; }, saveDebates() {} },
    });
    await confirmBallotCommand("j1", "debate-1", undefined, { ...dependencies, confirmer: { name: "Tab Director", id: "uid-1" } });
    expect(savedBallots[0]).toMatchObject({ confirmed: true, confirmedBy: "Tab Director", confirmedById: "uid-1" });
    expect(isTabRoomConfirmed(savedBallots[0])).toBe(true);

    await confirmBallotCommand("j1", "debate-1", undefined, { ...dependencies, ballots: [judgeBallot] });
    expect(savedBallots[0].confirmedBy).toBe(TAB_ROOM_CONFIRMER);
    expect(isTabRoomConfirmed(savedBallots[0])).toBe(true);
  });

  it("saves nothing when a confirmed submission targets a missing debate", async () => {
    const writes: string[] = [];
    const { dependencies } = makeDependencies({
      repository: { saveBallots() { writes.push("ballots"); }, saveDebates() { writes.push("debates"); } },
    });
    await expect(submitBallotCommand(makeBallot({ confirmed: true }), undefined, dependencies)).rejects.toThrow(/no longer exists/);
    expect(writes).toEqual([]);
  });
});

describe("resubmitting a saved ballot version", () => {
  it("confirms the resubmitted scores, not the version that was saved before", async () => {
    const debate = {
      id: "debate-1",
      roundId: "round-1",
      resultStatus: "draft",
      teams: { AFF: { teamId: "team-AFF", teamName: "A", side: "AFF" }, NEG: { teamId: "team-NEG", teamName: "N", side: "NEG" } },
    } as unknown as import("@/types").Debate;
    const draft = makeBallot({ id: "ballot-1", confirmed: false });
    const corrected = makeBallot({
      id: "ballot-1",
      confirmed: true,
      teamScores: {
        ...draft.teamScores,
        AFF: { side: "AFF", teamId: "team-AFF", points: 1, totalSpeakerScore: 230, win: true },
        NEG: { side: "NEG", teamId: "team-NEG", points: 0, totalSpeakerScore: 225, win: false },
      },
    });
    let saved: BallotSubmission[] = [];
    const { dependencies } = makeDependencies({ ballots: [draft], debates: [debate] });
    dependencies.repository.saveBallots = (ballots) => { saved = ballots; };

    await submitBallotCommand(corrected, undefined, dependencies);

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: "ballot-1", confirmed: true, discarded: false });
    expect(saved[0].teamScores.AFF).toMatchObject({ points: 1, totalSpeakerScore: 230 });
  });
});

import { describe, expect, it } from "vitest";

import type { BallotSubmission, Debate, Round } from "@/types";
import { getRoundCompletionBlockers, setRoundCompletion } from "./roundAdministration";

const round: Round = {
  id: "r1",
  tournamentId: "t1",
  seq: 1,
  name: "Round 1",
  abbreviation: "R1",
  stage: "preliminary",
  drawType: "random",
  drawStatus: "confirmed",
  feedbackWeight: 1,
  silent: false,
  motionsReleased: false,
  resultsReleased: false,
  completed: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function debate(id: string, overrides: Partial<Debate> = {}): Debate {
  return {
    id,
    tournamentId: "t1",
    roundId: "r1",
    roundSeq: 1,
    venueName: `Room ${id}`,
    bracket: 0,
    roomRank: Number(id.replace(/\D/g, "")) || 0,
    importance: 0,
    resultStatus: "none",
    sidesConfirmed: true,
    flags: [],
    teams: {} as Debate["teams"],
    adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    ...overrides,
  };
}

function ballot(debateId: string, overrides: Partial<BallotSubmission> = {}): BallotSubmission {
  return {
    id: `b-${debateId}-${overrides.version ?? 1}`,
    tournamentId: "t1",
    roundId: "r1",
    debateId,
    version: 1,
    confirmed: true,
    discarded: false,
    submitterType: "tabroom",
    speakerScores: {} as BallotSubmission["speakerScores"],
    teamScores: {} as BallotSubmission["teamScores"],
    timestamp: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("getRoundCompletionBlockers", () => {
  it("blocks a round with no draw", () => {
    expect(getRoundCompletionBlockers(round, [], [])).toEqual([
      { reason: "no_draw", message: "Round 1 has no draw yet." },
    ]);
  });

  it("ignores bye debates and accepts the confirmed version among several", () => {
    const debates = [debate("d1"), debate("d2", { byeTeamId: "team-x" })];
    const ballots = [
      ballot("d1", { version: 1, confirmed: false }),
      ballot("d1", { version: 2, confirmed: true }),
    ];
    expect(getRoundCompletionBlockers(round, debates, ballots)).toEqual([]);
  });

  it("does not count discarded, unconfirmed or other-round ballots", () => {
    const debates = [debate("d1"), debate("d2"), debate("d3")];
    const ballots = [
      ballot("d1", { discarded: true }),
      ballot("d2", { confirmed: false }),
      ballot("d3", { roundId: "r2" }),
    ];
    expect(getRoundCompletionBlockers(round, debates, ballots).map((blocker) => blocker.debateId)).toEqual([
      "d1",
      "d2",
      "d3",
    ]);
  });

  it("reports postponed debates", () => {
    const blockers = getRoundCompletionBlockers(round, [debate("d1", { postponed: true })], [ballot("d1")]);
    expect(blockers).toEqual([{ reason: "postponed", debateId: "d1", message: "Room d1 is postponed." }]);
  });
});

describe("setRoundCompletion", () => {
  it("completes a round whose ballots are all confirmed and reopens it", () => {
    const completed = setRoundCompletion(round, true, [debate("d1")], [ballot("d1")]);
    expect(completed.completed).toBe(true);
    expect(setRoundCompletion(completed, false, [], []).completed).toBe(false);
  });

  it("refuses to complete with missing ballots and names the debate", () => {
    expect(() => setRoundCompletion(round, true, [debate("d1")], [])).toThrow(
      "Round 1 cannot be completed: Room d1 has no confirmed ballot."
    );
  });

  it("rejects elimination and cancelled rounds", () => {
    expect(() => setRoundCompletion({ ...round, stage: "elimination" }, true, [], [])).toThrow(/advancing/);
    expect(() => setRoundCompletion({ ...round, cancelled: true }, false, [], [])).toThrow(/cancelled/);
  });
});

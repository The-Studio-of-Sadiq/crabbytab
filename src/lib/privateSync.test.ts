import { describe, expect, it } from "vitest";
import type { BallotSubmission, Debate } from "@/types";
import { isTabRoomConfirmed, planPrivateBallotWrites, selectAssignedDebates, supersededBallotUpdate } from "./privateSync";

function debate(id: string, overrides: Partial<Debate> = {}): Debate {
  return {
    id,
    tournamentId: "t1",
    roundId: "r1",
    roundSeq: 1,
    bracket: 0,
    roomRank: 1,
    importance: 0,
    resultStatus: "none",
    sidesConfirmed: true,
    flags: [],
    teams: {
      Gov: { teamId: "team-a", teamName: "A" },
      Opp: { teamId: "team-b", teamName: "B" },
    } as unknown as Debate["teams"],
    adjudicators: { chairId: "chair", panellistIds: ["panel"], traineeIds: ["trainee"] } as Debate["adjudicators"],
    ...overrides,
  };
}

describe("selectAssignedDebates", () => {
  const live = new Map([
    ["d1", debate("d1")],
    ["d2", debate("d2", {
      adjudicators: { chairId: "other" } as Debate["adjudicators"],
      teams: { Gov: { teamId: "team-c" }, Opp: { teamId: "team-d" } } as unknown as Debate["teams"],
    })],
  ]);

  it("returns only debates the adjudicator sits on, in any role", () => {
    for (const id of ["chair", "panel", "trainee"]) {
      expect([...selectAssignedDebates(live, "adjudicator", id).keys()]).toEqual(["d1"]);
    }
    expect(selectAssignedDebates(live, "adjudicator", "nobody").size).toBe(0);
  });

  it("returns only debates the team competes in", () => {
    expect([...selectAssignedDebates(live, "team", "team-d").keys()]).toEqual(["d2"]);
  });

  it("tolerates debates without panels or teams", () => {
    const sparse = new Map([["d3", debate("d3", {
      adjudicators: undefined as unknown as Debate["adjudicators"],
      teams: undefined as unknown as Debate["teams"],
    })]]);
    expect(selectAssignedDebates(sparse, "adjudicator", "chair").size).toBe(0);
    expect(selectAssignedDebates(sparse, "team", "team-a").size).toBe(0);
  });
});

function ballot(id: string, overrides: Partial<BallotSubmission> = {}): BallotSubmission {
  return {
    id,
    tournamentId: "t1",
    roundId: "r1",
    debateId: "d1",
    version: 1,
    confirmed: false,
    discarded: false,
    submitterType: "judge",
    submitterId: "chair",
    submitterName: "Chair",
    speakerScores: {} as BallotSubmission["speakerScores"],
    teamScores: {} as BallotSubmission["teamScores"],
    timestamp: "",
    ...overrides,
  };
}

describe("isTabRoomConfirmed", () => {
  it("recognises tab-room and tab-confirmed judge ballots", () => {
    expect(isTabRoomConfirmed(ballot("a", { submitterType: "tabroom", confirmed: true }))).toBe(true);
    expect(isTabRoomConfirmed(ballot("a", { confirmed: true, confirmedBy: "director@example.com" }))).toBe(true);
  });

  it("ignores chair self-confirmation, unconfirmed and discarded ballots", () => {
    expect(isTabRoomConfirmed(ballot("a", { confirmed: true, confirmedBy: "Chair" }))).toBe(false);
    expect(isTabRoomConfirmed(ballot("a", { submitterType: "tabroom" }))).toBe(false);
    expect(isTabRoomConfirmed(ballot("a", { submitterType: "tabroom", confirmed: true, discarded: true }))).toBe(false);
  });
});

describe("planPrivateBallotWrites", () => {
  const chairFinal = ballot("chair-ballot", { confirmed: true, confirmedBy: "Chair", confirmedTimestamp: "now" });

  it("lets a chair's final ballot supersede earlier judge ballots", () => {
    const plan = planPrivateBallotWrites([chairFinal], new Map([["d1", [
      { id: "old", data: ballot("old", { version: 2 }) },
      { id: "gone", data: ballot("gone", { discarded: true }) },
    ]]]));
    expect(plan.discardExistingIds).toEqual(["old"]);
    expect(plan.writes).toEqual([{ ...chairFinal, version: 3, confirmed: true, discarded: false }]);
  });

  it("discards pending ballots queued before the chair's final ballot", () => {
    const draft = ballot("draft");
    const plan = planPrivateBallotWrites([draft, chairFinal], new Map());
    expect(plan.writes.map((write) => [write.id, write.version, write.confirmed, write.discarded])).toEqual([
      ["draft", 1, false, true],
      ["chair-ballot", 2, true, false],
    ]);
  });

  it("never discards a tab-confirmed ballot and stores the chair ballot for review", () => {
    const tabBallot = ballot("tab", { submitterType: "tabroom", confirmed: true, version: 1 });
    const plan = planPrivateBallotWrites([chairFinal], new Map([["d1", [{ id: "tab", data: tabBallot }]]]));
    expect(plan.discardExistingIds).toEqual([]);
    expect(plan.writes).toHaveLength(1);
    const [write] = plan.writes;
    expect(write).toMatchObject({ id: "chair-ballot", version: 2, confirmed: false, discarded: false });
    expect(write.confirmedBy).toBeUndefined();
    expect(write.confirmedTimestamp).toBeUndefined();
  });

  it("does not overwrite a tab-confirmed ballot that shares the resubmitted id", () => {
    const confirmedChairBallot = ballot("chair-ballot", { confirmed: true, confirmedBy: "director@example.com", version: 1 });
    const plan = planPrivateBallotWrites([chairFinal], new Map([["d1", [{ id: "chair-ballot", data: confirmedChairBallot }]]]));
    expect(plan.discardExistingIds).toEqual([]);
    expect(plan.writes[0]).toMatchObject({ id: "chair-ballot-v2", version: 2, confirmed: false });
  });

  it("keeps the result of a locked round and stores a late chair ballot for review", () => {
    // Even an earlier chair self-confirmed ballot stays: the round is completed or published.
    const earlier = ballot("earlier", { confirmed: true, confirmedBy: "Chair", version: 1 });
    const plan = planPrivateBallotWrites(
      [chairFinal],
      new Map([["d1", [{ id: "earlier", data: earlier }]]]),
      new Set(["d1"])
    );
    expect(plan.discardExistingIds).toEqual([]);
    expect(plan.writes).toEqual([
      expect.objectContaining({ id: "chair-ballot", version: 2, confirmed: false, discarded: false }),
    ]);
    expect(plan.writes[0].confirmedBy).toBeUndefined();
  });
});

describe("supersededBallotUpdate", () => {
  it("discards the earlier ballot and moves its sync version on", () => {
    expect(supersededBallotUpdate({ confirmed: true, discarded: false })).toEqual({ confirmed: false, discarded: true, syncVersion: 1 });
    expect(supersededBallotUpdate({ confirmed: true, syncVersion: 4 })).toEqual({ confirmed: false, discarded: true, syncVersion: 5 });
  });
});

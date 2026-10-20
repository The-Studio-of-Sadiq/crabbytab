import { describe, expect, it } from "vitest";
import type { BallotSubmission, Debate, Round } from "@/types";
import type { GenerateDrawParams as GenerateDrawParamsShape } from "@/lib/draw/generator";
import { makeAdjudicators, makeRound, makeTeams, makeTournament, makeVenues } from "@/test/tournamentFixtures";
import { checkConcurrentRoundClashes, checkDrawGeneration, checkRoundUpdate } from "./stateGuards";
import { liveListenerScopes } from "./liveSync";
import { computeAutoAllocation } from "./allocation";
import { generateDrawCommand, type GenerateDrawDependencies } from "./draws";
import { updateRoundsCommand } from "./rounds";

const tournament = makeTournament("wsdc");
const tid = tournament.id;

function debate(id: string, roundId: string, teams: [string, string], extra: Partial<Debate> = {}): Debate {
  return {
    id,
    tournamentId: tid,
    roundId,
    roundSeq: 1,
    bracket: 0,
    roomRank: 1,
    importance: 0,
    resultStatus: "none",
    sidesConfirmed: true,
    flags: [],
    teams: {
      AFF: { teamId: teams[0], teamName: teams[0], side: "AFF" },
      NEG: { teamId: teams[1], teamName: teams[1], side: "NEG" },
    } as Debate["teams"],
    adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    ...extra,
  };
}

// Round 1 (A) and Round 1 (B) share slot 1; Round 2 is slot 2.
const panelA = makeRound(tid, 1, { id: "1a", name: "Round 1 (A)", scheduleGroup: 1, drawType: "round_robin" });
const panelB = makeRound(tid, 2, { id: "1b", name: "Round 1 (B)", scheduleGroup: 1, drawType: "round_robin" });
const round2 = makeRound(tid, 3, { id: "r2", name: "Round 2", scheduleGroup: 2 });
const rounds: Round[] = [panelA, panelB, round2];

describe("concurrent rounds and the state rules", () => {
  it("does not wait for a concurrent round's results, but does for an earlier slot's", () => {
    const debates = [debate("da", "1a", ["t1", "t2"])];
    expect(checkDrawGeneration(panelB, { rounds, debates, ballots: [] })).toEqual([]);
    const later = checkDrawGeneration(round2, { rounds, debates, ballots: [] });
    expect(later.map((violation) => [violation.rule, violation.roundId])).toEqual([
      ["previous_round_incomplete", "1a"],
      ["previous_round_incomplete", "1b"],
    ]);
  });

  it("does not treat a concurrent round's draw as based on this round", () => {
    const debates = [debate("da", "1a", ["t1", "t2"]), debate("db", "1b", ["t3", "t4"])];
    const released = { ...panelA, drawStatus: "released" as const };
    const violations = checkDrawGeneration(released, { rounds: [released, panelB, round2], debates, ballots: [] });
    expect(violations.map((violation) => violation.rule)).toEqual(["draw_released"]);
  });

  it("flags a team drawn in two concurrent rounds when the draw is published", () => {
    const debates = [debate("da", "1a", ["t1", "t2"]), debate("db", "1b", ["t1", "t3"])];
    const state = { rounds, debates, ballots: [] as BallotSubmission[] };
    expect(checkConcurrentRoundClashes(panelB, state).map((violation) => [violation.rule, violation.overridable])).toEqual([
      ["concurrent_round_clash", true],
    ]);
    const published = checkRoundUpdate(panelB, { ...panelB, drawStatus: "confirmed" }, state, () => []);
    expect(published.map((violation) => violation.rule)).toContain("concurrent_round_clash");
    expect(checkConcurrentRoundClashes(round2, state)).toEqual([]);
  });

  it("listens live to the concurrent rounds' debates and ballots too", () => {
    expect(liveListenerScopes("1a", ["1b", "1a"])).toEqual([
      { collection: "teams" },
      { collection: "adjudicators" },
      { collection: "debates", roundId: "1a" },
      { collection: "ballots", roundId: "1a" },
      { collection: "debates", roundId: "1b" },
      { collection: "ballots", roundId: "1b" },
    ]);
  });
});

describe("allocating and drawing concurrent rounds", () => {
  it("never allocates an adjudicator already judging in a concurrent round", () => {
    const adjudicators = makeAdjudicators(4, { tournamentId: tid });
    const teams = makeTeams(4, { tournamentId: tid });
    const debates = [
      debate("da", "1a", ["team-1", "team-2"], {
        adjudicators: { chairId: "adj-1", chairName: "A1", panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
      }),
      debate("db", "1b", ["team-3", "team-4"]),
    ];
    const result = computeAutoAllocation({
      tournament,
      rounds,
      teams,
      debates,
      adjudicators,
      standings: [],
      breakCategories: [],
      feedback: [],
      venues: [],
      roundId: "1b",
      panelSize: 3,
    });
    const used = result?.roundDebates.flatMap((item) => [item.adjudicators.chairId, ...item.adjudicators.panellistIds]) ?? [];
    expect(used.length).toBeGreaterThan(0);
    expect(used).not.toContain("adj-1");
  });

  it("draws without the venues and history of a concurrent round, with the slot's round-robin index", async () => {
    const venues = makeVenues(3, tid);
    const debates = [debate("da", "1a", ["team-1", "team-2"], { venueId: "venue-1", venueName: "Room A" })];
    let params: GenerateDrawParamsShape | undefined;
    const dependencies: GenerateDrawDependencies = {
      tournament,
      rounds,
      teams: makeTeams(2, { tournamentId: tid }),
      venues,
      debates,
      ballots: [],
      motions: [],
      standings: [],
      generateRoundDraw(input) {
        params = input;
        return [];
      },
      localRepository: { saveDebates() {}, saveBallots() {}, markDebatesRemoved() {}, saveRounds() {} },
      async recordAuditEvent() {},
    };
    await generateDrawCommand("1b", dependencies);
    expect(params?.venues.map((venue) => venue.id)).toEqual(["venue-2", "venue-3"]);
    expect(params?.pastDebates).toEqual([]);
    expect(params?.roundRobinIndex).toBe(1);
  });
});

describe("updateRoundsCommand", () => {
  it("saves every changed round in one write after checking all of them", async () => {
    const saved: Round[][] = [];
    const events: string[] = [];
    const dependencies = {
      localRepository: { saveRounds: (items: Round[]) => { saved.push(items); } },
      recordAuditEvent: async (event: { action: string }) => { events.push(event.action); },
      guards: { debates: [], ballots: [], drawIssues: () => [] },
    };
    const grouped = [{ ...panelA, scheduleGroup: 5 }, { ...round2, startsAt: "2026-10-21T09:00:00.000Z" }];
    await updateRoundsCommand(grouped, rounds, null, dependencies, "Round schedule updated");
    expect(saved).toHaveLength(1);
    expect(saved[0].map((item) => [item.id, item.scheduleGroup, item.startsAt])).toEqual([
      ["1a", 5, undefined],
      ["1b", 1, undefined],
      ["r2", 2, "2026-10-21T09:00:00.000Z"],
    ]);
    expect(events).toEqual(["rounds.updated"]);

    // Publishing a draw with no debates is a hard block: nothing is saved.
    await expect(updateRoundsCommand([{ ...panelA, drawStatus: "confirmed" }], rounds, null, dependencies, "x")).rejects.toThrow();
    expect(saved).toHaveLength(1);
  });
});

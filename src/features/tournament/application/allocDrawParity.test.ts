/**
 * Application-level regression tests for the alloc-draw-bugs fixes: allocation refusals and room
 * shortages through the commands, concurrent-round room bookings, round ids and stage/draw-type
 * validation, emoji uniqueness, the released-draw guard, anticipated elimination rooms and the
 * Tabbycat allocator chosen for filling preformed panels.
 */
import { describe, expect, it } from "vitest";
import type { Adjudicator, Debate, DebateSide, Round, Team, Tournament, Venue } from "@/types";
import {
  autoAllocateCommand,
  computeAutoAllocation,
  computeRoundVenueAllocation,
  type AllocationDependencies,
} from "./allocation";
import {
  createRoundCommand,
  createRoundRecord,
  newRoundId,
  roundStageDrawTypeProblem,
  updateRoundCommand,
  RoundValidationError,
} from "./rounds";
import { checkAutoAllocation } from "./stateGuards";
import { anticipatedEliminationTeamCount, anticipateRound, panelFillMode } from "./preformedPanels";
import { assignTeamEmoji, TEAM_EMOJI } from "@/lib/codeNames";
import { createSeededRng } from "@/lib/draw/rng";

const T = "t";

function team(id: string): Team {
  return { id, tournamentId: T, name: id, speakers: [], breakCategories: [], speakerCategories: [] };
}

function debate(id: string, teamIds: [string, string], extra: Partial<Debate> = {}): Debate {
  return {
    id,
    tournamentId: T,
    roundId: "r1",
    roundSeq: 1,
    bracket: 0,
    roomRank: 1,
    importance: 0,
    resultStatus: "none",
    sidesConfirmed: true,
    flags: [],
    teams: Object.fromEntries((["AFF", "NEG"] as DebateSide[]).map((side, index) => [side, { teamId: teamIds[index], teamName: teamIds[index], side }])) as Debate["teams"],
    adjudicators: { chairId: "old-chair", chairName: "Old", panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    ...extra,
  };
}

function judge(id: string, extra: Partial<Adjudicator> = {}): Adjudicator {
  return { id, tournamentId: T, name: id, baseScore: 5, trainee: false, independent: true, checkedIn: true, conflicts: [], ...extra };
}

function round(id: string, seq: number, extra: Partial<Round> = {}): Round {
  return {
    id, tournamentId: T, seq, name: `Round ${seq}`, abbreviation: `R${seq}`, stage: "preliminary", drawType: "power_paired",
    drawStatus: "draft", feedbackWeight: 0, silent: false, motionsReleased: false, resultsReleased: false, completed: false, createdAt: "",
    ...extra,
  };
}

const venue = (id: string, extra: Partial<Venue> = {}): Venue => ({ id, tournamentId: T, name: id, priority: 1, available: true, ...extra });

function dependencies(adjudicators: Adjudicator[], extra: Partial<AllocationDependencies> = {}) {
  const saved: Debate[][] = [];
  const deps: AllocationDependencies = {
    tournament: { id: T, format: "wsdc", preferences: {} } as Tournament,
    rounds: [round("r1", 1)],
    teams: ["a", "b", "c", "d"].map(team),
    debates: [debate("d1", ["a", "b"]), debate("d2", ["c", "d"], { roomRank: 2 })],
    ballots: [],
    adjudicators,
    standings: [],
    breakCategories: [],
    feedback: [],
    venues: [],
    repository: { saveDebates: (debates) => saved.push(debates) },
    hideRevealedAdjudicators: async () => undefined,
    recordAuditEvent: async () => undefined,
    ...extra,
  };
  return { deps, saved };
}

describe("auto-allocation through the command", () => {
  it("refuses with a clear message and keeps the existing panels when nobody is available", async () => {
    const { deps, saved } = dependencies([judge("away", { checkedIn: false })]);
    await expect(autoAllocateCommand("r1", 1, deps)).rejects.toThrow(/no available adjudicators/);
    expect(saved).toEqual([]);
  });

  it("still allocates when an adjudicator has a room constraint and rooms run short, reporting the shortage", () => {
    const { deps } = dependencies([
      judge("j1", { venueConstraints: [{ category: "Quiet", priority: 1 }] }),
      judge("j2"),
    ], { venues: [venue("only", { categories: ["Quiet"], category: "Quiet" })] });
    const result = computeAutoAllocation({ ...deps, roundId: "r1", panelSize: 1 })!;
    expect(result.roundDebates.every((item) => item.adjudicators.chairId)).toBe(true);
    expect(result.roundDebates.filter((item) => item.venueId === "only")).toHaveLength(1);
    expect(result.details.warnings.some((warning) => /Not enough available venues/.test(warning))).toBe(true);
  });

  it("is blocked (overridable) when the draw is already released, as Tabbycat", () => {
    const released = round("r1", 1, { drawStatus: "confirmed" });
    const violations = checkAutoAllocation(released, { rounds: [released], debates: [], ballots: [] });
    expect(violations.map((item) => [item.rule, item.overridable])).toEqual([["draw_released", true]]);
    const locked = round("r1", 1, { drawStatus: "locked" });
    expect(checkAutoAllocation(locked, { rounds: [locked], debates: [], ballots: [] })).toEqual([]);
  });
});

describe("auto-allocating rooms on the draw page", () => {
  it("never offers a room booked by a concurrent round", () => {
    const rounds = [round("r1", 1, { scheduleGroup: 1 }), round("r1b", 2, { scheduleGroup: 1 })];
    const debates = [
      debate("d1", ["a", "b"], { venueId: undefined, venueName: "Room 1" }),
      debate("other", ["c", "d"], { roundId: "r1b", venueId: "best", venueName: "best" }),
    ];
    const { roundDebates, unassigned } = computeRoundVenueAllocation(rounds[0], {
      rounds,
      debates,
      venues: [venue("best", { priority: 9 }), venue("spare")],
    });
    expect(roundDebates.map((item) => item.venueId)).toEqual(["spare"]);
    expect(unassigned).toEqual([]);
  });
});

describe("round ids and stage/draw type (Tabbycat Round.clean())", () => {
  it("gives a new round a fresh id even when the sequence-based id is taken after a deletion", async () => {
    // R1..R3, R2 deleted: the old R3 keeps id ...-3 with seq 2; the new round has seq 3.
    const existing = [round("round-t-1", 1), round("round-t-3", 2)];
    const created = await createRoundCommand(
      { tournamentId: T, roundSeq: 3, name: "Round 3", abbr: "R3", stage: "preliminary" },
      existing,
      { localRepository: { saveRounds: () => undefined }, recordAuditEvent: async () => undefined }
    );
    expect(existing.map((item) => item.id)).not.toContain(created.id);
    expect(created.id).toMatch(/^round-t-3-/);
    expect(newRoundId(T, 3, [created, ...existing])).not.toBe(created.id);
  });

  it("an elimination round takes the elimination draw; mismatches are refused", () => {
    expect(createRoundRecord({ tournamentId: T, roundSeq: 6, name: "Final", abbr: "GF", stage: "elimination" }).drawType).toBe("elimination");
    expect(() => createRoundRecord({ tournamentId: T, roundSeq: 2, name: "R2", abbr: "R2", stage: "preliminary", customDrawType: "elimination" }))
      .toThrow(RoundValidationError);
    expect(roundStageDrawTypeProblem("elimination", "power_paired")).toMatch(/only for elimination rounds/);
    expect(roundStageDrawTypeProblem("preliminary", "random")).toBeNull();
  });

  it("refuses an update that makes the stage and draw type inconsistent", async () => {
    const prelim = round("r1", 1);
    await expect(updateRoundCommand({ ...prelim, drawType: "elimination" }, [prelim], null, {
      localRepository: { saveRounds: () => undefined },
      recordAuditEvent: async () => undefined,
      guards: { debates: [], ballots: [], drawIssues: () => [] },
    })).rejects.toThrow(RoundValidationError);
  });
});

describe("team emoji are unique (Tabbycat set_emoji)", () => {
  it("leaves the extra teams without an emoji when the pool runs out", () => {
    const teams = Array.from({ length: TEAM_EMOJI.length + 3 }, (_, index) => team(`team-${String(index).padStart(3, "0")}`));
    const assigned = assignTeamEmoji(teams, createSeededRng(5));
    expect(assigned).toHaveLength(TEAM_EMOJI.length);
    expect(new Set(assigned.map((item) => item.emoji)).size).toBe(TEAM_EMOJI.length);
  });
});

describe("preformed panels for elimination rounds and filling them", () => {
  it("sizes anticipated elimination rounds as Tabbycat", () => {
    expect(anticipatedEliminationTeamCount(8, 0, 2)).toBe(8);
    expect(anticipatedEliminationTeamCount(8, 1, 2)).toBe(4);
    // Partial two-team break of 12: 8 teams debate first (4 bypass), then 8, then 4.
    expect(anticipatedEliminationTeamCount(12, 0, 2)).toBe(8);
    expect(anticipatedEliminationTeamCount(12, 1, 2)).toBe(8);
    expect(anticipatedEliminationTeamCount(12, 2, 2)).toBe(4);
    expect(anticipatedEliminationTeamCount(32, 1, 4)).toBe(16);
  });

  it("the second elimination round of an 8-team break anticipates two rooms", () => {
    const tournament = { id: T, format: "wsdc", preferences: {} } as Tournament;
    const category = { id: "open", tournamentId: T, name: "Open", breakSize: 8, isGeneral: true } as never;
    const rounds = [
      round("qf", 6, { stage: "elimination", drawType: "elimination", breakCategoryIds: ["open"] }),
      round("sf", 7, { stage: "elimination", drawType: "elimination", breakCategoryIds: ["open"] }),
    ];
    const anticipation = anticipateRound(rounds[1], { tournament, rounds, teams: [], debates: [], ballots: [], breakCategories: [category] });
    expect(anticipation.rooms).toHaveLength(2);
  });

  it("fills panels with Tabbycat's allocator for the ballots unless a Tabbycat strategy is chosen", () => {
    const voting = { format: "wsdc", preferences: { ballotMode: "voting" } } as Tournament;
    const consensus = { format: "wsdc", preferences: { ballotMode: "consensus" } } as Tournament;
    const prelim = round("r1", 1);
    expect(panelFillMode(prelim, voting)).toBe("voting");
    expect(panelFillMode(prelim, consensus)).toBe("consensus");
    expect(panelFillMode(prelim, { ...voting, preferences: { ballotMode: "voting", adjudicatorPanelStrategy: "tabbycat_consensus" } } as Tournament)).toBe("consensus");
  });
});

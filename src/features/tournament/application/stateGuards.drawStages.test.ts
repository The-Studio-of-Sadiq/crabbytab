import { describe, expect, it } from "vitest";

import type { Debate, Round } from "@/types";
import { makeRound } from "@/test/tournamentFixtures";
import {
  checkDebateEdits,
  checkDrawGeneration,
  checkRoundUpdate,
  isDrawReleased,
  remoteBallotSubmissionBlocker,
  type RoundGuardState,
} from "./stateGuards";

const T = "t-stages";

function round(seq: number, overrides: Partial<Round> = {}): Round {
  return makeRound(T, seq, overrides);
}

function debate(id: string, roundId: string, teams: [string, string]): Debate {
  return {
    id,
    tournamentId: T,
    roundId,
    roundSeq: 1,
    venueId: `venue-${id}`,
    venueName: `Room ${id}`,
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
    adjudicators: { chairId: "adj-1", panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
  };
}

const r1 = round(1, { drawStatus: "draft" });
const withDraw: RoundGuardState = { rounds: [r1], debates: [debate("d1", r1.id, ["a", "b"])], ballots: [] };
const empty: RoundGuardState = { rounds: [r1], debates: [], ballots: [] };
const noIssues = () => [];
const errorIssue = () => [{ severity: "error" as const, message: "Team a is in two rooms." }];
const rules = (violations: { rule: string }[]) => violations.map((violation) => violation.rule);

describe("draw stage transitions (checkRoundUpdate)", () => {
  it("confirming (locking) needs a draw but does not run the release check", () => {
    expect(rules(checkRoundUpdate(r1, { ...r1, drawStatus: "locked" }, empty, noIssues))).toEqual(["draw_empty"]);
    expect(checkRoundUpdate(r1, { ...r1, drawStatus: "locked" }, withDraw, errorIssue)).toEqual([]);
  });

  it("a teams-only release runs the same draw check as the public release", () => {
    expect(rules(checkRoundUpdate(r1, { ...r1, drawStatus: "teams_released" }, withDraw, errorIssue))).toEqual(["draw_invalid"]);
    expect(rules(checkRoundUpdate(r1, { ...r1, drawStatus: "confirmed" }, withDraw, errorIssue))).toEqual(["draw_invalid"]);
    expect(rules(checkRoundUpdate({ ...r1, drawStatus: "locked" }, { ...r1, drawStatus: "confirmed" }, withDraw, errorIssue)))
      .toEqual(["draw_invalid"]);
  });

  it("going from teams-only to the full release does not re-check what teams already saw", () => {
    const teams = { ...r1, drawStatus: "teams_released" as const };
    expect(checkRoundUpdate(teams, { ...r1, drawStatus: "confirmed" }, withDraw, errorIssue)).toEqual([]);
  });

  it("unreleasing and unconfirming are never blocked", () => {
    expect(checkRoundUpdate({ ...r1, drawStatus: "confirmed" }, { ...r1, drawStatus: "locked" }, withDraw, errorIssue)).toEqual([]);
    expect(checkRoundUpdate({ ...r1, drawStatus: "locked" }, { ...r1, drawStatus: "draft" }, withDraw, errorIssue)).toEqual([]);
  });

  it("the legacy 'released' value still counts as already public", () => {
    expect(checkRoundUpdate({ ...r1, drawStatus: "released" }, { ...r1, drawStatus: "confirmed" }, withDraw, errorIssue)).toEqual([]);
  });
});

describe("changing a confirmed or released draw", () => {
  it("regenerating a confirmed draw needs a reason (draw_confirmed)", () => {
    const locked = { ...r1, drawStatus: "locked" as const };
    const violations = checkDrawGeneration(locked, { ...withDraw, rounds: [locked] });
    expect(rules(violations)).toEqual(["draw_confirmed"]);
    expect(violations[0].overridable).toBe(true);
  });

  it("regenerating a teams-only release warns that teams may have seen it", () => {
    const teams = { ...r1, drawStatus: "teams_released" as const };
    const violations = checkDrawGeneration(teams, { ...withDraw, rounds: [teams] });
    expect(rules(violations)).toEqual(["draw_released"]);
    expect(violations[0].message).toContain("released to teams");
  });

  it("matchup edits on a confirmed draw need a reason; on a draft they do not", () => {
    const before = [debate("d1", r1.id, ["a", "b"])];
    const after = [debate("d1", r1.id, ["a", "c"])];
    expect(checkDebateEdits(before, after, { rounds: [r1], ballots: [] })).toEqual([]);
    expect(rules(checkDebateEdits(before, after, { rounds: [{ ...r1, drawStatus: "locked" }], ballots: [] })))
      .toEqual(["draw_confirmed"]);
    expect(rules(checkDebateEdits(before, after, { rounds: [{ ...r1, drawStatus: "teams_released" }], ballots: [] })))
      .toEqual(["draw_released"]);
  });
});

describe("remote ballots need the full release", () => {
  it("blocks ballots while the draw is locked or released to teams only", () => {
    expect(isDrawReleased({ drawStatus: "teams_released" })).toBe(false);
    expect(remoteBallotSubmissionBlocker(round(1, { drawStatus: "locked" }))).toContain("not been published");
    expect(remoteBallotSubmissionBlocker(round(1, { drawStatus: "teams_released" }))).toContain("not been published");
    expect(remoteBallotSubmissionBlocker(round(1, { drawStatus: "confirmed" }))).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import type { BallotSubmission, Round, Tournament, TournamentPreferences } from "@/types";
import { ballotModeFor, usesVotingBallots } from "./result";
import { checkSettingsChange, lockedSettingsFields } from "@/features/tournament/application/stateGuards";

/* Per-stage ballot mode, as Tabbycat's ballots_per_debate_prelim / ballots_per_debate_elim. */

const prelim = { stage: "preliminary" } as const;
const elim = { stage: "elimination" } as const;
const rules = (preferences: Partial<TournamentPreferences>, format: Tournament["format"] = "australs") => ({ format, preferences });

describe("ballotModeFor", () => {
  it("uses ballotMode for both stages when no elimination mode is set (backward compatible)", () => {
    expect(ballotModeFor(prelim, rules({ ballotMode: "voting" }))).toBe("voting");
    expect(ballotModeFor(elim, rules({ ballotMode: "voting" }))).toBe("voting");
    expect(ballotModeFor(elim, rules({}))).toBe("consensus");
  });

  it("lets elimination rounds use their own mode", () => {
    // Tabbycat's Australian Easters preset: consensus prelims, voting elims.
    const easters = rules({ ballotMode: "consensus", eliminationBallotMode: "voting" });
    expect(ballotModeFor(prelim, easters)).toBe("consensus");
    expect(ballotModeFor(elim, easters)).toBe("voting");
    expect(ballotModeFor(elim, rules({ ballotMode: "voting", eliminationBallotMode: "consensus" }))).toBe("consensus");
  });

  it("treats an unknown round as preliminary", () => {
    expect(ballotModeFor(undefined, rules({ ballotMode: "consensus", eliminationBallotMode: "voting" }))).toBe("consensus");
  });

  it("is always consensus in BP", () => {
    expect(ballotModeFor(elim, rules({ ballotMode: "voting", eliminationBallotMode: "voting" }, "bp"))).toBe("consensus");
  });

  it("drives usesVotingBallots through the rules' stage", () => {
    const easters = rules({ ballotMode: "consensus", eliminationBallotMode: "voting" });
    expect(usesVotingBallots(easters)).toBe(false);
    expect(usesVotingBallots({ ...easters, stage: "elimination" })).toBe(true);
  });
});

describe("locking the elimination ballot mode", () => {
  const tournament = (preferences: Partial<TournamentPreferences>) =>
    ({ id: "t", format: "australs", preferences } as unknown as Tournament);
  const rounds = [{ id: "r1", stage: "preliminary" }, { id: "qf", stage: "elimination" }] as Round[];
  const ballotIn = (roundId: string) =>
    ({ id: `b-${roundId}`, roundId, debateId: "d", confirmed: true, discarded: false } as unknown as BallotSubmission);

  it("can change while only preliminary ballots exist", () => {
    const violations = checkSettingsChange(
      tournament({ ballotMode: "consensus" }),
      tournament({ ballotMode: "consensus", eliminationBallotMode: "voting" }),
      [ballotIn("r1")],
      rounds
    );
    expect(violations).toEqual([]);
    expect(lockedSettingsFields([ballotIn("r1")], rounds)).not.toContain("eliminationBallotMode");
  });

  it("is locked once an elimination ballot exists", () => {
    const violations = checkSettingsChange(
      tournament({ ballotMode: "consensus" }),
      tournament({ ballotMode: "consensus", eliminationBallotMode: "voting" }),
      [ballotIn("r1"), ballotIn("qf")],
      rounds
    );
    expect(violations.map((violation) => [violation.rule, violation.overridable])).toEqual([["settings_locked", false]]);
    expect(lockedSettingsFields([ballotIn("qf")], rounds)).toContain("eliminationBallotMode");
  });

  it("does not count setting the mode it already had as a change", () => {
    const violations = checkSettingsChange(
      tournament({ ballotMode: "voting" }),
      tournament({ ballotMode: "voting", eliminationBallotMode: "voting" }),
      [ballotIn("qf")],
      rounds
    );
    expect(violations).toEqual([]);
  });
});

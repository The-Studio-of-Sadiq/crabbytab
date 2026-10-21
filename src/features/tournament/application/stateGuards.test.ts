import { describe, expect, it } from "vitest";

import type { BallotSubmission, BreakCategory, Debate, Round, Team, Tournament } from "@/types";
import { makeRound, makeTournament } from "@/test/tournamentFixtures";
import {
  applyGuards,
  checkAdjudicatorDeletion,
  checkAutoAllocation,
  checkBallotSubmission,
  checkBreakCategoryDeletion,
  checkBreakGeneration,
  checkDebateEdits,
  checkDrawGeneration,
  checkDrawRelease,
  checkInstitutionDeletion,
  checkPreliminaryRoundCount,
  checkResultChange,
  checkResultsRelease,
  checkRoundCancellation,
  checkRoundCompletion,
  checkRoundDeletion,
  checkRoundReopen,
  checkRoundUpdate,
  checkSettingsChange,
  checkTeamDeletion,
  checkVenueDeletion,
  enforceGuards,
  isRoundLockedForPortalBallots,
  lockedSettingsFields,
  remoteBallotSubmissionBlocker,
  roundsCancelledByPreliminaryCount,
  ruleOverrideAuditEvent,
  TournamentRuleError,
  type GuardRule,
  type GuardViolation,
  type RoundGuardState,
} from "./stateGuards";

const T = "t-rules";

function round(seq: number, overrides: Partial<Round> = {}): Round {
  return makeRound(T, seq, overrides);
}

function debate(id: string, roundId: string, teams: [string, string], overrides: Partial<Debate> = {}): Debate {
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
    ...overrides,
  };
}

function ballot(id: string, target: Debate, overrides: Partial<BallotSubmission> = {}): BallotSubmission {
  return {
    id,
    tournamentId: T,
    roundId: target.roundId,
    debateId: target.id,
    version: 1,
    confirmed: true,
    discarded: false,
    submitterType: "tabroom",
    speakerScores: {} as BallotSubmission["speakerScores"],
    teamScores: {
      AFF: { side: "AFF", teamId: target.teams.AFF!.teamId, points: 1, totalSpeakerScore: 225 },
      NEG: { side: "NEG", teamId: target.teams.NEG!.teamId, points: 0, totalSpeakerScore: 220 },
    } as BallotSubmission["teamScores"],
    timestamp: "",
    ...overrides,
  };
}

function rules(violations: GuardViolation[]): GuardRule[] {
  return violations.map((violation) => violation.rule);
}

const r1 = round(1);
const r1Debate = debate("d1", r1.id, ["a", "b"]);
const r1Bye = debate("d1-bye", r1.id, ["c", ""], { byeTeamId: "c" });

/** Round 1 fully resulted, round 2 drawn without results. */
function playedState(overrides: Partial<RoundGuardState> = {}): RoundGuardState {
  const r2 = round(2);
  return {
    rounds: [{ ...r1, completed: true, drawStatus: "released" }, r2],
    debates: [r1Debate, r1Bye, debate("d2", r2.id, ["a", "c"])],
    ballots: [ballot("b1", r1Debate)],
    ...overrides,
  };
}

describe("enforcing violations", () => {
  const soft: GuardViolation = { rule: "draw_released", message: "Published.", overridable: true };
  const hard: GuardViolation = { rule: "round_cancelled", message: "Cancelled.", overridable: false };

  it("allows an action without violations", () => {
    expect(enforceGuards([])).toEqual([]);
  });

  it("blocks overridable violations unless a reason is given", () => {
    expect(() => enforceGuards([soft])).toThrow(TournamentRuleError);
    expect(() => enforceGuards([soft], { reason: "   " })).toThrow(TournamentRuleError);
    expect(enforceGuards([soft], { reason: "Agreed by the CA team" })).toEqual([soft]);
  });

  it("never lets an override through a hard violation", () => {
    try {
      enforceGuards([soft, hard], { reason: "Please" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(TournamentRuleError);
      expect((error as TournamentRuleError).overridable).toBe(false);
      expect((error as TournamentRuleError).message).toBe("Published. Cancelled.");
    }
  });

  it("records an override in the audit log with its reason and rules", async () => {
    const events: unknown[] = [];
    await applyGuards([{ ...soft, roundId: "r" }], { reason: " Late room swap " }, {
      action: "draw.generated",
      category: "draw",
      roundId: "r",
      record: async (event) => { events.push(event); },
    });
    expect(events).toEqual([ruleOverrideAuditEvent("draw.generated", "draw", [{ ...soft, roundId: "r" }], { reason: "Late room swap" }, "r")]);
    expect(events[0]).toMatchObject({
      action: "rules.overridden",
      details: { overriddenAction: "draw.generated", reason: "Late room swap", rules: [{ rule: "draw_released", roundId: "r" }] },
    });
  });

  it("records nothing when no rule was overridden", async () => {
    const events: unknown[] = [];
    await applyGuards([], { reason: "unused" }, { action: "x", category: "draw", record: async (event) => { events.push(event); } });
    expect(events).toEqual([]);
  });
});

describe("draw generation", () => {
  it("allows the first round and a round after a finished round", () => {
    expect(checkDrawGeneration(r1, { rounds: [r1], debates: [], ballots: [] })).toEqual([]);
    const state = playedState({ debates: [r1Debate, r1Bye] });
    expect(checkDrawGeneration(state.rounds[1], state)).toEqual([]);
  });

  it("needs an override while an earlier round has unconfirmed results", () => {
    const state = playedState({ debates: [r1Debate, r1Bye], ballots: [ballot("b1", r1Debate, { confirmed: false })] });
    const violations = checkDrawGeneration(state.rounds[1], state);
    expect(rules(violations)).toEqual(["previous_round_incomplete"]);
    expect(violations[0].overridable).toBe(true);
    expect(violations[0].message).toContain("Room d1 has no confirmed ballot");
  });

  it("treats a postponed debate as unfinished but ignores byes", () => {
    const postponed = { ...r1Debate, postponed: true };
    const state = playedState({ debates: [postponed, r1Bye] });
    expect(checkDrawGeneration(state.rounds[1], state)[0].message).toContain("postponed");
  });

  it("blocks cancelled, completed and advanced rounds", () => {
    const state = playedState();
    expect(rules(checkDrawGeneration({ ...state.rounds[1], cancelled: true }, state))).toEqual(["round_cancelled"]);
    expect(rules(checkDrawGeneration(state.rounds[0], state))).toContain("round_completed");
    const elim = round(3, { stage: "elimination", breakCategoryIds: ["open"], eliminationAdvanced: true });
    expect(rules(checkDrawGeneration(elim, { ...state, rounds: [...state.rounds, elim] }))).toContain("elimination_advanced");
  });

  it("needs an override to regenerate a published draw or one later rounds were drawn from", () => {
    const state = playedState({ ballots: [] });
    const r1Open = { ...state.rounds[0], completed: false };
    const violations = checkDrawGeneration(r1Open, { ...state, rounds: [r1Open, state.rounds[1]] });
    expect(rules(violations)).toEqual(["draw_released", "later_round_drawn"]);
    expect(violations.every((violation) => violation.overridable)).toBe(true);
  });

  it("requires a break before an elimination round, and the earlier elimination round advanced", () => {
    const quarters = round(3, { stage: "elimination", breakCategoryIds: ["open"] });
    const semis = round(4, { stage: "elimination", breakCategoryIds: ["open"] });
    const unscheduled = round(5, { stage: "elimination" });
    const state = { rounds: [quarters, semis, unscheduled], debates: [], ballots: [] };
    expect(checkDrawGeneration(quarters, state)).toEqual([]);
    expect(rules(checkDrawGeneration(semis, state))).toEqual(["previous_elimination_not_advanced"]);
    expect(rules(checkDrawGeneration(unscheduled, state))).toEqual(["break_not_generated"]);
    const advanced = { ...state, rounds: [{ ...quarters, eliminationAdvanced: true }, semis] };
    expect(checkDrawGeneration(semis, advanced)).toEqual([]);
  });
});

describe("round status changes", () => {
  it("blocks publishing an empty draw and needs an override for draw check problems", () => {
    const empty = { rounds: [r1], debates: [], ballots: [] };
    expect(rules(checkDrawRelease(r1, empty, []))).toEqual(["draw_empty"]);
    const drawn = { rounds: [r1], debates: [r1Debate], ballots: [] };
    expect(checkDrawRelease(r1, drawn, [{ severity: "warning", message: "Minor." }])).toEqual([]);
    const invalid = checkDrawRelease(r1, drawn, [{ severity: "error", message: "Team a appears twice." }]);
    expect(rules(invalid)).toEqual(["draw_invalid"]);
    expect(invalid[0]).toMatchObject({ overridable: true, message: expect.stringContaining("Team a appears twice.") });
  });

  it("blocks publishing results until every debate has a confirmed result", () => {
    const incomplete = { rounds: [r1], debates: [r1Debate, r1Bye], ballots: [] };
    expect(rules(checkResultsRelease(r1, incomplete))).toEqual(["results_incomplete"]);
    expect(checkResultsRelease(r1, playedState())).toEqual([]);
  });

  it("needs an override to publish results while newer ballot versions await a check", () => {
    const state = playedState({ ballots: [ballot("b1", r1Debate), ballot("b1-v2", r1Debate, { version: 2, confirmed: false })] });
    const violations = checkResultsRelease(r1, state);
    expect(rules(violations)).toEqual(["unconfirmed_ballots"]);
    expect(violations[0].overridable).toBe(true);
    // A discarded version is not waiting for anything.
    const discarded = playedState({ ballots: [ballot("b1", r1Debate), ballot("old", r1Debate, { confirmed: false, discarded: true })] });
    expect(checkResultsRelease(r1, discarded)).toEqual([]);
  });

  it("blocks completing an unfinished round", () => {
    expect(rules(checkRoundCompletion(r1, { rounds: [r1], debates: [r1Debate], ballots: [] }))).toEqual(["results_incomplete"]);
    expect(checkRoundCompletion(r1, playedState())).toEqual([]);
  });

  it("needs an override to reopen a round once a later round is drawn", () => {
    const state = playedState();
    expect(rules(checkRoundReopen(state.rounds[0], state))).toEqual(["later_round_drawn"]);
    const undrawn = playedState({ debates: [r1Debate, r1Bye] });
    expect(checkRoundReopen(undrawn.rounds[0], undrawn)).toEqual([]);
  });

  it("checks only the fields that change", () => {
    const state = playedState({ ballots: [] });
    const r2 = state.rounds[1];
    let drawChecks = 0;
    const issues = () => { drawChecks += 1; return [{ severity: "error" as const, message: "Clash." }]; };
    expect(checkRoundUpdate(r2, { ...r2, feedbackWeight: 0.5 }, state, issues)).toEqual([]);
    expect(drawChecks).toBe(0);
    expect(rules(checkRoundUpdate(r2, { ...r2, drawStatus: "confirmed" }, state, issues))).toEqual(["draw_invalid"]);
    expect(rules(checkRoundUpdate(r2, { ...r2, resultsReleased: true }, state, issues))).toEqual(["results_incomplete"]);
    expect(rules(checkRoundUpdate(r2, { ...r2, teamSpeaksReleased: true }, state, issues))).toEqual(["results_incomplete"]);
    expect(rules(checkRoundUpdate(r2, { ...r2, completed: true }, state, issues))).toEqual(["results_incomplete"]);
    // Withdrawing a release is always allowed.
    const released = { ...r2, drawStatus: "released" as const, resultsReleased: true };
    expect(checkRoundUpdate(released, { ...released, drawStatus: "draft", resultsReleased: false }, state, issues)).toEqual([]);
  });

  it("blocks cancelling a round with results and needs an override for a drawn round", () => {
    const state = playedState();
    expect(rules(checkRoundCancellation(state.rounds[0], state))).toEqual(["round_has_results"]);
    expect(checkRoundCancellation(state.rounds[1], state)).toEqual([
      expect.objectContaining({ rule: "round_has_draw", overridable: true }),
    ]);
    expect(checkRoundCancellation(round(3), state)).toEqual([]);
  });

  it("checks exactly the rounds a lower preliminary count cancels", () => {
    const state = playedState();
    expect(roundsCancelledByPreliminaryCount([...state.rounds, round(3, { cancelled: true })], 1).map((item) => item.seq)).toEqual([2]);
    expect(rules(checkPreliminaryRoundCount(1, state))).toEqual(["round_has_draw"]);
    expect(rules(checkPreliminaryRoundCount(0, state))).toEqual(["round_has_results", "round_has_draw"]);
    expect(checkPreliminaryRoundCount(5, state)).toEqual([]);
  });

  it("needs an override to delete a resulted round or one later rounds were drawn from", () => {
    const state = playedState();
    const violations = checkRoundDeletion(state.rounds[0], state);
    expect(rules(violations)).toEqual(["later_round_drawn", "round_has_results"]);
    expect(violations.every((violation) => violation.overridable)).toBe(true);
    expect(checkRoundDeletion(state.rounds[1], state)).toEqual([]);
    const advanced = round(3, { stage: "elimination", eliminationAdvanced: true });
    expect(rules(checkRoundDeletion(advanced, { ...state, rounds: [...state.rounds, advanced] }))).toEqual(["elimination_advanced"]);
  });
});

describe("draw and allocation edits", () => {
  const draft = round(1, { drawStatus: "draft" });
  const plain = debate("d", draft.id, ["a", "b"]);
  const state = (overrides: Partial<RoundGuardState> = {}) => ({ rounds: [draft], ballots: [] as BallotSubmission[], ...overrides });

  it("allows any edit of an unpublished draw without ballots", () => {
    const swapped = { ...plain, teams: { AFF: plain.teams.NEG, NEG: plain.teams.AFF } as Debate["teams"] };
    expect(checkDebateEdits([plain], [swapped], state())).toEqual([]);
    expect(checkDebateEdits([plain], [], state())).toEqual([]);
    expect(checkDebateEdits([], [plain], state())).toEqual([]);
  });

  it("blocks deleting a debate or changing its teams once it has a ballot", () => {
    const withBallot = state({ ballots: [ballot("b", plain, { confirmed: false })] });
    expect(rules(checkDebateEdits([plain], [], withBallot))).toEqual(["debate_has_ballots"]);
    const moved = { ...plain, teams: { ...plain.teams, NEG: { teamId: "z", teamName: "z", side: "NEG" } } as Debate["teams"] };
    const violations = checkDebateEdits([plain], [moved], withBallot);
    expect(violations).toEqual([expect.objectContaining({ rule: "debate_has_ballots", overridable: false })]);
    // A discarded ballot no longer ties the debate to its teams.
    expect(checkDebateEdits([plain], [moved], state({ ballots: [ballot("b", plain, { discarded: true })] }))).toEqual([]);
  });

  it("needs an override to change the panel of a debate with a ballot, but not its venue", () => {
    const withBallot = state({ ballots: [ballot("b", plain)] });
    const newChair = { ...plain, adjudicators: { ...plain.adjudicators, chairId: "adj-2" } };
    expect(checkDebateEdits([plain], [newChair], withBallot)).toEqual([
      expect.objectContaining({ rule: "debate_has_ballots", overridable: true }),
    ]);
    expect(checkDebateEdits([plain], [{ ...plain, venueId: "other" }], withBallot)).toEqual([]);
  });

  it("needs an override to change matchups of a published draw, not its panels or rooms", () => {
    const published = { rounds: [{ ...draft, drawStatus: "released" as const }], ballots: [] };
    expect(rules(checkDebateEdits([plain], [], published))).toEqual(["draw_released"]);
    const newChair = { ...plain, adjudicators: { ...plain.adjudicators, chairId: "adj-2" } };
    expect(checkDebateEdits([plain], [newChair], published)).toEqual([]);
    expect(checkDebateEdits([plain], [{ ...plain, venueName: "Hall" }], published)).toEqual([]);
  });

  it("flags completed rounds and blocks advanced elimination rounds", () => {
    const newChair = { ...plain, adjudicators: { ...plain.adjudicators, chairId: "adj-2" } };
    expect(rules(checkDebateEdits([plain], [newChair], { rounds: [{ ...draft, completed: true }], ballots: [] }))).toEqual(["round_completed"]);
    expect(rules(checkDebateEdits([plain], [newChair], { rounds: [{ ...draft, eliminationAdvanced: true }], ballots: [] })))
      .toEqual(["elimination_advanced"]);
  });

  it("needs an override to re-allocate a round with ballots", () => {
    expect(checkAutoAllocation(draft, { rounds: [draft], debates: [plain], ballots: [] })).toEqual([]);
    expect(rules(checkAutoAllocation(draft, { rounds: [draft], debates: [plain], ballots: [ballot("b", plain)] })))
      .toEqual(["debate_has_ballots"]);
    expect(rules(checkAutoAllocation({ ...draft, cancelled: true }, { rounds: [], debates: [], ballots: [] }))).toEqual(["round_cancelled"]);
  });
});

describe("ballots", () => {
  it("allows a new version and rewriting an unconfirmed draft", () => {
    const state = playedState({ ballots: [ballot("draft", r1Debate, { confirmed: false })] });
    expect(checkBallotSubmission(ballot("new", r1Debate, { confirmed: false }), state)).toEqual([]);
    expect(checkBallotSubmission(ballot("draft", r1Debate, { confirmed: false }), state)).toEqual([]);
  });

  it("never overwrites a confirmed or discarded version in place", () => {
    const state = playedState({ ballots: [ballot("b1", r1Debate), ballot("old", r1Debate, { confirmed: false, discarded: true })] });
    expect(rules(checkBallotSubmission(ballot("b1", r1Debate, { confirmed: false }), state))).toEqual(["ballot_locked"]);
    expect(rules(checkBallotSubmission(ballot("old", r1Debate, { confirmed: false }), state))).toEqual(["ballot_locked"]);
    const other = debate("other", r1.id, ["x", "y"]);
    const draftState = playedState({ ballots: [ballot("draft", r1Debate, { confirmed: false })] });
    expect(rules(checkBallotSubmission(ballot("draft", other, { confirmed: false }), draftState))).toEqual(["ballot_locked"]);
  });

  it("needs an override to change the result of a completed round", () => {
    const state = playedState();
    const violations = checkBallotSubmission(ballot("b2", r1Debate, { version: 2 }), state);
    expect(violations).toEqual([expect.objectContaining({ rule: "round_completed", overridable: true })]);
    expect(violations[0].message).toContain("Round 2 was drawn from its current results");
    // An unconfirmed version changes no result.
    expect(checkBallotSubmission(ballot("b2", r1Debate, { version: 2, confirmed: false }), state)).toEqual([]);
    expect(rules(checkResultChange(ballot("b1", r1Debate), state))).toEqual(["round_completed"]);
  });

  it("blocks results in cancelled rounds and advanced elimination rounds", () => {
    const state = playedState();
    const cancelled = { ...state, rounds: [{ ...state.rounds[0], cancelled: true }, state.rounds[1]] };
    expect(rules(checkBallotSubmission(ballot("x", r1Debate, { confirmed: false }), cancelled))).toEqual(["round_cancelled"]);
    const advanced = { ...state, rounds: [{ ...state.rounds[0], eliminationAdvanced: true }] };
    expect(rules(checkResultChange(ballot("x", r1Debate), advanced))).toEqual(["elimination_advanced"]);
  });

  it("locks portal ballots in finished or published rounds", () => {
    expect(isRoundLockedForPortalBallots(round(1, { drawStatus: "released" }))).toBe(false);
    for (const patch of [{ completed: true }, { resultsReleased: true }, { teamSpeaksReleased: true }, { eliminationAdvanced: true }, { cancelled: true }]) {
      expect(isRoundLockedForPortalBallots(round(1, { drawStatus: "released", ...patch }))).toBe(true);
    }
    expect(isRoundLockedForPortalBallots(undefined)).toBe(true);
  });

  it("refuses remote ballots for unpublished, cancelled or advanced rounds", () => {
    expect(remoteBallotSubmissionBlocker(round(1, { drawStatus: "released" }))).toBe("");
    expect(remoteBallotSubmissionBlocker(round(1, { drawStatus: "confirmed", completed: true }))).toBe("");
    expect(remoteBallotSubmissionBlocker(round(1, { drawStatus: "draft" }))).toContain("not been published");
    expect(remoteBallotSubmissionBlocker(round(1, { drawStatus: "released", cancelled: true }))).toContain("not running");
    expect(remoteBallotSubmissionBlocker(round(1, { drawStatus: "released", eliminationAdvanced: true }))).toContain("advanced");
    expect(remoteBallotSubmissionBlocker(undefined)).not.toBe("");
  });
});

describe("tournament settings", () => {
  const tournament: Tournament = makeTournament("wsdc", {}, T);
  const entered = [ballot("b1", r1Debate)];

  it("allows any change before ballots exist, or when every ballot is discarded", () => {
    const bp = { ...tournament, format: "bp" as const };
    expect(checkSettingsChange(tournament, bp, [])).toEqual([]);
    expect(checkSettingsChange(tournament, bp, [ballot("b1", r1Debate, { discarded: true })])).toEqual([]);
    expect(checkSettingsChange(null, bp, entered)).toEqual([]);
    expect(lockedSettingsFields([])).toEqual([]);
  });

  it("blocks changing the format or ballot shape once ballots exist", () => {
    expect(rules(checkSettingsChange(tournament, { ...tournament, format: "bp" }, entered))).toEqual(["settings_locked"]);
    for (const patch of [{ substantiveSpeakers: 2 }, { replyScoresEnabled: false }, { ballotMode: "voting" as const }]) {
      const next = { ...tournament, preferences: { ...tournament.preferences, ...patch } };
      expect(rules(checkSettingsChange(tournament, next, entered))).toEqual(["settings_locked"]);
    }
    expect(lockedSettingsFields(entered)).toContain("format");
  });

  it("needs an override to change scoring rules once ballots exist", () => {
    const next = { ...tournament, preferences: { ...tournament.preferences, maxSpeakerScore: 100 } };
    const violations = checkSettingsChange(tournament, next, entered);
    expect(violations).toEqual([expect.objectContaining({ rule: "scoring_changed_after_ballots", overridable: true })]);
    expect(violations[0].message).toContain("maximum speaker score");
  });

  it("allows unrelated settings at any time", () => {
    const next = { ...tournament, name: "Renamed", preferences: { ...tournament.preferences, publicDraw: false } };
    expect(checkSettingsChange(tournament, next, entered)).toEqual([]);
  });
});

describe("deleting records", () => {
  const references = {
    debates: [r1Debate],
    ballots: [ballot("b1", r1Debate, { submitterId: "adj-9" })],
    feedback: [],
  };

  it("blocks deleting a team that is drawn, resulted or in feedback", () => {
    expect(rules(checkTeamDeletion({ id: "a", name: "A" }, references))).toEqual(["entity_in_use"]);
    expect(checkTeamDeletion({ id: "a", name: "A" }, references)[0].message).toContain("1 debate and 1 ballot");
    expect(checkTeamDeletion({ id: "c", name: "C" }, { ...references, debates: [r1Bye] })[0].message).toContain("1 debate");
    expect(checkTeamDeletion({ id: "unused", name: "U" }, references)).toEqual([]);
  });

  it("blocks deleting an adjudicator on a panel or ballot", () => {
    expect(rules(checkAdjudicatorDeletion({ id: "adj-1", name: "J1" }, references))).toEqual(["entity_in_use"]);
    expect(rules(checkAdjudicatorDeletion({ id: "adj-9", name: "J9" }, references))).toEqual(["entity_in_use"]);
    expect(checkAdjudicatorDeletion({ id: "adj-5", name: "J5" }, references)).toEqual([]);
  });

  it("blocks deleting a venue used by a debate", () => {
    expect(rules(checkVenueDeletion({ id: "venue-d1", name: "Room" }, references))).toEqual(["entity_in_use"]);
    expect(checkVenueDeletion({ id: "spare", name: "Spare" }, references)).toEqual([]);
  });

  it("blocks deleting an institution with members", () => {
    const team = { id: "a", institutionId: "inst" } as Team;
    expect(rules(checkInstitutionDeletion({ id: "inst", name: "Inst" }, { ...references, teams: [team], adjudicators: [] })))
      .toEqual(["entity_in_use"]);
    expect(checkInstitutionDeletion({ id: "other", name: "Other" }, { ...references, teams: [team], adjudicators: [] })).toEqual([]);
  });

  it("blocks deleting a break category that has a break or a drawn round", () => {
    const category = { id: "open", name: "Open" } as BreakCategory;
    expect(checkBreakCategoryDeletion(category, [], [])).toEqual([]);
    expect(rules(checkBreakCategoryDeletion(category, [{ breakCategoryIds: ["open"] } as Team], []))).toEqual(["break_category_in_use"]);
    const drawn = round(3, { stage: "elimination", breakCategoryIds: ["open"], drawStatus: "draft" });
    expect(rules(checkBreakCategoryDeletion(category, [], [drawn]))).toEqual(["break_category_in_use"]);
  });
});

describe("break generation", () => {
  const category = { id: "open", name: "Open" } as BreakCategory;
  const semis = round(3, { stage: "elimination" });
  const scheduled = { ...semis, breakCategoryIds: ["open"] };

  it("allows a break after finished preliminary rounds", () => {
    const state = { ...playedState({ debates: [r1Debate, r1Bye] }), rounds: [{ ...r1, completed: true }, semis] };
    expect(checkBreakGeneration(category, state, [scheduled])).toEqual([]);
  });

  it("needs an override while preliminary rounds are unfinished", () => {
    const state = { rounds: [r1, semis], debates: [r1Debate], ballots: [] };
    expect(checkBreakGeneration(category, state, [scheduled])).toEqual([
      expect.objectContaining({ rule: "prelims_incomplete", overridable: true }),
    ]);
  });

  it("blocks regenerating once its elimination rounds are drawn or advanced", () => {
    const base = { ...playedState({ debates: [r1Debate, r1Bye] }), rounds: [{ ...r1, completed: true }] };
    const drawn = { ...scheduled, drawStatus: "draft" as const };
    expect(rules(checkBreakGeneration(category, { ...base, rounds: [...base.rounds, drawn] }, [drawn]))).toEqual(["elimination_started"]);
    const advanced = { ...scheduled, eliminationAdvanced: true };
    expect(rules(checkBreakGeneration(category, { ...base, rounds: [...base.rounds, advanced] }, [advanced]))).toEqual(["elimination_started"]);
  });

  it("allows another category's break when it leaves started rounds untouched", () => {
    const base = { ...playedState({ debates: [r1Debate, r1Bye] }), rounds: [{ ...r1, completed: true }] };
    const openFinal = { ...scheduled, drawStatus: "draft" as const };
    const esl = { id: "esl", name: "ESL" } as BreakCategory;
    const eslRound = round(4, { stage: "elimination", breakCategoryIds: [] });
    const state = { ...base, rounds: [...base.rounds, openFinal, eslRound] };
    expect(checkBreakGeneration(esl, state, [openFinal, { ...eslRound, breakCategoryIds: ["esl"] }])).toEqual([]);
  });
});

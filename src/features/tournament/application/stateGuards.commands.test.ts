import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BreakCategory, Debate, Round, Tournament } from "@/types";
import { createSeededRng } from "@/lib/draw/rng";
import { TournamentHarness } from "@/test/lifecycleHarness";
import { FIXED_TIME, makeAdjudicators, makeTeams, makeTournament, makeVenues, simulateBallot } from "@/test/tournamentFixtures";
import { createTournamentEntityCommands, type EntityAuditEvent } from "./entities";
import { deleteRoundCommand, setPreliminaryRoundCountCommand } from "./roundAdministration";
import { saveTournamentCommand } from "./settings";
import { TournamentRuleError, type RuleOverride } from "./stateGuards";

/**
 * Each rule enforced by the command that performs the action: blocked without an override,
 * allowed (and audited) with one where the rule may be overridden, and never relaxed otherwise.
 */

const OVERRIDE: RuleOverride = { reason: "Agreed with the adjudication core" };
let harness: TournamentHarness;
let rng: () => number;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(FIXED_TIME));
  vi.spyOn(Math, "random").mockImplementation(createSeededRng(5));
  rng = createSeededRng(99);
  const tournament = makeTournament("wsdc", {}, "t-guards");
  harness = new TournamentHarness(tournament, (round: Round) => 300 + round.seq);
  harness.teams = makeTeams(8, { tournamentId: tournament.id, institutionCount: 4 });
  harness.adjudicators = makeAdjudicators(6, { tournamentId: tournament.id });
  harness.venues = makeVenues(5, tournament.id);
  for (const seq of [1, 2, 3]) {
    await harness.createRound({ roundSeq: seq, name: `Round ${seq}`, abbr: `R${seq}`, stage: "preliminary" });
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const rounds = () => harness.rounds;

async function drawAndRelease(roundId: string, override?: RuleOverride): Promise<Debate[]> {
  await harness.generateDraw(roundId, { override });
  await harness.allocate(roundId, 1);
  await harness.patchRound(roundId, { drawStatus: "released" });
  return harness.roundDebates(roundId);
}

/** Enters a confirmed ballot for every debate from index `from` up to (not including) `to`. */
async function resultRound(roundId: string, from = 0, to?: number): Promise<void> {
  for (const debate of harness.roundDebates(roundId).slice(from, to)) {
    if (!debate.byeTeamId) await harness.submitBallot(simulateBallot(debate, harness.teams, harness.tournament, rng));
  }
}

function overrides() {
  return harness.audit.filter((event) => event.action === "rules.overridden");
}

async function expectRuleError(action: Promise<unknown>, rule: string, overridable: boolean): Promise<void> {
  const error = await action.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(TournamentRuleError);
  expect((error as TournamentRuleError).violations.map((violation) => violation.rule)).toContain(rule);
  expect((error as TournamentRuleError).overridable).toBe(overridable);
}

describe("draw generation", () => {
  it("needs an override to draw the next round before the previous one is finished", async () => {
    await drawAndRelease(rounds()[0].id);
    await resultRound(rounds()[0].id, 1);
    const before = harness.debates.length;

    await expectRuleError(harness.generateDraw(rounds()[1].id), "previous_round_incomplete", true);
    expect(harness.debates).toHaveLength(before);
    expect(overrides()).toEqual([]);

    await harness.generateDraw(rounds()[1].id, { override: OVERRIDE });
    expect(harness.roundDebates(rounds()[1].id).length).toBeGreaterThan(0);
    expect(overrides()).toEqual([expect.objectContaining({
      roundId: rounds()[1].id,
      details: expect.objectContaining({ overriddenAction: "draw.generated", reason: OVERRIDE.reason }),
    })]);
  });

  it("draws the next round without an override once the previous one is finished", async () => {
    await drawAndRelease(rounds()[0].id);
    await resultRound(rounds()[0].id);
    await harness.generateDraw(rounds()[1].id);
    expect(overrides()).toEqual([]);
  });

  it("needs an override to regenerate a published draw", async () => {
    await drawAndRelease(rounds()[0].id);
    await expectRuleError(harness.generateDraw(rounds()[0].id), "draw_released", true);
    await harness.generateDraw(rounds()[0].id, { override: OVERRIDE });
    expect(harness.round(rounds()[0].id).drawStatus).toBe("draft");
  });

  it("refuses to regenerate a completed round even with an override", async () => {
    await drawAndRelease(rounds()[0].id);
    await resultRound(rounds()[0].id);
    await harness.completeRound(rounds()[0].id);
    await expectRuleError(
      harness.generateDraw(rounds()[0].id, { discardExistingResults: true, override: OVERRIDE }),
      "round_completed",
      false
    );
  });
});

describe("round status", () => {
  it("refuses to publish results of an unfinished round, even with an override", async () => {
    await drawAndRelease(rounds()[0].id);
    await resultRound(rounds()[0].id, 1);
    await expectRuleError(harness.patchRound(rounds()[0].id, { resultsReleased: true }, OVERRIDE), "results_incomplete", false);
    await expectRuleError(harness.patchRound(rounds()[0].id, { teamSpeaksReleased: true }, OVERRIDE), "results_incomplete", false);
    expect(harness.round(rounds()[0].id).resultsReleased).toBe(false);

    await resultRound(rounds()[0].id, 0, 1);
    await harness.patchRound(rounds()[0].id, { resultsReleased: true, teamSpeaksReleased: true });
    expect(harness.round(rounds()[0].id)).toMatchObject({ resultsReleased: true, teamSpeaksReleased: true });
  });

  it("refuses to publish an empty draw and needs an override for draw check problems", async () => {
    await expectRuleError(harness.patchRound(rounds()[0].id, { drawStatus: "released" }, OVERRIDE), "draw_empty", false);

    await harness.generateDraw(rounds()[0].id);
    // Two debates in one room is a draw check error.
    const [first, second] = harness.roundDebates(rounds()[0].id);
    await harness.updateDebate({ ...second, venueId: first.venueId, venueName: first.venueName });
    await expectRuleError(harness.patchRound(rounds()[0].id, { drawStatus: "released" }), "draw_invalid", true);
    await harness.patchRound(rounds()[0].id, { drawStatus: "released" }, OVERRIDE);
    expect(harness.round(rounds()[0].id).drawStatus).toBe("released");
    expect(overrides().at(-1)?.details).toMatchObject({ overriddenAction: "round.updated" });
  });

  it("needs an override to reopen a round once the next round is drawn", async () => {
    await drawAndRelease(rounds()[0].id);
    await resultRound(rounds()[0].id);
    await harness.completeRound(rounds()[0].id);
    await harness.patchRound(rounds()[0].id, { completed: false });
    await harness.completeRound(rounds()[0].id);

    await harness.generateDraw(rounds()[1].id);
    await expectRuleError(harness.patchRound(rounds()[0].id, { completed: false }), "later_round_drawn", true);
    await harness.patchRound(rounds()[0].id, { completed: false }, OVERRIDE);
    expect(harness.round(rounds()[0].id).completed).toBe(false);
  });
});

describe("ballots", () => {
  beforeEach(async () => {
    await drawAndRelease(rounds()[0].id);
    await resultRound(rounds()[0].id);
    await harness.completeRound(rounds()[0].id);
  });

  it("needs an override to change a result in a completed round", async () => {
    const debate = harness.roundDebates(rounds()[0].id)[0];
    const confirmed = harness.liveBallots(debate.id).find((ballot) => ballot.confirmed)!;
    const correction = simulateBallot(debate, harness.teams, harness.tournament, rng, { id: `${confirmed.id}-v2`, version: 2 });

    await expectRuleError(harness.submitBallot(correction), "round_completed", true);
    expect(harness.liveBallots(debate.id).find((ballot) => ballot.confirmed)?.id).toBe(confirmed.id);
    await expectRuleError(harness.discardBallot(confirmed.id), "round_completed", true);

    await harness.submitBallot(correction, OVERRIDE);
    expect(harness.liveBallots(debate.id).find((ballot) => ballot.confirmed)?.id).toBe(correction.id);
    expect(overrides()).toEqual([expect.objectContaining({ details: expect.objectContaining({ overriddenAction: "ballot.submitted" }) })]);
  });

  it("allows an unconfirmed version in a completed round", async () => {
    const debate = harness.roundDebates(rounds()[0].id)[0];
    const draft = { ...simulateBallot(debate, harness.teams, harness.tournament, rng, { id: "late-draft", version: 2 }), confirmed: false };
    await harness.submitBallot(draft);
    expect(harness.ballots.some((ballot) => ballot.id === "late-draft")).toBe(true);
    await expectRuleError(harness.confirmBallot("late-draft", debate.id), "round_completed", true);
    await harness.confirmBallot("late-draft", debate.id, OVERRIDE);
  });

  it("never overwrites a confirmed ballot in place", async () => {
    const debate = harness.roundDebates(rounds()[0].id)[0];
    const confirmed = harness.liveBallots(debate.id).find((ballot) => ballot.confirmed)!;
    await expectRuleError(harness.submitBallot({ ...confirmed, confirmed: false }, OVERRIDE), "ballot_locked", false);
    expect(harness.ballots.find((ballot) => ballot.id === confirmed.id)).toEqual(confirmed);
  });
});

describe("draw and allocation edits", () => {
  it("refuses to change the teams of a debate with a ballot", async () => {
    await drawAndRelease(rounds()[0].id);
    const [first, second] = harness.roundDebates(rounds()[0].id);
    await harness.submitBallot(simulateBallot(first, harness.teams, harness.tournament, rng));
    const swapped = { ...first, teams: { ...first.teams, AFF: second.teams.AFF } } as Debate;
    await expectRuleError(harness.updateDebate(swapped, OVERRIDE), "debate_has_ballots", false);
    const stored = harness.debates.find((debate) => debate.id === first.id)!;
    expect([stored.teams.AFF?.teamId, stored.teams.NEG?.teamId]).toEqual([first.teams.AFF?.teamId, first.teams.NEG?.teamId]);
  });

  it("needs an override to swap matchups of a published draw or re-allocate a resulted round", async () => {
    const [first] = await drawAndRelease(rounds()[0].id);
    const swapped = { ...first, teams: { AFF: { ...first.teams.NEG!, side: "AFF" }, NEG: { ...first.teams.AFF!, side: "NEG" } } } as Debate;
    await expectRuleError(harness.updateDebate(swapped), "draw_released", true);
    await harness.updateDebate(swapped, OVERRIDE);

    await harness.submitBallot(simulateBallot(harness.debates.find((debate) => debate.id === first.id)!, harness.teams, harness.tournament, rng));
    await expectRuleError(harness.allocate(rounds()[0].id, 1), "debate_has_ballots", true);
    await harness.allocate(rounds()[0].id, 1, OVERRIDE);
    expect(overrides()).toHaveLength(2);
  });

  it("allows changing a published debate's room without an override", async () => {
    const [first] = await drawAndRelease(rounds()[0].id);
    const spare = harness.venues.find((venue) => !harness.debates.some((debate) => debate.venueId === venue.id))!;
    await harness.updateDebate({ ...first, venueId: spare.id, venueName: spare.name });
    expect(overrides()).toEqual([]);
  });
});

describe("round administration", () => {
  function roundAdminDependencies() {
    return {
      rounds: harness.rounds,
      debates: harness.debates,
      ballots: harness.ballots,
      tournamentId: harness.tournament.id,
      drawRule: "power_paired" as const,
      localRepository: {
        saveRounds: (items: Round[]) => { harness.rounds = items; },
        saveDebates: (items: Debate[]) => { harness.debates = items; },
        setActiveRound: () => {},
      },
      recordAuditEvent: async (event: { action: string }) => { harness.audit.push(event as never); },
    };
  }

  it("refuses to cancel rounds with results and needs an override to cancel a drawn round", async () => {
    await drawAndRelease(rounds()[0].id);
    await resultRound(rounds()[0].id);
    await harness.completeRound(rounds()[0].id);
    await harness.generateDraw(rounds()[1].id);

    await setPreliminaryRoundCountCommand(2, roundAdminDependencies());
    expect(harness.rounds.filter((round) => round.cancelled).map((round) => round.name)).toEqual(["Round 3"]);

    await expectRuleError(setPreliminaryRoundCountCommand(1, roundAdminDependencies()), "round_has_draw", true);
    await expectRuleError(setPreliminaryRoundCountCommand(0, roundAdminDependencies(), OVERRIDE), "round_has_results", false);
    await setPreliminaryRoundCountCommand(1, roundAdminDependencies(), OVERRIDE);
    expect(harness.rounds.filter((round) => !round.cancelled).map((round) => round.name)).toEqual(["Round 1"]);
  });

  it("needs an override to delete a round with results", async () => {
    await drawAndRelease(rounds()[0].id);
    await resultRound(rounds()[0].id);
    const dependencies = {
      roundId: rounds()[0].id,
      rounds: harness.rounds,
      debates: harness.debates,
      ballots: harness.ballots,
      feedback: [],
      motions: [],
      activeRound: null,
      localRepository: {
        saveRounds: (items: Round[]) => { harness.rounds = items; },
        saveDebates: (items: Debate[]) => { harness.debates = items; },
        saveBallots: () => {},
        saveFeedback: () => {},
        saveMotions: () => {},
        setActiveRound: () => {},
      },
      recordAuditEvent: async () => {},
    };
    await expectRuleError(deleteRoundCommand(dependencies), "round_has_results", true);
    expect(harness.rounds).toHaveLength(3);
    await deleteRoundCommand(dependencies, OVERRIDE);
    expect(harness.rounds).toHaveLength(2);
  });
});

describe("settings and deletions", () => {
  beforeEach(async () => {
    await drawAndRelease(rounds()[0].id);
    await resultRound(rounds()[0].id);
  });

  it("refuses ballot-shape changes and needs an override for scoring changes once ballots exist", async () => {
    let saved: Tournament | null = null;
    const save = (next: Tournament, override?: RuleOverride) => saveTournamentCommand(next, harness.tournament, {
      ballots: harness.ballots,
      localRepository: { saveTournament: (value) => { saved = value; } },
      recordAuditEvent: async (event) => { harness.audit.push(event as never); },
      warn: () => {},
    }, override);
    const t = harness.tournament;
    await expectRuleError(save({ ...t, format: "australs" }, OVERRIDE), "settings_locked", false);
    await expectRuleError(save({ ...t, preferences: { ...t.preferences, replyScoresEnabled: false } }, OVERRIDE), "settings_locked", false);
    const widened = { ...t, preferences: { ...t.preferences, maxSpeakerScore: 100 } };
    await expectRuleError(save(widened), "scoring_changed_after_ballots", true);
    expect(saved).toBeNull();
    await save(widened, OVERRIDE);
    expect(saved).toEqual(widened);
    await save({ ...t, name: "Renamed" });
  });

  it("refuses to delete participants and venues that are referenced", async () => {
    const audit: EntityAuditEvent[] = [];
    const saved: string[] = [];
    const commands = createTournamentEntityCommands({
      tournamentId: harness.tournament.id,
      institutions: [{ id: "inst-1", tournamentId: harness.tournament.id, name: "Institution 1", code: "I1" }],
      teams: harness.teams,
      adjudicators: harness.adjudicators,
      venues: harness.venues,
      motions: [],
      debates: harness.debates,
      ballots: harness.ballots,
      feedback: [],
      repositories: {
        institutions: { save: () => saved.push("institutions") },
        teams: { save: () => saved.push("teams") },
        adjudicators: { save: () => saved.push("adjudicators") },
        venues: { save: () => saved.push("venues") },
        motions: { save: () => saved.push("motions") },
      },
      recordAuditEvent: async (event) => { audit.push(event); },
      createId: (prefix) => `${prefix}-new`,
      generatePrivateKey: () => "key",
    });
    const debate = harness.roundDebates(rounds()[0].id)[0];
    await expectRuleError(commands.deleteTeam(debate.teams.AFF!.teamId), "entity_in_use", false);
    await expectRuleError(commands.deleteAdjudicator(debate.adjudicators.chairId!), "entity_in_use", false);
    await expectRuleError(commands.deleteVenue(debate.venueId!), "entity_in_use", false);
    await expectRuleError(commands.deleteInstitution("inst-1"), "entity_in_use", false);
    expect(saved).toEqual([]);

    const spareVenue = harness.venues.find((venue) => !harness.debates.some((item) => item.venueId === venue.id))!;
    await commands.deleteVenue(spareVenue.id);
    expect(saved).toEqual(["venues"]);
  });
});

describe("breaks", () => {
  const open: BreakCategory = {
    id: "open", tournamentId: "t-guards", name: "Open", slug: "open", seq: 1,
    breakSize: 4, reserveSize: 0, isGeneral: true, priority: 1, qualificationRule: "standard",
  };

  async function setUpBreak() {
    for (const round of rounds().filter((item) => item.stage === "preliminary")) {
      await drawAndRelease(round.id);
      await resultRound(round.id);
      await harness.completeRound(round.id);
    }
    await harness.saveBreakCategories([open]);
    for (const [seq, name] of [[4, "Semifinals"], [5, "Grand Final"]] as const) {
      await harness.createRound({ roundSeq: seq, name, abbr: `E${seq}`, stage: "elimination", customDrawType: "elimination" });
    }
  }

  it("needs an override to break before the preliminary rounds are finished", async () => {
    await setUpBreak();
    await harness.patchRound(rounds()[2].id, { completed: false });
    const [unfinished] = harness.roundDebates(rounds()[2].id);
    const confirmed = harness.liveBallots(unfinished.id).find((ballot) => ballot.confirmed)!;
    await harness.discardBallot(confirmed.id);

    await expectRuleError(harness.generateBreak("open"), "prelims_incomplete", true);
    await harness.generateBreak("open", OVERRIDE);
    expect(harness.rounds.find((round) => round.name === "Semifinals")?.breakCategoryIds).toEqual(["open"]);
  });

  it("refuses to regenerate the break once elimination rounds are drawn", async () => {
    await setUpBreak();
    await harness.generateBreak("open");
    const semis = harness.rounds.find((round) => round.name === "Semifinals")!;
    await harness.generateDraw(semis.id);
    await expectRuleError(harness.generateBreak("open", OVERRIDE), "elimination_started", false);
    expect(harness.round(semis.id).breakCategoryIds).toEqual(["open"]);

    const final = harness.rounds.find((round) => round.name === "Grand Final")!;
    await expectRuleError(harness.generateDraw(final.id), "previous_elimination_not_advanced", false);
    await expect(harness.saveBreakCategories([])).rejects.toBeInstanceOf(TournamentRuleError);
  });
});

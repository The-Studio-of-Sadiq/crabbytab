import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { BreakCategory, Round } from "@/types";
import { parseAdjudicatorsCsv, parseMotionsCsv, parseTeamsCsv, parseVenuesCsv } from "@/lib/csv/importer";
import { createSeededRng } from "@/lib/draw/rng";
import { resolveCheckState } from "./ballotEntry";
import { withTeamOverride } from "./breaks";
import { DrawHasResultsError } from "./draws";
import { TournamentRuleError } from "./stateGuards";
import { TournamentHarness } from "@/test/lifecycleHarness";
import { expectValidRound, publicRound, slotResultFields, teamPortal } from "@/test/lifecycleAssertions";
import { FIXED_TIME, makeTournament, simulateBallot } from "@/test/tournamentFixtures";

/**
 * A complete British Parliamentary tournament driven through the application commands: CSV
 * import, three preliminary rounds (one with a withdrawal and byes, one silent), ballots with
 * double-entry review and a discarded result, a 6-team break with a manual override, a partial
 * elimination, the grand final, and the public and private views at every stage.
 */

const TEAMS_CSV = [
  "name,institution,speaker1,speaker2",
  ...["Alpha", "Bravo", "Charlie", "Delta"].flatMap((institution) =>
    ["A", "B", "C", "D"].map((suffix) => `${institution} ${suffix},${institution} University,${institution} ${suffix}1,${institution} ${suffix}2`)
  ),
].join("\n");

const ADJUDICATORS_CSV = [
  "name,institution,score,independent",
  "Ada Chair,,8,yes",
  "Ben Chair,,7.5,yes",
  "Cleo Chair,Judges Guild,7,no",
  "Dev Chair,Judges Guild,6.5,no",
  "Eve Wing,,6,yes",
  "Finn Wing,,5.5,yes",
  "Gus Wing,Judges Guild,5,no",
  "Hana Wing,,4.5,yes",
].join("\n");

const VENUES_CSV = ["name,priority", "Hall,10", "Room 101,8", "Room 102,7", "Room 103,6", "Room 104,5"].join("\n");

let harness: TournamentHarness;
const rng = createSeededRng(20261001);

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(FIXED_TIME));
  // generateDrawCommand records a fresh seed per draw; seeding Math.random keeps those reproducible.
  const seeded = createSeededRng(7);
  vi.spyOn(Math, "random").mockImplementation(seeded);
  const tournament = makeTournament("bp", {
    byeTeamSelectionMethod: "lowest_ranked",
    byeTeamResults: "absent",
    ballotDoubleEntry: true,
    ballotCheckMode: "review",
  });
  harness = new TournamentHarness(tournament, (round: Round) => 100 + round.seq);
});

afterAll(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function releaseDraw(roundId: string) {
  await harness.patchRound(roundId, { drawStatus: "released", adjudicatorsRevealed: true, motionsReleased: true });
  harness.motions = harness.motions.map((motion) => motion.rounds.includes(roundId) ? { ...motion, released: true } : motion);
}

async function confirmAllBallots(roundId: string) {
  for (const debate of harness.roundDebates(roundId)) {
    if (debate.byeTeamId) continue;
    await harness.submitBallot(simulateBallot(debate, harness.teams, harness.tournament, rng));
  }
}

describe("British Parliamentary tournament lifecycle", () => {
  it("imports participants from CSV", async () => {
    const id = harness.tournament.id;
    harness.teams = parseTeamsCsv(TEAMS_CSV, id);
    harness.adjudicators = parseAdjudicatorsCsv(ADJUDICATORS_CSV, id);
    harness.venues = parseVenuesCsv(VENUES_CSV, id);
    expect(harness.teams).toHaveLength(16);
    expect(harness.teams[0]).toMatchObject({ name: "Alpha A", institutionName: "Alpha University", checkedIn: true });
    expect(harness.teams.every((team) => team.speakers.length === 2)).toBe(true);
    expect(new Set(harness.teams.map((team) => team.id)).size).toBe(16);
    expect(harness.adjudicators.filter((adj) => adj.independent)).toHaveLength(5);
    expect(harness.venues.map((venue) => venue.priority)).toEqual([10, 8, 7, 6, 5]);
    // A declared personal conflict, as entered on the adjudicator conflicts editor.
    harness.adjudicators[0] = { ...harness.adjudicators[0], conflicts: [{ teamId: harness.teams[0].id, type: "personal" }] };
  });

  it("creates three preliminary rounds and assigns motions", async () => {
    for (const seq of [1, 2, 3]) {
      await harness.createRound({ roundSeq: seq, name: `Round ${seq}`, abbr: `R${seq}`, stage: "preliminary" });
    }
    expect(harness.rounds.map((round) => round.drawType)).toEqual(["random", "power_paired", "power_paired"]);
    harness.motions = parseMotionsCsv(
      ["motion,round", "THW ban zoos,R1", "THW abolish exams,R2", "THBT cities should be car-free,R3"].join("\n"),
      harness.tournament.id,
      harness.rounds
    );
    expect(harness.motions.map((motion) => motion.rounds.length)).toEqual([1, 1, 1]);
  });

  it("round 1: draws, allocates, releases and records results", async () => {
    const [r1] = harness.rounds;
    const draw = await harness.generateDraw(r1.id);
    expect(draw).toHaveLength(4);
    expect(draw.every((debate) => debate.motionId === harness.motions[0].id)).toBe(true);
    expect(harness.round(r1.id)).toMatchObject({ drawStatus: "draft", drawSeed: expect.any(Number) });
    // A draft draw is not public, and teams cannot see it on their private page.
    expect(publicRound(harness, r1.id).debates).toEqual([]);
    expect(teamPortal(harness, harness.teams[0].id, r1.id).debates).toEqual([]);

    await harness.allocate(r1.id, 2);
    expectValidRound(harness, r1.id);
    const chairs = harness.roundDebates(r1.id).map((debate) => debate.adjudicators.chairId);
    expect(chairs.every(Boolean)).toBe(true);
    // The conflicted adjudicator is kept away from the team they declared.
    const conflicted = harness.roundDebates(r1.id).find((debate) =>
      Object.values(debate.teams).some((slot) => slot?.teamId === harness.teams[0].id)
    )!;
    expect([conflicted.adjudicators.chairId, ...conflicted.adjudicators.panellistIds]).not.toContain(harness.adjudicators[0].id);

    await releaseDraw(r1.id);
    const released = publicRound(harness, r1.id);
    expect(released.debates).toHaveLength(4);
    expect(released.debates.every((debate) => (debate.adjudicators as { chairId?: string }).chairId)).toBe(true);
    expect(released.debates.every((debate) => debate.motionText === "THW ban zoos")).toBe(true);
    expect(released.ballots).toEqual([]);

    // Double entry with review: a first entry waits for a second person to confirm it.
    const [first, ...rest] = harness.roundDebates(r1.id);
    const entry = simulateBallot(first, harness.teams, harness.tournament, rng, { confirmed: false, submitterId: "volunteer-1" });
    await harness.submitBallot(entry);
    expect(harness.debates.find((debate) => debate.id === first.id)?.resultStatus).toBe("draft");
    expect(harness.standings().teams.every((row) => row.points === 0)).toBe(true);
    const check = resolveCheckState({ ballots: harness.ballots, debateId: first.id, userId: "volunteer-1", doubleEntry: true, checkMode: "review" });
    expect(check.kind).toBe("awaiting-other");
    const review = resolveCheckState({ ballots: harness.ballots, debateId: first.id, userId: "tab-director", doubleEntry: true, checkMode: "review" });
    expect(review.kind).toBe("review");
    await harness.confirmBallot(entry.id, first.id);
    for (const debate of rest) await harness.submitBallot(simulateBallot(debate, harness.teams, harness.tournament, rng));

    // Every room awards 3+2+1+0 points.
    expect(harness.standings().teams.reduce((sum, row) => sum + row.points, 0)).toBe(4 * 6);

    // Confirmed but unreleased results stay private everywhere.
    const unreleased = publicRound(harness, r1.id);
    expect(unreleased.ballots).toEqual([]);
    expect(unreleased.debates.map((debate) => debate.resultStatus)).toEqual(["none", "none", "none", "none"]);
    expect(unreleased.debates.flatMap(slotResultFields)).toEqual([]);
    const portal = teamPortal(harness, harness.teams[0].id, r1.id);
    expect(portal.ballots).toEqual([]);
    expect(portal.debates.flatMap((debate) => slotResultFields(debate as unknown as Record<string, unknown>))).toEqual([]);

    // Results released without speaks: points public, speaker scores not.
    await harness.patchRound(r1.id, { resultsReleased: true });
    const results = publicRound(harness, r1.id);
    expect(results.ballots).toHaveLength(4);
    for (const ballot of results.ballots) {
      expect(ballot.speakerScores).toEqual({});
      for (const score of Object.values(ballot.teamScores as Record<string, Record<string, unknown>>)) {
        expect(score).not.toHaveProperty("totalSpeakerScore");
        expect(score).toHaveProperty("points");
      }
    }
    expect(results.debates.flatMap(slotResultFields).every((field) => field === "points")).toBe(true);
    await harness.patchRound(r1.id, { teamSpeaksReleased: true });
    expect(publicRound(harness, r1.id).ballots.every((ballot) => Object.keys(ballot.speakerScores as object).length === 4)).toBe(true);
    expect(teamPortal(harness, harness.teams[0].id, r1.id).ballots).toHaveLength(1);

    await harness.completeRound(r1.id);
    expect(harness.round(r1.id).completed).toBe(true);
  });

  it("round 2: a withdrawal gives the three lowest-ranked teams byes", async () => {
    const r2 = harness.rounds[1];
    const withdrawn = harness.teams[5];
    harness.teams = harness.teams.map((team) =>
      team.id === withdrawn.id ? { ...team, roundAvailability: { [r2.id]: false } } : team
    );
    const rankOf = new Map(harness.standings().teams.map((row) => [row.teamId, row.rank]));
    const draw = await harness.generateDraw(r2.id);
    const byes = draw.filter((debate) => debate.byeTeamId);
    expect(byes).toHaveLength(3);
    // No team that plays is ranked below a team that sits out (ties may go either way).
    const byeRanks = byes.map((debate) => rankOf.get(debate.byeTeamId!)!);
    const playingRanks = draw.filter((debate) => !debate.byeTeamId)
      .flatMap((debate) => Object.values(debate.teams).map((slot) => rankOf.get(slot!.teamId)!));
    expect(Math.max(...playingRanks)).toBeLessThanOrEqual(Math.min(...byeRanks));
    expect(byes.map((debate) => debate.byeTeamId)).not.toContain(withdrawn.id);
    expect(draw.filter((debate) => !debate.byeTeamId)).toHaveLength(3);
    await harness.allocate(r2.id, 2);
    expectValidRound(harness, r2.id);
    expect(byes.every((debate) => !debate.adjudicators.chairId)).toBe(true);
    await releaseDraw(r2.id);
    await confirmAllBallots(r2.id);
  });

  it("round 2: regenerating a resulted draw requires discarding the results first", async () => {
    const r2 = harness.rounds[1];
    const before = harness.roundDebates(r2.id).map((debate) => debate.id);
    const standings = harness.standings().teams;
    // The published draw needs an explicit override; even then, its results must be discarded first.
    await expect(harness.generateDraw(r2.id)).rejects.toBeInstanceOf(TournamentRuleError);
    await expect(harness.generateDraw(r2.id, { override: { reason: "Wrong teams checked in" } }))
      .rejects.toBeInstanceOf(DrawHasResultsError);
    expect(harness.roundDebates(r2.id).map((debate) => debate.id)).toEqual(before);
    expect(harness.standings().teams).toEqual(standings);
  });

  it("round 2: discarding a confirmed ballot withdraws its points until a new one is confirmed", async () => {
    const r2 = harness.rounds[1];
    await harness.patchRound(r2.id, { resultsReleased: true });
    const debate = harness.roundDebates(r2.id).find((item) => !item.byeTeamId)!;
    const ballot = harness.liveBallots(debate.id).find((item) => item.confirmed)!;
    const winner = Object.values(ballot.teamScores).find((score) => score.points === 3)!.teamId;
    const pointsBefore = harness.standings().teams.find((row) => row.teamId === winner)!.points;

    await harness.discardBallot(ballot.id);
    expect(harness.standings().teams.find((row) => row.teamId === winner)!.points).toBe(pointsBefore - 3);
    expect(harness.debates.find((item) => item.id === debate.id)?.resultStatus).toBe("none");
    // Withdrawing a result also withdraws the round's released results.
    expect(harness.round(r2.id).resultsReleased).toBe(false);
    await expect(harness.completeRound(r2.id)).rejects.toThrow("has no confirmed ballot");

    const replacement = simulateBallot(debate, harness.teams, harness.tournament, rng, { id: `${ballot.id}-v2`, version: 2 });
    await harness.submitBallot(replacement);
    const newWinner = Object.values(replacement.teamScores).find((score) => score.points === 3)!.teamId;
    expect(harness.standings().teams.find((row) => row.teamId === newWinner)!.metrics.firsts).toBeGreaterThan(0);
    expect(harness.standings().teams.reduce((sum, row) => sum + row.points, 0)).toBe(7 * 6);
    await harness.completeRound(r2.id);
  });

  it("round 3: a silent round keeps its results off the public page", async () => {
    const r3 = harness.rounds[2];
    harness.teams = harness.teams.map((team) => ({ ...team, roundAvailability: { ...team.roundAvailability, [r3.id]: true } }));
    await harness.patchRound(r3.id, { silent: true });
    const draw = await harness.generateDraw(r3.id);
    expect(draw.filter((debate) => debate.byeTeamId)).toEqual([]);
    await harness.allocate(r3.id, 2);
    expectValidRound(harness, r3.id);
    await releaseDraw(r3.id);
    await confirmAllBallots(r3.id);
    await harness.patchRound(r3.id, { resultsReleased: true, teamSpeaksReleased: true });
    const silent = publicRound(harness, r3.id);
    expect(silent.ballots).toEqual([]);
    expect(silent.debates.flatMap(slotResultFields)).toEqual([]);
    expect(teamPortal(harness, harness.teams[0].id, r3.id).ballots).toEqual([]);
    await harness.completeRound(r3.id);

    const standings = harness.standings().teams;
    expect(standings).toHaveLength(16);
    expect(standings.reduce((sum, row) => sum + row.points, 0)).toBe(11 * 6);
    expect(standings.map((row) => row.rank)).toEqual([...standings.map((row) => row.rank)].sort((a, b) => a - b));
  });

  it("generates a 6-team break with a withdrawn team replaced by the next team", async () => {
    const open: BreakCategory = {
      id: "open",
      tournamentId: harness.tournament.id,
      name: "Open",
      slug: "open",
      seq: 1,
      breakSize: 6,
      reserveSize: 2,
      isGeneral: true,
      priority: 1,
      qualificationRule: "standard",
    };
    await harness.saveBreakCategories([open]);
    for (const [seq, name] of [[4, "Partial Elimination"], [5, "Grand Final"]] as const) {
      await harness.createRound({ roundSeq: seq, name, abbr: `E${seq}`, stage: "elimination", customDrawType: "elimination" });
    }
    const ranked = harness.standings().teams.map((row) => row.teamId);
    await harness.saveBreakCategories(withTeamOverride(harness.breakCategories, "open", ranked[1], "withdrawn"));
    const firstRound = await harness.generateBreak("open");
    expect(firstRound?.name).toBe("Partial Elimination");
    const breaking = harness.teams.filter((team) => team.breakStatus === "breaking").map((team) => team.id);
    expect(breaking.sort()).toEqual([ranked[0], ...ranked.slice(2, 7)].sort());
    expect(harness.breakCategories[0].generatedBreak?.breakingTeamIds).toEqual([ranked[0], ...ranked.slice(2, 7)]);
    expect(harness.breakCategories[0].generatedBreak?.reserveTeamIds).toEqual(ranked.slice(7, 9));

    // An unreleased break reveals nothing: no break status, no generated break.
    const hidden = harness.publicProjection();
    expect(hidden.collections.teams.some((team) => "breakStatus" in team || "breakCategoryIds" in team)).toBe(false);
    expect(hidden.collections.breakCategories[0]).not.toHaveProperty("generatedBreak");
    harness.setPreferences({ releasedBreakCategoryIds: ["open"] });
    const shown = harness.publicProjection();
    expect(shown.collections.breakCategories[0]).toHaveProperty("generatedBreak");
    expect(shown.collections.teams.filter((team) => team.breakStatus === "breaking")).toHaveLength(6);
  });

  it("plays the partial elimination: the top two seeds have byes", async () => {
    const partial = harness.rounds.find((round) => round.name === "Partial Elimination")!;
    const draw = await harness.generateDraw(partial.id);
    expect(draw.filter((debate) => debate.byeTeamId)).toHaveLength(2);
    expect(draw.filter((debate) => !debate.byeTeamId)).toHaveLength(1);
    const seeds = harness.breakCategories[0].generatedBreak!.breakingTeamIds;
    expect(draw.filter((debate) => debate.byeTeamId).map((debate) => debate.byeTeamId).sort()).toEqual(seeds.slice(0, 2).sort());
    await harness.allocate(partial.id, 3);
    expectValidRound(harness, partial.id);
    await releaseDraw(partial.id);
    await expect(harness.advanceElimination(partial.id)).rejects.toThrow("A confirmed ballot is required");
    await confirmAllBallots(partial.id);
    const next = await harness.advanceElimination(partial.id);
    expect(next?.name).toBe("Grand Final");
    expect(harness.teams.filter((team) => team.breakStatus === "breaking")).toHaveLength(4);
    expect(harness.teams.filter((team) => team.eliminatedInRoundId === partial.id)).toHaveLength(2);
    // Elimination results never change the preliminary standings.
    expect(harness.standings().teams.reduce((sum, row) => sum + row.points, 0)).toBe(11 * 6);
  });

  it("plays the grand final and crowns one winner", async () => {
    const final = harness.rounds.find((round) => round.name === "Grand Final")!;
    const draw = await harness.generateDraw(final.id);
    expect(draw).toHaveLength(1);
    await harness.allocate(final.id, 3);
    expectValidRound(harness, final.id);
    await releaseDraw(final.id);
    await confirmAllBallots(final.id);
    expect(await harness.advanceElimination(final.id)).toBeNull();
    const champions = harness.teams.filter((team) => team.breakStatus === "breaking");
    expect(champions).toHaveLength(1);
    const ballot = harness.liveBallots(draw[0].id)[0];
    expect(Object.values(ballot.teamScores).find((score) => score.rank === 1)?.teamId).toBe(champions[0].id);
    expect(harness.audit.filter((event) => event.action === "elimination.round_advanced")).toHaveLength(2);
  });
});

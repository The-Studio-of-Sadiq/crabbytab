import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { BallotSubmission, BreakCategory, Debate, Round } from "@/types";
import { diffBallots } from "@/lib/ballots/result";
import { parseAdjudicatorsCsv, parseTeamsCsv, parseVenuesCsv } from "@/lib/csv/importer";
import { createSeededRng } from "@/lib/draw/rng";
import { resolveCheckState } from "./ballotEntry";
import { withTeamOverride } from "./breaks";
import { TournamentHarness } from "@/test/lifecycleHarness";
import { expectValidRound, publicRound, slotResultFields, teamPortal } from "@/test/lifecycleAssertions";
import { FIXED_TIME, makeTournament, simulateBallot } from "@/test/tournamentFixtures";

/**
 * A complete two-team tournament (WSDC rules: three speakers and a reply) with voting ballots:
 * 11 teams so every preliminary round has a bye (awarded as a win), blind double entry (a matching
 * check and a mismatch), a forfeit, an iron-person speech, a split decision, an AIDA 2016 break of
 * six with a manual inclusion, a partial elimination, semifinals and a grand final.
 */

const INSTITUTIONS = ["Avon", "Blyth", "Clyde", "Dee"];
const TEAMS_CSV = [
  "name,institution,speaker1,speaker2,speaker3",
  ...Array.from({ length: 11 }, (_, index) => {
    const institution = INSTITUTIONS[index % 4];
    return `${institution} ${Math.floor(index / 4) + 1},${institution} School,${institution} ${index}a,${institution} ${index}b,${institution} ${index}c`;
  }),
].join("\n");

const ADJUDICATORS_CSV = [
  "name,institution,score,independent",
  ...Array.from({ length: 15 }, (_, index) => `Judge ${String(index + 1).padStart(2, "0")},,${(4 + (index % 5)).toFixed(1)},yes`),
].join("\n");

const VENUES_CSV = ["name,priority", ...Array.from({ length: 6 }, (_, index) => `Room ${index + 1},${10 - index}`)].join("\n");

let harness: TournamentHarness;
const rng = createSeededRng(424242);

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(FIXED_TIME));
  vi.spyOn(Math, "random").mockImplementation(createSeededRng(11));
  harness = new TournamentHarness(
    makeTournament("wsdc", {
      ballotMode: "voting",
      ballotDoubleEntry: true,
      ballotCheckMode: "blind",
      enableForfeits: true,
      byeTeamSelectionMethod: "random",
      byeTeamResults: "win",
      pairingMethod: "fold",
      oddBracketMethod: "pullup_top",
      conflictAvoidance: "one_up_one_down",
    }),
    (round: Round) => 500 + round.seq
  );
});

afterAll(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function drawAllocateRelease(roundId: string): Promise<Debate[]> {
  await harness.generateDraw(roundId);
  await harness.allocate(roundId, 3);
  expectValidRound(harness, roundId);
  await harness.patchRound(roundId, { drawStatus: "released", adjudicatorsRevealed: true });
  return harness.roundDebates(roundId);
}

async function resultRound(roundId: string, skip: Set<string> = new Set()) {
  for (const debate of harness.roundDebates(roundId)) {
    if (debate.byeTeamId || skip.has(debate.id)) continue;
    await harness.submitBallot(simulateBallot(debate, harness.teams, harness.tournament, rng, { dissenters: 1 }));
  }
}

function standingOf(teamId: string) {
  return harness.standings().teams.find((row) => row.teamId === teamId)!;
}

describe("two-team (WSDC) tournament lifecycle with voting ballots", () => {
  it("imports participants and creates the preliminary rounds", async () => {
    const id = harness.tournament.id;
    harness.teams = parseTeamsCsv(TEAMS_CSV, id);
    harness.adjudicators = parseAdjudicatorsCsv(ADJUDICATORS_CSV, id);
    harness.venues = parseVenuesCsv(VENUES_CSV, id);
    expect(harness.teams).toHaveLength(11);
    expect(harness.teams.every((team) => team.speakers.length === 3)).toBe(true);
    for (const seq of [1, 2, 3]) {
      await harness.createRound({ roundSeq: seq, name: `Round ${seq}`, abbr: `R${seq}`, stage: "preliminary" });
    }
  });

  it("round 1: blind double entry, a split decision, a forfeit and an iron-person speech", async () => {
    const r1 = harness.rounds[0];
    const draw = await drawAllocateRelease(r1.id);
    const bye = draw.find((debate) => debate.byeTeamId)!;
    expect(bye).toBeDefined();
    expect(draw.filter((debate) => !debate.byeTeamId)).toHaveLength(5);
    expect(draw.filter((debate) => !debate.byeTeamId).every((debate) => debate.adjudicators.panellistIds.length === 2)).toBe(true);
    const [matching, mismatching, forfeit, ironPerson] = draw.filter((debate) => !debate.byeTeamId);

    // Blind check that matches: the second entry confirms, the first is kept as a discarded version.
    const firstEntry = simulateBallot(matching, harness.teams, harness.tournament, createSeededRng(1), {
      confirmed: false, submitterId: "volunteer", id: "blind-1",
    });
    await harness.submitBallot(firstEntry);
    expect(resolveCheckState({ ballots: harness.ballots, debateId: matching.id, userId: "volunteer", doubleEntry: true, checkMode: "blind" }).kind)
      .toBe("awaiting-other");
    const state = resolveCheckState({ ballots: harness.ballots, debateId: matching.id, userId: "checker", doubleEntry: true, checkMode: "blind" });
    expect(state.kind).toBe("blind-check");
    const checkEntry = {
      ...simulateBallot(matching, harness.teams, harness.tournament, createSeededRng(1), { submitterId: "checker", id: "blind-2", version: 2 }),
      checksVersion: firstEntry.version,
    };
    expect(diffBallots(firstEntry, checkEntry, "wsdc")).toEqual([]);
    await harness.submitBallot(checkEntry);
    expect(harness.ballots.find((ballot) => ballot.id === "blind-1")).toMatchObject({ discarded: true, confirmed: false });
    expect(harness.liveBallots(matching.id).map((ballot) => ballot.id)).toEqual(["blind-2"]);

    // Blind check that does not match: the tab director keeps the first entry.
    const original = simulateBallot(mismatching, harness.teams, harness.tournament, createSeededRng(2), {
      confirmed: false, submitterId: "volunteer", id: "mismatch-1",
    });
    await harness.submitBallot(original);
    const different = simulateBallot(mismatching, harness.teams, harness.tournament, createSeededRng(3), { id: "mismatch-2", version: 2 });
    expect(diffBallots(original, different, "wsdc").length).toBeGreaterThan(0);
    await harness.confirmBallot("mismatch-1", mismatching.id);
    expect(harness.liveBallots(mismatching.id).map((ballot) => ballot.id)).toEqual(["mismatch-1"]);
    expect(harness.liveBallots(mismatching.id)[0].confirmed).toBe(true);

    // A forfeit: the other team wins and nobody is credited with speeches.
    await harness.submitBallot(simulateBallot(forfeit, harness.teams, harness.tournament, rng, { forfeitSide: "NEG" }));

    // An iron-person speech counts once for the speaker, and not towards the team total.
    const ironBallot = simulateBallot(ironPerson, harness.teams, harness.tournament, rng, { ironPersonSide: "AFF" });
    expect(ironBallot.sheets).toHaveLength(3);
    await harness.submitBallot(ironBallot);

    // The last debate is a split decision: two sheets to one, decided by the majority.
    const [split] = draw.filter((debate) => !debate.byeTeamId).slice(4);
    const splitBallot = simulateBallot(split, harness.teams, harness.tournament, rng, { dissenters: 1 });
    expect(Object.values(splitBallot.teamScores).map((score) => score.votes).sort()).toEqual([1, 2]);
    expect(Object.values(splitBallot.teamScores).find((score) => score.votes === 2)?.win).toBe(true);
    await harness.submitBallot(splitBallot);
    await harness.completeRound(r1.id);

    const forfeitWinner = forfeit.teams.AFF!.teamId;
    const forfeiter = forfeit.teams.NEG!.teamId;
    expect(standingOf(forfeitWinner)).toMatchObject({ wins: 1, totalSpeakerScore: 0 });
    expect(standingOf(forfeiter)).toMatchObject({ wins: 0, losses: 1, totalSpeakerScore: 0 });
    // The bye is awarded as a win with no speeches.
    expect(standingOf(bye.byeTeamId!)).toMatchObject({ wins: 1, totalSpeakerScore: 0 });
    expect(standingOf(bye.byeTeamId!).roundResults[0]).toMatchObject({ bye: true, win: true });

    const ironTeam = harness.teams.find((team) => team.id === ironPerson.teams.AFF!.teamId)!;
    const ironSpeaker = harness.standings().speakers.find((row) => row.speakerId === ironTeam.speakers[0].id)!;
    expect(ironSpeaker.speechesCount).toBe(1);
    const lastSpeaker = harness.standings().speakers.find((row) => row.speakerId === ironTeam.speakers[2].id)!;
    expect(lastSpeaker.speechesCount).toBe(0);
    const ghostTotal = harness.ballots.find((ballot) => ballot.id === ironBallot.id)!.speakerScores.AFF
      .filter((speech) => !speech.ghost).reduce((sum, speech) => sum + speech.score, 0);
    expect(standingOf(ironTeam.id).totalSpeakerScore).toBeCloseTo(ghostTotal, 5);
    expect(harness.standings().replies.length).toBeGreaterThan(0);
    // 5 debates and a bye-win: 6 wins in all.
    expect(harness.standings().teams.reduce((sum, row) => sum + (row.wins ?? 0), 0)).toBe(6);
  });

  it("rounds 2 and 3: power-paired draws keep every invariant", async () => {
    for (const round of harness.rounds.slice(1, 3)) {
      const draw = await drawAllocateRelease(round.id);
      expect(draw.filter((debate) => debate.byeTeamId)).toHaveLength(1);
      await resultRound(round.id);
      await harness.patchRound(round.id, { resultsReleased: true });
      await harness.completeRound(round.id);
    }
    const standings = harness.standings().teams;
    expect(standings.reduce((sum, row) => sum + (row.wins ?? 0), 0)).toBe(18);
    // Nobody had two byes while others had none.
    const byeCounts = harness.teams.map((team) => harness.debates.filter((debate) => debate.byeTeamId === team.id).length);
    expect(Math.max(...byeCounts)).toBeLessThanOrEqual(1);
  });

  it("voting results become public only as released", async () => {
    const r1 = harness.rounds[0];
    expect(publicRound(harness, r1.id).ballots).toEqual([]);
    expect(publicRound(harness, r1.id).debates.flatMap(slotResultFields)).toEqual([]);
    await harness.patchRound(r1.id, { resultsReleased: true });
    const released = publicRound(harness, r1.id);
    expect(released.ballots).toHaveLength(5);
    for (const ballot of released.ballots) {
      expect(ballot).not.toHaveProperty("sheets");
      for (const score of Object.values(ballot.teamScores as Record<string, Record<string, unknown>>)) {
        expect(Object.keys(score).sort()).toEqual(["points", "rank", "side", "teamId", "win"]);
      }
    }
    // Discarded and unconfirmed versions never become public.
    expect(released.ballots.map((ballot) => ballot.id)).not.toContain("blind-1");
    expect(released.ballots.map((ballot) => ballot.id)).not.toContain("mismatch-2");
  });

  it("generates an AIDA 2016 break of six with a manual inclusion", async () => {
    const open: BreakCategory = {
      id: "open",
      tournamentId: harness.tournament.id,
      name: "Open",
      slug: "open",
      seq: 1,
      breakSize: 6,
      reserveSize: 1,
      isGeneral: true,
      priority: 1,
      qualificationRule: "aida_2016_australs",
    };
    await harness.saveBreakCategories([open]);
    for (const [seq, name] of [[4, "Quarterfinals"], [5, "Semifinals"], [6, "Grand Final"]] as const) {
      await harness.createRound({ roundSeq: seq, name, abbr: `E${seq}`, stage: "elimination", customDrawType: "elimination" });
    }
    const ranked = harness.standings().teams.map((row) => row.teamId);
    const underdog = ranked[ranked.length - 1];
    await harness.saveBreakCategories(withTeamOverride(harness.breakCategories, "open", underdog, "include"));
    const expected = harness.breakResults()[0];
    expect(expected.breakingTeams.map((entry) => entry.team.id)).toContain(underdog);
    expect(expected.breakingTeams).toHaveLength(6);

    const first = await harness.generateBreak("open");
    expect(first?.name).toBe("Quarterfinals");
    expect(harness.breakCategories[0].generatedBreak?.breakingTeamIds).toEqual(expected.breakingTeams.map((entry) => entry.team.id));
    expect(harness.teams.filter((team) => team.breakStatus === "breaking").map((team) => team.id).sort())
      .toEqual(expected.breakingTeams.map((entry) => entry.team.id).sort());
    // AIDA 2016: at most three teams per institution break.
    const perInstitution = new Map<string, number>();
    for (const entry of expected.breakingTeams) {
      const key = entry.team.institutionName ?? entry.team.id;
      perInstitution.set(key, (perInstitution.get(key) ?? 0) + 1);
    }
    expect(Math.max(...perInstitution.values())).toBeLessThanOrEqual(3);
    // Every elimination round is scheduled for the category.
    expect(harness.rounds.filter((round) => round.stage === "elimination").map((round) => round.breakCategoryIds))
      .toEqual([["open"], ["open"], ["open"]]);
  });

  it("plays the partial elimination, semifinals and grand final", async () => {
    const [quarters, semis, final] = harness.rounds.filter((round) => round.stage === "elimination");
    const seeds = harness.breakCategories[0].generatedBreak!.breakingTeamIds;

    const qf = await drawAllocateRelease(quarters.id);
    expect(qf.filter((debate) => debate.byeTeamId).map((debate) => debate.byeTeamId).sort()).toEqual(seeds.slice(0, 2).sort());
    expect(qf.filter((debate) => !debate.byeTeamId)).toHaveLength(2);
    // An eliminated team's private page shows no elimination debate.
    const outsider = harness.teams.find((team) => team.breakStatus === "eliminated")!;
    expect(teamPortal(harness, outsider.id, quarters.id).debates).toEqual([]);
    await resultRound(quarters.id);
    expect((await harness.advanceElimination(quarters.id))?.id).toBe(semis.id);
    expect(harness.teams.filter((team) => team.breakStatus === "breaking")).toHaveLength(4);

    const sf = await drawAllocateRelease(semis.id);
    expect(sf.filter((debate) => !debate.byeTeamId)).toHaveLength(2);
    // The bye teams keep their seeds: the top two seeds are in different semifinals.
    const topTwo = new Set(seeds.slice(0, 2));
    expect(sf.every((debate) => Object.values(debate.teams).filter((slot) => topTwo.has(slot!.teamId)).length === 1)).toBe(true);
    await resultRound(semis.id);
    expect((await harness.advanceElimination(semis.id))?.id).toBe(final.id);

    const gf = await drawAllocateRelease(final.id);
    expect(gf).toHaveLength(1);
    await resultRound(final.id);
    expect(await harness.advanceElimination(final.id)).toBeNull();
    const champion = harness.teams.filter((team) => team.breakStatus === "breaking");
    expect(champion).toHaveLength(1);
    const finalBallot = harness.liveBallots(gf[0].id)[0] as BallotSubmission;
    expect(Object.values(finalBallot.teamScores).find((score) => score.win)?.teamId).toBe(champion[0].id);
    // Elimination results never alter the preliminary tab.
    expect(harness.standings().teams.reduce((sum, row) => sum + (row.wins ?? 0), 0)).toBe(18);
  });
});

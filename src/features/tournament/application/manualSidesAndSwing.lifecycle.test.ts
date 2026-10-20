import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { BreakCategory, Round } from "@/types";
import { calculateBreaks } from "@/lib/breakqual/calculator";
import { buildMatchupHistory, getEligibleTeamsForRound } from "@/lib/draw/generator";
import { MANUAL_SIDES_FLAG, resolveRecordedSides, sidesPending, swapTwoTeamSides } from "@/lib/draw/manualSides";
import { createSeededRng } from "@/lib/draw/rng";
import { TournamentHarness } from "@/test/lifecycleHarness";
import { expectValidRound } from "@/test/lifecycleAssertions";
import { FIXED_TIME, makeAdjudicators, makeTeams, makeTournament, makeVenues, simulateBallot } from "@/test/tournamentFixtures";
import { buildSwingTeam, roundFieldSize, swingTeamsNeeded, withSwingRound } from "./swingTeams";

/**
 * Golden case for roadmap #16: a two-team tournament whose sides are chosen on the ballot (Tabbycat's
 * "manual-ballot"), with five teams and a swing team filling the third room of round 1.
 */

let harness: TournamentHarness;
const rng = createSeededRng(1616);
let round1: Round;
let round2: Round;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(FIXED_TIME));
  vi.spyOn(Math, "random").mockImplementation(createSeededRng(16));
  harness = new TournamentHarness(
    makeTournament("custom_2team", { sideAllocationRule: "manual_ballot", drawRule: "random" }),
    (round) => 900 + round.seq
  );
  const id = harness.tournament.id;
  harness.teams = makeTeams(5, { tournamentId: id, institutionCount: 5 });
  harness.adjudicators = makeAdjudicators(3, { tournamentId: id });
  harness.venues = makeVenues(3, id);
  round1 = await harness.createRound({ roundSeq: 1, name: "Round 1", abbr: "R1", stage: "preliminary" });
  round2 = await harness.createRound({ roundSeq: 2, name: "Round 2", abbr: "R2", stage: "preliminary" });
});

afterAll(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("swing team fills an odd room", () => {
  it("asks for one swing team for five two-team teams, then none once it exists", () => {
    const field = roundFieldSize(harness.tournament, round1, harness.teams);
    expect(field).toEqual({ available: 5, teamsPerDebate: 2, excess: 1 });
    expect(swingTeamsNeeded(field)).toBe(1);

    const source = harness.teams[0].speakers[0];
    harness.teams = [...harness.teams, {
      id: "swing-1",
      tournamentId: harness.tournament.id,
      ...buildSwingTeam({
        name: "Swing A",
        speakers: [{ name: source.name, sourceSpeakerId: source.id }, { name: "Reserve One" }, { name: "Reserve Two" }],
        round: round1,
        teams: harness.teams,
        tournament: harness.tournament,
      }, (index) => `swing-1-s${index + 1}`),
    }];
    expect(swingTeamsNeeded(roundFieldSize(harness.tournament, round1, harness.teams))).toBe(0);
    // Only drawn in the round it was formed for.
    expect(getEligibleTeamsForRound(harness.teams, round2).map((team) => team.id)).not.toContain("swing-1");
  });
});

describe("manual-ballot sides", () => {
  it("draws every room with sides still to be chosen, and the draw check accepts it", async () => {
    const debates = await harness.generateDraw(round1.id);
    expect(debates).toHaveLength(3);
    for (const debate of debates) {
      expect(debate.flags).toContain(MANUAL_SIDES_FLAG);
      expect(debate.sidesConfirmed).toBe(false);
      expect(sidesPending(debate)).toBe(true);
    }
    expect(debates.some((debate) => Object.values(debate.teams).some((slot) => slot.teamId === "swing-1"))).toBe(true);
    await harness.allocate(round1.id, 1);
    expectValidRound(harness, round1.id);
  });

  it("takes each debate's sides from its confirmed ballot", async () => {
    const drawn = harness.roundDebates(round1.id);
    // Every room recorded the reverse of the draw's order.
    for (const debate of drawn) {
      await harness.submitBallot(simulateBallot(swapTwoTeamSides(debate), harness.teams, harness.tournament, rng));
    }
    for (const before of drawn) {
      const after = harness.debates.find((debate) => debate.id === before.id)!;
      expect(after.sidesConfirmed).toBe(true);
      expect(after.resultStatus).toBe("confirmed");
      expect(after.teams.AFF.teamId).toBe(before.teams.NEG.teamId);
      expect(after.teams.NEG.teamId).toBe(before.teams.AFF.teamId);
    }
  });

  it("builds side history from the recorded sides (golden)", () => {
    const drawn = harness.roundDebates(round1.id);
    const history = buildMatchupHistory(resolveRecordedSides(drawn, harness.ballots));
    for (const debate of drawn) {
      expect(history.sides.get(debate.teams.AFF.teamId)).toEqual(["AFF"]);
      expect(history.sides.get(debate.teams.NEG.teamId)).toEqual(["NEG"]);
    }
    // A debate still awaiting its ballot is a meeting with no side.
    const pending = { ...drawn[0], sidesConfirmed: false };
    const unresolved = buildMatchupHistory([pending]);
    expect(unresolved.sides.get(pending.teams.AFF.teamId)).toEqual([]);
    expect(unresolved.opponents.get(pending.teams.AFF.teamId)).toEqual(new Set([pending.teams.NEG.teamId]));
  });

  it("standings read the recorded sides, also before the debate record was rearranged", () => {
    const rows = harness.standings().teams;
    // A chair's portal ballot reaches this device before anyone rearranges the debate.
    const stale = harness.debates.map((debate) =>
      debate.roundId === round1.id ? { ...swapTwoTeamSides(debate), sidesConfirmed: false } : debate
    );
    const fromBallots = new TournamentHarness(harness.tournament, () => 1);
    Object.assign(fromBallots, { rounds: harness.rounds, teams: harness.teams, debates: stale, ballots: harness.ballots });
    const staleRows = fromBallots.standings().teams;
    expect(staleRows.map((row) => [row.teamId, row.points, row.roundResults[0]?.side]))
      .toEqual(rows.map((row) => [row.teamId, row.points, row.roundResults[0]?.side]));
  });

  it("reopens the sides when the confirmed ballot is discarded", async () => {
    const debate = harness.roundDebates(round1.id)[0];
    const ballot = harness.liveBallots(debate.id).find((item) => item.confirmed)!;
    await harness.discardBallot(ballot.id);
    const reopened = harness.debates.find((item) => item.id === debate.id)!;
    expect(sidesPending(reopened)).toBe(true);
    // Re-entered with the opposite sides.
    await harness.submitBallot(simulateBallot(swapTwoTeamSides(reopened), harness.teams, harness.tournament, rng, { version: 2 }));
    const confirmed = harness.debates.find((item) => item.id === debate.id)!;
    expect(confirmed.sidesConfirmed).toBe(true);
    expect(confirmed.teams.AFF.teamId).toBe(reopened.teams.NEG.teamId);
  });
});

describe("swing team results", () => {
  it("count for the opponent but the swing team and its speakers are not ranked (golden)", () => {
    const { teams, speakers } = harness.standings();
    expect(teams.map((row) => row.teamId)).not.toContain("swing-1");
    expect(teams).toHaveLength(5);
    expect(speakers.some((row) => row.speakerId.startsWith("swing-1"))).toBe(false);
    // The source speaker keeps only their own team's speeches.
    const source = speakers.find((row) => row.speakerId === harness.teams[0].speakers[0].id)!;
    expect(source.speechesCount).toBe(1);

    const swingDebate = harness.roundDebates(round1.id).find((debate) =>
      Object.values(debate.teams).some((slot) => slot.teamId === "swing-1")
    )!;
    const opponentSide = swingDebate.teams.AFF.teamId === "swing-1" ? "NEG" : "AFF";
    const opponentId = swingDebate.teams[opponentSide].teamId;
    const ballot = harness.liveBallots(swingDebate.id).find((item) => item.confirmed)!;
    const opponent = teams.find((row) => row.teamId === opponentId)!;
    expect(opponent.wins).toBe(ballot.teamScores[opponentSide].win ? 1 : 0);
    expect(opponent.roundResults[0].opponentTeamIds).toEqual(["swing-1"]);
  });

  it("never breaks", () => {
    const open: BreakCategory = {
      id: "open",
      tournamentId: harness.tournament.id,
      name: "Open",
      slug: "open",
      seq: 1,
      breakSize: 6,
      reserveSize: 0,
      isGeneral: true,
      priority: 1,
    };
    const [result] = calculateBreaks([open], harness.teams, harness.standings().teams, harness.tournament.format);
    const placed = [...result.breakingTeams, ...result.cutoffTies.flatMap((tie) => tie.teams)].map((entry) => entry.team.id);
    // Six break places, five ranked teams: everyone but the swing team is in.
    expect(placed.sort()).toEqual(harness.teams.filter((team) => !team.isSwing).map((team) => team.id).sort());
  });

  it("can be drawn again in a later round", () => {
    const swing = harness.teams.find((team) => team.id === "swing-1")!;
    const reused = withSwingRound(swing, round2);
    expect(getEligibleTeamsForRound([reused], round2)).toHaveLength(1);
    expect(reused.swingRoundIds).toEqual([round1.id, round2.id]);
  });
});

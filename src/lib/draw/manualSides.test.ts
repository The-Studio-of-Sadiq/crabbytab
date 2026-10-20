import { describe, expect, it } from "vitest";
import type { Adjudicator, BallotSubmission, Debate, Team } from "@/types";
import { ballotMatchesDebate } from "@/lib/ballots/result";
import { buildPrivateBallot } from "@/lib/privateBallot";
import { makeRound, makeTeams, makeTournament, makeVenues } from "@/test/tournamentFixtures";
import { generateRoundDraw } from "./generator";
import {
  applyBallotSides,
  arrangeDebateSides,
  isSidePermutation,
  MANUAL_SIDES_FLAG,
  resolveRecordedSides,
  sidesPending,
  swapTwoTeamSides,
} from "./manualSides";
import { validateDraw } from "./validateDraw";

function debate(overrides: Partial<Debate> = {}): Debate {
  return {
    id: "d1",
    tournamentId: "t",
    roundId: "r1",
    roundSeq: 1,
    bracket: 0,
    roomRank: 1,
    importance: 0,
    resultStatus: "none",
    sidesConfirmed: false,
    flags: [MANUAL_SIDES_FLAG],
    teams: {
      AFF: { teamId: "a", teamName: "A", side: "AFF", pulledUp: true },
      NEG: { teamId: "b", teamName: "B", side: "NEG", points: 1 },
    } as Debate["teams"],
    adjudicators: { chairId: "chair", panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    ...overrides,
  };
}

function ballot(aff: string, neg: string, confirmed = true): BallotSubmission {
  return {
    id: `ballot-${aff}`,
    tournamentId: "t",
    roundId: "r1",
    debateId: "d1",
    version: 1,
    confirmed,
    discarded: false,
    submitterType: "tabroom",
    timestamp: "",
    speakerScores: { AFF: [], NEG: [] } as unknown as BallotSubmission["speakerScores"],
    teamScores: {
      AFF: { side: "AFF", teamId: aff, points: 1, totalSpeakerScore: 150, win: true },
      NEG: { side: "NEG", teamId: neg, points: 0, totalSpeakerScore: 140, win: false },
    } as BallotSubmission["teamScores"],
  };
}

describe("sidesPending", () => {
  it("is true only for flagged, unconfirmed, non-bye debates", () => {
    expect(sidesPending(debate())).toBe(true);
    expect(sidesPending(debate({ sidesConfirmed: true }))).toBe(false);
    // Draws made under other side rules never had a meaningful sidesConfirmed.
    expect(sidesPending(debate({ flags: [] }))).toBe(false);
    expect(sidesPending(debate({ byeTeamId: "a" }))).toBe(false);
  });
});

describe("arrangeDebateSides", () => {
  it("moves each team's slot with its own details and drops side-bound scores", () => {
    const swapped = swapTwoTeamSides(debate());
    expect(swapped.teams.AFF).toEqual({ teamId: "b", teamName: "B", side: "AFF" });
    expect(swapped.teams.NEG).toEqual({ teamId: "a", teamName: "A", side: "NEG", pulledUp: true });
  });

  it("refuses an assignment that is not a rearrangement of the debate's teams", () => {
    expect(isSidePermutation(debate(), { AFF: "a", NEG: "a" })).toBe(false);
    expect(isSidePermutation(debate(), { AFF: "a", NEG: "c" })).toBe(false);
    expect(isSidePermutation(debate(), { AFF: "a" })).toBe(false);
    expect(() => arrangeDebateSides(debate(), { AFF: "a", NEG: "c" })).toThrow(/exactly once/);
  });
});

describe("ballots on manual-ballot debates", () => {
  it("match the debate on either side, but never with other teams", () => {
    expect(ballotMatchesDebate(ballot("b", "a"), debate())).toBe(true);
    expect(ballotMatchesDebate(ballot("a", "b"), debate())).toBe(true);
    expect(ballotMatchesDebate(ballot("a", "c"), debate())).toBe(false);
    // Fixed sides still have to match exactly.
    expect(ballotMatchesDebate(ballot("b", "a"), debate({ flags: [] }))).toBe(false);
  });

  it("apply their sides, and a corrected version may change confirmed sides", () => {
    const applied = applyBallotSides(debate(), ballot("b", "a"));
    expect(applied.sidesConfirmed).toBe(true);
    expect(applied.teams.AFF.teamId).toBe("b");
    expect(applyBallotSides(applied, ballot("a", "b")).teams.AFF.teamId).toBe("a");
    // Unflagged debates are untouched.
    expect(applyBallotSides(debate({ flags: [] }), ballot("b", "a")).teams.AFF.teamId).toBe("a");
  });

  it("resolveRecordedSides uses confirmed, non-discarded ballots only", () => {
    const [resolved] = resolveRecordedSides([debate()], [ballot("b", "a")]);
    expect(resolved.teams.AFF.teamId).toBe("b");
    const [unconfirmed] = resolveRecordedSides([debate()], [ballot("b", "a", false)]);
    expect(sidesPending(unconfirmed)).toBe(true);
    const [discarded] = resolveRecordedSides([debate()], [{ ...ballot("b", "a"), discarded: true }]);
    expect(sidesPending(discarded)).toBe(true);
  });
});

describe("generator with manual-ballot sides", () => {
  const venues = makeVenues(4, "t-custom_2team");

  it("marks every debate (not byes) as awaiting its sides and is reproducible", () => {
    const tournament = makeTournament("custom_2team", {
      sideAllocationRule: "manual_ballot",
      byeTeamSelectionMethod: "random",
      maxTimesPerSide: 1,
    });
    const teams = makeTeams(7, { tournamentId: tournament.id });
    const round = makeRound(tournament.id, 2, { drawType: "random" });
    // Every team was already AFF once: side limits would refuse half the rooms if they applied.
    const past: Debate[] = [];
    const params = { tournament, round, teams, venues, pastDebates: past, standings: [], seed: 7 };
    const first = generateRoundDraw(params);
    expect(generateRoundDraw(params)).toEqual(first);
    const rooms = first.filter((item) => !item.byeTeamId);
    expect(rooms).toHaveLength(3);
    for (const room of rooms) {
      expect(sidesPending(room)).toBe(true);
    }
    const bye = first.find((item) => item.byeTeamId)!;
    expect(bye.flags).not.toContain(MANUAL_SIDES_FLAG);
  });

  it("refuses BP, where sides cannot be chosen on the ballot", () => {
    const tournament = makeTournament("bp", { sideAllocationRule: "manual_ballot" });
    const teams = makeTeams(8, { tournamentId: tournament.id, speakersPerTeam: 2 });
    expect(() =>
      generateRoundDraw({ tournament, round: makeRound(tournament.id, 1), teams, venues, pastDebates: [], standings: [] })
    ).toThrow(/two-team formats/);
  });

  it("never gives the bye to a swing team", () => {
    const tournament = makeTournament("custom_2team", { byeTeamSelectionMethod: "random" });
    const round = makeRound(tournament.id, 1);
    const teams: Team[] = [
      ...makeTeams(4, { tournamentId: tournament.id }),
      { ...makeTeams(1, { tournamentId: tournament.id, prefix: "swing" })[0], isSwing: true, swingRoundIds: [round.id] },
    ];
    for (let seed = 1; seed <= 20; seed++) {
      const draw = generateRoundDraw({ tournament, round, teams, venues, pastDebates: [], standings: [], seed });
      expect(draw.find((item) => item.byeTeamId)?.byeTeamId).not.toBe("swing-1");
    }
  });
});

describe("draw check with manual-ballot sides", () => {
  it("applies no side limit to a debate whose sides are still to be chosen", () => {
    const tournament = makeTournament("custom_2team", { sideAllocationRule: "manual_ballot", maxTimesPerSide: 1 });
    const teams = makeTeams(2, { tournamentId: tournament.id });
    const round1 = makeRound(tournament.id, 1);
    const round2 = makeRound(tournament.id, 2);
    const slot = (team: Team, side: "AFF" | "NEG") => ({ teamId: team.id, teamName: team.name, side });
    const earlier = debate({
      id: "d0", roundId: round1.id, roundSeq: 1, flags: [], sidesConfirmed: true,
      teams: { AFF: slot(teams[0], "AFF"), NEG: slot(teams[1], "NEG") } as Debate["teams"],
    });
    const current = debate({
      id: "d1", roundId: round2.id, roundSeq: 2,
      teams: { AFF: slot(teams[0], "AFF"), NEG: slot(teams[1], "NEG") } as Debate["teams"],
    });
    const input = { tournament, round: round2, rounds: [round1, round2], teams, adjudicators: [], venues: [] };
    expect(validateDraw({ ...input, debates: [earlier, current] }).map((issue) => issue.code)).not.toContain("side_limit");
    expect(validateDraw({ ...input, debates: [earlier, { ...current, flags: [] }] }).map((issue) => issue.code))
      .toContain("side_limit");
  });
});

describe("private portal chair ballot with manual-ballot sides", () => {
  const tournament = makeTournament("custom_2team", { sideAllocationRule: "manual_ballot", replyScoresEnabled: false, substantiveSpeakers: 1 });
  const teams = makeTeams(2, { tournamentId: tournament.id, speakersPerTeam: 1 });
  const chair: Adjudicator = {
    id: "chair", tournamentId: tournament.id, name: "Chair", baseScore: 5, trainee: false, independent: true, conflicts: [],
  };
  const drawn = debate({
    teams: {
      AFF: { teamId: teams[0].id, teamName: teams[0].name, side: "AFF" },
      NEG: { teamId: teams[1].id, teamName: teams[1].name, side: "NEG" },
    } as Debate["teams"],
  });
  const input = (affTeam: Team | undefined, negTeam: Team | undefined) => ({
    id: `ballot-${drawn.id}-adj-chair-1`,
    submitterType: "judge",
    submitterId: "chair",
    speakerScores: {
      AFF: [{ speakerId: (affTeam ?? teams[0]).speakers[0].id, position: 1, score: 75 }],
      NEG: [{ speakerId: (negTeam ?? teams[1]).speakers[0].id, position: 1, score: 70 }],
    },
    teamScores: {
      AFF: { rank: 1, ...(affTeam ? { teamId: affTeam.id } : {}) },
      NEG: { rank: 2, ...(negTeam ? { teamId: negTeam.id } : {}) },
    },
  });
  const context = { tournament, adjudicator: chair, debate: drawn, teams: new Map(teams.map((team) => [team.id, team])), tournamentId: tournament.id };

  it("records the sides the chair chose", () => {
    const built = buildPrivateBallot(input(teams[1], teams[0]), context);
    expect(built.teamScores.AFF.teamId).toBe(teams[1].id);
    expect(built.speakerScores.AFF[0].speakerId).toBe(teams[1].speakers[0].id);
    expect(built.teamScores.AFF.win).toBe(true);
  });

  it("requires the sides while they are still to be chosen", () => {
    expect(() => buildPrivateBallot(input(undefined, undefined), context)).toThrow(/which team took which side/);
    expect(() => buildPrivateBallot(input(teams[0], teams[0]), context)).toThrow(/which team took which side/);
  });
});

import { describe, expect, it } from "vitest";
import type { BallotSubmission, Debate } from "@/types";
import { makeRound, makeTeams, makeTournament } from "@/test/tournamentFixtures";
import { calculateStandingsAsOf, roundsCountedAsOf } from "./asOfRound";
import { calculateStandings } from "./calculator";

const tournament = makeTournament("wsdc", { replyScoresEnabled: false });
const T = tournament.id;
const teams = makeTeams(2, { tournamentId: T });
const [alpha, beta] = teams;
const r1 = makeRound(T, 1, { drawStatus: "confirmed", completed: true });
const r2 = makeRound(T, 2, { drawStatus: "confirmed", completed: true });
const r3 = makeRound(T, 3, { drawStatus: "confirmed", cancelled: true });
const rounds = [r1, r2, r3];

function debate(roundId: string, seq: number): Debate {
  return {
    id: `d-${roundId}`,
    tournamentId: T,
    roundId,
    roundSeq: seq,
    bracket: 0,
    roomRank: 1,
    importance: 0,
    resultStatus: "confirmed",
    sidesConfirmed: true,
    flags: [],
    teams: {
      AFF: { teamId: alpha.id, teamName: alpha.name, side: "AFF" },
      NEG: { teamId: beta.id, teamName: beta.name, side: "NEG" },
    } as Debate["teams"],
    adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
  };
}

function ballot(roundId: string, affWins: boolean): BallotSubmission {
  const scores = (teamIndex: number, base: number) =>
    teams[teamIndex].speakers.map((speaker, index) => ({ speakerId: speaker.id, speakerName: speaker.name, position: index + 1, score: base }));
  const affScore = affWins ? 75 : 70;
  const negScore = affWins ? 70 : 75;
  return {
    id: `b-${roundId}`,
    tournamentId: T,
    roundId,
    debateId: `d-${roundId}`,
    version: 1,
    confirmed: true,
    discarded: false,
    submitterType: "tabroom",
    timestamp: "",
    speakerScores: { AFF: scores(0, affScore), NEG: scores(1, negScore) },
    teamScores: {
      AFF: { side: "AFF", teamId: alpha.id, points: affWins ? 1 : 0, totalSpeakerScore: affScore * 3, win: affWins },
      NEG: { side: "NEG", teamId: beta.id, points: affWins ? 0 : 1, totalSpeakerScore: negScore * 3, win: !affWins },
    },
  } as unknown as BallotSubmission;
}

const debates = [debate(r1.id, 1), debate(r2.id, 2), debate(r3.id, 3)];
// Alpha wins round 1; Beta wins round 2; the cancelled round 3 never counts.
const ballots = [ballot(r1.id, true), ballot(r2.id, false), ballot(r3.id, true)];
const pointsOf = (rows: { teamId: string; points: number }[]) =>
  Object.fromEntries(rows.map((row) => [row.teamId, row.points]));

describe("standings as of a round", () => {
  it("counts the non-cancelled rounds up to and including the chosen round", () => {
    expect(roundsCountedAsOf(rounds).map((round) => round.id)).toEqual([r1.id, r2.id]);
    expect(roundsCountedAsOf(rounds, r1.id).map((round) => round.id)).toEqual([r1.id]);
    expect(roundsCountedAsOf(rounds, r2.id).map((round) => round.id)).toEqual([r1.id, r2.id]);
    // A cancelled or unknown round falls back to every round.
    expect(roundsCountedAsOf(rounds, r3.id).map((round) => round.id)).toEqual([r1.id, r2.id]);
    expect(roundsCountedAsOf(rounds, "gone").map((round) => round.id)).toEqual([r1.id, r2.id]);
  });

  it("leaves later rounds' results out of every metric", () => {
    const afterRound1 = calculateStandingsAsOf(tournament, rounds, teams, debates, ballots, r1.id);
    expect(pointsOf(afterRound1.teams)).toEqual({ [alpha.id]: 1, [beta.id]: 0 });
    expect(afterRound1.teams[0].teamId).toBe(alpha.id);
    expect(afterRound1.speakers.find((row) => row.speakerId === beta.speakers[0].id)?.totalScore).toBe(70);

    const afterAll = calculateStandingsAsOf(tournament, rounds, teams, debates, ballots);
    expect(pointsOf(afterAll.teams)).toEqual({ [alpha.id]: 1, [beta.id]: 1 });
  });

  it("the default equals the tournament-wide standings the app computed before", () => {
    const live = rounds.filter((round) => !round.cancelled);
    const liveIds = new Set(live.map((round) => round.id));
    const before = calculateStandings(
      tournament,
      live,
      teams,
      debates.filter((item) => liveIds.has(item.roundId)),
      ballots.filter((item) => liveIds.has(item.roundId))
    );
    expect(calculateStandingsAsOf(tournament, rounds, teams, debates, ballots)).toEqual(before);
  });
});

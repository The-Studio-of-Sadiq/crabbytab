import { describe, expect, it } from "vitest";
import type { BallotSubmission, Debate, DebateSide, SpeakerScoreEntry } from "@/types";
import { buildBallotResult, type BallotRules } from "@/lib/ballots/result";
import { makeRound, makeTeams, makeTournament } from "@/test/tournamentFixtures";
import { calculateStandings } from "./calculator";
import { resolveTeamPrecedence } from "./precedence";

const tournament = makeTournament("poly", {
  teamsInDebate: 3,
  substantiveSpeakers: 1,
  replyScoresEnabled: false,
  minSpeakerScore: 50,
  maxSpeakerScore: 99,
  ballotMode: "consensus",
  teamStandingsPrecedence: ["points", "speaks_sum"],
});
const teams = makeTeams(3, { tournamentId: tournament.id, speakersPerTeam: 1 });
const rounds = [makeRound(tournament.id, 1, { drawType: "random" }), makeRound(tournament.id, 2, { drawType: "random" })];
const sides: DebateSide[] = ["P1", "P2", "P3"];

function debate(round: number, order: number[]): Debate {
  return {
    id: `d${round}`,
    tournamentId: tournament.id,
    roundId: rounds[round - 1].id,
    roundSeq: round,
    bracket: 0,
    roomRank: 1,
    importance: 0,
    resultStatus: "confirmed",
    sidesConfirmed: true,
    flags: [],
    teams: Object.fromEntries(
      sides.map((side, index) => [side, { teamId: teams[order[index]].id, teamName: teams[order[index]].name, side }])
    ) as Debate["teams"],
    adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
  };
}

function ballot(source: Debate, totals: number[], rules: BallotRules): BallotSubmission {
  const speakerScores = Object.fromEntries(
    sides.map((side, index) => {
      const team = teams.find((item) => item.id === source.teams[side]?.teamId)!;
      return [side, [{ speakerId: team.speakers[0].id, speakerName: team.speakers[0].name, position: 1, score: totals[index] } as SpeakerScoreEntry]];
    })
  );
  const result = buildBallotResult(
    { speakerScores },
    Object.fromEntries(sides.map((side) => [side, source.teams[side]?.teamId ?? ""])),
    undefined,
    rules
  );
  return {
    id: `b-${source.id}`,
    tournamentId: tournament.id,
    roundId: source.roundId,
    debateId: source.id,
    version: 1,
    confirmed: true,
    discarded: false,
    submitterType: "tabroom",
    speakerScores: result.speakerScores,
    teamScores: result.teamScores,
    ...(result.sheets ? { sheets: result.sheets } : {}),
    timestamp: "",
  };
}

describe("standings for N teams per room", () => {
  const rules: BallotRules = { format: "poly", preferences: tournament.preferences };
  const debates = [debate(1, [0, 1, 2]), debate(2, [2, 0, 1])];
  // Round 1: team 1 first (2 points), team 2 second (1), team 3 last (0).
  // Round 2: team 3 first, team 1 second, team 2 last.
  const ballots = [ballot(debates[0], [80, 75, 70], rules), ballot(debates[1], [78, 76, 60], rules)];

  it("adds each room's points (teams in the room - rank) and never counts a win", () => {
    const { teams: rows } = calculateStandings(tournament, rounds, teams, debates, ballots);
    const byId = new Map(rows.map((row) => [row.teamId, row]));
    expect(byId.get(teams[0].id)?.points).toBe(3);
    expect(byId.get(teams[1].id)?.points).toBe(1);
    expect(byId.get(teams[2].id)?.points).toBe(2);
    expect(rows.every((row) => row.wins === 0 && row.losses === 0)).toBe(true);
    expect(rows.map((row) => row.teamId)).toEqual([teams[0].id, teams[2].id, teams[1].id]);
    expect(byId.get(teams[0].id)?.totalSpeakerScore).toBe(156);
    expect(byId.get(teams[0].id)?.roundResults.map((result) => result.side)).toEqual(["P1", "P2"]);
  });

  it("gives score-only voting ballots no points and ranks on speaks", () => {
    const voting = makeTournament("poly", {
      teamsInDebate: 3,
      substantiveSpeakers: 1,
      replyScoresEnabled: false,
      minSpeakerScore: 50,
      maxSpeakerScore: 99,
      ballotMode: "voting",
      marginIncludesDissenters: true,
    });
    const votingRules: BallotRules = { format: "poly", preferences: voting.preferences };
    const source = debates[0];
    const speakerScores = (totals: number[]) =>
      Object.fromEntries(sides.map((side, index) => {
        const team = teams.find((item) => item.id === source.teams[side]?.teamId)!;
        return [side, [{ speakerId: team.speakers[0].id, speakerName: "", position: 1, score: totals[index] }]];
      })) as Record<DebateSide, SpeakerScoreEntry[]>;
    const result = buildBallotResult(
      { speakerScores: {}, sheets: [{ adjudicatorId: "a", speakerScores: speakerScores([70, 80, 80]) }, { adjudicatorId: "b", speakerScores: speakerScores([72, 70, 90]) }] },
      Object.fromEntries(sides.map((side) => [side, source.teams[side]?.teamId ?? ""])),
      "a",
      votingRules
    );
    const stored: BallotSubmission = { ...ballots[0], speakerScores: result.speakerScores, teamScores: result.teamScores, sheets: result.sheets };
    const { teams: rows } = calculateStandings(voting, rounds.slice(0, 1), teams, [source], [stored]);
    expect(rows.every((row) => row.points === 0 && row.wins === 0)).toBe(true);
    // The default poly precedence ranks on average speaks (Tabbycat Public Speaking).
    expect(resolveTeamPrecedence("poly", {})).toEqual(["speaks_avg"]);
    expect(rows[0].teamId).toBe(teams[2].id);
    expect(rows[0].totalSpeakerScore).toBe(85);
  });

  it("keeps the BP and two-team default precedence", () => {
    expect(resolveTeamPrecedence("bp", {})).toEqual(["points", "speaks_sum", "firsts", "seconds", "thirds"]);
    expect(resolveTeamPrecedence("uadc", {})).toEqual(["points", "speaks_sum", "margin_sum"]);
  });
});

import { describe, expect, it } from "vitest";
import type { Adjudicator, Debate, Team, TournamentPreferences } from "@/types";
import { buildPrivateBallot, privateBallotRules } from "@/lib/privateBallot";
import { makeTournament } from "@/test/tournamentFixtures";

/** A poly room that drew only three of the format's five teams (the random draw's remainder). */
const SIDES = ["P1", "P2", "P3"] as const;

function tournamentWith(overrides: Partial<TournamentPreferences>) {
  return makeTournament("poly", {
    teamsInDebate: 5,
    substantiveSpeakers: 1,
    replyScoresEnabled: false,
    minSpeakerScore: 50,
    maxSpeakerScore: 99,
    stepSpeakerScore: 1,
    ...overrides,
  });
}

const debate: Debate = {
  id: "d1",
  tournamentId: "t-poly",
  roundId: "r1",
  roundSeq: 1,
  bracket: 0,
  roomRank: 1,
  importance: 0,
  resultStatus: "none",
  sidesConfirmed: true,
  flags: [],
  teams: Object.fromEntries(SIDES.map((side) => [side, { side, teamId: `team-${side}`, teamName: side }])) as unknown as Debate["teams"],
  adjudicators: { chairId: "chair", panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
};

const teams = new Map(
  SIDES.map((side) => [
    `team-${side}`,
    {
      id: `team-${side}`,
      tournamentId: "t-poly",
      name: side,
      speakers: [{ id: `speaker-${side}`, name: `${side} Speaker` }],
      breakCategories: [],
      speakerCategories: [],
    } satisfies Team,
  ])
);

const chair: Adjudicator = { id: "chair", tournamentId: "t-poly", name: "Chair", baseScore: 5, trainee: false, independent: true, conflicts: [] };

function input(scores: number[], teamScores: (index: number) => Record<string, unknown>) {
  return {
    id: "ballot-d1-adj-chair-1",
    submitterType: "judge",
    submitterId: "chair",
    speakerScores: Object.fromEntries(
      SIDES.map((side, index) => [side, [{ speakerId: `speaker-${side}`, position: 1, score: scores[index] }]])
    ),
    teamScores: Object.fromEntries(SIDES.map((side, index) => [side, teamScores(index)])),
  };
}

describe("private-URL ballots for N teams per room", () => {
  it("ranks a consensus sheet on its totals, for the room's own teams", () => {
    const tournament = tournamentWith({ ballotMode: "consensus" });
    const ballot = buildPrivateBallot(input([70, 90, 80], (index) => ({ rank: index + 1 })), {
      tournament,
      adjudicator: chair,
      debate,
      teams,
      tournamentId: tournament.id,
      round: { stage: "preliminary" },
    });
    expect(Object.keys(ballot.teamScores).sort()).toEqual(["P1", "P2", "P3"]);
    expect([ballot.teamScores.P2.rank, ballot.teamScores.P3.rank, ballot.teamScores.P1.rank]).toEqual([1, 2, 3]);
    expect([ballot.teamScores.P2.points, ballot.teamScores.P1.points]).toEqual([2, 0]);
    expect(() =>
      buildPrivateBallot(input([70, 70, 80], (index) => ({ rank: index + 1 })), {
        tournament,
        adjudicator: chair,
        debate,
        teams,
        tournamentId: tournament.id,
        round: { stage: "preliminary" },
      })
    ).toThrow(/same total/);
  });

  it("takes an adjudicator's own scores-only sheet in a voting round: ties allowed, no ranks", () => {
    const tournament = tournamentWith({ ballotMode: "voting", marginIncludesDissenters: true });
    expect(privateBallotRules(tournament, { stage: "preliminary" }, debate).polyScoresOnly).toBe(true);
    const ballot = buildPrivateBallot(input([70, 70, 80], () => ({})), {
      tournament,
      adjudicator: chair,
      debate,
      teams,
      tournamentId: tournament.id,
      round: { stage: "preliminary" },
    });
    expect(ballot.teamScores.P1).toMatchObject({ points: 0, totalSpeakerScore: 70 });
    expect(ballot.teamScores.P1.rank).toBeUndefined();
  });

  it("refuses voting rounds without margins including dissenters", () => {
    const tournament = tournamentWith({ ballotMode: "voting", marginIncludesDissenters: false });
    expect(() =>
      buildPrivateBallot(input([70, 75, 80], () => ({})), {
        tournament,
        adjudicator: chair,
        debate,
        teams,
        tournamentId: tournament.id,
        round: { stage: "preliminary" },
      })
    ).toThrow(/margins include dissenters/);
  });

  it("records the advancing teams of a results-only ballot, one in the last round", () => {
    const tournament = tournamentWith({ ballotMode: "consensus", speakersInBallots: "never" });
    const context = { tournament, adjudicator: chair, debate, teams, tournamentId: tournament.id };
    const ballot = buildPrivateBallot(input([0, 0, 0], (index) => ({ win: index !== 1 })), { ...context, round: { stage: "elimination", seq: 2 } });
    expect(ballot.noSpeakerScores).toBe(true);
    expect(SIDES.filter((side) => ballot.teamScores[side].win)).toEqual(["P1", "P3"]);
    expect(() =>
      buildPrivateBallot(input([0, 0, 0], (index) => ({ win: index !== 1 })), {
        ...context,
        round: { stage: "elimination", seq: 2 },
        rounds: [{ seq: 1 }, { seq: 2 }],
      })
    ).toThrow(/Choose the team that advances/);
  });
});

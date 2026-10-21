import { describe, expect, it } from "vitest";
import type { Debate, DebateSide, Round, SpeakerScoreEntry } from "@/types";
import { makeRound, makeTeams, makeTournament } from "@/test/tournamentFixtures";
import { buildApiBallot } from "./ballotInput";

const tournament = makeTournament("poly", {
  teamsInDebate: 6, // Tabbycat Public Speaking
  substantiveSpeakers: 1,
  replyScoresEnabled: false,
  minSpeakerScore: 50,
  maxSpeakerScore: 99,
  stepSpeakerScore: 1,
  ballotMode: "consensus",
  speakersInBallots: "prelim",
});
const teams = makeTeams(3, { tournamentId: tournament.id, speakersPerTeam: 1 });
const rounds: Round[] = [
  makeRound(tournament.id, 1, { drawType: "random" }),
  makeRound(tournament.id, 2, { stage: "elimination", drawType: "manual" }),
  makeRound(tournament.id, 3, { stage: "elimination", drawType: "manual" }),
];
// A short room: three of the format's six positions.
const debate = (round: Round): Debate => ({
  id: `d-${round.seq}`,
  tournamentId: tournament.id,
  roundId: round.id,
  roundSeq: round.seq,
  bracket: 0,
  roomRank: 1,
  importance: 0,
  resultStatus: "none",
  sidesConfirmed: true,
  flags: [],
  teams: Object.fromEntries(teams.map((team, index) => [`P${index + 1}`, { teamId: team.id, teamName: team.name, side: `P${index + 1}` }])) as Debate["teams"],
  adjudicators: { chairId: "adj", panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
});
const context = (round: Round) => ({
  tournament,
  round,
  debate: debate(round),
  teams,
  motions: [],
  rounds,
  existingBallots: [],
  submitter: { id: "api", name: "API" },
  now: new Date("2026-10-01T00:00:00Z"),
  createId: (prefix: string) => prefix,
});

describe("API ballots for N teams per room", () => {
  it("ranks a scored ballot on the room's own teams", () => {
    const speakerScores = Object.fromEntries(
      teams.map((team, index) => [`P${index + 1}`, [{ speakerId: team.speakers[0].id, speakerName: "", position: 1, score: 70 + index }]])
    ) as Record<DebateSide, SpeakerScoreEntry[]>;
    const ballot = buildApiBallot({ entry: { speakerScores }, confirmed: true }, context(rounds[0]));
    expect(Object.keys(ballot.teamScores).sort()).toEqual(["P1", "P2", "P3"]);
    expect(ballot.teamScores.P3).toMatchObject({ rank: 1, points: 2, win: false });
  });

  it("takes the advancing teams of a results-only elimination ballot, one in the last round", () => {
    const semi = buildApiBallot({ entry: { speakerScores: {}, winners: ["P1", "P3"] }, confirmed: true }, context(rounds[1]));
    expect(semi.noSpeakerScores).toBe(true);
    expect(["P1", "P2", "P3"].filter((side) => semi.teamScores[side as "P1"].win)).toEqual(["P1", "P3"]);
    expect(() => buildApiBallot({ entry: { speakerScores: {}, winners: ["P1", "P3"] }, confirmed: true }, context(rounds[2]))).toThrow(
      /not valid/
    );
  });
});

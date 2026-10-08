import { describe, expect, it } from "vitest";
import { Adjudicator, Debate, Team, Tournament } from "@/types";
import { buildPrivateBallot } from "@/lib/privateBallot";

const tournament: Tournament = {
  id: "t1",
  name: "Tournament",
  shortName: "Tournament",
  slug: "tournament",
  format: "bp",
  active: true,
  ownerId: "owner",
  admins: {},
  preferences: {
    teamsInDebate: 4,
    substantiveSpeakers: 1,
    replyScoresEnabled: false,
    minSpeakerScore: 68,
    maxSpeakerScore: 84,
    stepSpeakerScore: 1,
    minReplyScore: 34,
    maxReplyScore: 42,
    drawRule: "random",
    sideAllocationRule: "balanced",
    ballotDoubleEntry: false,
    publicDraw: true,
    publicResults: true,
    publicStandings: true,
    publicMotions: true,
    feedbackEnabled: true,
    feedbackMinScore: 1,
    feedbackMaxScore: 10,
  },
  createdAt: "",
  updatedAt: "",
};

const debate: Debate = {
  id: "d1",
  tournamentId: "t1",
  roundId: "r1",
  roundSeq: 1,
  bracket: 0,
  roomRank: 0,
  importance: 0,
  resultStatus: "none",
  sidesConfirmed: true,
  flags: [],
  teams: Object.fromEntries(
    ["OG", "OO", "CG", "CO"].map((side) => [
      side,
      { side, teamId: `team-${side}`, teamName: side },
    ])
  ) as Debate["teams"],
  adjudicators: {
    chairId: "chair",
    panellistIds: ["panel"],
    panellistNames: [],
    traineeIds: ["trainee"],
    traineeNames: [],
  },
};

const teams = new Map(
  ["OG", "OO", "CG", "CO"].map((side) => [
    `team-${side}`,
    {
      id: `team-${side}`,
      tournamentId: "t1",
      name: side,
      speakers: [{ id: `speaker-${side}`, name: `${side} Speaker` }],
      breakCategories: [],
      speakerCategories: [],
    } satisfies Team,
  ])
);

function ballotInput() {
  return {
    id: "ballot-d1-adj-123",
    submitterType: "judge",
    submitterId: "chair",
    confirmed: false,
    discarded: true,
    roundId: "forged-round",
    speakerScores: Object.fromEntries(
      ["OG", "OO", "CG", "CO"].map((side) => [
        side,
        [{ speakerId: `speaker-${side}`, speakerName: "Forged name", position: 1, score: 75 }],
      ])
    ),
    teamScores: Object.fromEntries(
      ["OG", "OO", "CG", "CO"].map((side, index) => [
        side,
        { side: "OG", teamId: "forged-team", rank: index + 1, points: 999, totalSpeakerScore: 999 },
      ])
    ),
  };
}

const chair: Adjudicator = {
  id: "chair",
  tournamentId: "t1",
  name: "Chair",
  baseScore: 5,
  trainee: false,
  independent: true,
  conflicts: [],
};

describe("buildPrivateBallot", () => {
  it("rebuilds trusted ballot fields and derived scores from the debate roster", () => {
    const result = buildPrivateBallot(ballotInput(), {
      tournament,
      adjudicator: chair,
      debate,
      teams,
      tournamentId: "t1",
    });

    expect(result).toMatchObject({
      tournamentId: "t1",
      roundId: "r1",
      debateId: "d1",
      confirmed: true,
      discarded: false,
      submitterName: "Chair",
      speakerScores: { OG: [{ speakerId: "speaker-OG", speakerName: "OG Speaker", score: 75 }] },
      teamScores: { OG: { teamId: "team-OG", points: 3, totalSpeakerScore: 75, rank: 1 } },
    });
  });

  it("rejects a trainee or other non-voting adjudicator", () => {
    expect(() =>
      buildPrivateBallot(ballotInput(), {
        tournament,
        adjudicator: { ...chair, id: "trainee", trainee: true },
        debate,
        teams,
        tournamentId: "t1",
      })
    ).toThrow("Only the chair or a voting panellist may submit a ballot.");
  });

  it("rejects forged speakers, invalid scores, and duplicate ranks", () => {
    const forgedSpeaker = ballotInput();
    (forgedSpeaker.speakerScores.OG[0] as { speakerId: string }).speakerId = "forged";
    expect(() =>
      buildPrivateBallot(forgedSpeaker, {
        tournament,
        adjudicator: chair,
        debate,
        teams,
        tournamentId: "t1",
      })
    ).toThrow("A speaker score is invalid or does not match the debate roster.");

    const duplicateRanks = ballotInput();
    duplicateRanks.teamScores.OO.rank = 1;
    expect(() =>
      buildPrivateBallot(duplicateRanks, {
        tournament,
        adjudicator: chair,
        debate,
        teams,
        tournamentId: "t1",
      })
    ).toThrow("The ballot rankings must be unique.");
  });
});

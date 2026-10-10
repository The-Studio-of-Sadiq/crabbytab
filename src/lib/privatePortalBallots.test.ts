import { describe, expect, it } from "vitest";
import type { BallotSubmission, Debate, Round } from "@/types";
import { getPrivatePortalBallots, sanitizeTeamPrivateDebate } from "./privatePortalBallots";

const round: Round = {
  id: "round-1",
  tournamentId: "tournament-1",
  seq: 1,
  name: "Round 1",
  abbreviation: "R1",
  stage: "preliminary",
  drawType: "random",
  drawStatus: "confirmed",
  feedbackWeight: 1,
  silent: false,
  motionsReleased: false,
  resultsReleased: true,
  teamSpeaksReleased: false,
  completed: true,
  createdAt: "",
};

const ballot = {
  id: "ballot-1",
  tournamentId: "tournament-1",
  roundId: "round-1",
  debateId: "debate-1",
  version: 1,
  confirmed: true,
  discarded: false,
  submitterType: "judge",
  submitterId: "judge-1",
  submitterName: "Judge",
  speakerScores: { OG: [{ speakerId: "speaker-1", speakerName: "Speaker", position: 1, score: 75 }] },
  teamScores: {
    OG: { side: "OG", teamId: "team-1", points: 3, totalSpeakerScore: 75, rank: 1 },
  },
  timestamp: "",
} as BallotSubmission;

describe("getPrivatePortalBallots", () => {
  it("hides unreleased, silent, draft, and discarded ballots from teams", () => {
    expect(getPrivatePortalBallots([ballot], [{ ...round, resultsReleased: false }], "team")).toEqual([]);
    expect(getPrivatePortalBallots([ballot], [{ ...round, silent: true }], "team")).toEqual([]);
    expect(getPrivatePortalBallots([{ ...ballot, confirmed: false }], [round], "team")).toEqual([]);
    expect(getPrivatePortalBallots([{ ...ballot, discarded: true }], [round], "team")).toEqual([]);
    expect(getPrivatePortalBallots([ballot], [round], "team", false)).toEqual([]);
  });

  it("withholds speaker scores and judge identity until team speaks are released", () => {
    const [visible] = getPrivatePortalBallots([ballot], [round], "team");

    expect(visible.speakerScores).toEqual({});
    expect(visible.teamScores).toEqual({
      OG: { side: "OG", teamId: "team-1", points: 3, rank: 1 },
    });
    expect(visible).not.toHaveProperty("submitterId");
    expect(visible).not.toHaveProperty("submitterName");
  });

  it("includes scores only after team speaks are released", () => {
    const [visible] = getPrivatePortalBallots(
      [ballot],
      [{ ...round, teamSpeaksReleased: true }],
      "team"
    );

    expect(visible.speakerScores).toEqual(ballot.speakerScores);
    expect(visible.teamScores).toEqual(ballot.teamScores);
  });

  it("retains the full assigned ballot history for adjudicators", () => {
    expect(getPrivatePortalBallots([ballot], [], "adjudicator")).toEqual([{ ...ballot }]);
  });

  it("withholds private debate result fields until results are released", () => {
    const debate = {
      id: "debate-1",
      tournamentId: "tournament-1",
      roundId: "round-1",
      roundSeq: 1,
      bracket: 0,
      roomRank: 0,
      importance: 0,
      resultStatus: "confirmed",
      sidesConfirmed: true,
      flags: [],
      teams: {
        OG: { teamId: "team-1", teamName: "Team", side: "OG", points: 3, speakerScoreTotal: 75 },
      },
      adjudicators: {
        panellistIds: [],
        panellistNames: [],
        traineeIds: [],
        traineeNames: [],
      },
    } as unknown as Debate;

    expect(sanitizeTeamPrivateDebate(debate, { ...round, resultsReleased: false })).toMatchObject({
      resultStatus: "none",
      teams: { OG: { teamId: "team-1" } },
    });
    expect(
      sanitizeTeamPrivateDebate(debate, round, false).teams.OG?.points
    ).toBeUndefined();
    expect(
      sanitizeTeamPrivateDebate(debate, round).teams.OG?.speakerScoreTotal
    ).toBeUndefined();
  });
});

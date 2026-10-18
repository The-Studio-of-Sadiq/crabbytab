import { describe, expect, it } from "vitest";
import type { BallotSubmission, Debate, Round } from "@/types";
import {
  filterTeamVisibleDebates,
  getPrivatePortalBallots,
  isDrawVisibleToTeams,
  sanitizeTeamPrivateDebate,
} from "./privatePortalBallots";

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

describe("team draw and panel visibility", () => {
  const panel = {
    chairId: "judge-1",
    chairName: "Chair",
    panellistIds: ["judge-2"],
    panellistNames: ["Wing"],
    traineeIds: [],
    traineeNames: [],
  };
  const debate = {
    id: "debate-1",
    tournamentId: "tournament-1",
    roundId: "round-1",
    roundSeq: 1,
    bracket: 0,
    roomRank: 0,
    importance: 0,
    resultStatus: "none",
    sidesConfirmed: true,
    flags: [],
    teams: { OG: { teamId: "team-1", teamName: "Team", side: "OG" } },
    adjudicators: panel,
    motionId: "motion-1",
    motionText: "This House would test",
  } as unknown as Debate;

  it("only shows confirmed or released, non-cancelled draws", () => {
    expect(isDrawVisibleToTeams(undefined)).toBe(false);
    expect(isDrawVisibleToTeams({ ...round, drawStatus: "none" })).toBe(false);
    expect(isDrawVisibleToTeams({ ...round, drawStatus: "draft" })).toBe(false);
    expect(isDrawVisibleToTeams({ ...round, drawStatus: "confirmed", cancelled: true })).toBe(false);
    expect(isDrawVisibleToTeams({ ...round, drawStatus: "confirmed" })).toBe(true);
    expect(isDrawVisibleToTeams({ ...round, drawStatus: "released" })).toBe(true);
  });

  it("drops debates whose draw is unpublished", () => {
    const rounds = new Map([
      ["round-1", { ...round, drawStatus: "draft" as const }],
      ["round-2", { ...round, id: "round-2", drawStatus: "released" as const }],
    ]);
    const visible = filterTeamVisibleDebates(
      [debate, { ...debate, id: "debate-2", roundId: "round-2" }, { ...debate, id: "debate-3", roundId: "missing" }],
      rounds
    );
    expect(visible.map((item) => item.id)).toEqual(["debate-2"]);
  });

  it("hides the panel until adjudicators are revealed", () => {
    const hidden = sanitizeTeamPrivateDebate(debate, { ...round, adjudicatorsRevealed: false });
    expect(hidden.adjudicators).toEqual({ panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] });
    const revealed = sanitizeTeamPrivateDebate(debate, { ...round, adjudicatorsRevealed: true });
    expect(revealed.adjudicators).toEqual(panel);
    const draftRevealed = sanitizeTeamPrivateDebate(debate, { ...round, drawStatus: "draft", adjudicatorsRevealed: true });
    expect(draftRevealed.adjudicators.chairId).toBeUndefined();
  });

  it("hides the motion until motions are released", () => {
    const hidden = sanitizeTeamPrivateDebate(debate, { ...round, motionsReleased: false });
    expect(hidden).not.toHaveProperty("motionText");
    expect(hidden).not.toHaveProperty("motionId");
    const shown = sanitizeTeamPrivateDebate(debate, { ...round, motionsReleased: true });
    expect(shown.motionText).toBe("This House would test");
  });
});

import { describe, expect, it } from "vitest";
import type { BallotSubmission, Debate, Round } from "@/types";
import {
  filterParticipantVisibleDebates,
  filterTeamVisibleDebates,
  getPrivatePortalBallots,
  isDrawVisibleToAdjudicators,
  isDrawVisibleToTeams,
  sanitizeTeamPrivateDebate,
  withoutUnreleasedMotion,
  createPortalNamer,
  renamePortalBallot,
  renamePortalDebate,
  renamePortalTeam,
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

  it("shows a teams-only release to teams but not to adjudicators; never a locked draw", () => {
    expect(isDrawVisibleToTeams({ ...round, drawStatus: "teams_released" })).toBe(true);
    expect(isDrawVisibleToAdjudicators({ ...round, drawStatus: "teams_released" })).toBe(false);
    expect(isDrawVisibleToTeams({ ...round, drawStatus: "locked" })).toBe(false);
    expect(isDrawVisibleToAdjudicators({ ...round, drawStatus: "locked" })).toBe(false);
    expect(isDrawVisibleToAdjudicators({ ...round, drawStatus: "confirmed" })).toBe(true);
    const rounds = new Map([["round-1", { ...round, drawStatus: "teams_released" as const }]]);
    expect(filterParticipantVisibleDebates([debate], rounds, "team")).toHaveLength(1);
    expect(filterParticipantVisibleDebates([debate], rounds, "adjudicator")).toHaveLength(0);
  });

  it("never shows the panel in a teams-only release, even when adjudicators are revealed", () => {
    const teamsOnly = sanitizeTeamPrivateDebate(debate, { ...round, drawStatus: "teams_released", adjudicatorsRevealed: true });
    expect(teamsOnly.adjudicators.chairId).toBeUndefined();
    expect(teamsOnly.teams.OG?.teamId).toBe("team-1");
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

describe("portal code names", () => {
  const teams = [
    { id: "own", name: "Own Real", codeName: "Owl", speakers: [{ id: "s-own", name: "Own Speaker", codeName: "OS" }] },
    { id: "opp", name: "Opp Real", codeName: "Fox", speakers: [{ id: "s-opp", name: "Opp Speaker", codeName: "XS" }] },
    { id: "bare", name: "Bare Real", speakers: [] },
  ];
  const adjudicators = [
    { id: "adj-1", name: "Chair Real", codeName: "Judge C" },
    { id: "adj-2", name: "Wing Real", codeName: "Judge W" },
  ];
  const debate = {
    id: "debate-1",
    tournamentId: "tournament-1",
    roundId: "round-1",
    roundSeq: 1,
    teams: {
      AFF: { side: "AFF", teamId: "own", teamName: "Own Real" },
      NEG: { side: "NEG", teamId: "opp", teamName: "Opp Real" },
    },
    adjudicators: { chairId: "adj-1", chairName: "Chair Real", panellistIds: ["adj-2"], panellistNames: ["Wing Real"], traineeIds: [], traineeNames: [] },
  } as unknown as Debate;

  it("changes nothing when code names are off or real names with tooltips", () => {
    for (const teamCodeNames of [undefined, "off", "all-tooltips"] as const) {
      const namer = createPortalNamer({
        preferences: { teamCodeNames } as never,
        viewer: { type: "team", id: "own" },
        teams,
        adjudicators,
      });
      expect(namer.active).toBe(false);
      expect(renamePortalDebate(debate, namer)).toBe(debate);
    }
  });

  it("shows other teams under code names on a team portal, keeping the team's own name", () => {
    const namer = createPortalNamer({ preferences: { teamCodeNames: "everywhere" } as never, viewer: { type: "team", id: "own" }, teams, adjudicators });
    const renamed = renamePortalDebate(debate, namer);
    expect(renamed.teams.AFF?.teamName).toBe("Own Real");
    expect(renamed.teams.NEG?.teamName).toBe("Fox");
    expect(renamePortalTeam({ id: "bare", name: "Bare Real", speakers: [] }, namer).name).toBe("");
    // Speakers and adjudicators keep real names without participant code names.
    expect(renamed.adjudicators.chairName).toBe("Chair Real");
  });

  it("uses code names for every team on an adjudicator portal (admin-tooltips modes too)", () => {
    for (const teamCodeNames of ["admin-tooltips-code", "admin-tooltips-real", "everywhere"] as const) {
      const namer = createPortalNamer({ preferences: { teamCodeNames } as never, viewer: { type: "adjudicator", id: "adj-1" }, teams });
      const renamed = renamePortalDebate(debate, namer);
      expect([renamed.teams.AFF?.teamName, renamed.teams.NEG?.teamName]).toEqual(["Owl", "Fox"]);
    }
  });

  it("applies participant code names to other speakers and adjudicators", () => {
    const teamView = createPortalNamer({ preferences: { participantCodeNames: "everywhere" } as never, viewer: { type: "team", id: "own" }, teams, adjudicators });
    const renamed = renamePortalDebate(debate, teamView);
    expect(renamed.adjudicators.chairName).toBe("Judge C");
    expect(renamed.adjudicators.panellistNames).toEqual(["Judge W"]);
    expect(renamePortalTeam({ id: "opp", name: "Opp Real", speakers: [{ id: "s-opp", name: "Opp Speaker" }] }, teamView).speakers[0].name).toBe("XS");
    expect(renamePortalTeam({ id: "own", name: "Own Real", speakers: [{ id: "s-own", name: "Own Speaker" }] }, teamView).speakers[0].name).toBe("Own Speaker");
    const ballotView = renamePortalBallot({
      speakerScores: { NEG: [{ speakerId: "s-opp", speakerName: "Opp Speaker", position: 1, score: 75 }] },
      sheets: [{ adjudicatorId: "adj-2", adjudicatorName: "Wing Real", speakerScores: {} }],
    }, teamView);
    expect(JSON.stringify(ballotView)).not.toContain("Opp Speaker");
    expect(JSON.stringify(ballotView)).not.toContain("Wing Real");

    // The adjudicator keeps their own name and the speakers' real names (ballot entry is by speaker).
    const adjudicatorView = createPortalNamer({ preferences: { participantCodeNames: "everywhere" } as never, viewer: { type: "adjudicator", id: "adj-1" }, teams, adjudicators });
    const adjRenamed = renamePortalDebate(debate, adjudicatorView);
    expect(adjRenamed.adjudicators.chairName).toBe("Chair Real");
    expect(adjRenamed.adjudicators.panellistNames).toEqual(["Judge W"]);
    expect(adjudicatorView.speaker("s-opp", "Opp Speaker")).toBe("Opp Speaker");
  });
});

describe("withoutUnreleasedMotion", () => {
  const debate = { id: "d1", roundId: "r1", motionId: "m1", motionText: "THW test" } as unknown as Debate;
  it("hides the motion until the round's motions are released", () => {
    const hidden = withoutUnreleasedMotion(debate, { id: "r1", motionsStatus: "not_released" } as unknown as Round);
    expect(hidden).not.toHaveProperty("motionId");
    expect(hidden).not.toHaveProperty("motionText");
    const shown = withoutUnreleasedMotion(debate, { id: "r1", motionsStatus: "motions_released" } as unknown as Round);
    expect(shown.motionText).toBe("THW test");
  });
});

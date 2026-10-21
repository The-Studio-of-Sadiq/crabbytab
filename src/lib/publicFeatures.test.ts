import { describe, expect, it } from "vitest";
import {
  currentDrawRoundId,
  getPublicSiteSettings,
  isRoundDrawPublic,
  orderPublicMotions,
  robotsForPublicPage,
} from "@/lib/publicFeatures";
import { assignTeamEmoji, generateTeamCodeNames, hasCodeName, lastNamesCodeName, tabroomTeamName, TEAM_EMOJI } from "@/lib/codeNames";
import { createSeededRng } from "@/lib/draw/rng";
import { bracketRounds } from "@/lib/publicBracket";
import { adjudicatorRecord, publicRecordPath, teamRecord } from "@/lib/publicRecords";
import { getPrivatePortalBallots } from "@/lib/privatePortalBallots";
import type { BallotSubmission, Debate, Round, Team } from "@/types";

describe("getPublicSiteSettings", () => {
  it("defaults to Tabbycat's defaults, keeping existing tournaments' draws public", () => {
    const settings = getPublicSiteSettings(undefined);
    expect(settings).toMatchObject({
      drawMode: "all",
      recordPages: true,
      adjudicatorTab: false,
      adjudicatorTabShows: "final",
      ballots: false,
      privateBallots: false,
      teamTabLimit: 0,
      breakMetrics: -1,
      showTeamInstitutions: true,
      showEmoji: true,
      showSpeakersInDraw: true,
      showSplittingAdjudicators: false,
      teamCodeNames: "off",
      searchEngineIndexing: "all",
      motionsOrder: "forward",
      ballotForm: false,
      feedbackForm: false,
    });
    expect(getPublicSiteSettings({ publicDraw: false }).drawMode).toBe("off");
    expect(getPublicSiteSettings({ publicDraw: false, publicDrawMode: "current" }).drawMode).toBe("current");
  });

  it("ignores invalid values", () => {
    const settings = getPublicSiteSettings({
      publicDrawMode: "sometimes" as never,
      teamTabLimit: -3,
      speakerTabLimit: 2.7,
      publicBreakMetrics: -5,
      welcomeMessage: `  ${"x".repeat(6000)}`,
    });
    expect(settings.drawMode).toBe("all");
    expect(settings.teamTabLimit).toBe(0);
    expect(settings.speakerTabLimit).toBe(2);
    expect(settings.breakMetrics).toBe(-1);
    expect(settings.welcomeMessage).toHaveLength(5000);
  });

  it("releases the motion tab with the motions page unless set on its own", () => {
    expect(getPublicSiteSettings({})).toMatchObject({ motionsPage: true, motionTab: true, motionsInResults: false });
    expect(getPublicSiteSettings({ publicMotions: false })).toMatchObject({ motionsPage: false, motionTab: false });
    expect(getPublicSiteSettings({ publicMotions: false, motionTabReleased: true }).motionTab).toBe(true);
    expect(getPublicSiteSettings({ motionTabReleased: false })).toMatchObject({ motionsPage: true, motionTab: false });
    expect(getPublicSiteSettings({ showMotionsInResults: true }).motionsInResults).toBe(true);
  });

  it("needs motion vetoes enabled for veto statistics", () => {
    expect(getPublicSiteSettings({ publicVetoStatistics: true }).vetoStatistics).toBe(false);
    expect(getPublicSiteSettings({ publicVetoStatistics: true, enableMotionVetoes: true }).vetoStatistics).toBe(true);
  });
});

describe("draw mode", () => {
  const rounds = [
    { id: "r1", seq: 1, drawStatus: "released" as const },
    { id: "r2", seq: 2, drawStatus: "confirmed" as const },
    { id: "r3", seq: 3, drawStatus: "draft" as const },
    { id: "r4", seq: 4, drawStatus: "released" as const, cancelled: true },
  ];

  it("takes the latest published, non-cancelled draw as the current round", () => {
    expect(currentDrawRoundId(rounds)).toBe("r2");
    expect(currentDrawRoundId([])).toBeUndefined();
  });

  it("decides which draws are public", () => {
    expect(rounds.map((round) => isRoundDrawPublic(round, "all", "r2"))).toEqual([true, true, false, false]);
    expect(rounds.map((round) => isRoundDrawPublic(round, "current", "r2"))).toEqual([false, true, false, false]);
    expect(rounds.map((round) => isRoundDrawPublic(round, "off", "r2"))).toEqual([false, false, false, false]);
  });
});

describe("robots and motions order", () => {
  it("indexes per the search-engine setting", () => {
    expect(robotsForPublicPage("all", false).index).toBe(true);
    expect(robotsForPublicPage("homepage-only", true).index).toBe(true);
    expect(robotsForPublicPage("homepage-only", false).index).toBe(false);
    expect(robotsForPublicPage("none", true).index).toBe(false);
  });

  it("orders motions by round, unassigned last, stable within a round", () => {
    const seqs = new Map([["r1", 1], ["r2", 2]]);
    const motions = [
      { id: "b", seq: 2, rounds: ["r1"] },
      { id: "c", seq: 1, rounds: ["r2"] },
      { id: "a", seq: 1, rounds: ["r1"] },
      { id: "z", seq: 0, rounds: [] },
    ];
    expect(orderPublicMotions(motions, "forward", seqs).map((motion) => motion.id)).toEqual(["a", "b", "c", "z"]);
    expect(orderPublicMotions(motions, "reverse", seqs).map((motion) => motion.id)).toEqual(["c", "a", "b", "z"]);
  });
});

const team = (id: string, extra: Partial<Team> = {}): Team => ({
  id,
  tournamentId: "t1",
  name: `Team ${id}`,
  speakers: [{ id: `${id}-1`, name: `Ann Jones${id}` }, { id: `${id}-2`, name: `Bo Smith${id}` }],
  breakCategories: [],
  speakerCategories: [],
  ...extra,
});

describe("code-name generators", () => {
  it("treats a code name equal to the team name as none", () => {
    expect(hasCodeName({ name: "A", codeName: "A" })).toBe(false);
    expect(hasCodeName({ name: "A", codeName: "Fox" })).toBe(true);
  });

  it("assigns unused emoji to teams without one, reproducibly", () => {
    const teams = [team("1", { emoji: TEAM_EMOJI[0][0] }), team("2"), team("3")];
    const first = assignTeamEmoji(teams, createSeededRng(7));
    expect(first.map((item) => item.id)).toEqual(["2", "3"]);
    expect(new Set(first.map((item) => item.emoji)).size).toBe(2);
    expect(first.map((item) => item.emoji)).not.toContain(TEAM_EMOJI[0][0]);
    expect(assignTeamEmoji(teams, createSeededRng(7))).toEqual(first);
  });

  it("generates unique code names only for teams without one", () => {
    const teams = [team("1", { codeName: "Kept" }), team("2", { emoji: "🦊" }), team("3", { emoji: "🦊" }), team("4", { codeName: "Team 4" })];
    const generated = generateTeamCodeNames(teams, "emoji", createSeededRng(1));
    expect(generated.map((item) => [item.id, item.codeName])).toEqual([["2", "Fox"], ["3", "Fox 2"], ["4", expect.any(String)]]);
    expect(generated.find((item) => item.id === "4")?.emoji).toBeTruthy();
    expect(lastNamesCodeName(team("x"))).toBe("Jonesx & Smithx");
    expect(generateTeamCodeNames([team("5")], "last_names", createSeededRng(1))[0].codeName).toBe("Jones5 & Smith5");
  });
});

const round = (id: string, seq: number, extra: Partial<Round> = {}): Round => ({
  id,
  tournamentId: "t1",
  seq,
  name: `R${seq}`,
  abbreviation: `R${seq}`,
  stage: "preliminary",
  drawType: "power_paired",
  drawStatus: "released",
  feedbackWeight: 0.5,
  silent: false,
  motionsReleased: false,
  resultsReleased: true,
  completed: true,
  createdAt: "",
  adjudicatorsRevealed: true,
  ...extra,
});

const debate = (id: string, roundId: string, aff: string, neg: string, extra: Partial<Debate> = {}): Debate => ({
  id,
  tournamentId: "t1",
  roundId,
  roundSeq: 1,
  bracket: 0,
  roomRank: 1,
  importance: 0,
  teams: {
    AFF: { teamId: aff, teamName: `Team ${aff}`, side: "AFF", speakerScoreTotal: 220 },
    NEG: { teamId: neg, teamName: `Team ${neg}`, side: "NEG" },
  },
  adjudicators: { chairId: "adj", chairName: "Adj", panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
  ...extra,
} as Debate);

const ballot = (id: string, debateId: string, roundId: string, affWins: boolean, extra: Partial<BallotSubmission> = {}): BallotSubmission => ({
  id,
  tournamentId: "t1",
  roundId,
  debateId,
  version: 1,
  confirmed: true,
  discarded: false,
  submitterType: "tabroom",
  speakerScores: { AFF: [{ speakerId: "s1", speakerName: "S", position: 1, score: 75 }] } as BallotSubmission["speakerScores"],
  teamScores: {
    AFF: { side: "AFF", teamId: "a", points: affWins ? 1 : 0, win: affWins, totalSpeakerScore: 220 },
    NEG: { side: "NEG", teamId: "b", points: affWins ? 0 : 1, win: !affWins, totalSpeakerScore: 210 },
  } as BallotSubmission["teamScores"],
  timestamp: "",
  ...extra,
});

describe("public bracket", () => {
  it("lists public elimination rounds with seeds and who advanced", () => {
    const rounds = [
      round("p1", 1),
      round("sf", 2, { stage: "elimination" }),
      round("gf", 3, { stage: "elimination", drawStatus: "draft" }),
    ];
    const debates = [
      debate("sf2", "sf", "c", "d", { roomRank: 2, teams: { AFF: { teamId: "c", teamName: "C", side: "AFF", bracketPosition: 2 }, NEG: { teamId: "d", teamName: "D", side: "NEG", bracketPosition: 3 } } } as Partial<Debate>),
      debate("sf1", "sf", "a", "b", { teams: { AFF: { teamId: "a", teamName: "A", side: "AFF", bracketPosition: 1 }, NEG: { teamId: "b", teamName: "B", side: "NEG", bracketPosition: 4 } } } as Partial<Debate>),
      debate("p", "p1", "a", "b"),
    ];
    const columns = bracketRounds(rounds, debates, [ballot("x", "sf1", "sf", false)], new Map(), false);
    expect(columns.map((column) => column.id)).toEqual(["sf"]);
    expect(columns[0].matches.map((match) => match.debateId)).toEqual(["sf1", "sf2"]);
    expect(columns[0].matches[0].teams.map((item) => [item.name, item.seed, item.advanced])).toEqual([["A", 1, false], ["B", 4, true]]);
    expect(columns[0].matches[1].teams.every((item) => !item.advanced)).toBe(true);
  });

  it("respects the projection's draw-page flag", () => {
    const rounds = [{ ...round("sf", 2, { stage: "elimination" }), drawPublic: false } as Round];
    expect(bracketRounds(rounds, [debate("sf1", "sf", "a", "b")], [], new Map(), false)).toEqual([]);
  });
});

describe("public records", () => {
  const rounds = [round("r1", 1, { teamSpeaksReleased: true }), round("r2", 2, { resultsReleased: false, adjudicatorsRevealed: false })];
  const debates = [debate("d1", "r1", "a", "b"), debate("d2", "r2", "c", "a")];
  const ballots = [ballot("b1", "d1", "r1", true), ballot("b2", "d2", "r2", true)];

  it("lists a team's debates with results only where they are public", () => {
    const rows = teamRecord("a", rounds, debates, ballots);
    expect(rows.map((row) => [row.roundId, row.side, row.opponents[0].teamId])).toEqual([["r1", "AFF", "b"], ["r2", "NEG", "c"]]);
    expect(rows[0].result).toEqual({ win: true, points: 1 });
    expect(rows[0].speakerScoreTotal).toBe(220);
    expect(rows[1]).not.toHaveProperty("result");
  });

  it("lists an adjudicator's revealed panels only", () => {
    expect(adjudicatorRecord("adj", rounds, debates).map((row) => [row.roundId, row.role])).toEqual([["r1", "chair"]]);
    expect(publicRecordPath("my-open", "team", "a/b")).toBe("/my-open/public/team/a%2Fb");
  });
});

describe("private scoresheets", () => {
  const rounds = [round("r1", 1, { teamSpeaksReleased: false })];
  const sheets = [{ adjudicatorId: "adj", adjudicatorName: "Adj", speakerScores: {} as BallotSubmission["speakerScores"] }];

  it("gives a team its own scoresheets only once released", () => {
    const ballots = [ballot("b1", "d1", "r1", true, { sheets })];
    const hidden = getPrivatePortalBallots(ballots, rounds, "team");
    expect(hidden[0]).not.toHaveProperty("sheets");
    expect(hidden[0].speakerScores).toEqual({});
    const shown = getPrivatePortalBallots(ballots, rounds, "team", true, true);
    expect(shown[0].sheets).toEqual(sheets);
    expect(shown[0].speakerScores).not.toEqual({});
  });

  it("still needs the round's results and panel", () => {
    const ballots = [ballot("b1", "d1", "r1", true, { sheets })];
    expect(getPrivatePortalBallots(ballots, [round("r1", 1, { resultsReleased: false })], "team", true, true)).toEqual([]);
    expect(getPrivatePortalBallots(ballots, [round("r1", 1, { adjudicatorsRevealed: false })], "team", true, true)[0]).not.toHaveProperty("sheets");
  });
});

describe("tab-room team names under team code names", () => {
  const team = { name: "Alpha Real", codeName: "Fox" };
  it("shows real names with code-name tooltips in all-tooltips and admin-tooltips-code", () => {
    for (const mode of ["all-tooltips", "admin-tooltips-code"] as const) {
      expect(tabroomTeamName(team, "Alpha Real", mode)).toEqual({ name: "Alpha Real", tooltip: { kind: "code", name: "Fox" } });
    }
  });
  it("shows code names with real-name tooltips in admin-tooltips-real", () => {
    expect(tabroomTeamName(team, "Alpha Real", "admin-tooltips-real")).toEqual({ name: "Fox", tooltip: { kind: "real", name: "Alpha Real" } });
  });
  it("shows the real name alone when off, everywhere, or without a code name", () => {
    expect(tabroomTeamName(team, undefined, "off")).toEqual({ name: "Alpha Real" });
    expect(tabroomTeamName(team, undefined, "everywhere")).toEqual({ name: "Alpha Real" });
    expect(tabroomTeamName({ name: "Beta", codeName: "Beta" }, undefined, "admin-tooltips-real")).toEqual({ name: "Beta" });
    expect(tabroomTeamName(undefined, "Stored", "admin-tooltips-real")).toEqual({ name: "Stored" });
  });
});

import { describe, expect, it } from "vitest";

import type { BreakCategory, Round, Team, TeamStandingRow, Tournament } from "@/types";
import { calculateBreaks } from "@/lib/breakqual/calculator";
import { createRoundRecord } from "./rounds";
import {
  generateBreakCommand,
  proceedToNextEliminationRoundCommand,
  saveBreakCategoriesCommand,
  type BreakDependencies,
} from "./breaks";

const tournament: Tournament = {
  id: "tournament-1",
  name: "Test Tournament",
  shortName: "Test",
  slug: "test",
  format: "bp",
  active: true,
  ownerId: "local",
  admins: {},
  preferences: {
    teamsInDebate: 4,
    substantiveSpeakers: 2,
    replyScoresEnabled: false,
    minSpeakerScore: 50,
    maxSpeakerScore: 90,
    stepSpeakerScore: 1,
    minReplyScore: 30,
    maxReplyScore: 45,
    drawRule: "power_paired",
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

function makeDependencies(overrides: Partial<BreakDependencies> = {}) {
  const calls: string[] = [];
  const dependencies: BreakDependencies = {
    tournament,
    rounds: [],
    teams: [],
    breakCategories: [],
    breakResults: [],
    debates: [],
    ballots: [],
    localRepository: {
      saveBreakCategories() { calls.push("local-categories"); },
      saveTeams() { calls.push("local-teams"); },
      saveRounds() { calls.push("local-rounds"); },
      setActiveRound() { calls.push("active-round"); },
    },
    cloudRepository: {
      async saveBreakCategories() { calls.push("cloud-categories"); },
      async saveGeneratedBreak() { calls.push("cloud-break"); },
      async saveEliminationAdvancement() { calls.push("cloud-advancement"); },
    },
    async recordAuditEvent(event) { calls.push(event.action); },
    ...overrides,
  };
  return { dependencies, calls };
}

const openBreak: BreakCategory = {
  id: "open",
  tournamentId: "tournament-1",
  name: "Open",
  slug: "open",
  seq: 1,
  breakSize: 8,
  reserveSize: 0,
  isGeneral: true,
  priority: 1,
};

describe("break application commands", () => {
  it("persists break categories locally before cloud sync and audit", async () => {
    const { dependencies, calls } = makeDependencies({ breakCategories: [openBreak] });

    await saveBreakCategoriesCommand([{ ...openBreak, breakSize: 4 }], dependencies);

    expect(calls).toEqual(["local-categories", "cloud-categories", "break.categories_updated"]);
  });

  it("refuses to advance an elimination round without a generated draw", async () => {
    const round: Round = createRoundRecord({
      tournamentId: tournament.id,
      roundSeq: 1,
      name: "Quarterfinal",
      abbr: "QF",
      stage: "elimination",
    });
    const { dependencies, calls } = makeDependencies({ rounds: [round] });

    await expect(proceedToNextEliminationRoundCommand(round.id, dependencies))
      .rejects.toThrow("Generate this elimination round's draw before proceeding.");

    expect(calls).toEqual([]);
  });

  it("generates one category's break without changing another category's teams", async () => {
    const twoTeam: Tournament = {
      ...tournament,
      format: "uadc",
      preferences: { ...tournament.preferences, teamsInDebate: 2 },
    };
    const open: BreakCategory = { ...openBreak, breakSize: 2, priority: 10 };
    const esl: BreakCategory = { ...openBreak, id: "esl", slug: "esl", name: "ESL", breakSize: 2, isGeneral: false, priority: 1 };
    const teams: Team[] = ["a", "b", "c", "d", "e"].map((id) => ({
      id,
      tournamentId: tournament.id,
      name: id,
      speakers: [],
      breakCategories: id === "a" ? [] : ["esl"],
      speakerCategories: [],
    }));
    const standings = teams.map((team, index) => ({
      rank: index + 1,
      teamId: team.id,
      teamName: team.name,
      points: 5 - index,
      totalSpeakerScore: 0,
      averageSpeakerScore: 0,
      breakCategories: [],
      roundResults: [],
      metrics: {} as TeamStandingRow["metrics"],
    }));
    const rounds = ["SF", "GF"].map((abbr, index) => ({
      ...createRoundRecord({ tournamentId: tournament.id, roundSeq: index + 1, name: abbr, abbr, stage: "elimination" }),
      id: abbr,
    }));
    let savedTeams: Team[] = [];
    let savedCategories: BreakCategory[] = [];
    const { dependencies } = makeDependencies({
      tournament: twoTeam,
      teams,
      rounds,
      breakCategories: [open, esl],
      breakResults: calculateBreaks([open, esl], teams, standings, "uadc"),
    });
    dependencies.localRepository.saveTeams = (items) => { savedTeams = items; };
    dependencies.localRepository.saveBreakCategories = (items) => { savedCategories = items; };

    await generateBreakCommand("esl", dependencies);

    expect(savedTeams.map((team) => [team.id, team.breakStatus, team.breakCategoryIds])).toEqual([
      ["a", "eliminated", []],
      ["b", "eliminated", []],
      ["c", "breaking", ["esl"]],
      ["d", "breaking", ["esl"]],
      ["e", "eliminated", []],
    ]);
    expect(savedCategories.find((category) => category.id === "esl")?.generatedBreak?.breakingTeamIds)
      .toEqual(["c", "d"]);
    expect(savedCategories.find((category) => category.id === "open")?.generatedBreak).toBeUndefined();
  });
});

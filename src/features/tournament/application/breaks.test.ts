import { describe, expect, it } from "vitest";

import type { BreakCategory, Round, Tournament } from "@/types";
import { createRoundRecord } from "./rounds";
import { proceedToNextEliminationRoundCommand, saveBreakCategoriesCommand, type BreakDependencies } from "./breaks";

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
});
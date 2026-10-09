import { describe, expect, it } from "vitest";

import type { Tournament } from "@/types";
import { createRoundRecord } from "./rounds";
import type { GenerateDrawDependencies } from "./draws";
import { generateDrawCommand } from "./draws";

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

describe("generateDrawCommand", () => {
  it("saves locally before optional cloud persistence and audit", async () => {
    const calls: string[] = [];
    const round = createRoundRecord({
      tournamentId: tournament.id,
      roundSeq: 1,
      name: "Round 1",
      abbr: "R1",
      stage: "preliminary",
    });
    const dependencies: GenerateDrawDependencies = {
      tournament,
      rounds: [round],
      teams: [],
      venues: [],
      debates: [],
      motions: [],
      standings: [],
      generateRoundDraw() {
        calls.push("algorithm");
        return [];
      },
      localRepository: {
        saveDebates(debates) {
          calls.push("local-debates");
          expect(debates).toEqual([]);
        },
        saveRounds(rounds, activeRound) {
          calls.push("local-rounds");
          expect(rounds[0]).toMatchObject({ drawStatus: "draft", adjudicatorsRevealed: false });
          expect(activeRound.id).toBe(round.id);
        },
      },
      cloudRepository: {
        async replaceRoundDraw(roundId, removedDebates, debates, updatedRound) {
          calls.push("cloud");
          expect(roundId).toBe(round.id);
          expect(removedDebates).toEqual([]);
          expect(debates).toEqual([]);
          expect(updatedRound.drawStatus).toBe("draft");
        },
      },
      async recordAuditEvent(event) {
        calls.push("audit");
        expect(event).toMatchObject({ action: "draw.generated", roundId: round.id });
      },
    };

    await generateDrawCommand(round.id, dependencies);

    expect(calls).toEqual([
      "algorithm",
      "local-debates",
      "local-rounds",
      "cloud",
      "audit",
    ]);
  });
});
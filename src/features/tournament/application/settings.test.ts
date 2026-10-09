import { describe, expect, it } from "vitest";

import type { Tournament } from "@/types";
import { saveTournamentCommand } from "./settings";

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

describe("saveTournamentCommand", () => {
  it("saves metadata locally and audits changed settings after cloud persistence", async () => {
    const calls: string[] = [];
    const updated = { ...tournament, name: "Updated Tournament" };

    await saveTournamentCommand(updated, tournament, {
      localRepository: { saveTournament() { calls.push("local"); } },
      cloudRepository: { async saveTournament() { calls.push("cloud"); } },
      async recordAuditEvent(event) {
        calls.push("audit");
        expect(event.details).toMatchObject({ previousName: tournament.name, name: updated.name });
      },
      warn() {},
    });

    expect(calls).toEqual(["local", "cloud", "audit"]);
  });

  it("keeps local settings if the optional cloud write fails", async () => {
    const calls: string[] = [];
    await saveTournamentCommand(tournament, null, {
      localRepository: { saveTournament() { calls.push("local"); } },
      cloudRepository: {
        async saveTournament() {
          calls.push("cloud");
          throw new Error("Firestore unavailable");
        },
      },
      async recordAuditEvent() { calls.push("audit"); },
      warn(message) { calls.push(message); },
    });

    expect(calls).toEqual(["local", "cloud", "Firestore sync warning:"]);
  });
});
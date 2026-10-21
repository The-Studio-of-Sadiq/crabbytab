import { describe, expect, it } from "vitest";

import type { Adjudicator, Team } from "@/types";
import { regeneratePrivateAccess, regeneratePrivateAccessCommand } from "./privateAccess";

describe("regeneratePrivateAccess", () => {
  it("creates new private URLs and passcodes when they are missing", () => {
    const teams: Array<{ id: string; name?: string; privateUrlKey?: string; privatePasscode?: string }> = [
      {
        id: "team-1",
        name: "Alpha",
      },
    ];

    const result = regeneratePrivateAccess(teams, false, "team");

    expect(result.changed).toBe(true);
    expect(result.updatedIds).toEqual(["team-1"]);
    expect(result.items[0].privateUrlKey).toMatch(/^team_/);
    expect(result.items[0].privatePasscode).toBeTruthy();
  });

  it("leaves current credentials alone unless a refresh is forced", () => {
    const teams: Array<{ id: string; privateUrlKey?: string; privatePasscode?: string }> = [
      {
        id: "team-1",
        privateUrlKey: "team_existing_key",
        privatePasscode: "secure-passcode",
      },
    ];

    const result = regeneratePrivateAccess(teams, false, "team");

    expect(result.changed).toBe(false);
    expect(result.items[0]).toEqual(teams[0]);
  });
});

describe("regeneratePrivateAccessCommand", () => {
  it("saves changed credentials together and audits counts without credential values", async () => {
    const teams: Team[] = [{
      id: "team-1",
      tournamentId: "tournament-1",
      name: "Alpha",
      speakers: [],
      breakCategories: [],
      speakerCategories: [],
    }];
    const adjudicators: Adjudicator[] = [{
      id: "adj-1",
      tournamentId: "tournament-1",
      name: "Judge A",
      baseScore: 5,
      trainee: false,
      independent: true,
      conflicts: [],
      privateUrlKey: "adj_existing_key",
      privatePasscode: "existing-passcode",
    }];
    const calls: string[] = [];
    let auditDetails: Record<string, unknown> | undefined;

    await regeneratePrivateAccessCommand(teams, adjudicators, false, {
      localRepository: {
        saveTeams(updatedTeams) { calls.push("local-teams"); expect(updatedTeams[0].privateUrlKey).toMatch(/^team_/); },
        saveAdjudicators() { calls.push("local-adjudicators"); },
      },
      cloudRepository: {
        async savePrivateAccessChanges(changes) {
          calls.push("cloud");
          expect(changes.teams).toHaveLength(1);
          expect(changes.adjudicators).toBeUndefined();
        },
      },
      async recordAuditEvent(event) {
        calls.push("audit");
        auditDetails = event.details;
      },
    });

    expect(calls).toEqual(["local-teams", "cloud", "audit"]);
    expect(auditDetails).toEqual({ forceRegenerate: false, teamsUpdated: 1, adjudicatorsUpdated: 0 });
    expect(JSON.stringify(auditDetails)).not.toContain("existing-passcode");
  });
});

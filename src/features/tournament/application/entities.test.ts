import { describe, expect, it, vi } from "vitest";

import type { Adjudicator, Team } from "@/types";
import {
  createTournamentEntityCommands,
  type EntityAuditEvent,
  type EntityCommandDependencies,
} from "./entities";

function createDependencies(overrides: Partial<EntityCommandDependencies> = {}) {
  const calls: string[] = [];
  const auditEvents: EntityAuditEvent[] = [];
  const repositories = {
    institutions: { save: vi.fn() },
    teams: { save: vi.fn(() => calls.push("local")) },
    adjudicators: { save: vi.fn() },
    venues: { save: vi.fn() },
    motions: { save: vi.fn(() => calls.push("local")) },
  };
  const dependencies: EntityCommandDependencies = {
    tournamentId: "tournament-1",
    institutions: [],
    teams: [],
    adjudicators: [],
    venues: [],
    motions: [],
    repositories,
    async recordAuditEvent(event) {
      calls.push("audit");
      auditEvents.push(event);
    },
    createId: (prefix) => `${prefix}-generated`,
    generatePrivateKey: (prefix = "key") => `${prefix}-secret`,
    ...overrides,
  };

  return { dependencies, calls, auditEvents, repositories };
}

function makeTeam(overrides: Partial<Team> = {}): Omit<Team, "id" | "tournamentId"> {
  return {
    name: "Team A",
    speakers: [{ id: "speaker-1", name: "Speaker A" }],
    breakCategories: [],
    speakerCategories: [],
    ...overrides,
  };
}

function makeAdjudicator(overrides: Partial<Adjudicator> = {}): Adjudicator {
  return {
    id: "adj-1",
    tournamentId: "tournament-1",
    name: "Judge A",
    baseScore: 5,
    trainee: false,
    independent: true,
    conflicts: [],
    privateUrlKey: "private-url-secret",
    privatePasscode: "private-passcode-secret",
    ...overrides,
  };
}

describe("tournament entity commands", () => {
  it("saves bulk-created teams before auditing without exposing credentials", async () => {
    const { dependencies, calls, auditEvents, repositories } = createDependencies();
    const commands = createTournamentEntityCommands(dependencies);

    await commands.addTeams([makeTeam()]);

    expect(calls).toEqual(["local", "audit"]);
    expect(repositories.teams.save).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "team-generated",
        tournamentId: "tournament-1",
        privateUrlKey: "team-secret",
        privatePasscode: "key-secret",
      }),
    ]);
    expect(JSON.stringify(auditEvents)).not.toContain("secret");
  });

  it("omits adjudicator private access values from update audit records", async () => {
    const adjudicator = makeAdjudicator();
    const { dependencies, auditEvents } = createDependencies({ adjudicators: [adjudicator] });
    const commands = createTournamentEntityCommands(dependencies);

    await commands.updateAdjudicator({ ...adjudicator, name: "Judge B" });

    expect(JSON.stringify(auditEvents)).not.toContain("private-url-secret");
    expect(JSON.stringify(auditEvents)).not.toContain("private-passcode-secret");
    expect(auditEvents[0]).toMatchObject({
      action: "adjudicator.updated",
      details: { current: { name: "Judge B" } },
    });
  });

  it("writes updated motions to cloud before local state and audit", async () => {
    const { dependencies, calls } = createDependencies({
      cloudRepository: {
        async saveMotion() {
          calls.push("cloud");
        },
      },
    });
    const commands = createTournamentEntityCommands(dependencies);

    await commands.updateMotion({
      id: "motion-1",
      tournamentId: "tournament-1",
      text: "This house...",
      rounds: [],
      released: false,
    });

    expect(calls).toEqual(["cloud", "local", "audit"]);
  });

  it("does not save or audit a motion locally if cloud persistence fails", async () => {
    const { dependencies, calls, repositories } = createDependencies({
      cloudRepository: {
        async saveMotion() {
          calls.push("cloud");
          throw new Error("Firestore unavailable");
        },
      },
    });
    const commands = createTournamentEntityCommands(dependencies);

    await expect(
      commands.updateMotion({
        id: "motion-1",
        tournamentId: "tournament-1",
        text: "This house...",
        rounds: [],
        released: false,
      })
    ).rejects.toThrow("Firestore unavailable");

    expect(calls).toEqual(["cloud"]);
    expect(repositories.motions.save).not.toHaveBeenCalled();
  });
});
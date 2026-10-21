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
    debates: [],
    ballots: [],
    feedback: [],
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

  it("records base and test score changes with the editor, time and reason", async () => {
    const adjudicator = makeAdjudicator();
    const { dependencies, auditEvents, repositories } = createDependencies({
      adjudicators: [adjudicator],
      currentActor: () => ({ id: "uid-1", name: "Tab Director" }),
      now: () => "2026-10-20T10:00:00.000Z",
    });
    const commands = createTournamentEntityCommands(dependencies);

    await commands.updateAdjudicator({ ...adjudicator, baseScore: 7, testScore: 6 }, { scoreChangeReason: "Test marked" });

    const [saved] = repositories.adjudicators.save.mock.calls[0][0] as Adjudicator[];
    const entry = { timestamp: "2026-10-20T10:00:00.000Z", actorId: "uid-1", actorName: "Tab Director", reason: "Test marked" };
    expect(saved.scoreHistory).toEqual([
      { field: "baseScore", previous: 5, value: 7, ...entry },
      { field: "testScore", value: 6, ...entry },
    ]);
    expect(auditEvents[0].details).toMatchObject({ scoreChanges: saved.scoreHistory });
    expect(JSON.stringify(auditEvents[0].details?.current)).not.toContain("scoreHistory");
  });

  it("records score changes from bulk edits and keeps the stored history", async () => {
    const adjudicator = makeAdjudicator({
      scoreHistory: [{ field: "baseScore", previous: 4, value: 5, timestamp: "earlier" }],
    });
    const { dependencies, repositories } = createDependencies({ adjudicators: [adjudicator], now: () => "later" });
    const commands = createTournamentEntityCommands(dependencies);

    await commands.updateAdjudicators([{ ...adjudicator, baseScore: 3, scoreHistory: undefined }]);

    const [saved] = repositories.adjudicators.save.mock.calls[0][0] as Adjudicator[];
    expect(saved.scoreHistory?.map((change) => `${change.previous}->${change.value}@${change.timestamp}`))
      .toEqual(["4->5@earlier", "5->3@later"]);
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
describe("saveEntityBatch", () => {
  it("saves each collection once and records one audit event", async () => {
    const existingTeam = { ...makeTeam(), id: "team-1", tournamentId: "tournament-1" };
    const { dependencies, auditEvents, repositories } = createDependencies({ teams: [existingTeam] });
    const commands = createTournamentEntityCommands(dependencies);

    await commands.saveEntityBatch(
      {
        institutionsCreated: [{ id: "inst-1", tournamentId: "", name: "Oxford", code: "OXF" }],
        teamsCreated: [{ ...makeTeam({ name: "New" }), id: "team-2", tournamentId: "" }],
        teamsUpdated: [{ ...existingTeam, name: "Renamed" }],
      },
      "Teams CSV import"
    );

    expect(repositories.institutions.save).toHaveBeenCalledTimes(1);
    expect(repositories.teams.save).toHaveBeenCalledTimes(1);
    expect(repositories.adjudicators.save).not.toHaveBeenCalled();
    expect(repositories.teams.save).toHaveBeenCalledWith([
      expect.objectContaining({ id: "team-1", name: "Renamed" }),
      expect.objectContaining({ id: "team-2", tournamentId: "tournament-1", privateUrlKey: "team-secret", privatePasscode: "key-secret" }),
    ]);
    expect(auditEvents).toEqual([
      expect.objectContaining({
        action: "entities.batch_saved",
        summary: "Teams CSV import: 1 institution(s) added, 1 team(s) added, 1 team(s) updated",
      }),
    ]);
    expect(JSON.stringify(auditEvents)).not.toContain("secret");
  });

  it("refuses to update a record that no longer exists, saving nothing", async () => {
    const { dependencies, repositories, auditEvents } = createDependencies();
    const commands = createTournamentEntityCommands(dependencies);
    await expect(
      commands.saveEntityBatch({ adjudicatorsUpdated: [makeAdjudicator()] }, "Conflicts CSV import")
    ).rejects.toThrow(/adjudicator adj-1: it no longer exists/);
    expect(repositories.adjudicators.save).not.toHaveBeenCalled();
    expect(auditEvents).toEqual([]);
  });
});

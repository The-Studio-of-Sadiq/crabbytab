import { describe, expect, it } from "vitest";

import { CLOUD_COLLECTIONS, type CloudCollectionName, type CloudRecord } from "@/features/tournament/collections";
import {
  backupHasErrors,
  createTournamentBackup,
  diffTournamentBackup,
  mergeTournamentBackup,
  parseTournamentBackup,
  planTournamentBackupReplace,
  validateTournamentBackup,
  type TournamentBackup,
} from "./tournamentBackup";
import type { Tournament } from "@/types";

const tournament = {
  id: "tournament-1",
  name: "Tournament",
  slug: "tournament",
  format: "wsdc",
  ownerId: "owner",
  admins: { owner: true },
  preferences: { substantiveSpeakers: 3 },
} as unknown as Tournament;

function emptyCollections(): Record<CloudCollectionName, CloudRecord[]> {
  return Object.fromEntries(CLOUD_COLLECTIONS.map((name) => [name, []])) as unknown as Record<CloudCollectionName, CloudRecord[]>;
}

function record<T extends object>(value: T): CloudRecord {
  return value as unknown as CloudRecord;
}

/** A small but referentially complete tournament. */
function populated(): Record<CloudCollectionName, CloudRecord[]> {
  const collections = emptyCollections();
  collections.rounds = [record({ id: "r1", tournamentId: "tournament-1", seq: 1, name: "Round 1", stage: "preliminary", drawStatus: "draft", breakCategoryIds: [] })];
  collections.breakCategories = [record({ id: "open", name: "Open", breakSize: 4 })];
  collections.institutions = [record({ id: "inst", name: "Uni" })];
  collections.teams = [
    record({ id: "a", name: "Alpha", speakers: [{ id: "a1", name: "Ada" }], breakCategories: ["open"], institutionId: "inst" }),
    record({ id: "b", name: "Bravo", speakers: [{ id: "b1", name: "Ben" }], breakCategories: [] }),
  ];
  collections.adjudicators = [record({ id: "j1", name: "Judge", baseScore: 5, conflicts: [{ teamId: "a", type: "personal" }] })];
  collections.venues = [record({ id: "v1", name: "Room" })];
  collections.motions = [record({ id: "m1", text: "THW", rounds: ["r1"] })];
  collections.debates = [record({
    id: "d1",
    roundId: "r1",
    venueId: "v1",
    motionId: "m1",
    teams: { AFF: { teamId: "a" }, NEG: { teamId: "b" } },
    adjudicators: { chairId: "j1", panellistIds: [], traineeIds: [] },
  })];
  collections.ballots = [record({ id: "bal1", roundId: "r1", debateId: "d1", confirmed: true, speakerScores: {}, teamScores: {} })];
  collections.feedback = [record({ id: "f1", roundId: "r1", debateId: "d1", score: 7, sourceType: "team", sourceId: "a", targetAdjudicatorId: "j1" })];
  collections.auditEvents = [record({ id: "e1", timestamp: "2026-10-10T00:00:00.000Z", action: "draw.generated" })];
  return collections;
}

function backupOf(collections = populated(), overrides: Partial<Tournament> = {}): TournamentBackup {
  return createTournamentBackup({ tournament: { ...tournament, ...overrides }, collections, exportedAt: "2026-10-10T00:00:00.000Z" });
}

function messages(value: unknown, expectedId?: string): string[] {
  return validateTournamentBackup(value, expectedId).issues.map((issue) =>
    `${issue.severity} ${issue.collection}${issue.recordId ? `/${issue.recordId}` : ""}: ${issue.message}`
  );
}

describe("tournament file backup", () => {
  it("creates and validates a versioned backup for the same tournament", () => {
    const backup = backupOf();
    expect(validateTournamentBackup(backup, tournament.id)).toEqual({ backup, issues: [] });
    expect(parseTournamentBackup(backup, tournament.id)).toEqual(backup);
    expect(() => parseTournamentBackup(backup, "different-tournament")).toThrow("different tournament");
  });

  it("rejects files that are not backups or are from an unsupported version", () => {
    expect(messages(null)).toEqual(["error file: The backup file is not valid JSON data."]);
    expect(messages({ format: "something-else" })[0]).toContain("not a supported CrabbyTab tournament backup");
    expect(messages({ ...backupOf(), format: "crabbytab-tournament-backup-v2" })[0]).toContain("version (crabbytab-tournament-backup-v2) is not supported");
    expect(messages({ ...backupOf(), tournament: { id: "tournament-1", name: "T", slug: "t", format: "chess", preferences: {} } })).toContain(
      'error tournament: Unknown tournament format "chess".'
    );
    const noTeams = backupOf() as unknown as { collections: Record<string, unknown> };
    delete noTeams.collections.teams;
    expect(messages(noTeams)).toContain("error teams: The backup has no teams list.");
  });

  it("accepts backups written before ballot intake existed, reading them as having no receipts", () => {
    const older = backupOf() as unknown as { collections: Record<string, unknown> };
    delete older.collections.ballotIntake;
    const validation = validateTournamentBackup(older, tournament.id);
    expect(validation.issues).toEqual([]);
    expect(validation.backup?.collections.ballotIntake).toEqual([]);
    const withReceipt = populated();
    withReceipt.ballotIntake = [record({ id: "intake-1", roundId: "r1", debateId: "gone", sheetCode: "ABCDEFGH", receivedAt: "2026-10-10T00:00:00.000Z" })];
    expect(messages(backupOf(withReceipt))).toEqual([
      'warning ballotIntake/intake-1: Refers to debate "gone", which is not in the backup.',
    ]);
  });

  it("checks required fields, duplicate ids and records from another tournament", () => {
    const collections = populated();
    collections.teams.push(record({ id: "a", name: "Alpha again", speakers: [] }));
    collections.adjudicators.push(record({ id: "j2", name: "No score" }));
    collections.venues.push(record({ id: "v2", tournamentId: "other", name: "Elsewhere" }));
    collections.motions.push(record({ text: "No id", rounds: [] }));
    expect(messages(backupOf(collections))).toEqual([
      "error teams/a: This id is used by more than one record.",
      "error adjudicators/j2: The baseScore field is missing.",
      "error venues/v2: This record belongs to a different tournament.",
      "error motions: Record 2 has no id.",
    ]);
  });

  it("checks referential integrity: hard references are errors, display references warnings", () => {
    const collections = populated();
    collections.debates.push(record({
      id: "d2",
      roundId: "r-missing",
      venueId: "v-missing",
      teams: { AFF: { teamId: "a" }, NEG: { teamId: "ghost-team" } },
      adjudicators: { chairId: "j-missing", panellistIds: [], traineeIds: [] },
    }));
    collections.ballots.push(record({ id: "bal2", roundId: "r1", debateId: "d-missing", confirmed: false, speakerScores: {}, teamScores: {} }));
    collections.teams[1] = record({ ...collections.teams[1], breakCategories: ["novice"], institutionId: "inst-missing" });
    const validation = validateTournamentBackup(backupOf(collections), tournament.id);
    expect(backupHasErrors(validation)).toBe(true);
    expect(validation.issues.map((issue) => `${issue.severity} ${issue.collection}/${issue.recordId}: ${issue.message}`)).toEqual([
      'error teams/b: Refers to break category "novice", which is not in the backup.',
      'warning teams/b: Refers to institution "inst-missing", which is not in the backup.',
      'error debates/d2: Refers to round "r-missing", which is not in the backup.',
      'error debates/d2: Refers to team "ghost-team", which is not in the backup.',
      'error debates/d2: Refers to adjudicator "j-missing", which is not in the backup.',
      'warning debates/d2: Refers to venue "v-missing", which is not in the backup.',
      'error ballots/bal2: Refers to debate "d-missing", which is not in the backup.',
    ]);
    expect(() => parseTournamentBackup(backupOf(collections), tournament.id)).toThrow('Refers to break category "novice"');
  });

  it("diffs a backup against the current data", () => {
    const current = populated();
    current.teams[0] = record({ ...current.teams[0], name: "Alpha (renamed)" });
    current.venues.push(record({ id: "v-new", name: "New room" }));
    const backupCollections = populated();
    backupCollections.motions.push(record({ id: "m2", text: "Spare", rounds: [] }));

    const diff = diffTournamentBackup({
      currentTournament: { ...tournament, updatedAt: "later", syncVersion: 4 },
      current,
      backup: backupOf(backupCollections),
    });
    expect(diff.collections.teams).toEqual({ added: 0, removed: 0, changed: 1, unchanged: 1 });
    expect(diff.collections.venues).toEqual({ added: 0, removed: 1, changed: 0, unchanged: 1 });
    expect(diff.collections.motions).toEqual({ added: 1, removed: 0, changed: 0, unchanged: 1 });
    expect(diff.tournamentSettingsChanged).toBe(false);
    expect(diff.hasChanges).toBe(true);

    const settings = diffTournamentBackup({ currentTournament: tournament, current: populated(), backup: backupOf(populated(), { name: "Old name", ownerId: "someone-else" }) });
    expect(settings.tournamentSettingsChanged).toBe(true);
    expect(diffTournamentBackup({ currentTournament: tournament, current: populated(), backup: backupOf() }).hasChanges).toBe(false);
  });

  it("merges backup-only records without replacing local conflicts or deleting either copy", () => {
    const current = emptyCollections();
    const backupCollections = emptyCollections();
    current.teams = [record({ id: "shared", name: "Current" })];
    backupCollections.teams = [record({ id: "shared", name: "Backup" }), record({ id: "backup-only", name: "Backup only" })];
    current.auditEvents = [record({ id: "event-1", summary: "Current" })];
    backupCollections.auditEvents = [record({ id: "event-1", summary: "Backup duplicate" }), record({ id: "event-2", summary: "Backup event" })];

    const merged = mergeTournamentBackup({ current, backup: backupCollections });

    expect(merged.teams).toEqual([record({ id: "shared", name: "Current" }), record({ id: "backup-only", name: "Backup only" })]);
    expect(merged.auditEvents).toEqual([record({ id: "event-1", summary: "Current" }), record({ id: "event-2", summary: "Backup event" })]);
  });

  it("replaces data with the backup, keeping identity and the audit log", () => {
    const current = populated();
    current.teams[0] = record({ ...current.teams[0], name: "Alpha (renamed)" });
    current.venues.push(record({ id: "v-new", name: "New room" }));
    current.auditEvents.push(record({ id: "e-local", timestamp: "2026-10-11T00:00:00.000Z", action: "ballot.confirmed" }));
    const backupCollections = populated();
    backupCollections.auditEvents = [record({ id: "e0", timestamp: "2026-10-09T00:00:00.000Z", action: "tournament.created" })];

    const plan = planTournamentBackupReplace({
      currentTournament: { ...tournament, admins: { owner: true, helper: true } },
      current,
      backup: backupOf(backupCollections, { name: "Backup name", slug: "old-slug", ownerId: "intruder", admins: { intruder: true } }),
    });

    expect(plan.collections.teams).toEqual(backupCollections.teams);
    expect(plan.collections.venues.map((venue) => venue.id)).toEqual(["v1"]);
    expect(plan.removedIds).toEqual({ venues: ["v-new"] });
    expect(plan.restoredIds.teams).toEqual(["a", "b"]);
    expect(plan.restoredIds.auditEvents).toBeUndefined();
    expect(plan.collections.auditEvents.map((event) => event.id)).toEqual(["e1", "e-local", "e0"]);
    expect(plan.tournament).toMatchObject({
      id: "tournament-1",
      name: "Backup name",
      slug: "tournament",
      ownerId: "owner",
      admins: { owner: true, helper: true },
    });
  });
});

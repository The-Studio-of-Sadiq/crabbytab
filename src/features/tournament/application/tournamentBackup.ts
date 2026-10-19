import type { Tournament, TournamentFormat } from "@/types";
import { CLOUD_COLLECTIONS, type CloudCollectionName, type CloudRecord } from "@/features/tournament/collections";

export const TOURNAMENT_BACKUP_FORMAT = "crabbytab-tournament-backup-v1";

export interface TournamentBackup {
  format: typeof TOURNAMENT_BACKUP_FORMAT;
  exportedAt: string;
  tournament: Tournament;
  collections: Record<CloudCollectionName, CloudRecord[]>;
}

export type BackupCollections = Record<CloudCollectionName, CloudRecord[]>;

export function createTournamentBackup(input: {
  tournament: Tournament;
  collections: BackupCollections;
  exportedAt?: string;
}): TournamentBackup {
  return {
    format: TOURNAMENT_BACKUP_FORMAT,
    exportedAt: input.exportedAt || new Date().toISOString(),
    tournament: input.tournament,
    collections: input.collections,
  };
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export interface BackupIssue {
  severity: "error" | "warning";
  collection: CloudCollectionName | "tournament" | "file";
  recordId?: string;
  message: string;
}

export interface BackupValidation {
  /** Present when the file is structurally a backup, even if it has integrity errors. */
  backup?: TournamentBackup;
  issues: BackupIssue[];
}

const MAX_ISSUES = 200;
const FORMATS: TournamentFormat[] = ["bp", "uadc", "australs", "wsdc", "custom_2team"];

type FieldKind = "string" | "number" | "boolean" | "object" | "array";

/** Fields each record must carry for CrabbyTab to work with it. */
const REQUIRED_FIELDS: Record<CloudCollectionName, Record<string, FieldKind>> = {
  rounds: { seq: "number", name: "string", stage: "string", drawStatus: "string" },
  teams: { name: "string", speakers: "array" },
  adjudicators: { name: "string", baseScore: "number" },
  venues: { name: "string" },
  motions: { text: "string", rounds: "array" },
  breakCategories: { name: "string", breakSize: "number" },
  debates: { roundId: "string", teams: "object", adjudicators: "object" },
  ballots: { roundId: "string", debateId: "string", confirmed: "boolean", speakerScores: "object", teamScores: "object" },
  feedback: { roundId: "string", debateId: "string", score: "number", sourceType: "string", sourceId: "string" },
  institutions: { name: "string" },
  auditEvents: { timestamp: "string", action: "string" },
  ballotIntake: { roundId: "string", debateId: "string", sheetCode: "string", receivedAt: "string" },
};

/** Collections added after the v1 format: a backup written before them simply has none. */
const OPTIONAL_COLLECTIONS: ReadonlySet<CloudCollectionName> = new Set(["ballotIntake"]);

function kindOf(value: unknown): FieldKind | "missing" | "other" {
  if (value === undefined || value === null) return "missing";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "object") {
    return typeof value as FieldKind;
  }
  return "other";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringsIn(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Checks a parsed backup file: format version, the tournament, required fields and duplicate ids
 * per collection, and that references between records point at records in the same backup.
 * Dangling references that would corrupt results (rounds, teams, debates, adjudicators) are
 * errors; references CrabbyTab can display without (venues, motions, institutions) are warnings.
 */
export function validateTournamentBackup(value: unknown, expectedTournamentId?: string): BackupValidation {
  const issues: BackupIssue[] = [];
  let suppressed = 0;
  const add = (issue: BackupIssue) => {
    if (issues.length < MAX_ISSUES) issues.push(issue);
    else suppressed += 1;
  };
  const finish = (backup?: TournamentBackup): BackupValidation => ({
    ...(backup ? { backup } : {}),
    issues: suppressed > 0
      ? [...issues, { severity: "error", collection: "file", message: `${suppressed} more problem(s) were not listed.` }]
      : issues,
  });

  if (!isRecord(value)) {
    add({ severity: "error", collection: "file", message: "The backup file is not valid JSON data." });
    return finish();
  }
  if (value.format !== TOURNAMENT_BACKUP_FORMAT) {
    add({
      severity: "error",
      collection: "file",
      message: typeof value.format === "string" && value.format.startsWith("crabbytab-tournament-backup-")
        ? `This backup version (${value.format.slice(0, 60)}) is not supported by this version of CrabbyTab.`
        : "This file is not a supported CrabbyTab tournament backup.",
    });
    return finish();
  }
  if (typeof value.exportedAt !== "string" || Number.isNaN(Date.parse(value.exportedAt))) {
    add({ severity: "warning", collection: "file", message: "The backup has no valid export date." });
  }

  const tournament = value.tournament;
  if (!isRecord(tournament) || typeof tournament.id !== "string" || !tournament.id) {
    add({ severity: "error", collection: "tournament", message: "The backup is missing the tournament record." });
    return finish();
  }
  if (expectedTournamentId && tournament.id !== expectedTournamentId) {
    add({ severity: "error", collection: "tournament", message: "This backup belongs to a different tournament." });
    return finish();
  }
  for (const [field, kind] of Object.entries({ name: "string", slug: "string", format: "string", preferences: "object" })) {
    if (kindOf(tournament[field]) !== kind) {
      add({ severity: "error", collection: "tournament", message: `The tournament's ${field} is missing or invalid.` });
    }
  }
  if (typeof tournament.format === "string" && !FORMATS.includes(tournament.format as TournamentFormat)) {
    add({ severity: "error", collection: "tournament", message: `Unknown tournament format "${tournament.format.slice(0, 30)}".` });
  }

  if (!isRecord(value.collections)) {
    add({ severity: "error", collection: "file", message: "The backup is missing tournament records." });
    return finish();
  }
  const collectionsValue: Record<string, unknown> = { ...value.collections };
  for (const name of OPTIONAL_COLLECTIONS) collectionsValue[name] ??= [];

  const ids = {} as Record<CloudCollectionName, Set<string>>;
  let structurallyValid = true;
  for (const name of CLOUD_COLLECTIONS) {
    ids[name] = new Set();
    const records = collectionsValue[name];
    if (!Array.isArray(records)) {
      add({ severity: "error", collection: name, message: `The backup has no ${name} list.` });
      structurallyValid = false;
      continue;
    }
    records.forEach((record: unknown, index) => {
      if (!isRecord(record) || typeof record.id !== "string" || !record.id) {
        add({ severity: "error", collection: name, message: `Record ${index + 1} has no id.` });
        structurallyValid = false;
        return;
      }
      const recordId = record.id;
      if (ids[name].has(recordId)) {
        add({ severity: "error", collection: name, recordId, message: "This id is used by more than one record." });
      }
      ids[name].add(recordId);
      for (const [field, kind] of Object.entries(REQUIRED_FIELDS[name])) {
        const actual = kindOf(record[field]);
        if (actual !== kind) {
          add({ severity: "error", collection: name, recordId, message: `The ${field} field is ${actual === "missing" ? "missing" : `a ${actual}, expected a ${kind}`}.` });
        }
      }
      if (typeof record.tournamentId === "string" && record.tournamentId !== tournament.id) {
        add({ severity: "error", collection: name, recordId, message: "This record belongs to a different tournament." });
      }
    });
  }
  if (!structurallyValid) return finish();

  const collections = collectionsValue as unknown as BackupCollections;
  const check = (
    severity: BackupIssue["severity"],
    from: CloudCollectionName,
    recordId: string,
    target: CloudCollectionName,
    refs: Array<string | undefined>,
    label: string
  ) => {
    for (const ref of refs) {
      if (ref && !ids[target].has(ref)) {
        add({ severity, collection: from, recordId, message: `Refers to ${label} "${ref.slice(0, 60)}", which is not in the backup.` });
      }
    }
  };
  const asFields = (record: CloudRecord) => record as unknown as Record<string, unknown>;

  for (const record of collections.rounds) {
    check("error", "rounds", record.id, "breakCategories", stringsIn(asFields(record).breakCategoryIds), "break category");
  }
  for (const record of collections.teams) {
    const fields = asFields(record);
    check("error", "teams", record.id, "breakCategories", stringsIn(fields.breakCategories), "break category");
    check("warning", "teams", record.id, "institutions", [fields.institutionId as string | undefined], "institution");
    const speakers = Array.isArray(fields.speakers) ? fields.speakers : [];
    if (speakers.some((speaker) => !isRecord(speaker) || typeof speaker.id !== "string" || typeof speaker.name !== "string")) {
      add({ severity: "error", collection: "teams", recordId: record.id, message: "A speaker has no id or name." });
    }
  }
  for (const record of collections.adjudicators) {
    const fields = asFields(record);
    check("warning", "adjudicators", record.id, "institutions", [fields.institutionId as string | undefined], "institution");
    const conflicts = Array.isArray(fields.conflicts) ? fields.conflicts.filter(isRecord) : [];
    check("warning", "adjudicators", record.id, "teams", conflicts.map((conflict) => conflict.teamId as string | undefined), "team");
    check("warning", "adjudicators", record.id, "adjudicators", conflicts.map((conflict) => conflict.adjudicatorId as string | undefined), "adjudicator");
    check("warning", "adjudicators", record.id, "institutions", conflicts.map((conflict) => conflict.institutionId as string | undefined), "institution");
  }
  for (const record of collections.motions) {
    check("warning", "motions", record.id, "rounds", stringsIn(asFields(record).rounds), "round");
  }
  for (const record of collections.debates) {
    const fields = asFields(record);
    check("error", "debates", record.id, "rounds", [fields.roundId as string], "round");
    const slots = isRecord(fields.teams) ? Object.values(fields.teams).filter(isRecord) : [];
    check("error", "debates", record.id, "teams", [...slots.map((slot) => slot.teamId as string | undefined), fields.byeTeamId as string | undefined], "team");
    const panel = isRecord(fields.adjudicators) ? fields.adjudicators : {};
    check("error", "debates", record.id, "adjudicators", [
      panel.chairId as string | undefined,
      ...stringsIn(panel.panellistIds),
      ...stringsIn(panel.traineeIds),
    ], "adjudicator");
    check("warning", "debates", record.id, "venues", [fields.venueId as string | undefined], "venue");
    check("warning", "debates", record.id, "motions", [fields.motionId as string | undefined], "motion");
  }
  for (const record of collections.ballots) {
    const fields = asFields(record);
    check("error", "ballots", record.id, "debates", [fields.debateId as string], "debate");
    check("error", "ballots", record.id, "rounds", [fields.roundId as string], "round");
  }
  for (const record of collections.feedback) {
    const fields = asFields(record);
    check("error", "feedback", record.id, "debates", [fields.debateId as string], "debate");
    check("error", "feedback", record.id, "adjudicators", [fields.targetAdjudicatorId as string | undefined], "adjudicator");
    check("warning", "feedback", record.id, fields.sourceType === "team" ? "teams" : "adjudicators", [fields.sourceId as string], "source");
  }
  for (const record of collections.ballotIntake) {
    const fields = asFields(record);
    check("warning", "ballotIntake", record.id, "debates", [fields.debateId as string], "debate");
  }

  return finish({ ...value, collections: collectionsValue } as unknown as TournamentBackup);
}

export function backupHasErrors(validation: BackupValidation): boolean {
  return !validation.backup || validation.issues.some((issue) => issue.severity === "error");
}

/** Strict parse used by the merge path: any validation error is thrown. */
export function parseTournamentBackup(value: unknown, expectedTournamentId: string): TournamentBackup {
  const validation = validateTournamentBackup(value, expectedTournamentId);
  const firstError = validation.issues.find((issue) => issue.severity === "error");
  if (firstError || !validation.backup) {
    const where = firstError?.recordId ? ` (${firstError.collection} ${firstError.recordId})` : "";
    throw new Error(`${firstError?.message ?? "The backup is invalid."}${where}`);
  }
  return validation.backup;
}

/* -------------------------------------------------------------------------- */
/* Diff, merge and replace                                                    */
/* -------------------------------------------------------------------------- */

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export interface CollectionDiff {
  /** In the backup only: a replace restores them. */
  added: number;
  /** On this device only: a replace deletes them. */
  removed: number;
  /** In both with different contents: a replace takes the backup's version. */
  changed: number;
  unchanged: number;
}

export interface BackupDiff {
  collections: Record<CloudCollectionName, CollectionDiff>;
  tournamentSettingsChanged: boolean;
  hasChanges: boolean;
}

export function diffTournamentBackup(input: {
  currentTournament: Tournament;
  current: BackupCollections;
  backup: TournamentBackup;
}): BackupDiff {
  let hasChanges = false;
  const collections = Object.fromEntries(CLOUD_COLLECTIONS.map((name) => {
    const current = new Map(input.current[name].map((record) => [record.id, record]));
    const backupIds = new Set<string>();
    const diff: CollectionDiff = { added: 0, removed: 0, changed: 0, unchanged: 0 };
    for (const record of input.backup.collections[name]) {
      backupIds.add(record.id);
      const existing = current.get(record.id);
      if (!existing) diff.added += 1;
      else if (stableStringify(existing) === stableStringify(record)) diff.unchanged += 1;
      else diff.changed += 1;
    }
    for (const id of current.keys()) if (!backupIds.has(id)) diff.removed += 1;
    if (diff.added || diff.removed || diff.changed) hasChanges = true;
    return [name, diff];
  })) as Record<CloudCollectionName, CollectionDiff>;
  const comparable = (tournament: Tournament) => stableStringify({ ...tournament, ...identityFields(input.currentTournament), updatedAt: undefined, syncVersion: undefined });
  const tournamentSettingsChanged = comparable(input.backup.tournament) !== comparable(input.currentTournament);
  return { collections, tournamentSettingsChanged, hasChanges: hasChanges || tournamentSettingsChanged };
}

/** Fields that identify and secure this tournament; a backup never overwrites them. */
function identityFields(tournament: Tournament): Pick<Tournament, "id" | "slug" | "ownerId" | "admins"> & Partial<Tournament> {
  return {
    id: tournament.id,
    slug: tournament.slug,
    ownerId: tournament.ownerId,
    admins: tournament.admins,
    ...(tournament.ownerEmail !== undefined ? { ownerEmail: tournament.ownerEmail } : {}),
  };
}

export function mergeTournamentBackup(input: {
  current: BackupCollections;
  backup: BackupCollections;
}): BackupCollections {
  return Object.fromEntries(CLOUD_COLLECTIONS.map((name) => {
    const merged = new Map(input.current[name].map((record) => [record.id, record]));
    for (const record of input.backup[name]) {
      if (!merged.has(record.id)) merged.set(record.id, record);
    }
    return [name, [...merged.values()]];
  })) as BackupCollections;
}

export interface BackupReplacePlan {
  tournament: Tournament;
  collections: BackupCollections;
  /** Ids that exist on this device but not in the backup; record them as sync deletions. */
  removedIds: Partial<Record<CloudCollectionName, string[]>>;
  /** Ids the backup brings back; clear any pending sync deletion for them. */
  restoredIds: Partial<Record<CloudCollectionName, string[]>>;
}

/**
 * Replaces this tournament's data with the backup's. The audit log is append-only, so it is
 * merged rather than replaced; the tournament keeps its id, slug, owner and administrators.
 */
export function planTournamentBackupReplace(input: {
  currentTournament: Tournament;
  current: BackupCollections;
  backup: TournamentBackup;
}): BackupReplacePlan {
  const removedIds: BackupReplacePlan["removedIds"] = {};
  const restoredIds: BackupReplacePlan["restoredIds"] = {};
  const collections = {} as BackupCollections;
  for (const name of CLOUD_COLLECTIONS) {
    const backupRecords = input.backup.collections[name];
    const backupIds = new Set(backupRecords.map((record) => record.id));
    if (name === "auditEvents") {
      collections[name] = mergeTournamentBackup({ current: input.current, backup: input.backup.collections })[name];
      continue;
    }
    collections[name] = backupRecords;
    const removed = input.current[name].filter((record) => !backupIds.has(record.id)).map((record) => record.id);
    if (removed.length) removedIds[name] = removed;
    if (backupIds.size) restoredIds[name] = [...backupIds];
  }
  return {
    tournament: { ...input.backup.tournament, ...identityFields(input.currentTournament) },
    collections,
    removedIds,
    restoredIds,
  };
}

/**
 * Adding, removing, listing and importing soft room constraints (Tabbycat venue constraints) on
 * teams, adjudicators and institutions.
 *
 * Constraints CSV: one row per constraint with exactly one of `team`, `adjudicator`,
 * `institution`, plus `category` and `priority` (an integer; higher wins). Subjects are found by
 * name (teams also by code name, adjudicators also by email, institutions also by code). Nothing
 * is saved from a file with errors unless the organiser chooses to import only the valid rows.
 */
import type { Adjudicator, Institution, Team, VenueConstraint } from "@/types";
import { normalizeEmail, normalizeName, readCsvTable, unknownColumns } from "@/lib/csv/csvTable";
import { getField } from "@/lib/csv/importer";
import { normaliseCategory } from "./venues";

export type ConstraintSubjectKind = "team" | "adjudicator" | "institution";

export interface ConstraintRow {
  kind: ConstraintSubjectKind;
  subjectId: string;
  subjectName: string;
  category: string;
  priority: number;
}

export interface ConstraintSubjects {
  teams: Team[];
  adjudicators: Adjudicator[];
  institutions: Institution[];
}

function sameConstraint(a: VenueConstraint, b: VenueConstraint): boolean {
  return normaliseCategory(a.category) === normaliseCategory(b.category);
}

/**
 * The subject's constraints with this category set to `priority` (one constraint per category).
 */
export function withVenueConstraint<T extends { venueConstraints?: VenueConstraint[] }>(
  subject: T,
  constraint: VenueConstraint
): T {
  const category = constraint.category.trim();
  if (!category) throw new Error("A room preference needs a category.");
  if (!Number.isInteger(constraint.priority)) throw new Error("Priority must be a whole number.");
  return {
    ...subject,
    venueConstraints: [
      ...(subject.venueConstraints ?? []).filter((existing) => !sameConstraint(existing, constraint)),
      { category, priority: constraint.priority },
    ],
  };
}

export function withoutVenueConstraint<T extends { venueConstraints?: VenueConstraint[] }>(
  subject: T,
  category: string
): T {
  const remaining = (subject.venueConstraints ?? []).filter(
    (existing) => normaliseCategory(existing.category) !== normaliseCategory(category)
  );
  const { venueConstraints: _removed, ...rest } = subject;
  return (remaining.length > 0 ? { ...rest, venueConstraints: remaining } : rest) as T;
}

/** Every constraint, highest priority first, then by subject name. */
export function listVenueConstraints(subjects: ConstraintSubjects): ConstraintRow[] {
  const rows: ConstraintRow[] = [];
  const add = (kind: ConstraintSubjectKind, items: Array<{ id: string; name: string; venueConstraints?: VenueConstraint[] }>) => {
    for (const item of items) {
      for (const constraint of item.venueConstraints ?? []) {
        rows.push({ kind, subjectId: item.id, subjectName: item.name, category: constraint.category, priority: constraint.priority });
      }
    }
  };
  add("team", subjects.teams);
  add("adjudicator", subjects.adjudicators);
  add("institution", subjects.institutions);
  return rows.sort((a, b) => b.priority - a.priority || a.subjectName.localeCompare(b.subjectName) || a.category.localeCompare(b.category));
}

// ─── CSV import ─────────────────────────────────────────────────────

export interface PlannedConstraint {
  rowNumber: number;
  status: "add" | "update" | "exists" | "error";
  issues: string[];
  kind?: ConstraintSubjectKind;
  subjectId?: string;
  subjectName?: string;
  category?: string;
  priority?: number;
}

export interface ConstraintsPlan {
  rows: PlannedConstraint[];
  fileErrors: string[];
  ignoredColumns: string[];
}

const COLUMNS = {
  team: ["team", "team_name"],
  adjudicator: ["adjudicator", "adjudicator_name", "judge"],
  institution: ["institution", "institution_name"],
  category: ["category", "room_category", "venue_category"],
  priority: ["priority"],
};

function finder<T extends { id: string; name: string }>(records: T[], keys: (record: T) => string[]) {
  return (value: string): { record?: T; error?: string } => {
    const key = normalizeName(value);
    const matches = records.filter(
      (record) => normalizeName(record.name) === key || keys(record).some((other) => other && normalizeName(other) === key)
    );
    if (matches.length === 1) return { record: matches[0] };
    return { error: matches.length === 0 ? `"${value}" was not found.` : `"${value}" matches ${matches.length} records; use something unique.` };
  };
}

export function planVenueConstraintsImport(text: string, subjects: ConstraintSubjects): ConstraintsPlan {
  const table = readCsvTable(text);
  if (table.fileErrors.length > 0) return { rows: [], fileErrors: table.fileErrors, ignoredColumns: [] };
  const known = Object.values(COLUMNS).flat();
  const fileErrors: string[] = [];
  const has = (aliases: string[]) => table.headers.some((header) => aliases.includes(header.toLowerCase()));
  if (!has(COLUMNS.category)) fileErrors.push("The file needs a category column.");
  if (!has(COLUMNS.priority)) fileErrors.push("The file needs a priority column.");
  if (fileErrors.length > 0) return { rows: [], fileErrors, ignoredColumns: [] };

  const findTeam = finder(subjects.teams, (team) => [team.codeName ?? ""]);
  const findAdjudicator = finder(subjects.adjudicators, (adjudicator) => [normalizeEmail(adjudicator.email ?? "")]);
  const findInstitution = finder(subjects.institutions, (institution) => [institution.code]);
  const seen = new Map<string, number>();

  const rows = table.records.map(({ rowNumber, values, parseError }): PlannedConstraint => {
    if (parseError) return { rowNumber, status: "error", issues: [parseError] };
    const issues: string[] = [];
    const team = getField(values, ...COLUMNS.team)?.trim();
    const adjudicator = getField(values, ...COLUMNS.adjudicator)?.trim();
    const institution = getField(values, ...COLUMNS.institution)?.trim();
    const category = getField(values, ...COLUMNS.category)?.trim() ?? "";
    const priorityText = getField(values, ...COLUMNS.priority)?.trim() ?? "";
    const filled = [team, adjudicator, institution].filter(Boolean).length;
    if (filled !== 1) issues.push("Fill exactly one of team, adjudicator and institution.");
    if (!category) issues.push("The category is empty.");
    const priority = Number(priorityText);
    if (!priorityText || !Number.isInteger(priority)) issues.push(`Priority "${priorityText}" is not a whole number.`);

    let kind: ConstraintSubjectKind | undefined;
    let subject: { id: string; name: string; venueConstraints?: VenueConstraint[] } | undefined;
    if (filled === 1) {
      const found = team
        ? ((kind = "team"), findTeam(team))
        : adjudicator
          ? ((kind = "adjudicator"), findAdjudicator(adjudicator.includes("@") ? normalizeEmail(adjudicator) : adjudicator))
          : ((kind = "institution"), findInstitution(institution!));
      if (found.error) issues.push(found.error);
      subject = found.record;
    }
    if (issues.length > 0 || !subject || !kind) return { rowNumber, status: "error", issues };

    const key = `${kind}:${subject.id}:${normaliseCategory(category)}`;
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      return { rowNumber, status: "error", issues: [`Row ${earlier} already sets this category for ${subject.name}.`] };
    }
    seen.set(key, rowNumber);
    const existing = (subject.venueConstraints ?? []).find(
      (constraint) => normaliseCategory(constraint.category) === normaliseCategory(category)
    );
    return {
      rowNumber,
      status: !existing ? "add" : existing.priority === priority ? "exists" : "update",
      issues: [],
      kind,
      subjectId: subject.id,
      subjectName: subject.name,
      category,
      priority,
    };
  });
  return { rows, fileErrors: [], ignoredColumns: unknownColumns(table.headers, known) };
}

/** The changed teams, adjudicators and institutions after applying the valid rows. */
export function applyVenueConstraintsPlan(plan: ConstraintsPlan, subjects: ConstraintSubjects) {
  const teams = new Map(subjects.teams.map((team) => [team.id, team]));
  const adjudicators = new Map(subjects.adjudicators.map((adjudicator) => [adjudicator.id, adjudicator]));
  const institutions = new Map(subjects.institutions.map((institution) => [institution.id, institution]));
  const changed = { teams: new Set<string>(), adjudicators: new Set<string>(), institutions: new Set<string>() };
  let applied = 0;
  for (const row of plan.rows) {
    if ((row.status !== "add" && row.status !== "update") || !row.kind || !row.subjectId) continue;
    const constraint = { category: row.category!, priority: row.priority! };
    if (row.kind === "team") {
      teams.set(row.subjectId, withVenueConstraint(teams.get(row.subjectId)!, constraint));
      changed.teams.add(row.subjectId);
    } else if (row.kind === "adjudicator") {
      adjudicators.set(row.subjectId, withVenueConstraint(adjudicators.get(row.subjectId)!, constraint));
      changed.adjudicators.add(row.subjectId);
    } else {
      institutions.set(row.subjectId, withVenueConstraint(institutions.get(row.subjectId)!, constraint));
      changed.institutions.add(row.subjectId);
    }
    applied++;
  }
  return {
    applied,
    teams: [...changed.teams].map((id) => teams.get(id)!),
    adjudicators: [...changed.adjudicators].map((id) => adjudicators.get(id)!),
    institutions: [...changed.institutions].map((id) => institutions.get(id)!),
  };
}

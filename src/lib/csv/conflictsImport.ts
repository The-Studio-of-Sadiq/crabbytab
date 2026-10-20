import type { Adjudicator, AdjudicatorConflict, Institution, Team } from "@/types";
import { normalizeEmail, normalizeName, readCsvTable, unknownColumns } from "./csvTable";
import { getField, type ImportIssue } from "./importer";

/**
 * Conflicts CSV (Tabbycat's four conflict types in one file). Each row fills exactly two of the
 * columns `adjudicator`, `team`, `institution` and `other_adjudicator`:
 *
 * | Filled                           | Conflict                         | Stored as                                  |
 * | -------------------------------- | -------------------------------- | ------------------------------------------ |
 * | adjudicator + team               | adjudicator–team                 | `{ teamId, type: "personal" }` on the adjudicator |
 * | adjudicator + other_adjudicator  | adjudicator–adjudicator          | `{ adjudicatorId, type: "personal" }` on the first |
 * | adjudicator + institution        | adjudicator–institution          | `{ institutionId, type: "institution" }`  |
 * | team + institution               | team–institution                 | `Team.institutionConflictIds`              |
 *
 * Adjudicators are found by email or name, teams by name or code, institutions by name or code.
 * A name shared by two records is an error: the row must use something unique.
 */

export type ConflictKind = "adjudicator-team" | "adjudicator-adjudicator" | "adjudicator-institution" | "team-institution";

export interface PlannedConflict {
  rowNumber: number;
  kind?: ConflictKind;
  description: string;
  status: "add" | "exists" | "error";
  issues: ImportIssue[];
  adjudicatorId?: string;
  teamId?: string;
  institutionId?: string;
  otherAdjudicatorId?: string;
}

export interface ConflictsPlan {
  rows: PlannedConflict[];
  fileErrors: string[];
  ignoredColumns: string[];
}

const COLUMNS = {
  adjudicator: ["adjudicator", "adjudicator_name", "judge", "adjudicator1"],
  team: ["team", "team_name"],
  institution: ["institution", "institution_name", "inst"],
  otherAdjudicator: ["other_adjudicator", "adjudicator2", "conflicted_adjudicator"],
};

interface Lookup<T> {
  find(value: string): { record?: T; error?: string };
}

function lookup<T extends { id: string; name: string }>(
  records: T[],
  noun: string,
  otherKeys: (record: T) => string[]
): Lookup<T> {
  return {
    find(value) {
      const key = normalizeName(value);
      const byName = records.filter((record) => normalizeName(record.name) === key);
      if (byName.length === 1) return { record: byName[0] };
      if (byName.length > 1) return { error: `${byName.length} ${noun}s are called "${value}"; use a unique value.` };
      const byOther = records.filter((record) => otherKeys(record).some((other) => other && normalizeName(other) === key));
      if (byOther.length === 1) return { record: byOther[0] };
      if (byOther.length > 1) return { error: `"${value}" matches ${byOther.length} ${noun}s; use a unique value.` };
      return { error: `No ${noun} "${value}".` };
    },
  };
}

function hasConflict(adjudicator: Adjudicator, predicate: (conflict: AdjudicatorConflict) => boolean): boolean {
  return (adjudicator.conflicts ?? []).some(predicate);
}

export function planConflictsImport(
  text: string,
  data: { adjudicators: Adjudicator[]; teams: Team[]; institutions: Institution[] }
): ConflictsPlan {
  const table = readCsvTable(text);
  const fileErrors = [...table.fileErrors];
  const known = Object.values(COLUMNS).flat();
  if (table.headers.length > 0 && !table.headers.some((header) => known.includes(header.toLowerCase()))) {
    fileErrors.push("No conflict columns found. Use adjudicator, team, institution and other_adjudicator.");
  }
  if (fileErrors.length > 0) return { rows: [], fileErrors, ignoredColumns: [] };

  const adjudicators = lookup(data.adjudicators, "adjudicator", (adjudicator) => [normalizeEmail(adjudicator.email)]);
  const teams = lookup(data.teams, "team", (team) => [team.codeName ?? ""]);
  const institutions = lookup(data.institutions, "institution", (institution) => [institution.code]);
  const seen = new Map<string, number>();

  const rows = table.records.map((record): PlannedConflict => {
    const issues: ImportIssue[] = [];
    if (record.parseError) issues.push({ severity: record.parseErrorCode === "TooFewFields" ? "warning" : "error", message: record.parseError });
    const cells = {
      adjudicator: getField(record.values, ...COLUMNS.adjudicator).trim(),
      team: getField(record.values, ...COLUMNS.team).trim(),
      institution: getField(record.values, ...COLUMNS.institution).trim(),
      otherAdjudicator: getField(record.values, ...COLUMNS.otherAdjudicator).trim(),
    };
    const filled = Object.entries(cells).filter(([, value]) => value).map(([key]) => key).sort().join("+");
    const kind: ConflictKind | undefined = ({
      "adjudicator+team": "adjudicator-team",
      "adjudicator+otherAdjudicator": "adjudicator-adjudicator",
      "adjudicator+institution": "adjudicator-institution",
      "institution+team": "team-institution",
    } as Record<string, ConflictKind>)[filled];
    const description = Object.values(cells).filter(Boolean).join(" ↔ ") || "(empty)";
    if (!kind) {
      issues.push({
        severity: "error",
        message: "Fill exactly two of adjudicator, team, institution and other_adjudicator (adjudicator with one of the others, or team with institution).",
      });
      return { rowNumber: record.rowNumber, description, status: "error", issues };
    }

    const resolve = <T>(finder: Lookup<T>, value: string): T | undefined => {
      const result = finder.find(value);
      if (result.error) issues.push({ severity: "error", message: result.error });
      return result.record;
    };
    const adjudicator = cells.adjudicator ? resolve(adjudicators, cells.adjudicator) : undefined;
    const team = cells.team ? resolve(teams, cells.team) : undefined;
    const institution = cells.institution ? resolve(institutions, cells.institution) : undefined;
    const other = cells.otherAdjudicator ? resolve(adjudicators, cells.otherAdjudicator) : undefined;
    const base = {
      rowNumber: record.rowNumber,
      kind,
      description,
      issues,
      adjudicatorId: adjudicator?.id,
      teamId: team?.id,
      institutionId: institution?.id,
      otherAdjudicatorId: other?.id,
    };
    if (issues.some((issue) => issue.severity === "error")) return { ...base, status: "error" };

    if (kind === "adjudicator-adjudicator" && adjudicator!.id === other!.id) {
      issues.push({ severity: "error", message: "An adjudicator cannot conflict with themselves." });
      return { ...base, status: "error" };
    }

    const pairKey = kind === "adjudicator-adjudicator"
      ? `${kind}:${[adjudicator!.id, other!.id].sort().join("|")}`
      : `${kind}:${adjudicator?.id ?? team?.id}|${team?.id ?? institution?.id}|${institution?.id ?? ""}`;
    const earlier = seen.get(pairKey);
    if (earlier !== undefined) {
      issues.push({ severity: "warning", message: `Same conflict as row ${earlier}.` });
      return { ...base, status: "exists" };
    }
    seen.set(pairKey, record.rowNumber);

    let exists = false;
    if (kind === "adjudicator-team") exists = hasConflict(adjudicator!, (conflict) => conflict.teamId === team!.id);
    if (kind === "adjudicator-adjudicator") {
      exists = hasConflict(adjudicator!, (conflict) => conflict.adjudicatorId === other!.id) ||
        hasConflict(other!, (conflict) => conflict.adjudicatorId === adjudicator!.id);
    }
    if (kind === "adjudicator-institution") {
      exists = adjudicator!.institutionId === institution!.id ||
        hasConflict(adjudicator!, (conflict) => conflict.institutionId === institution!.id && !conflict.teamId && !conflict.adjudicatorId);
    }
    if (kind === "team-institution") {
      exists = team!.institutionId === institution!.id || (team!.institutionConflictIds ?? []).includes(institution!.id);
    }
    if (exists) issues.push({ severity: "warning", message: "Already recorded." });
    return { ...base, status: exists ? "exists" : "add" };
  });

  return { rows, fileErrors, ignoredColumns: unknownColumns(table.headers, known) };
}

/** Adjudicators and teams with the planned conflicts added, ready to save in one write each. */
export function applyConflictsPlan(
  plan: ConflictsPlan,
  data: { adjudicators: Adjudicator[]; teams: Team[] }
): { adjudicators: Adjudicator[]; teams: Team[]; added: number } {
  const adjudicators = new Map<string, Adjudicator>();
  const teams = new Map<string, Team>();
  const adjudicator = (id: string) => {
    const current = adjudicators.get(id) ?? data.adjudicators.find((item) => item.id === id)!;
    return { ...current, conflicts: [...(current.conflicts ?? [])] };
  };
  let added = 0;
  for (const row of plan.rows) {
    if (row.status !== "add") continue;
    added += 1;
    if (row.kind === "team-institution") {
      const current = teams.get(row.teamId!) ?? data.teams.find((item) => item.id === row.teamId)!;
      teams.set(current.id, { ...current, institutionConflictIds: [...(current.institutionConflictIds ?? []), row.institutionId!] });
      continue;
    }
    const updated = adjudicator(row.adjudicatorId!);
    if (row.kind === "adjudicator-team") updated.conflicts.push({ teamId: row.teamId, type: "personal" });
    if (row.kind === "adjudicator-adjudicator") updated.conflicts.push({ adjudicatorId: row.otherAdjudicatorId, type: "personal" });
    if (row.kind === "adjudicator-institution") updated.conflicts.push({ institutionId: row.institutionId, type: "institution" });
    adjudicators.set(updated.id, updated);
  }
  return { adjudicators: [...adjudicators.values()], teams: [...teams.values()], added };
}

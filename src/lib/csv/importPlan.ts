import type { Adjudicator, BreakCategory, Institution, Speaker, SpeakerCategory, Team } from "@/types";
import { changeAdjudicatorInstitution } from "@/lib/adjudicators/conflicts";
import {
  resolveSpeakerCategoryNamesForImport,
  resolveSpeakerCategoryRef,
  slugifyCategory,
  speakerCategoryIdForSlug,
  toStoredSpeakerCategories,
  type SpeakerCategoryView,
} from "@/lib/speakerCategories";
import { normalizeEmail, normalizeName, readCsvTable, unknownColumns, type CsvRecord } from "./csvTable";
import {
  deriveInstitutionCode,
  getField,
  parseAdjudicatorRow,
  parseInstitutionRow,
  parseTeamRow,
  type AdjudicatorDraft,
  type ImportIssue,
  type InstitutionDraft,
  type TeamDraft,
} from "./importer";

/**
 * Previewed CSV imports for institutions, teams and adjudicators (AGENTS.md §10).
 *
 * `planImport` reads the file and decides, for every row, what would happen — create a record,
 * update the existing one it matches, or skip it — with row errors and warnings. Nothing is
 * written. `buildImportCommit` turns the plan and the organiser's choices into the records to
 * save in one go; it refuses when a row has errors unless the organiser chose to import the
 * valid rows only.
 */

export type ImportKind = "institutions" | "teams" | "adjudicators";
export type RowAction = "create" | "update" | "skip";

export interface ExistingMatch {
  id: string;
  name: string;
  reason: string;
}

/** Where a team's or adjudicator's institution cell points. */
export type InstitutionRef = { existingId: string } | { newKey: string };

export interface PlannedTeam {
  team: TeamDraft;
  speakerCategoryNames: string[][];
  /** Placeholder speakers were added because the row named none. */
  placeholderSpeakers: boolean;
}

export interface PlannedAdjudicator {
  adjudicator: AdjudicatorDraft;
  /** Columns the row filled, so an update leaves the others alone. */
  provided: { score: boolean; trainee: boolean; independent: boolean };
}

export type ImportDraft = InstitutionDraft | PlannedTeam | PlannedAdjudicator;

export interface PlannedRow<D extends ImportDraft = ImportDraft> {
  rowNumber: number;
  label: string;
  details: string;
  issues: ImportIssue[];
  /** Absent when the row could not be read at all. */
  draft?: D;
  match?: ExistingMatch;
  duplicateOfRow?: number;
  institution?: InstitutionRef;
  /** What the organiser may choose; a row with errors can only be skipped. */
  actions: RowAction[];
  defaultAction: RowAction;
}

export interface NewInstitution {
  key: string;
  name: string;
  code: string;
  rowNumbers: number[];
}

export interface ImportPlan<D extends ImportDraft = ImportDraft> {
  kind: ImportKind;
  rows: PlannedRow<D>[];
  fileErrors: string[];
  ignoredColumns: string[];
  /** Institutions named in the file that do not exist yet. */
  newInstitutions: NewInstitution[];
  /** Speaker category names in the file that match no category yet. */
  newSpeakerCategories: string[];
}

export interface ImportContext {
  institutions: Institution[];
  teams: Team[];
  adjudicators: Adjudicator[];
  breakCategories?: BreakCategory[];
  /** Saved and unsaved (label-derived) categories, as effectiveSpeakerCategories returns them. */
  speakerCategories?: SpeakerCategoryView[];
  /** Speakers per team in the format; teams with no speakers get this many placeholders. */
  substantiveSpeakers?: number;
}

const COMMON_VENUE_COLUMNS = [
  "required_venue_category", "venue_category", "min_venue_capacity", "minimum_venue_capacity",
  "requires_accessible_venue", "venue_accessible", "requires_online_venue", "venue_online",
  "requires_near_tab_room", "venue_near_tab_room",
];

const INSTITUTION_COLUMNS = ["institution", "inst"];

const KNOWN_COLUMNS: Record<ImportKind, string[]> = {
  institutions: [
    "name", "institution", "institution name", "code", "abbr", "institution code", "region", ...COMMON_VENUE_COLUMNS,
  ],
  teams: [
    "name", "team", "team_name", "team name", "code", ...INSTITUTION_COLUMNS, "division_id", "divisionId", "division",
    "category", "break_categories", "break categories", "break_category", ...COMMON_VENUE_COLUMNS,
    ...[1, 2, 3, 4, 5].flatMap((position) => [
      `speaker${position}`, `speaker_${position}`, `speaker ${position}`, `speaker${position}_email`,
      `speaker ${position} email`, `speaker${position}_categories`, `speaker ${position} categories`,
      `speaker${position}_category`,
    ]),
  ],
  adjudicators: [
    "name", "adjudicator", "judge", "email", ...INSTITUTION_COLUMNS, "score", "rating", "baseScore", "trainee",
    "independent", "indep", "preformed_panel_id", "preformedPanelId", "gender", "region", ...COMMON_VENUE_COLUMNS,
  ],
};

const REQUIRED_COLUMNS: Record<ImportKind, { label: string; aliases: string[] }> = {
  institutions: { label: "name", aliases: ["name", "institution", "institution name"] },
  teams: { label: "name", aliases: ["name", "team", "team_name", "team name"] },
  adjudicators: { label: "name", aliases: ["name", "adjudicator", "judge"] },
};

/** Institution cells that mean "no institution". */
const NO_INSTITUTION = new Set(["", "-", "none", "n/a", "na", "independent", "unaffiliated", "no institution"]);

function hasErrors(issues: ImportIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

function rowIssues(record: CsvRecord, kind: ImportKind): ImportIssue[] {
  if (!record.parseError) return [];
  // Institutions recover unquoted commas in names (parseInstitutionRow warns about it).
  if (kind === "institutions" && record.parseErrorCode === "TooManyFields") return [];
  return [{ severity: record.parseErrorCode === "TooFewFields" ? "warning" : "error", message: record.parseError }];
}

function finishRow<D extends ImportDraft>(row: Omit<PlannedRow<D>, "actions" | "defaultAction">): PlannedRow<D> {
  if (hasErrors(row.issues) || !row.draft) return { ...row, actions: ["skip"], defaultAction: "skip" };
  if (row.match) return { ...row, actions: ["skip", "update", "create"], defaultAction: "skip" };
  if (row.duplicateOfRow !== undefined) return { ...row, actions: ["skip", "create"], defaultAction: "skip" };
  return { ...row, actions: ["create", "skip"], defaultAction: "create" };
}

/** Makes `code` unique against `taken` (case-insensitive) by adding 2, 3, … */
function uniqueCode(code: string, taken: Set<string>): string {
  const base = code || "INST";
  let candidate = base;
  for (let suffix = 2; taken.has(candidate.toLowerCase()); suffix += 1) candidate = `${base}${suffix}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

function findInstitution(value: string, institutions: Institution[]): Institution | undefined {
  const key = normalizeName(value);
  return (
    institutions.find((institution) => normalizeName(institution.name) === key) ??
    institutions.find((institution) => normalizeName(institution.code) === key)
  );
}

class InstitutionResolver {
  readonly created = new Map<string, NewInstitution>();
  private readonly takenCodes: Set<string>;

  constructor(private readonly institutions: Institution[]) {
    this.takenCodes = new Set(institutions.map((institution) => institution.code.toLowerCase()));
  }

  resolve(value: string | undefined, rowNumber: number): InstitutionRef | undefined {
    const name = (value ?? "").trim().replace(/\s+/g, " ");
    if (NO_INSTITUTION.has(name.toLowerCase())) return undefined;
    const existing = findInstitution(name, this.institutions);
    if (existing) return { existingId: existing.id };
    const key = normalizeName(name);
    const known = this.created.get(key);
    if (known) {
      known.rowNumbers.push(rowNumber);
    } else {
      this.created.set(key, {
        key,
        name,
        code: uniqueCode(deriveInstitutionCode(name), this.takenCodes),
        rowNumbers: [rowNumber],
      });
    }
    return { newKey: key };
  }

  label(ref: InstitutionRef | undefined): string {
    if (!ref) return "No institution";
    if ("existingId" in ref) return this.institutions.find((institution) => institution.id === ref.existingId)?.name ?? "";
    return `${this.created.get(ref.newKey)?.name ?? ref.newKey} (new)`;
  }
}

function missingRequiredColumn(kind: ImportKind, headers: string[]): string | undefined {
  const required = REQUIRED_COLUMNS[kind];
  const present = headers.some((header) => required.aliases.includes(header.toLowerCase()));
  return present ? undefined : `The "${required.label}" column is missing. Columns found: ${headers.join(", ") || "none"}.`;
}

export function planImport(kind: "institutions", text: string, context: ImportContext): ImportPlan<InstitutionDraft>;
export function planImport(kind: "teams", text: string, context: ImportContext): ImportPlan<PlannedTeam>;
export function planImport(kind: "adjudicators", text: string, context: ImportContext): ImportPlan<PlannedAdjudicator>;
export function planImport(kind: ImportKind, text: string, context: ImportContext): ImportPlan;
export function planImport(kind: ImportKind, text: string, context: ImportContext): ImportPlan {
  const table = readCsvTable(text);
  const fileErrors = [...table.fileErrors];
  const missing = table.headers.length > 0 ? missingRequiredColumn(kind, table.headers) : undefined;
  if (missing) fileErrors.push(missing);
  const empty: ImportPlan = {
    kind,
    rows: [],
    fileErrors,
    ignoredColumns: [],
    newInstitutions: [],
    newSpeakerCategories: [],
  };
  if (fileErrors.length > 0) return empty;
  const ignoredColumns = unknownColumns(table.headers, KNOWN_COLUMNS[kind]);
  if (kind === "institutions") return { ...empty, ignoredColumns, rows: planInstitutionRows(table.records, context) };
  if (kind === "teams") return { ...planTeamRows(table.records, context), kind, fileErrors, ignoredColumns };
  return { ...planAdjudicatorRows(table.records, context), kind, fileErrors, ignoredColumns };
}

function planInstitutionRows(records: CsvRecord[], context: ImportContext): PlannedRow<InstitutionDraft>[] {
  const seen = new Map<string, number>();
  const seenCodes = new Map<string, number>();
  return records.map((record) => {
    const issues = rowIssues(record, "institutions");
    const parsed = parseInstitutionRow(record.values, record.rowNumber);
    issues.push(...parsed.issues);
    const { institution } = parsed;
    if (!institution.name) issues.push({ severity: "error", message: "The institution name is missing." });
    const key = normalizeName(institution.name);
    const codeKey = normalizeName(institution.code);

    let match: ExistingMatch | undefined;
    const byName = context.institutions.find((existing) => normalizeName(existing.name) === key);
    const byCode = context.institutions.find((existing) => normalizeName(existing.code) === codeKey);
    if (byName) match = { id: byName.id, name: byName.name, reason: "same name" };
    else if (byCode && codeKey) match = { id: byCode.id, name: byCode.name, reason: `same code ${byCode.code}` };

    let duplicateOfRow: number | undefined;
    if (key && seen.has(key)) {
      duplicateOfRow = seen.get(key);
      issues.push({ severity: "warning", message: `Same institution as row ${duplicateOfRow}.` });
    } else if (codeKey && seenCodes.has(codeKey)) {
      duplicateOfRow = seenCodes.get(codeKey);
      issues.push({ severity: "warning", message: `Code ${institution.code} is also used on row ${duplicateOfRow}.` });
    }
    if (key && !seen.has(key)) seen.set(key, record.rowNumber);
    if (codeKey && !seenCodes.has(codeKey)) seenCodes.set(codeKey, record.rowNumber);

    return finishRow<InstitutionDraft>({
      rowNumber: record.rowNumber,
      label: institution.name || "(no name)",
      details: [institution.code, institution.region].filter(Boolean).join(" · "),
      issues,
      draft: institution.name ? institution : undefined,
      match,
      duplicateOfRow,
    });
  });
}

function collectNewSpeakerCategories(
  names: string[],
  categories: SpeakerCategoryView[],
  found: string[]
): void {
  const { unknown } = resolveSpeakerCategoryNamesForImport(names, categories);
  for (const name of unknown) {
    if (!found.some((item) => slugifyCategory(item) === slugifyCategory(name))) found.push(name);
  }
}

function planTeamRows(
  records: CsvRecord[],
  context: ImportContext
): Pick<ImportPlan<PlannedTeam>, "rows" | "newInstitutions" | "newSpeakerCategories"> {
  const resolver = new InstitutionResolver(context.institutions);
  const speakerCategories = context.speakerCategories ?? [];
  const newSpeakerCategories: string[] = [];
  const placeholders = Math.max(1, context.substantiveSpeakers ?? 2);
  const seen = new Map<string, number>();
  const emailOwners = new Map<string, string>();
  for (const team of context.teams) {
    for (const speaker of team.speakers) {
      const email = normalizeEmail(speaker.email);
      if (email) emailOwners.set(email, `${speaker.name} (${team.name})`);
    }
  }

  const rows = records.map((record) => {
    const issues = rowIssues(record, "teams");
    const parsed = parseTeamRow(record.values, record.rowNumber, context.breakCategories ?? []);
    issues.push(...parsed.issues);
    const team = parsed.team;
    if (!team.name) issues.push({ severity: "error", message: "The team name is missing." });

    const institution = resolver.resolve(team.institutionName, record.rowNumber);
    const placeholderSpeakers = team.speakers.length === 0;
    if (placeholderSpeakers) {
      issues.push({
        severity: "warning",
        message: `No speakers named: ${placeholders} placeholder speaker${placeholders === 1 ? "" : "s"} ("${team.name || "Team"} Speaker 1"…) will be created. Rename them before results are entered.`,
      });
    } else if (team.speakers.length < placeholders) {
      issues.push({ severity: "warning", message: `Only ${team.speakers.length} of ${placeholders} speakers named.` });
    }

    const key = normalizeName(team.name);
    const existing = key ? context.teams.find((item) => normalizeName(item.name) === key) : undefined;
    const match = existing ? { id: existing.id, name: existing.name, reason: "same team name" } : undefined;
    let duplicateOfRow: number | undefined;
    if (key && seen.has(key)) {
      duplicateOfRow = seen.get(key);
      issues.push({ severity: "warning", message: `Same team name as row ${duplicateOfRow}.` });
    } else if (key) {
      seen.set(key, record.rowNumber);
    }

    for (const speaker of team.speakers) {
      const email = normalizeEmail(speaker.email);
      if (!email) continue;
      const owner = emailOwners.get(email);
      const ownTeam = existing && existing.speakers.some((item) => normalizeEmail(item.email) === email);
      if (owner && !ownTeam) {
        issues.push({ severity: "warning", message: `${speaker.email} is also used by ${owner}.` });
      }
      if (!owner) emailOwners.set(email, `${speaker.name} (row ${record.rowNumber})`);
    }

    for (const names of parsed.speakerCategoryNames) collectNewSpeakerCategories(names, speakerCategories, newSpeakerCategories);
    const teamCategory = getField(record.values, "category", "Category").trim();
    if (teamCategory) collectNewSpeakerCategories([teamCategory], speakerCategories, newSpeakerCategories);

    const speakerSummary = placeholderSpeakers ? "no speakers" : team.speakers.map((speaker) => speaker.name).join(", ");
    return finishRow<PlannedTeam>({
      rowNumber: record.rowNumber,
      label: team.name || "(no name)",
      details: `${resolver.label(institution)} · ${speakerSummary}`,
      issues,
      draft: team.name
        ? { team, speakerCategoryNames: parsed.speakerCategoryNames, placeholderSpeakers }
        : undefined,
      match,
      duplicateOfRow,
      institution,
    });
  });

  return { rows, newInstitutions: [...resolver.created.values()], newSpeakerCategories };
}

function planAdjudicatorRows(
  records: CsvRecord[],
  context: ImportContext
): Pick<ImportPlan<PlannedAdjudicator>, "rows" | "newInstitutions" | "newSpeakerCategories"> {
  const resolver = new InstitutionResolver(context.institutions);
  const seen = new Map<string, number>();

  const rows = records.map((record) => {
    const issues = rowIssues(record, "adjudicators");
    const parsed = parseAdjudicatorRow(record.values, record.rowNumber);
    issues.push(...parsed.issues);
    const { adjudicator } = parsed;
    if (!adjudicator.name) issues.push({ severity: "error", message: "The adjudicator name is missing." });

    let institution: InstitutionRef | undefined;
    if (adjudicator.independent && adjudicator.institutionName) {
      issues.push({ severity: "warning", message: `Marked independent, so the institution "${adjudicator.institutionName}" is not linked.` });
    } else {
      institution = resolver.resolve(adjudicator.institutionName, record.rowNumber);
    }
    const institutionKey = institution
      ? "existingId" in institution ? institution.existingId : `new:${institution.newKey}`
      : "";

    const email = normalizeEmail(adjudicator.email);
    const nameKey = normalizeName(adjudicator.name);
    const sameInstitution = (existing: Adjudicator) =>
      institution && "existingId" in institution ? existing.institutionId === institution.existingId : !institution && !existing.institutionId;
    let match: ExistingMatch | undefined;
    const byEmail = email ? context.adjudicators.find((existing) => normalizeEmail(existing.email) === email) : undefined;
    if (byEmail) {
      match = { id: byEmail.id, name: byEmail.name, reason: "same email" };
    } else if (nameKey) {
      const byName = context.adjudicators.filter((existing) => normalizeName(existing.name) === nameKey);
      const exact = byName.find(sameInstitution);
      if (exact) match = { id: exact.id, name: exact.name, reason: "same name and institution" };
      else if (byName.length > 0) {
        issues.push({ severity: "warning", message: `An adjudicator called ${byName[0].name} already exists at another institution.` });
      }
    }

    const key = email ? `email:${email}` : `name:${nameKey}|${institutionKey}`;
    let duplicateOfRow: number | undefined;
    if (nameKey && seen.has(key)) {
      duplicateOfRow = seen.get(key);
      issues.push({ severity: "warning", message: `Same adjudicator as row ${duplicateOfRow}.` });
    } else if (nameKey) {
      seen.set(key, record.rowNumber);
    }

    const provided = {
      score: getField(record.values, "score", "Score", "rating", "Rating", "baseScore").trim() !== "",
      trainee: getField(record.values, "trainee", "Trainee").trim() !== "",
      independent: getField(record.values, "independent", "Independent", "indep").trim() !== "",
    };
    return finishRow<PlannedAdjudicator>({
      rowNumber: record.rowNumber,
      label: adjudicator.name || "(no name)",
      details: `${resolver.label(institution)} · score ${adjudicator.baseScore}${adjudicator.trainee ? " · trainee" : ""}`,
      issues,
      draft: adjudicator.name ? { adjudicator, provided } : undefined,
      match,
      duplicateOfRow,
      institution,
    });
  });

  return { rows, newInstitutions: [...resolver.created.values()], newSpeakerCategories: [] };
}

/* -------------------------------------------------------------------------- */
/* Commit                                                                      */
/* -------------------------------------------------------------------------- */

export interface ImportChoices {
  /** Chosen action by row number; rows not listed use their default. */
  actions?: Record<number, RowAction>;
  /** Edits to the new institutions by key; `create: false` leaves the name unlinked. */
  newInstitutions?: Record<string, { name?: string; code?: string; create?: boolean }>;
  /** Import the rows without errors and skip the rest. */
  validRowsOnly?: boolean;
}

export interface ImportCommit {
  institutionsCreated: Institution[];
  institutionsUpdated: Institution[];
  teamsCreated: Team[];
  teamsUpdated: Team[];
  adjudicatorsCreated: Adjudicator[];
  adjudicatorsUpdated: Adjudicator[];
  /** The full category list to save when the import adds categories; absent when unchanged. */
  speakerCategories?: SpeakerCategory[];
  skipped: number;
}

export interface CommitContext extends ImportContext {
  tournamentId: string;
  createId(prefix: string): string;
}

export function chosenAction(row: PlannedRow, choices: ImportChoices): RowAction {
  const chosen = choices.actions?.[row.rowNumber];
  return chosen && row.actions.includes(chosen) ? chosen : row.defaultAction;
}

export function countRowsWithErrors(plan: ImportPlan): number {
  return plan.rows.filter((row) => hasErrors(row.issues)).length;
}

/** Checks the edited new institutions: names and codes present and unique. */
export function validateNewInstitutions(plan: ImportPlan, choices: ImportChoices, existing: Institution[]): string[] {
  const errors: string[] = [];
  const codes = new Set(existing.map((institution) => institution.code.trim().toLowerCase()));
  const names = new Set(existing.map((institution) => normalizeName(institution.name)));
  for (const item of plan.newInstitutions) {
    const edit = choices.newInstitutions?.[item.key];
    if (edit?.create === false) continue;
    const name = (edit?.name ?? item.name).trim();
    const code = (edit?.code ?? item.code).trim();
    if (!name) errors.push(`A new institution (from row ${item.rowNumbers[0]}) needs a name.`);
    if (!code) errors.push(`New institution ${name || item.name} needs a code.`);
    else if (codes.has(code.toLowerCase())) errors.push(`Code ${code} for ${name} is already used.`);
    if (name && names.has(normalizeName(name))) errors.push(`An institution called ${name} already exists or is listed twice.`);
    codes.add(code.toLowerCase());
    names.add(normalizeName(name));
  }
  return errors;
}

/** Overlays an import onto an existing speaker list by position, keeping speaker ids (ballots use them). */
function mergeSpeakers(existing: Speaker[], incoming: Speaker[], createId: (prefix: string) => string): Speaker[] {
  if (incoming.length === 0) return existing;
  const merged = incoming.map((speaker, index) => {
    const previous = existing[index];
    if (!previous) return { ...speaker, id: createId("spk") };
    return {
      ...previous,
      name: speaker.name,
      email: speaker.email ?? previous.email,
      categories: speaker.categories ?? previous.categories,
    };
  });
  // Speakers beyond the imported ones stay: removing a speaker is done in the team editor.
  return [...merged, ...existing.slice(incoming.length)];
}

export function buildImportCommit(
  plan: ImportPlan,
  choices: ImportChoices,
  context: CommitContext
): { commit?: ImportCommit; errors: string[] } {
  const errors: string[] = [...plan.fileErrors];
  const rowsWithErrors = countRowsWithErrors(plan);
  if (rowsWithErrors > 0 && !choices.validRowsOnly) {
    errors.push(
      `${rowsWithErrors} row${rowsWithErrors === 1 ? " has" : "s have"} errors. Fix the file, or choose to import the valid rows only.`
    );
  }
  errors.push(...validateNewInstitutions(plan, choices, context.institutions));
  if (errors.length > 0) return { errors };

  const commit: ImportCommit = {
    institutionsCreated: [],
    institutionsUpdated: [],
    teamsCreated: [],
    teamsUpdated: [],
    adjudicatorsCreated: [],
    adjudicatorsUpdated: [],
    skipped: 0,
  };
  const active = plan.rows.filter((row) => {
    const action = chosenAction(row, choices);
    if (action === "skip" || !row.draft) commit.skipped += 1;
    return action !== "skip" && Boolean(row.draft);
  });

  // New institutions are created only when a row that is being imported uses them.
  const usedKeys = new Set(
    active.flatMap((row) => (row.institution && "newKey" in row.institution ? [row.institution.newKey] : []))
  );
  const newInstitutionIds = new Map<string, Institution>();
  for (const item of plan.newInstitutions) {
    const edit = choices.newInstitutions?.[item.key];
    if (!usedKeys.has(item.key) || edit?.create === false) continue;
    const institution: Institution = {
      id: context.createId("inst"),
      tournamentId: context.tournamentId,
      name: (edit?.name ?? item.name).trim(),
      code: (edit?.code ?? item.code).trim(),
    };
    newInstitutionIds.set(item.key, institution);
    commit.institutionsCreated.push(institution);
  }
  const institutionFor = (row: PlannedRow): Institution | undefined => {
    if (!row.institution) return undefined;
    if ("existingId" in row.institution) {
      const id = row.institution.existingId;
      return context.institutions.find((institution) => institution.id === id);
    }
    return newInstitutionIds.get(row.institution.newKey);
  };
  /** Name kept when the organiser declined to create the institution (legacy unlinked name). */
  const unlinkedName = (row: PlannedRow): string | undefined =>
    row.institution && "newKey" in row.institution && !newInstitutionIds.has(row.institution.newKey)
      ? plan.newInstitutions.find((item) => row.institution && "newKey" in row.institution && item.key === row.institution.newKey)?.name
      : undefined;

  if (plan.kind === "institutions") {
    for (const row of active as PlannedRow<InstitutionDraft>[]) {
      const draft = row.draft!;
      const action = chosenAction(row, choices);
      const existing = row.match && context.institutions.find((institution) => institution.id === row.match!.id);
      if (action === "update" && existing) {
        commit.institutionsUpdated.push({
          ...existing,
          name: draft.name,
          code: getCodeOrKeep(draft.code, draft.name, existing.code),
          region: draft.region ?? existing.region,
          venueRequirements: draft.venueRequirements ?? existing.venueRequirements,
        });
      } else {
        commit.institutionsCreated.push({ ...draft, id: context.createId("inst"), tournamentId: context.tournamentId });
      }
    }
    return { commit, errors };
  }

  if (plan.kind === "teams") {
    const categories: SpeakerCategoryView[] = [...(context.speakerCategories ?? [])];
    let categoriesChanged = false;
    let nextSeq = Math.max(0, ...categories.map((category) => category.seq)) + 1;
    const categoryIdsFor = (names: string[]): string[] | undefined => {
      if (names.length === 0) return undefined;
      const ids: string[] = [];
      for (const name of names) {
        let category = resolveSpeakerCategoryRef(name, categories);
        if (!category) {
          const slug = slugifyCategory(name);
          if (!slug) continue;
          category = { id: speakerCategoryIdForSlug(slug), name: name.trim(), slug, seq: nextSeq++, public: false };
          categories.push(category);
          categoriesChanged = true;
        } else if (category.unsaved) {
          category.unsaved = false;
          categoriesChanged = true;
        }
        if (!ids.includes(category.id)) ids.push(category.id);
      }
      return ids;
    };

    for (const row of active as PlannedRow<PlannedTeam>[]) {
      const { team, speakerCategoryNames, placeholderSpeakers } = row.draft!;
      const institution = institutionFor(row);
      const speakers: Speaker[] = team.speakers.map((speaker, index) => {
        const ids = categoryIdsFor(speakerCategoryNames[index] ?? []);
        const { categories: _labels, ...rest } = speaker;
        return { ...rest, ...(ids ? { categories: ids } : {}) };
      });
      const teamCategory = team.speakerCategories[0];
      if (teamCategory) categoryIdsFor([teamCategory]);
      const institutionFields = institution
        ? { institutionId: institution.id, institutionName: institution.name }
        : { institutionId: undefined, institutionName: unlinkedName(row) };

      const existing = row.match && context.teams.find((item) => item.id === row.match!.id);
      if (chosenAction(row, choices) === "update" && existing) {
        commit.teamsUpdated.push({
          ...existing,
          name: team.name,
          codeName: team.codeName ?? existing.codeName,
          divisionId: team.divisionId ?? existing.divisionId,
          divisionName: team.divisionName ?? existing.divisionName,
          ...(row.institution ? institutionFields : {}),
          venueRequirements: team.venueRequirements ?? existing.venueRequirements,
          speakers: mergeSpeakers(existing.speakers, speakers, context.createId),
          breakCategories: team.breakCategories.length > 0 ? team.breakCategories : existing.breakCategories,
          speakerCategories: team.speakerCategories.length > 0 ? team.speakerCategories : existing.speakerCategories,
        });
        continue;
      }
      const count = Math.max(1, context.substantiveSpeakers ?? 2);
      commit.teamsCreated.push({
        ...team,
        ...institutionFields,
        id: context.createId("team"),
        tournamentId: context.tournamentId,
        speakers: placeholderSpeakers
          ? Array.from({ length: count }, (_, index) => ({ id: context.createId("spk"), name: `${team.name} Speaker ${index + 1}` }))
          : speakers.map((speaker) => ({ ...speaker, id: context.createId("spk") })),
      });
    }
    if (categoriesChanged) commit.speakerCategories = toStoredSpeakerCategories(categories);
    return { commit, errors };
  }

  for (const row of active as PlannedRow<PlannedAdjudicator>[]) {
    const { adjudicator, provided } = row.draft!;
    const institution = institutionFor(row);
    const existing = row.match && context.adjudicators.find((item) => item.id === row.match!.id);
    if (chosenAction(row, choices) === "update" && existing) {
      // Blank cells keep the existing values; a new institution keeps the adjudicator's other conflicts.
      let updated: Adjudicator = {
        ...existing,
        name: adjudicator.name,
        email: adjudicator.email ?? existing.email,
        baseScore: provided.score ? adjudicator.baseScore : existing.baseScore,
        trainee: provided.trainee ? adjudicator.trainee : existing.trainee,
        preformedPanelId: adjudicator.preformedPanelId ?? existing.preformedPanelId,
        gender: adjudicator.gender ?? existing.gender,
        region: adjudicator.region ?? existing.region,
        venueRequirements: adjudicator.venueRequirements ?? existing.venueRequirements,
      };
      if (institution) updated = changeAdjudicatorInstitution(updated, institution);
      else if (provided.independent && adjudicator.independent) updated = changeAdjudicatorInstitution(updated, undefined);
      commit.adjudicatorsUpdated.push(updated);
      continue;
    }
    const base: Adjudicator = {
      ...adjudicator,
      id: context.createId("adj"),
      tournamentId: context.tournamentId,
      institutionId: undefined,
      institutionName: adjudicator.independent ? adjudicator.institutionName : unlinkedName(row),
      independent: adjudicator.independent || !institution,
    };
    commit.adjudicatorsCreated.push(institution ? changeAdjudicatorInstitution(base, institution) : base);
  }
  return { commit, errors };
}

function getCodeOrKeep(code: string, name: string, existingCode: string): string {
  // parseInstitutionRow derives a code from the name when the cell is blank; an update keeps the old one then.
  return code === deriveInstitutionCode(name) ? existingCode : code;
}

export function commitCounts(commit: ImportCommit): { created: number; updated: number } {
  return {
    created: commit.institutionsCreated.length + commit.teamsCreated.length + commit.adjudicatorsCreated.length,
    updated: commit.institutionsUpdated.length + commit.teamsUpdated.length + commit.adjudicatorsUpdated.length,
  };
}

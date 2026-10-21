import Papa from "papaparse";
import { parseVenueCategoryList, safeVenueUrl, withVenueCategories } from "@/lib/venues/venues";
import type { TeamSeedMode } from "@/types";
import { parseTeamSeed } from "@/lib/teamSeeds";
import { Team, Adjudicator, Institution, Venue, VenueRequirements, Motion, Round, TeamStandingRow, SpeakerStandingRow, BreakCategory, Speaker } from "@/types";
import { parseCategoryList, resolveBreakCategoryRefs } from "@/lib/teamCategories";
import { csvFileStem, teamStandingsCsv } from "@/lib/csv/exporters";
import { downloadCsv } from "@/lib/csv/download";

export interface TeamCsvRow {
  name: string;
  code?: string;
  institution?: string;
  division_id?: string;
  division?: string;
  required_venue_category?: string;
  min_venue_capacity?: string | number;
  requires_accessible_venue?: string | boolean;
  requires_online_venue?: string | boolean;
  requires_near_tab_room?: string | boolean;
  speaker1: string;
  speaker1_email?: string;
  speaker2: string;
  speaker2_email?: string;
  speaker3?: string;
  speaker3_email?: string;
  speaker1_categories?: string;
  speaker2_categories?: string;
  speaker3_categories?: string;
  category?: string;
  /** Break categories the team is eligible for, by name, slug or id, separated by "," or ";". */
  break_categories?: string;
}

export interface AdjudicatorCsvRow {
  name: string;
  institution?: string;
  score?: string | number;
  email?: string;
  trainee?: string | boolean;
  independent?: string | boolean;
  preformed_panel_id?: string;
  gender?: string;
  region?: string;
  required_venue_category?: string;
  min_venue_capacity?: string | number;
  requires_accessible_venue?: string | boolean;
  requires_online_venue?: string | boolean;
  requires_near_tab_room?: string | boolean;
}

export interface VenueCsvRow {
  name: string;
  priority?: string | number;
  category?: string;
  near_tab_room?: string | boolean;
}

export function getField(row: Record<string, string>, ...aliases: string[]): string {
  for (const alias of aliases) {
    if (row[alias] !== undefined) return row[alias];
    const lowerAlias = alias.toLowerCase();
    for (const key of Object.keys(row)) {
      if (key.toLowerCase() === lowerAlias) {
        return row[key];
      }
    }
  }
  return "";
}

function parseCsvFlag(raw: string, field: string, rowNumber: number): boolean | undefined {
  if (!raw.trim()) return undefined;
  if (/^(yes|true|1)$/i.test(raw.trim())) return true;
  if (/^(no|false|0)$/i.test(raw.trim())) return false;
  throw new Error(`Invalid ${field} value on CSV row ${rowNumber}: ${raw}`);
}

function parseVenueRequirements(row: Record<string, string>, rowNumber: number): VenueRequirements | undefined {
  const category = getField(row, "required_venue_category", "venue_category").trim();
  const capacityRaw = getField(row, "min_venue_capacity", "minimum_venue_capacity");
  const capacity = capacityRaw.trim() ? Number(capacityRaw) : undefined;
  if (capacity !== undefined && (!Number.isFinite(capacity) || capacity < 0)) {
    throw new Error(`Invalid minimum venue capacity on CSV row ${rowNumber}: ${capacityRaw}`);
  }
  const requirements: VenueRequirements = {
    category: category || undefined,
    minimumCapacity: capacity,
    accessible: parseCsvFlag(getField(row, "requires_accessible_venue", "venue_accessible"), "requires_accessible_venue", rowNumber),
    online: parseCsvFlag(getField(row, "requires_online_venue", "venue_online"), "requires_online_venue", rowNumber),
    nearTabRoom: parseCsvFlag(getField(row, "requires_near_tab_room", "venue_near_tab_room"), "requires_near_tab_room", rowNumber),
  };
  return Object.values(requirements).some((value) => value !== undefined) ? requirements : undefined;
}

/** Problems found in one CSV row. Errors stop the row being imported; warnings do not. */
export interface ImportIssue {
  severity: "error" | "warning";
  message: string;
}

/** Runs one field parser, turning a thrown error into a row error. */
function collect<T>(issues: ImportIssue[], parse: () => T): T | undefined {
  try {
    return parse();
  } catch (error) {
    issues.push({ severity: "error", message: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkEmail(email: string, who: string, issues: ImportIssue[]): string | undefined {
  const trimmed = email.trim();
  if (!trimmed) return undefined;
  if (!EMAIL_PATTERN.test(trimmed)) {
    issues.push({ severity: "error", message: `${who} email "${trimmed}" is not a valid address.` });
  }
  return trimmed;
}

/**
 * Splits a category cell ("ESL; Novice") into names, keeping the organiser's spelling and
 * dropping repeats that differ only in case.
 */
export function splitCategoryNames(raw: string): string[] {
  const names: string[] = [];
  for (const part of raw.split(/[,;|]/)) {
    const name = part.trim().replace(/\s+/g, " ");
    if (name && !names.some((existing) => existing.toLowerCase() === name.toLowerCase())) names.push(name);
  }
  return names;
}

export type TeamDraft = Omit<Team, "id" | "tournamentId">;

export interface ParsedTeamRow {
  team: TeamDraft;
  issues: ImportIssue[];
  /** Speaker category names per speaker, as written (resolved to category ids by the import plan). */
  speakerCategoryNames: string[][];
}

/** Speaker columns read from a team row: speaker1 … speaker5. */
const MAX_SPEAKER_COLUMNS = 5;

/**
 * Parses one team row without inventing data: a missing name or missing speakers are left for
 * the caller to report. Speaker ids are blank for the caller to assign.
 */
export function parseTeamRow(
  row: Record<string, string>,
  rowNumber: number,
  breakCategories: BreakCategory[] = [],
  options: { seedMode?: TeamSeedMode } = {}
): ParsedTeamRow {
  const issues: ImportIssue[] = [];
  const name = getField(row, "name", "team", "Team", "team_name", "Team Name").trim().replace(/\s+/g, " ");

  const speakers: Speaker[] = [];
  const speakerCategoryNames: string[][] = [];
  for (let position = 1; position <= MAX_SPEAKER_COLUMNS; position += 1) {
    const speakerName = getField(row, `speaker${position}`, `Speaker${position}`, `speaker_${position}`, `Speaker ${position}`).trim();
    const email = getField(row, `speaker${position}_email`, `Speaker ${position} Email`);
    const categoryCell = getField(row, `speaker${position}_categories`, `Speaker ${position} Categories`, `speaker${position}_category`);
    if (!speakerName) {
      if (email.trim() || categoryCell.trim()) {
        issues.push({ severity: "error", message: `Speaker ${position} has an email or categories but no name.` });
      }
      continue;
    }
    const categories = parseCategoryList(categoryCell);
    speakers.push({
      id: "",
      name: speakerName.replace(/\s+/g, " "),
      email: checkEmail(email, `Speaker ${position}`, issues),
      ...(categories.length > 0 ? { categories } : {}),
    });
    speakerCategoryNames.push(splitCategoryNames(categoryCell));
  }

  const breakRefs = parseCategoryList(getField(row, "break_categories", "Break Categories", "break_category"));
  const resolvedBreaks = resolveBreakCategoryRefs(breakRefs, breakCategories);
  if (resolvedBreaks.unknown.length > 0) {
    issues.push({
      severity: "error",
      message: `Unknown break categor${resolvedBreaks.unknown.length === 1 ? "y" : "ies"} on CSV row ${rowNumber}: ${resolvedBreaks.unknown.join(", ")}. Create ${resolvedBreaks.unknown.length === 1 ? "it" : "them"} on the Break page first.`,
    });
  }

  // The seed column is read only when the tournament asks for seeds (Tabbycat show_seed_in_importer).
  const seedMode = options.seedMode ?? "off";
  let seed: number | undefined;
  if (seedMode !== "off") {
    const parsedSeed = parseTeamSeed(getField(row, "seed", "Seed"), seedMode);
    if (parsedSeed.ok) seed = parsedSeed.seed;
    else issues.push({ severity: "error", message: `${parsedSeed.error} (CSV row ${rowNumber})` });
  }

  const category = getField(row, "category", "Category").trim();
  const institutionName = getField(row, "institution", "Institution", "inst", "Inst").trim();
  const team: TeamDraft = {
    name,
    codeName: getField(row, "code", "Code").trim() || undefined,
    divisionId: getField(row, "division_id", "divisionId", "division").trim() || undefined,
    divisionName: getField(row, "division", "Division", "division_id", "divisionId").trim() || undefined,
    institutionName: institutionName || undefined,
    venueRequirements: collect(issues, () => parseVenueRequirements(row, rowNumber)),
    speakers,
    breakCategories: resolvedBreaks.ids,
    speakerCategories: category ? [category.toLowerCase()] : [],
    ...(seed !== undefined ? { seed } : {}),
    checkedIn: true,
  };
  return { team, issues, speakerCategoryNames };
}

export type AdjudicatorDraft = Omit<Adjudicator, "id" | "tournamentId">;

export const DEFAULT_ADJUDICATOR_SCORE = 5;

export function parseAdjudicatorRow(
  row: Record<string, string>,
  rowNumber: number
): { adjudicator: AdjudicatorDraft; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const name = getField(row, "name", "Name", "adjudicator", "Adjudicator", "judge", "Judge").trim().replace(/\s+/g, " ");
  const scoreRaw = getField(row, "score", "Score", "rating", "Rating", "baseScore").trim();
  const score = scoreRaw ? Number(scoreRaw) : DEFAULT_ADJUDICATOR_SCORE;
  if (!Number.isFinite(score)) {
    issues.push({ severity: "error", message: `Invalid score value on CSV row ${rowNumber}: ${scoreRaw}` });
  }
  const adjudicator: AdjudicatorDraft = {
    name,
    email: checkEmail(getField(row, "email", "Email"), "The", issues),
    institutionName: getField(row, "institution", "Institution", "inst", "Inst").trim() || undefined,
    baseScore: Number.isFinite(score) ? score : DEFAULT_ADJUDICATOR_SCORE,
    trainee: collect(issues, () => parseCsvFlag(getField(row, "trainee", "Trainee"), "trainee", rowNumber)) ?? false,
    independent:
      collect(issues, () => parseCsvFlag(getField(row, "independent", "Independent", "indep"), "independent", rowNumber)) ?? false,
    preformedPanelId: getField(row, "preformed_panel_id", "preformedPanelId").trim() || undefined,
    gender: getField(row, "gender", "Gender").trim() || undefined,
    region: getField(row, "region", "Region").trim() || undefined,
    venueRequirements: collect(issues, () => parseVenueRequirements(row, rowNumber)),
    checkedIn: true,
    conflicts: [],
  };
  return { adjudicator, issues };
}

export type InstitutionDraft = Omit<Institution, "id" | "tournamentId">;

/** Institution name abbreviated to a code, as the add-institution form does. */
export function deriveInstitutionCode(name: string): string {
  return name.trim().substring(0, 4).toUpperCase();
}

export function parseInstitutionRow(
  row: Record<string, string>,
  rowNumber: number
): { institution: InstitutionDraft; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const extraFields = (row as Record<string, string> & { __parsed_extra?: string[] }).__parsed_extra ?? [];
  const values = [
    getField(row, "name", "Name", "institution", "Institution", "institution name", "Institution Name"),
    getField(row, "code", "Code", "abbr", "Abbr", "institution code", "Institution Code"),
    getField(row, "region", "Region"),
    ...extraFields,
  ];
  // Older exports wrote names such as "University, City" unquoted: the extra cells belong to the name.
  const name = (extraFields.length > 0
    ? values.slice(0, -2).map((value) => value.trim()).join(", ")
    : values[0].trim()).replace(/\s+/g, " ");
  const code = (extraFields.length > 0 ? values[values.length - 2] : values[1])?.trim();
  const region = (extraFields.length > 0 ? values[values.length - 1] : values[2])?.trim();
  if (extraFields.length > 0) {
    issues.push({ severity: "warning", message: `Unquoted commas: the name was read as "${name}".` });
  }
  return {
    institution: {
      name,
      code: code || deriveInstitutionCode(name),
      region: region || undefined,
      venueRequirements: collect(issues, () => parseVenueRequirements(row, rowNumber)),
    },
    issues,
  };
}

function throwFirstError(issues: ImportIssue[]): void {
  const error = issues.find((issue) => issue.severity === "error");
  if (error) throw new Error(error.message);
}

/**
 * Parses CSV text to Teams and Speakers array, filling a missing name or speakers with
 * placeholders. Kept for fixtures and tests; the Teams page imports through the previewed
 * plan in importPlan.ts, which reports those gaps instead.
 *
 * Optional columns: `speakerN_categories` (e.g. "esl; novice") and
 * `break_categories` (names, slugs or ids of the tournament's break
 * categories). An unknown break category rejects the import with its row
 * number rather than silently dropping the team's eligibility.
 */
export function parseTeamsCsv(
  csvContent: string,
  tournamentId: string,
  breakCategories: BreakCategory[] = []
): Team[] {
  const parsed = Papa.parse<Record<string, string>>(csvContent, { header: true, skipEmptyLines: true });
  return parsed.data.map((row, idx) => {
    const { team, issues } = parseTeamRow(row, idx + 2, breakCategories);
    throwFirstError(issues);
    const name = team.name || `Team ${idx + 1}`;
    const speakers = team.speakers.length > 0
      ? team.speakers.map((speaker, position) => ({ ...speaker, id: `spk-${Date.now()}-${idx}-${position + 1}` }))
      : [1, 2].map((position) => ({ id: `spk-${Date.now()}-${idx}-${position}`, name: `${name} Speaker ${position}` }));
    return { ...team, id: `team-${Date.now()}-${idx}`, tournamentId, name, speakers };
  });
}

/**
 * Parses CSV text to Adjudicators array.
 */
export function parseAdjudicatorsCsv(csvContent: string, tournamentId: string): Adjudicator[] {
  const parsed = Papa.parse<Record<string, string>>(csvContent, { header: true, skipEmptyLines: true });
  return parsed.data.map((row, idx) => {
    const { adjudicator, issues } = parseAdjudicatorRow(row, idx + 2);
    throwFirstError(issues);
    return {
      ...adjudicator,
      id: `adj-${Date.now()}-${idx}`,
      tournamentId,
      name: adjudicator.name || `Judge ${idx + 1}`,
    };
  });
}

/**
 * Parses CSV text to Venues array.
 */
export function parseVenuesCsv(csvContent: string, tournamentId: string): Venue[] {
  const parsed = Papa.parse<Record<string, string>>(csvContent, { header: true, skipEmptyLines: true });
  const venues: Venue[] = [];

  parsed.data.forEach((row, idx) => {
    const name = getField(row, "name", "Name", "room", "Room", "venue", "Venue") || `Room ${idx + 1}`;
    const priorityRaw = getField(row, "priority", "Priority") || "10";
    const priority = parseInt(priorityRaw, 10) || 10;
    // Several categories are separated by ";" or "," ("Accessible; Large").
    const categories = parseVenueCategoryList(getField(row, "category", "Category", "categories", "Categories") || "");
    const capacityRaw = getField(row, "capacity", "Capacity", "seats", "Seats");
    const capacity = capacityRaw?.trim() ? Number(capacityRaw) : undefined;
    const accessibleRaw = getField(row, "accessible", "Accessible");
    const onlineRaw = getField(row, "online", "Online");
    const urlRaw = getField(row, "url", "URL", "link", "meeting_url")?.trim();
    // Room links are shown to participants: only http(s) links are accepted.
    if (urlRaw && !safeVenueUrl(urlRaw)) {
      throw new Error(`Invalid venue URL on CSV row ${idx + 2}: use an http(s) link.`);
    }

    if (
      capacity !== undefined &&
      (!Number.isFinite(capacity) || capacity < 0)
    ) {
      throw new Error(`Invalid venue capacity on CSV row ${idx + 2}: ${capacityRaw}`);
    }

    venues.push(withVenueCategories({
      id: `venue-${Date.now()}-${idx}`,
      tournamentId,
      name: name.trim(),
      priority,
      capacity,
      accessible: parseCsvFlag(accessibleRaw, "accessible", idx + 2),
      online: parseCsvFlag(onlineRaw, "online", idx + 2),
      nearTabRoom: parseCsvFlag(getField(row, "near_tab_room", "nearTabRoom"), "near_tab_room", idx + 2),
      ...(urlRaw ? { url: safeVenueUrl(urlRaw) } : {}),
      available: true,
    } as Venue, categories));
  });

  return venues;
}

/**
 * Parses CSV text to Institutions array.
 */
export function parseInstitutionsCsv(csvContent: string, tournamentId: string): Institution[] {
  const parsed = Papa.parse<Record<string, string>>(csvContent, { header: true, skipEmptyLines: true });
  return parsed.data.map((row, idx) => {
    const { institution, issues } = parseInstitutionRow(row, idx + 2);
    throwFirstError(issues);
    const name = institution.name || `Institution ${idx + 1}`;
    return {
      ...institution,
      id: `inst-${Date.now()}-${idx}`,
      tournamentId,
      name,
      code: institution.code || deriveInstitutionCode(name),
    };
  });
}

/**
 * Parses CSV text to Motions array.
 */
export function parseMotionsCsv(
  csvContent: string,
  tournamentId: string,
  rounds: Round[] = []
): Motion[] {
  const parsed = Papa.parse<Record<string, string>>(csvContent, { header: true, skipEmptyLines: true });
  const motions: Motion[] = [];

  parsed.data.forEach((row, idx) => {
    const text = getField(row, "text", "motion", "Motion", "motion_text", "Motion Text", "Text");
    if (!text.trim()) return;

    const reference =
      getField(row, "reference", "ref", "Reference", "topic", "Topic", "tag", "Tag") ||
      `Motion ${idx + 1}`;
    const infoSlide =
      getField(row, "infoslide", "info_slide", "info", "Infoslide", "Info Slide", "context", "Context") ||
      undefined;
    const roundRaw = getField(row, "round", "Round", "round_abbr", "round_seq", "round_name");

    const matchedRounds: string[] = [];
    if (roundRaw && rounds.length > 0) {
      const q = roundRaw.trim().toLowerCase();
      const matched = rounds.find(
        (r) =>
          r.id.toLowerCase() === q ||
          r.name.toLowerCase() === q ||
          r.abbreviation.toLowerCase() === q ||
          `r${r.seq}` === q ||
          `${r.seq}` === q ||
          `round ${r.seq}` === q
      );
      if (matched) {
        matchedRounds.push(matched.id);
      }
    }

    motions.push({
      id: `motion-${Date.now()}-${idx}`,
      tournamentId,
      text: text.trim(),
      reference: reference.trim(),
      infoSlide: infoSlide ? infoSlide.trim() : undefined,
      rounds: matchedRounds,
      seq: idx + 1,
      released: false, // Don't make them public by default
    });
  });

  return motions;
}

/**
 * Exports team standings to a downloadable CSV file.
 */
export function exportStandingsToCsv(standings: TeamStandingRow[], tournamentName: string) {
  downloadCsv(`${csvFileStem(tournamentName)}_Standings.csv`, teamStandingsCsv(standings));
}

import Papa from "papaparse";
import { Team, Adjudicator, Institution, Venue, VenueRequirements, Motion, Round, TeamStandingRow, SpeakerStandingRow } from "@/types";

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
  category?: string;
}

export interface AdjudicatorCsvRow {
  name: string;
  institution?: string;
  score?: string | number;
  email?: string;
  trainee?: string | boolean;
  independent?: string | boolean;
  preformed_panel_id?: string;
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

function getField(row: Record<string, string>, ...aliases: string[]): string {
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

/**
 * Parses CSV text to Teams and Speakers array.
 */
export function parseTeamsCsv(csvContent: string, tournamentId: string): Team[] {
  const parsed = Papa.parse<Record<string, string>>(csvContent, { header: true, skipEmptyLines: true });
  const teams: Team[] = [];

  parsed.data.forEach((row, idx) => {
    const name = getField(row, "name", "team", "Team") || `Team ${idx + 1}`;
    const instName = getField(row, "institution", "Institution", "inst", "Inst");
    const speakers = [];

    // Extract speaker 1, 2, 3, etc.
    const spk1 = getField(row, "speaker1", "Speaker1", "speaker_1", "Speaker 1");
    if (spk1) speakers.push({ id: `spk-${Date.now()}-${idx}-1`, name: spk1.trim(), email: getField(row, "speaker1_email", "Speaker 1 Email") });

    const spk2 = getField(row, "speaker2", "Speaker2", "speaker_2", "Speaker 2");
    if (spk2) speakers.push({ id: `spk-${Date.now()}-${idx}-2`, name: spk2.trim(), email: getField(row, "speaker2_email", "Speaker 2 Email") });

    const spk3 = getField(row, "speaker3", "Speaker3", "speaker_3", "Speaker 3");
    if (spk3) speakers.push({ id: `spk-${Date.now()}-${idx}-3`, name: spk3.trim(), email: getField(row, "speaker3_email", "Speaker 3 Email") });

    // If no numbered speakers, check single speakers column or default
    if (speakers.length === 0) {
      speakers.push({ id: `spk-${Date.now()}-${idx}-1`, name: `${name} Speaker 1` });
      speakers.push({ id: `spk-${Date.now()}-${idx}-2`, name: `${name} Speaker 2` });
    }

    const category = getField(row, "category", "Category");

    teams.push({
      id: `team-${Date.now()}-${idx}`,
      tournamentId,
      name: name.trim(),
      codeName: getField(row, "code", "Code") || undefined,
      divisionId: getField(row, "division_id", "divisionId", "division") || undefined,
      divisionName: getField(row, "division", "Division", "division_id", "divisionId") || undefined,
      institutionName: instName.trim() || undefined,
      venueRequirements: parseVenueRequirements(row, idx + 2),
      speakers,
      breakCategories: [],
      speakerCategories: category ? [category.toLowerCase().trim()] : [],
      checkedIn: true,
    });
  });

  return teams;
}

/**
 * Parses CSV text to Adjudicators array.
 */
export function parseAdjudicatorsCsv(csvContent: string, tournamentId: string): Adjudicator[] {
  const parsed = Papa.parse<Record<string, string>>(csvContent, { header: true, skipEmptyLines: true });
  const adjs: Adjudicator[] = [];

  parsed.data.forEach((row, idx) => {
    const name = getField(row, "name", "Name", "adjudicator", "Adjudicator", "judge", "Judge") || `Judge ${idx + 1}`;
    const scoreRaw = getField(row, "score", "Score", "rating", "Rating", "baseScore") || "5.0";
    const scoreVal = parseFloat(scoreRaw) || 5.0;

    const traineeRaw = getField(row, "trainee", "Trainee").toLowerCase();
    const isTrainee = traineeRaw === "true" || traineeRaw === "yes" || traineeRaw === "1";

    const indepRaw = getField(row, "independent", "Independent", "indep").toLowerCase();
    const isIndep = indepRaw === "true" || indepRaw === "yes" || indepRaw === "1";

    adjs.push({
      id: `adj-${Date.now()}-${idx}`,
      tournamentId,
      name: name.trim(),
      email: getField(row, "email", "Email") || undefined,
      institutionName: getField(row, "institution", "Institution", "inst", "Inst").trim() || undefined,
      baseScore: scoreVal,
      trainee: isTrainee,
      independent: isIndep,
      preformedPanelId: getField(row, "preformed_panel_id", "preformedPanelId").trim() || undefined,
      venueRequirements: parseVenueRequirements(row, idx + 2),
      checkedIn: true,
      conflicts: [],
    });
  });

  return adjs;
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
    const category = getField(row, "category", "Category") || undefined;
    const capacityRaw = getField(row, "capacity", "Capacity", "seats", "Seats");
    const capacity = capacityRaw?.trim() ? Number(capacityRaw) : undefined;
    const accessibleRaw = getField(row, "accessible", "Accessible");
    const onlineRaw = getField(row, "online", "Online");

    if (
      capacity !== undefined &&
      (!Number.isFinite(capacity) || capacity < 0)
    ) {
      throw new Error(`Invalid venue capacity on CSV row ${idx + 2}: ${capacityRaw}`);
    }

    venues.push({
      id: `venue-${Date.now()}-${idx}`,
      tournamentId,
      name: name.trim(),
      priority,
      category,
      capacity,
      accessible: parseCsvFlag(accessibleRaw, "accessible", idx + 2),
      online: parseCsvFlag(onlineRaw, "online", idx + 2),
      nearTabRoom: parseCsvFlag(getField(row, "near_tab_room", "nearTabRoom"), "near_tab_room", idx + 2),
      available: true,
    });
  });

  return venues;
}

/**
 * Parses CSV text to Institutions array.
 */
export function parseInstitutionsCsv(csvContent: string, tournamentId: string): Institution[] {
  const parsed = Papa.parse<Record<string, string>>(csvContent, { header: true, skipEmptyLines: true });
  const insts: Institution[] = [];

  parsed.data.forEach((row, idx) => {
    const extraFields = (row as Record<string, string> & { __parsed_extra?: string[] }).__parsed_extra ?? [];
    const values = [
      getField(row, "name", "Name", "institution", "Institution", "institution name", "Institution Name"),
      getField(row, "code", "Code", "abbr", "Abbr", "institution code", "Institution Code"),
      getField(row, "region", "Region"),
      ...extraFields,
    ];
    const name = extraFields.length > 0
      ? values.slice(0, -2).map((value) => value.trim()).join(", ")
      : values[0].trim();
    const code = extraFields.length > 0 ? values[values.length - 2] : values[1];
    const region = extraFields.length > 0 ? values[values.length - 1] : values[2];
    const institutionName = name || `Institution ${idx + 1}`;
    const institutionCode = code?.trim() || institutionName.substring(0, 4).toUpperCase();

    insts.push({
      id: `inst-${Date.now()}-${idx}`,
      tournamentId,
      name: institutionName,
      code: institutionCode,
      region: region?.trim() || undefined,
      venueRequirements: parseVenueRequirements(row, idx + 2),
    });
  });

  return insts;
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
 * Exports standings to downloadable CSV file.
 */
export function exportStandingsToCsv(standings: TeamStandingRow[], tournamentName: string) {
  const csvData = standings.map((s) => ({
    Rank: s.rank,
    Team: s.teamName,
    Institution: s.institutionCode || "",
    Points: s.points,
    "Total Speaker Score": s.totalSpeakerScore,
    "Average Speaker Score": s.averageSpeakerScore,
    "1st Places": s.firstPlaces || 0,
    "2nd Places": s.secondPlaces || 0,
    "3rd Places": s.thirdPlaces || 0,
    "4th Places": s.fourthPlaces || 0,
    Wins: s.wins || 0,
    Margin: s.margins || 0,
  }));

  const csv = Papa.unparse(csvData);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `${tournamentName}_Standings.csv`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

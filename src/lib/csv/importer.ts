import Papa from "papaparse";
import { Team, Adjudicator, Institution, Venue, TeamStandingRow, SpeakerStandingRow } from "@/types";

export interface TeamCsvRow {
  name: string;
  code?: string;
  institution?: string;
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
}

export interface VenueCsvRow {
  name: string;
  priority?: string | number;
  category?: string;
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
      institutionName: instName.trim() || undefined,
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

    venues.push({
      id: `venue-${Date.now()}-${idx}`,
      tournamentId,
      name: name.trim(),
      priority,
      category,
      available: true,
    });
  });

  return venues;
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

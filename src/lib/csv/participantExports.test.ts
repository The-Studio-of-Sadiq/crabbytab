import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import type { Adjudicator, BreakCategory, Institution, Round, SpeakerCategory, Team, Venue } from "@/types";
import { applyConflictsPlan, planConflictsImport } from "./conflictsImport";
import {
  adjudicatorsCsv,
  availabilityCsv,
  breakEligibilityCsv,
  conflictsCsv,
  institutionsCsv,
  speakersCsv,
  teamsCsv,
} from "./participantExports";

const institutions: Institution[] = [
  { id: "inst-a", tournamentId: "t", name: "Avon, College", code: "AVN" },
  { id: "inst-b", tournamentId: "t", name: "Blyth", code: "BLY", region: "North" },
];
const speakerCategories: SpeakerCategory[] = [{ id: "spkcat-esl", name: "ESL", slug: "esl", seq: 1, public: true }];
const breakCategories: BreakCategory[] = [
  { id: "bc-open", tournamentId: "t", name: "Open", slug: "open", seq: 1, breakSize: 4, reserveSize: 0, isGeneral: true, priority: 10 },
  {
    id: "bc-esl", tournamentId: "t", name: "ESL", slug: "esl", seq: 2, breakSize: 2, reserveSize: 0, isGeneral: false, priority: 5,
    speakerCategoryRule: { speakerCategoryId: "spkcat-esl" }, teamOverrides: { "team-2": "withdrawn" },
  },
];
const teams: Team[] = [
  {
    id: "team-1", tournamentId: "t", name: "Avon \"A\"", institutionId: "inst-a", institutionName: "Avon, College",
    speakers: [
      { id: "s1", name: "=SUM(A1)", email: "s1@example.test", categories: ["spkcat-esl"] },
      { id: "s2", name: "Line\nbreak", categories: ["spkcat-esl"] },
    ],
    breakCategories: ["bc-open"], speakerCategories: [], privateUrlKey: "team_secretkey1", privatePasscode: "pass-secret",
    institutionConflictIds: ["inst-b"], checkedIn: true,
  },
  {
    id: "team-2", tournamentId: "t", name: "Blyth A", codeName: "Comet", institutionId: "inst-b",
    speakers: [{ id: "s3", name: "Cara" }], breakCategories: ["bc-open"], speakerCategories: [],
    roundAvailability: { r2: false }, checkedIn: true,
  },
];
const adjudicators: Adjudicator[] = [
  {
    id: "adj-1", tournamentId: "t", name: "Dana", email: "dana@example.test", institutionId: "inst-a", baseScore: 6, trainee: false,
    independent: false, checkedIn: true, privateUrlKey: "adj_secretkey", privatePasscode: "adj-pass",
    conflicts: [
      { teamId: "team-2", type: "personal" },
      { adjudicatorId: "adj-2", type: "personal" },
      { institutionId: "inst-b", type: "institution" },
      { institutionId: "inst-a", type: "institution" },
      { teamId: "team-1", type: "history" },
    ],
  },
  {
    id: "adj-2", tournamentId: "t", name: "Dana", email: "dana2@example.test", baseScore: 4.5, trainee: true, independent: true,
    checkedIn: false, conflicts: [{ adjudicatorId: "adj-1", type: "personal" }],
  },
];

function parse(csv: string): Record<string, string>[] {
  return Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true }).data;
}

describe("participant CSV exports", () => {
  const context = { institutions, breakCategories, speakerCategories };

  it("escapes commas, quotes, newlines and formulas", () => {
    const rows = parse(teamsCsv(teams, context));
    expect(rows[0]).toMatchObject({ name: "Avon \"A\"", institution: "Avon, College", speaker1: "'=SUM(A1)", speaker2: "Line\nbreak", break_categories: "Open" });
    expect(rows[1]).toMatchObject({ code_name: "Comet", speaker1: "Cara", speaker2: "" });
  });

  it("never exports private URL keys or passcodes", () => {
    const all = [teamsCsv(teams, context), speakersCsv(teams, context), adjudicatorsCsv(adjudicators, context)].join("\n");
    expect(all).not.toMatch(/secret|pass-|adj-pass|privateUrlKey/);
  });

  it("exports one row per speaker with names of their categories", () => {
    expect(parse(speakersCsv(teams, context))).toEqual([
      expect.objectContaining({ id: "s1", team: "Avon \"A\"", email: "s1@example.test", categories: "ESL" }),
      expect.objectContaining({ id: "s2", categories: "ESL" }),
      expect.objectContaining({ id: "s3", team: "Blyth A", categories: "" }),
    ]);
  });

  it("exports adjudicators and institutions with counts", () => {
    expect(parse(adjudicatorsCsv(adjudicators, context))[1]).toMatchObject({ id: "adj-2", base_score: "4.5", trainee: "yes", independent: "yes" });
    expect(parse(institutionsCsv(institutions, teams, adjudicators))).toEqual([
      expect.objectContaining({ name: "Avon, College", teams: "1", adjudicators: "1" }),
      expect.objectContaining({ name: "Blyth", region: "North", teams: "1", adjudicators: "0" }),
    ]);
  });

  it("exports availability per round, applying round availability and skipping cancelled rounds", () => {
    const rounds = [
      { id: "r1", seq: 1, name: "Round 1", abbreviation: "R1" },
      { id: "r2", seq: 2, name: "Round 2", abbreviation: "R2" },
      { id: "r3", seq: 3, name: "Round 3", abbreviation: "R3", cancelled: true },
    ] as Round[];
    const venues: Venue[] = [{ id: "v1", tournamentId: "t", name: "Hall", priority: 1, available: false }];
    const rows = parse(availabilityCsv({ rounds, teams, adjudicators, venues }));
    expect(Object.keys(rows[0])).toEqual(["type", "id", "name", "R1", "R2"]);
    expect(rows.find((row) => row.id === "team-2")).toMatchObject({ R1: "yes", R2: "no" });
    expect(rows.find((row) => row.id === "adj-2")).toMatchObject({ R1: "no", R2: "no" });
    expect(rows.find((row) => row.id === "v1")).toMatchObject({ type: "venue", R1: "no" });
  });

  it("exports break eligibility with overrides and the speaker-category rule", () => {
    const rows = parse(breakEligibilityCsv(teams, breakCategories, speakerCategories));
    expect(rows).toEqual([
      expect.objectContaining({ team: "Avon \"A\"", break_category: "Open", eligible: "yes", override: "" }),
      expect.objectContaining({ team: "Avon \"A\"", break_category: "ESL", eligible: "no", meets_rule: "yes", speaker_category_rule: "every speaker in ESL" }),
      expect.objectContaining({ team: "Blyth A", break_category: "Open", eligible: "yes" }),
      expect.objectContaining({ team: "Blyth A", break_category: "ESL", override: "withdrawn", meets_rule: "no" }),
    ]);
  });

  it("exports conflicts in the import format and round-trips through the importer", () => {
    const csv = conflictsCsv({ adjudicators, teams, institutions });
    const rows = parse(csv);
    // Duplicate adjudicator names fall back to email; history and own-institution conflicts are left out;
    // the mutual adjudicator conflict appears once.
    expect(rows).toEqual([
      { adjudicator: "dana@example.test", team: "Blyth A", institution: "", other_adjudicator: "", type: "adjudicator-team" },
      { adjudicator: "dana@example.test", team: "", institution: "", other_adjudicator: "dana2@example.test", type: "adjudicator-adjudicator" },
      { adjudicator: "dana@example.test", team: "", institution: "Blyth", other_adjudicator: "", type: "adjudicator-institution" },
      { adjudicator: "", team: "Avon \"A\"", institution: "Blyth", other_adjudicator: "", type: "team-institution" },
    ]);

    // Importing the export into a copy without those conflicts restores exactly them.
    const stripped = {
      adjudicators: adjudicators.map((adjudicator) => ({ ...adjudicator, conflicts: adjudicator.conflicts.filter((conflict) => conflict.type === "history") })),
      teams: teams.map((team) => ({ ...team, institutionConflictIds: [] })),
      institutions,
    };
    const plan = planConflictsImport(csv, stripped);
    expect(plan.fileErrors).toEqual([]);
    expect(plan.rows.map((row) => row.status)).toEqual(["add", "add", "add", "add"]);
    const applied = applyConflictsPlan(plan, stripped);
    const merge = <T extends { id: string }>(all: T[], changed: T[]) => all.map((item) => changed.find((next) => next.id === item.id) ?? item);
    expect(conflictsCsv({
      adjudicators: merge(stripped.adjudicators, applied.adjudicators),
      teams: merge(stripped.teams, applied.teams),
      institutions,
    })).toBe(csv);
  });
});

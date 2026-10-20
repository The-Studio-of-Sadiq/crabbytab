import type { Adjudicator, BreakCategory, Institution, Round, SpeakerCategory, Team, Venue } from "@/types";
import { isAvailableForRound } from "@/lib/roundAvailability";
import { describeEligibilityRule, speakerCategoryNames, speakerCategoryRefs, teamMeetsEligibilityRule } from "@/lib/speakerCategories";
import { toCsv } from "./exporters";

/**
 * CSV exports of participants, availability, break eligibility and conflicts (Tabbycat's
 * participant and conflict exports). Pure functions over tournament records; `toCsv` escapes
 * commas, quotes and newlines and neutralises spreadsheet formulas. Private URL keys and passcodes
 * are never exported (private URL slips have their own page).
 *
 * Columns that the CSV importers read use the importers' names, so an export can be edited and
 * imported again (the conflicts export round-trips through `planConflictsImport`).
 */

const yesNo = (value: boolean | undefined) => (value ? "yes" : "no");
const list = (values: Array<string | undefined>) => values.filter(Boolean).join("; ");
const byName = <T extends { name: string; id: string }>(left: T, right: T) =>
  left.name.localeCompare(right.name) || left.id.localeCompare(right.id);

function institutionLabel(id: string | undefined, fallback: string | undefined, institutions: Map<string, Institution>): string {
  return (id ? institutions.get(id)?.name : undefined) ?? fallback ?? "";
}

export interface ParticipantExportContext {
  institutions: Institution[];
  breakCategories: BreakCategory[];
  speakerCategories: SpeakerCategory[];
}

function lookups(context: ParticipantExportContext) {
  return {
    institutions: new Map(context.institutions.map((institution) => [institution.id, institution])),
    breakCategories: new Map(context.breakCategories.map((category) => [category.id, category])),
  };
}

/** One row per team, speakers in their speaking-roster order. */
export function teamsCsv(teams: Team[], context: ParticipantExportContext): string {
  const { institutions, breakCategories } = lookups(context);
  const maxSpeakers = Math.max(0, ...teams.map((team) => team.speakers.length));
  return toCsv(
    [
      "id",
      "name",
      "code_name",
      "institution",
      "emoji",
      "seed",
      ...Array.from({ length: maxSpeakers }, (_, index) => `speaker${index + 1}`),
      "break_categories",
      "swing",
    ],
    [...teams].sort(byName).map((team) => [
      team.id,
      team.name,
      team.codeName,
      institutionLabel(team.institutionId, team.institutionName, institutions),
      team.emoji,
      team.seed,
      ...Array.from({ length: maxSpeakers }, (_, index) => team.speakers[index]?.name ?? ""),
      list((team.breakCategories ?? []).map((id) => breakCategories.get(id)?.name ?? id)),
      yesNo(team.isSwing),
    ])
  );
}

/** One row per speaker. */
export function speakersCsv(teams: Team[], context: ParticipantExportContext): string {
  const { institutions } = lookups(context);
  return toCsv(
    ["id", "name", "team", "institution", "email", "gender", "region", "categories"],
    [...teams].sort(byName).flatMap((team) => team.speakers.map((speaker) => [
      speaker.id,
      speaker.name,
      team.name,
      institutionLabel(team.institutionId, team.institutionName, institutions),
      speaker.email,
      speaker.gender,
      speaker.region,
      list(speakerCategoryNames(speakerCategoryRefs(speaker, team), context.speakerCategories)),
    ]))
  );
}

export function adjudicatorsCsv(adjudicators: Adjudicator[], context: ParticipantExportContext): string {
  const { institutions } = lookups(context);
  return toCsv(
    ["id", "name", "institution", "email", "base_score", "test_score", "trainee", "independent", "adj_core", "breaking", "gender", "region"],
    [...adjudicators].sort(byName).map((adjudicator) => [
      adjudicator.id,
      adjudicator.name,
      institutionLabel(adjudicator.institutionId, adjudicator.institutionName, institutions),
      adjudicator.email,
      adjudicator.baseScore,
      adjudicator.testScore,
      yesNo(adjudicator.trainee),
      yesNo(adjudicator.independent),
      yesNo(adjudicator.adjCore),
      yesNo(adjudicator.breaking),
      adjudicator.gender,
      adjudicator.region,
    ])
  );
}

export function institutionsCsv(institutions: Institution[], teams: Team[], adjudicators: Adjudicator[]): string {
  const teamCount = new Map<string, number>();
  const adjudicatorCount = new Map<string, number>();
  for (const team of teams) if (team.institutionId) teamCount.set(team.institutionId, (teamCount.get(team.institutionId) ?? 0) + 1);
  for (const adjudicator of adjudicators) {
    if (adjudicator.institutionId) adjudicatorCount.set(adjudicator.institutionId, (adjudicatorCount.get(adjudicator.institutionId) ?? 0) + 1);
  }
  return toCsv(
    ["id", "name", "code", "region", "teams", "adjudicators"],
    [...institutions].sort(byName).map((institution) => [
      institution.id,
      institution.name,
      institution.code,
      institution.region,
      teamCount.get(institution.id) ?? 0,
      adjudicatorCount.get(institution.id) ?? 0,
    ])
  );
}

/**
 * Who is available in each round: one row per team, adjudicator and venue, one column per round
 * (round availability, else check-in, with the check-in expiry applied; venues have one
 * tournament-wide flag).
 */
export function availabilityCsv(input: {
  rounds: Round[];
  teams: Team[];
  adjudicators: Adjudicator[];
  venues: Venue[];
  checkInExpiresAfterHours?: number;
  now?: number;
}): string {
  const rounds = input.rounds.filter((round) => !round.cancelled).sort((left, right) => left.seq - right.seq);
  const now = input.now ?? Date.now();
  const person = (type: string, record: Team | Adjudicator) => [
    type,
    record.id,
    record.name,
    ...rounds.map((round) => yesNo(isAvailableForRound(record, round, input.checkInExpiresAfterHours, now))),
  ];
  return toCsv(
    ["type", "id", "name", ...rounds.map((round) => round.abbreviation || round.name)],
    [
      ...[...input.teams].sort(byName).map((team) => person("team", team)),
      ...[...input.adjudicators].sort(byName).map((adjudicator) => person("adjudicator", adjudicator)),
      ...[...input.venues].sort(byName).map((venue) => [
        "venue",
        venue.id,
        venue.name,
        ...rounds.map(() => yesNo(venue.available !== false)),
      ]),
    ]
  );
}

/**
 * Break eligibility: one row per team and break category it is eligible for, overridden in, or
 * meets the category's speaker-category rule for.
 */
export function breakEligibilityCsv(teams: Team[], categories: BreakCategory[], speakerCategories: SpeakerCategory[]): string {
  const sortedCategories = [...categories].sort((left, right) => left.seq - right.seq || left.name.localeCompare(right.name));
  const rows = [...teams].sort(byName).flatMap((team) => sortedCategories.flatMap((category) => {
    const eligible = (team.breakCategories ?? []).includes(category.id);
    const override = category.teamOverrides?.[team.id];
    const rule = category.speakerCategoryRule;
    const meetsRule = rule ? teamMeetsEligibilityRule(team, rule, speakerCategories) : undefined;
    if (!eligible && !override && !meetsRule) return [];
    return [[
      team.id,
      team.name,
      category.name,
      yesNo(eligible),
      override ?? "",
      rule ? describeEligibilityRule(rule, speakerCategories) : "",
      meetsRule === undefined ? "" : yesNo(meetsRule),
      yesNo(team.breakCategoryIds?.includes(category.id)),
    ]];
  }));
  return toCsv(
    ["team_id", "team", "break_category", "eligible", "override", "speaker_category_rule", "meets_rule", "broke"],
    rows
  );
}

/**
 * Conflicts in the import format (`adjudicator`, `team`, `institution`, `other_adjudicator`),
 * plus a `type` column the importer ignores. Records are named by a value the importer can find
 * unambiguously: the name, else (adjudicators) email, (teams) code name, (institutions) code.
 * History conflicts are derived from past rounds and are left out, as is an adjudicator's or
 * team's own institution (always a conflict) and the second copy of a mutual adjudicator conflict.
 */
export function conflictsCsv(data: { adjudicators: Adjudicator[]; teams: Team[]; institutions: Institution[] }): string {
  const unique = <T extends { id: string; name: string }>(records: T[], fallback: (record: T) => string | undefined) => {
    const counts = new Map<string, number>();
    for (const record of records) {
      const key = record.name.trim().toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return (record: T) =>
      (counts.get(record.name.trim().toLowerCase()) ?? 0) > 1 ? fallback(record) || record.name : record.name;
  };
  const adjudicatorLabel = unique(data.adjudicators, (adjudicator) => adjudicator.email);
  const teamLabel = unique(data.teams, (team) => team.codeName);
  const institutionLabel = unique(data.institutions, (institution) => institution.code);
  const adjudicators = new Map(data.adjudicators.map((adjudicator) => [adjudicator.id, adjudicator]));
  const teams = new Map(data.teams.map((team) => [team.id, team]));
  const institutions = new Map(data.institutions.map((institution) => [institution.id, institution]));

  const rows: Array<[string, string, string, string, string]> = [];
  const seenPairs = new Set<string>();
  for (const adjudicator of [...data.adjudicators].sort(byName)) {
    for (const conflict of adjudicator.conflicts ?? []) {
      if (conflict.type === "history") continue;
      if (conflict.teamId) {
        const team = teams.get(conflict.teamId);
        if (team) rows.push([adjudicatorLabel(adjudicator), teamLabel(team), "", "", "adjudicator-team"]);
      } else if (conflict.adjudicatorId) {
        const other = adjudicators.get(conflict.adjudicatorId);
        const pair = [adjudicator.id, conflict.adjudicatorId].sort().join("|");
        if (other && !seenPairs.has(pair)) {
          seenPairs.add(pair);
          rows.push([adjudicatorLabel(adjudicator), "", "", adjudicatorLabel(other), "adjudicator-adjudicator"]);
        }
      } else if (conflict.institutionId && conflict.institutionId !== adjudicator.institutionId) {
        const institution = institutions.get(conflict.institutionId);
        if (institution) rows.push([adjudicatorLabel(adjudicator), "", institutionLabel(institution), "", "adjudicator-institution"]);
      }
    }
  }
  for (const team of [...data.teams].sort(byName)) {
    for (const institutionId of team.institutionConflictIds ?? []) {
      const institution = institutions.get(institutionId);
      if (institution && institutionId !== team.institutionId) {
        rows.push(["", teamLabel(team), institutionLabel(institution), "", "team-institution"]);
      }
    }
  }
  return toCsv(["adjudicator", "team", "institution", "other_adjudicator", "type"], rows);
}

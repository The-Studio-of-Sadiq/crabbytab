import type { Adjudicator, BreakCategory, Debate, FeedbackSubmission, Institution, Round, Team } from "@/types";
import { hasCodeName } from "@/lib/codeNames";
import { participantGender } from "@/lib/adjudicators/diversity";

/* ─── Break eligibility grid (Tabbycat breakqual-edit-eligibility) ───────────── */

/**
 * The break categories a team is eligible for, as the break calculation, liveness and the public
 * pages read it: a general category takes every team unless the tab director marked it
 * "Ineligible" there; any other category takes the teams that list it in `breakCategories`.
 */
export function teamEligibleCategoryIds(
  team: Pick<Team, "id" | "breakCategories">,
  categories: Pick<BreakCategory, "id" | "isGeneral" | "teamOverrides">[]
): Set<string> {
  return new Set(
    categories
      .filter((category) =>
        category.isGeneral
          ? category.teamOverrides?.[team.id] !== "ineligible"
          : Boolean(team.breakCategories?.includes(category.id))
      )
      .map((category) => category.id)
  );
}

/**
 * General categories whose eligibility the draft changes (team id -> eligible category ids). A team
 * leaves a general category through the "Ineligible" override, which the grid sets or clears;
 * unticking a team that had another override (e.g. "Withdrawn") replaces it. Returns only the
 * changed categories.
 */
export function generalCategoryEligibilityChanges<C extends Pick<BreakCategory, "id" | "isGeneral" | "teamOverrides">>(
  categories: C[],
  draft: ReadonlyMap<string, ReadonlySet<string>>
): C[] {
  return categories.flatMap((category) => {
    if (!category.isGeneral) return [];
    const overrides = { ...(category.teamOverrides ?? {}) };
    let changed = false;
    for (const [teamId, eligible] of draft) {
      const wasEligible = overrides[teamId] !== "ineligible";
      const isEligible = eligible.has(category.id);
      if (wasEligible === isEligible) continue;
      if (isEligible) delete overrides[teamId];
      else overrides[teamId] = "ineligible";
      changed = true;
    }
    return changed ? [{ ...category, teamOverrides: overrides }] : [];
  });
}

/**
 * Teams whose eligible break categories differ from the draft (team id -> category ids). Category
 * ids keep the order of `categories` (then any unknown ids the team already had, so data for a
 * deleted category is not silently dropped by an unrelated edit). Returns only changed teams.
 */
export function teamsWithEligibilityChanges(
  teams: Team[],
  draft: ReadonlyMap<string, ReadonlySet<string>>,
  categories: Pick<BreakCategory, "id" | "seq">[]
): Team[] {
  const order = [...categories].sort((left, right) => left.seq - right.seq).map((category) => category.id);
  const known = new Set(order);
  return teams.flatMap((team) => {
    const wanted = draft.get(team.id);
    if (!wanted) return [];
    const current = team.breakCategories ?? [];
    const next = [...order.filter((id) => wanted.has(id)), ...current.filter((id) => !known.has(id))];
    const same = next.length === current.length && next.every((id) => current.includes(id));
    return same ? [] : [{ ...team, breakCategories: next }];
  });
}

/* ─── Code-name decoder (Tabbycat participants-code-names-list) ──────────────── */

export interface CodeNameRow {
  teamId: string;
  codeName?: string;
  teamName: string;
  institutionName?: string;
  emoji?: string;
  speakers: string[];
}

/** Every team with its code name (if any), code names first in alphabetical order. */
export function codeNameRows(teams: Team[]): CodeNameRow[] {
  return teams
    .map((team) => ({
      teamId: team.id,
      ...(hasCodeName(team) ? { codeName: team.codeName!.trim() } : {}),
      teamName: team.name,
      ...(team.institutionName ? { institutionName: team.institutionName } : {}),
      ...(team.emoji ? { emoji: team.emoji } : {}),
      speakers: (team.speakers ?? []).map((speaker) => speaker.name),
    }))
    .sort((left, right) =>
      (left.codeName === undefined ? 1 : 0) - (right.codeName === undefined ? 1 : 0) ||
      (left.codeName ?? "").localeCompare(right.codeName ?? "") ||
      left.teamName.localeCompare(right.teamName)
    );
}

/* ─── Adjudicator requirement (Tabbycat participants-adj-rule, "N-1") ─────────── */

export interface InstitutionRequirementCell {
  teams: number;
  adjudicators: number;
  /** The N-1 rule: an institution with N teams should provide at least N-1 adjudicators. */
  short: boolean;
}

export interface InstitutionRequirementRow {
  institutionId: string;
  code: string;
  name: string;
  registered: InstitutionRequirementCell;
  /** Round id -> teams debating / adjudicators allocated from the institution in that round. */
  byRound: Record<string, InstitutionRequirementCell>;
}

/** Tabbycat's RULES["N-1"]: short when adjudicators < teams - 1. */
export function isShortOfAdjudicators(adjudicators: number, teams: number): boolean {
  return adjudicators < teams - 1;
}

function cell(teams: number, adjudicators: number): InstitutionRequirementCell {
  return { teams, adjudicators, short: isShortOfAdjudicators(adjudicators, teams) };
}

/** Preliminary rounds with a draw (Tabbycat excludes draw status "none"), in order. */
export function requirementRounds(rounds: Round[]): Round[] {
  return rounds
    .filter((round) => round.stage === "preliminary" && !round.cancelled && round.drawStatus !== "none")
    .sort((left, right) => left.seq - right.seq);
}

/**
 * Teams and adjudicators per institution: registered (adjudicators excluding independents, as
 * Tabbycat) and, for each preliminary round with a draw, teams in debates and adjudicators on panels
 * (chairs, panellists and trainees, as Tabbycat counts every DebateAdjudicator). Institutions with
 * neither teams nor adjudicators are left out; rows are ordered by institution code.
 */
export function institutionAdjudicatorRequirements(input: {
  institutions: Institution[];
  teams: Pick<Team, "id" | "institutionId">[];
  adjudicators: Pick<Adjudicator, "id" | "institutionId" | "independent">[];
  rounds: Round[];
  debates: Pick<Debate, "roundId" | "teams" | "adjudicators">[];
}): InstitutionRequirementRow[] {
  const rounds = requirementRounds(input.rounds);
  const roundIds = new Set(rounds.map((round) => round.id));
  const teamInstitution = new Map(input.teams.map((team) => [team.id, team.institutionId]));
  const adjudicatorInstitution = new Map(input.adjudicators.map((adjudicator) => [adjudicator.id, adjudicator.institutionId]));
  const key = (institutionId: string, roundId: string) => `${institutionId}\u0000${roundId}`;
  const teamsInRound = new Map<string, number>();
  const adjudicatorsInRound = new Map<string, number>();
  const bump = (map: Map<string, number>, k: string) => map.set(k, (map.get(k) ?? 0) + 1);

  for (const debate of input.debates) {
    if (!roundIds.has(debate.roundId)) continue;
    const seenTeams = new Set<string>();
    for (const slot of Object.values(debate.teams ?? {})) {
      if (!slot?.teamId || seenTeams.has(slot.teamId)) continue;
      seenTeams.add(slot.teamId);
      const institutionId = teamInstitution.get(slot.teamId);
      if (institutionId) bump(teamsInRound, key(institutionId, debate.roundId));
    }
    const panel = debate.adjudicators;
    const panelIds = new Set(
      [panel?.chairId, ...(panel?.panellistIds ?? []), ...(panel?.traineeIds ?? [])].filter((id): id is string => Boolean(id))
    );
    for (const id of panelIds) {
      const institutionId = adjudicatorInstitution.get(id);
      if (institutionId) bump(adjudicatorsInRound, key(institutionId, debate.roundId));
    }
  }

  const registeredTeams = new Map<string, number>();
  for (const team of input.teams) if (team.institutionId) registeredTeams.set(team.institutionId, (registeredTeams.get(team.institutionId) ?? 0) + 1);
  const registeredAdjudicators = new Map<string, number>();
  for (const adjudicator of input.adjudicators) {
    if (!adjudicator.institutionId || adjudicator.independent) continue;
    registeredAdjudicators.set(adjudicator.institutionId, (registeredAdjudicators.get(adjudicator.institutionId) ?? 0) + 1);
  }
  const anyAdjudicator = new Set(input.adjudicators.map((adjudicator) => adjudicator.institutionId).filter(Boolean));

  return input.institutions
    .filter((institution) => registeredTeams.has(institution.id) || anyAdjudicator.has(institution.id))
    .map((institution) => ({
      institutionId: institution.id,
      code: institution.code,
      name: institution.name,
      registered: cell(registeredTeams.get(institution.id) ?? 0, registeredAdjudicators.get(institution.id) ?? 0),
      byRound: Object.fromEntries(
        rounds.map((round) => [
          round.id,
          cell(teamsInRound.get(key(institution.id, round.id)) ?? 0, adjudicatorsInRound.get(key(institution.id, round.id)) ?? 0),
        ])
      ),
    }))
    .sort((left, right) => left.code.localeCompare(right.code) || left.name.localeCompare(right.name));
}

/* ─── Gender by institution (Tabbycat participants-institution-gender-diversity) ── */

export interface InstitutionGenderRow {
  institutionId: string;
  name: string;
  /** Gender label (as entered; "" = not given) -> count. */
  speakers: Record<string, number>;
  adjudicators: Record<string, number>;
}

export interface InstitutionGenderTable {
  /** Every gender label that occurs, in first-seen-spelling, sorted; "" (not given) last. */
  genders: string[];
  rows: InstitutionGenderRow[];
}

/**
 * Speakers (through their team's institution) and adjudicators (independents excluded, as Tabbycat)
 * by gender for each institution with participants. Genders are free text in CrabbyTab, so labels
 * are grouped ignoring case and surrounding spaces.
 */
export function institutionGenderTable(input: {
  institutions: Institution[];
  teams: Pick<Team, "institutionId" | "speakers">[];
  adjudicators: Pick<Adjudicator, "institutionId" | "independent" | "gender">[];
}): InstitutionGenderTable {
  const labels = new Map<string, string>();
  const label = (gender: string | undefined) => {
    const value = gender ?? "";
    const k = value.toLowerCase();
    if (!labels.has(k)) labels.set(k, value);
    return labels.get(k)!;
  };
  const rows = new Map<string, InstitutionGenderRow>();
  const row = (institution: Institution) => {
    const existing = rows.get(institution.id);
    if (existing) return existing;
    const created: InstitutionGenderRow = { institutionId: institution.id, name: institution.name, speakers: {}, adjudicators: {} };
    rows.set(institution.id, created);
    return created;
  };
  const byId = new Map(input.institutions.map((institution) => [institution.id, institution]));
  for (const team of input.teams) {
    const institution = team.institutionId ? byId.get(team.institutionId) : undefined;
    if (!institution) continue;
    const target = row(institution);
    for (const speaker of team.speakers ?? []) {
      const gender = label(participantGender(speaker));
      target.speakers[gender] = (target.speakers[gender] ?? 0) + 1;
    }
  }
  for (const adjudicator of input.adjudicators) {
    const institution = adjudicator.institutionId && !adjudicator.independent ? byId.get(adjudicator.institutionId) : undefined;
    if (!institution) continue;
    const target = row(institution);
    const gender = label(participantGender(adjudicator));
    target.adjudicators[gender] = (target.adjudicators[gender] ?? 0) + 1;
  }
  const genders = [...labels.values()].sort((left, right) =>
    left === "" ? 1 : right === "" ? -1 : left.localeCompare(right)
  );
  return { genders, rows: [...rows.values()].sort((left, right) => left.name.localeCompare(right.name)) };
}

/* ─── Duplicate feedback (Tabbycat management command printmultiplefeedback) ──── */

export interface DuplicateFeedbackGroup {
  key: string;
  targetType: "adjudicator" | "team";
  targetId: string;
  targetName: string;
  sourceType: FeedbackSubmission["sourceType"];
  sourceId: string;
  sourceName: string;
  roundId: string;
  debateId: string;
  /** Oldest first. */
  submissions: FeedbackSubmission[];
}

/**
 * Feedback from one source on one target in one debate submitted more than once (Tabbycat reports
 * feedback with several versions from the same source). Groups with at least `minimum` submissions,
 * most submissions first. Diagnostic only: nothing is changed.
 */
export function duplicateFeedbackGroups(feedback: FeedbackSubmission[], minimum = 2): DuplicateFeedbackGroup[] {
  const groups = new Map<string, DuplicateFeedbackGroup>();
  for (const item of feedback) {
    const targetType = item.targetType === "team" ? "team" : "adjudicator";
    const targetId = targetType === "team" ? item.targetTeamId : item.targetAdjudicatorId;
    if (!targetId) continue;
    const key = [targetType, targetId, item.sourceType, item.sourceId, item.debateId || item.roundId].join("\u0000");
    const group = groups.get(key) ?? {
      key,
      targetType,
      targetId,
      targetName: (targetType === "team" ? item.targetTeamName : item.targetAdjudicatorName) || targetId,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      sourceName: item.sourceName || item.sourceId,
      roundId: item.roundId,
      debateId: item.debateId,
      submissions: [],
    };
    group.submissions.push(item);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => group.submissions.length >= Math.max(2, minimum))
    .map((group) => ({
      ...group,
      submissions: [...group.submissions].sort((left, right) => (left.timestamp || "").localeCompare(right.timestamp || "")),
    }))
    .sort((left, right) =>
      right.submissions.length - left.submissions.length ||
      left.targetName.localeCompare(right.targetName) ||
      left.sourceName.localeCompare(right.sourceName)
    );
}

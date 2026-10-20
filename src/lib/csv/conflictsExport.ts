import type { Adjudicator, Institution, Team } from "@/types";
import type { ConflictKind } from "./conflictsImport";
import { normalizeName } from "./csvTable";

/**
 * Every declared conflict as one list (Tabbycat's conflicts page), plus removal and the
 * team–institution additions the conflicts page offers. The CSV export is `conflictsCsv` in
 * participantExports.ts.
 */

export interface DeclaredConflict {
  key: string;
  kind: ConflictKind;
  adjudicatorId?: string;
  teamId?: string;
  institutionId?: string;
  otherAdjudicatorId?: string;
}

export interface ConflictData {
  teams: Team[];
  adjudicators: Adjudicator[];
  institutions: Institution[];
}

export function listDeclaredConflicts(data: ConflictData): DeclaredConflict[] {
  const result: DeclaredConflict[] = [];
  const seenPairs = new Set<string>();
  for (const adjudicator of data.adjudicators) {
    for (const conflict of adjudicator.conflicts ?? []) {
      if (conflict.teamId) {
        result.push({ key: `at:${adjudicator.id}:${conflict.teamId}`, kind: "adjudicator-team", adjudicatorId: adjudicator.id, teamId: conflict.teamId });
      } else if (conflict.adjudicatorId) {
        const pair = [adjudicator.id, conflict.adjudicatorId].sort().join("|");
        if (seenPairs.has(pair) || conflict.adjudicatorId === adjudicator.id) continue;
        seenPairs.add(pair);
        result.push({
          key: `aa:${pair}`,
          kind: "adjudicator-adjudicator",
          adjudicatorId: adjudicator.id,
          otherAdjudicatorId: conflict.adjudicatorId,
        });
      } else if (conflict.institutionId) {
        result.push({
          key: `ai:${adjudicator.id}:${conflict.institutionId}`,
          kind: "adjudicator-institution",
          adjudicatorId: adjudicator.id,
          institutionId: conflict.institutionId,
        });
      }
    }
  }
  for (const team of data.teams) {
    for (const institutionId of team.institutionConflictIds ?? []) {
      result.push({ key: `ti:${team.id}:${institutionId}`, kind: "team-institution", teamId: team.id, institutionId });
    }
  }
  return result;
}

function names(data: ConflictData) {
  const adjudicators = new Map(data.adjudicators.map((item) => [item.id, item]));
  const nameCounts = new Map<string, number>();
  for (const item of data.adjudicators) nameCounts.set(normalizeName(item.name), (nameCounts.get(normalizeName(item.name)) ?? 0) + 1);
  const teams = new Map(data.teams.map((item) => [item.id, item.name]));
  const institutions = new Map(data.institutions.map((item) => [item.id, item.name]));
  return {
    adjudicator(id?: string) {
      const item = id ? adjudicators.get(id) : undefined;
      if (!item) return id ?? "";
      return (nameCounts.get(normalizeName(item.name)) ?? 0) > 1 && item.email ? item.email : item.name;
    },
    team: (id?: string) => (id ? teams.get(id) ?? id : ""),
    institution: (id?: string) => (id ? institutions.get(id) ?? id : ""),
  };
}

/** A readable one-line description of a conflict. */
export function describeConflict(conflict: DeclaredConflict, data: ConflictData): string {
  const name = names(data);
  switch (conflict.kind) {
    case "adjudicator-team":
      return `${name.adjudicator(conflict.adjudicatorId)} – ${name.team(conflict.teamId)}`;
    case "adjudicator-adjudicator":
      return `${name.adjudicator(conflict.adjudicatorId)} – ${name.adjudicator(conflict.otherAdjudicatorId)}`;
    case "adjudicator-institution":
      return `${name.adjudicator(conflict.adjudicatorId)} – ${name.institution(conflict.institutionId)}`;
    case "team-institution":
      return `${name.team(conflict.teamId)} – ${name.institution(conflict.institutionId)}`;
  }
}

/** The adjudicators and teams that change when this conflict is removed (from both sides). */
export function removeDeclaredConflict(
  conflict: DeclaredConflict,
  data: Pick<ConflictData, "teams" | "adjudicators">
): { adjudicators: Adjudicator[]; teams: Team[] } {
  if (conflict.kind === "team-institution") {
    const team = data.teams.find((item) => item.id === conflict.teamId);
    if (!team) return { adjudicators: [], teams: [] };
    return {
      adjudicators: [],
      teams: [{ ...team, institutionConflictIds: (team.institutionConflictIds ?? []).filter((id) => id !== conflict.institutionId) }],
    };
  }
  const changed: Adjudicator[] = [];
  for (const adjudicator of data.adjudicators) {
    const kept = (adjudicator.conflicts ?? []).filter((item) => {
      if (conflict.kind === "adjudicator-team") return !(adjudicator.id === conflict.adjudicatorId && item.teamId === conflict.teamId);
      if (conflict.kind === "adjudicator-institution") {
        return !(adjudicator.id === conflict.adjudicatorId && item.institutionId === conflict.institutionId && !item.teamId && !item.adjudicatorId);
      }
      return !(
        (adjudicator.id === conflict.adjudicatorId && item.adjudicatorId === conflict.otherAdjudicatorId) ||
        (adjudicator.id === conflict.otherAdjudicatorId && item.adjudicatorId === conflict.adjudicatorId)
      );
    });
    if (kept.length !== (adjudicator.conflicts ?? []).length) changed.push({ ...adjudicator, conflicts: kept });
  }
  return { adjudicators: changed, teams: [] };
}

/**
 * Adds a team-declared institution conflict (adjudicators from that institution should not judge
 * the team). Refuses the team's own institution, which always conflicts, and duplicates.
 */
export function addTeamInstitutionConflict(team: Team, institutionId: string): Team {
  if (team.institutionId === institutionId) throw new Error(`${team.name} already conflicts with its own institution.`);
  if ((team.institutionConflictIds ?? []).includes(institutionId)) throw new Error("That conflict is already recorded.");
  return { ...team, institutionConflictIds: [...(team.institutionConflictIds ?? []), institutionId] };
}

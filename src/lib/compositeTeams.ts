import type { Team } from "@/types";

/**
 * Composite teams (Tabbycat Team.type "composite"): a team whose speakers come from more than one
 * institution. It is an ordinary team in draws, standings and breaks (unlike a swing team); its
 * other institutions (`compositeInstitutionIds`) count as its own wherever institutions matter:
 * same-institution draw avoidance and adjudicator institution conflicts.
 */

/** Every institution a team belongs to: its own, plus a composite team's others. */
export function teamInstitutionIds(team: Pick<Team, "institutionId" | "isComposite" | "compositeInstitutionIds">): string[] {
  const ids = team.institutionId ? [team.institutionId] : [];
  if (team.isComposite) {
    for (const id of team.compositeInstitutionIds ?? []) if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * The team as stored: not composite → no composite fields at all (a swing team is never
 * composite); composite → its other institutions without duplicates or its own institution.
 */
export function normalizeCompositeTeam<T extends Team>(team: T): T {
  const { isComposite, compositeInstitutionIds, ...rest } = team;
  if (!isComposite || team.isSwing) return rest as T;
  const ids = [...new Set((compositeInstitutionIds ?? []).filter((id) => id && id !== team.institutionId))];
  return { ...rest, isComposite: true, compositeInstitutionIds: ids } as T;
}

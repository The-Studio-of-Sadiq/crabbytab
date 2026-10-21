import type { DebateSide, Team } from "@/types";
import { teamInstitutionIds } from "@/lib/compositeTeams";

export interface MatchupHistory {
  /** teamId -> ids of every team it has debated against. */
  opponents: Map<string, Set<string>>;
  /** teamId -> its sides in past debates, oldest first. */
  sides: Map<string, DebateSide[]>;
  /** teamId -> opponentId -> number of meetings. Absent: each opponent counts once. */
  meetings?: Map<string, Map<string, number>>;
  /** teamId -> number of past debates in which it was pulled up. */
  pullups?: Map<string, number>;
  /** teamId -> number of past debates it was in that contained a pulled-up team (including itself). */
  pullupDebates?: Map<string, number>;
}

export function timesMet(history: MatchupHistory, a: Team, b: Team): number {
  const counted = history.meetings?.get(a.id)?.get(b.id);
  if (counted !== undefined) return counted;
  return history.opponents.get(a.id)?.has(b.id) ? 1 : 0;
}

/**
 * Same institution by id, or by case-insensitive name for legacy records without ids. A composite
 * team shares an institution with any team from one of its institutions (lib/compositeTeams.ts).
 */
export function sameInstitution(a: Team, b: Team): boolean {
  if (a.isComposite || b.isComposite) {
    const ids = new Set(teamInstitutionIds(a));
    if (teamInstitutionIds(b).some((id) => ids.has(id))) return true;
  }
  if (a.institutionId && b.institutionId) return a.institutionId === b.institutionId;
  const aName = a.institutionName?.trim().toLowerCase();
  const bName = b.institutionName?.trim().toLowerCase();
  return Boolean(aName && bName && aName === bName);
}

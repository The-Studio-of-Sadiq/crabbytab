import type { Coach, Institution } from "@/types";
import { matchInstitution } from "@/lib/registration/review";
import type { RepresentativeSummary } from "@/lib/registration/types";

/**
 * Institution representatives (registration links) stored as coaches on their institutions
 * (Tabbycat Coach), so they are people of the tournament and can be emailed as a group. Revoked
 * links are skipped; a coach with the same email is not added twice.
 */
export function representativesAsCoaches(
  institutions: readonly Institution[],
  representatives: readonly Pick<RepresentativeSummary, "institution" | "email" | "name" | "status">[],
  createId: (prefix: string) => string
): { updated: Institution[]; unmatched: string[] } {
  const byId = new Map(institutions.map((institution) => [institution.id, institution]));
  const changed = new Set<string>();
  const unmatched: string[] = [];
  for (const representative of representatives) {
    if (representative.status !== "active") continue;
    const match = matchInstitution(representative.institution.name, [...byId.values()]);
    if (!match) {
      if (!unmatched.includes(representative.institution.name)) unmatched.push(representative.institution.name);
      continue;
    }
    const institution = byId.get(match.id)!;
    const coaches = institution.coaches ?? [];
    const email = representative.email.trim().toLowerCase();
    if (coaches.some((coach) => coach.email?.trim().toLowerCase() === email)) continue;
    const coach: Coach = { id: createId("coach"), name: representative.name.trim() || representative.email, email };
    byId.set(institution.id, { ...institution, coaches: [...coaches, coach] });
    changed.add(institution.id);
  }
  return { updated: [...changed].map((id) => byId.get(id)!), unmatched };
}

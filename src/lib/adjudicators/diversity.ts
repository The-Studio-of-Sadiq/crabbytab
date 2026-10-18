import type { Institution } from "@/types";

export interface DiversityFields {
  gender?: string;
  region?: string;
  institutionId?: string;
}

const UNSPECIFIED = "Unspecified";

/** The participant's own region, else their institution's region. */
export function participantRegion(
  participant: DiversityFields,
  institutionsById: Map<string, Pick<Institution, "region">>
): string | undefined {
  const own = participant.region?.trim();
  if (own) return own;
  const inherited = participant.institutionId
    ? institutionsById.get(participant.institutionId)?.region?.trim()
    : undefined;
  return inherited || undefined;
}

export function participantGender(participant: DiversityFields): string | undefined {
  return participant.gender?.trim() || undefined;
}

export interface DiversityCount {
  label: string;
  count: number;
}

export interface PanelDiversitySummary {
  size: number;
  genders: DiversityCount[];
  regions: DiversityCount[];
}

/** Counts values case-insensitively, keeping the first spelling seen; most common first. */
function countLabels(values: Array<string | undefined>): DiversityCount[] {
  const counts = new Map<string, DiversityCount>();
  for (const value of values) {
    const label = value ?? UNSPECIFIED;
    const key = label.toLowerCase();
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { label, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Gender and region make-up of a panel; a descriptive summary, not a constraint. */
export function panelDiversitySummary(
  members: DiversityFields[],
  institutionsById: Map<string, Pick<Institution, "region">>
): PanelDiversitySummary {
  return {
    size: members.length,
    genders: countLabels(members.map(participantGender)),
    regions: countLabels(members.map((member) => participantRegion(member, institutionsById))),
  };
}

export function formatDiversityCounts(counts: DiversityCount[]): string {
  return counts.map(({ label, count }) => `${count} ${label}`).join(", ");
}

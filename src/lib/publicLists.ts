import type { Adjudicator, Institution, Team } from "@/types";
import type { PublicRelease } from "@/lib/publicRelease";

/**
 * Builders for the public participant pages. They take the public projection's records (which the
 * server already filtered by the same releases), and gate again on the release flags so a stale or
 * local copy can never render a list that has not been released.
 */

const byName = (left: { name: string }, right: { name: string }) =>
  left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) || left.name.localeCompare(right.name);

export interface PublicParticipantTeam {
  id: string;
  name: string;
  institutionName?: string;
  speakers: string[];
}

export interface PublicParticipantAdjudicator {
  id: string;
  name: string;
  institutionName?: string;
}

export interface PublicParticipants {
  teams: PublicParticipantTeam[];
  adjudicators: PublicParticipantAdjudicator[];
}

export function buildPublicParticipants(
  teams: Team[],
  adjudicators: Adjudicator[],
  release: Pick<PublicRelease, "participants">
): PublicParticipants {
  if (!release.participants) return { teams: [], adjudicators: [] };
  return {
    teams: teams
      .map((team) => ({
        id: team.id,
        name: team.name,
        institutionName: team.institutionName || undefined,
        speakers: (team.speakers || []).map((speaker) => speaker.name).filter(Boolean),
      }))
      .sort(byName),
    adjudicators: adjudicators
      .map((adjudicator) => ({
        id: adjudicator.id,
        name: adjudicator.name,
        institutionName: adjudicator.institutionName || undefined,
      }))
      .sort(byName),
  };
}

export interface PublicInstitutionRow {
  id: string;
  name: string;
  code: string;
  region?: string;
  /** Only known when the participants list is released too. */
  teams?: number;
  adjudicators?: number;
}

export function buildPublicInstitutions(
  institutions: Institution[],
  teams: Team[],
  adjudicators: Adjudicator[],
  release: Pick<PublicRelease, "institutions" | "participants">
): PublicInstitutionRow[] {
  if (!release.institutions) return [];
  const teamCounts = new Map<string, number>();
  const adjudicatorCounts = new Map<string, number>();
  if (release.participants) {
    for (const team of teams) {
      if (team.institutionId) teamCounts.set(team.institutionId, (teamCounts.get(team.institutionId) ?? 0) + 1);
    }
    for (const adjudicator of adjudicators) {
      if (adjudicator.institutionId) {
        adjudicatorCounts.set(adjudicator.institutionId, (adjudicatorCounts.get(adjudicator.institutionId) ?? 0) + 1);
      }
    }
  }
  return institutions
    .map((institution) => ({
      id: institution.id,
      name: institution.name,
      code: institution.code,
      ...(institution.region ? { region: institution.region } : {}),
      ...(release.participants
        ? { teams: teamCounts.get(institution.id) ?? 0, adjudicators: adjudicatorCounts.get(institution.id) ?? 0 }
        : {}),
    }))
    .sort(byName);
}

export interface PublicAdjudicatorLists {
  core: PublicParticipantAdjudicator[];
  breaking: PublicParticipantAdjudicator[];
}

export function buildPublicAdjudicatorLists(
  adjudicators: Adjudicator[],
  release: Pick<PublicRelease, "adjudicatorCore" | "breakingAdjudicators">
): PublicAdjudicatorLists {
  const row = (adjudicator: Adjudicator): PublicParticipantAdjudicator => ({
    id: adjudicator.id,
    name: adjudicator.name,
    institutionName: adjudicator.institutionName || undefined,
  });
  return {
    core: release.adjudicatorCore ? adjudicators.filter((item) => item.adjCore === true).map(row).sort(byName) : [],
    breaking: release.breakingAdjudicators
      ? adjudicators.filter((item) => item.breaking === true).map(row).sort(byName)
      : [],
  };
}

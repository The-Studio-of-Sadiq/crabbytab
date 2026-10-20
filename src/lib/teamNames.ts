import type { Institution, Team, TournamentPreferences } from "@/types";
import { prefixedTeamName } from "@/lib/registration/review";

/**
 * Tabbycat team names (participants/models.py Team): a `reference` ("1", "A") and optional
 * `short_reference`, and `use_institution_prefix`, from which the long name ("Victoria 1") and the
 * short name ("VUW 1") are built. In CrabbyTab every page shows `Team.name`, so a team with a
 * reference stores both derived names and `name` is whichever the tournament displays
 * (`teamNameDisplay`, absent = long). Teams without a reference keep their name as typed
 * (CrabbyTab's behaviour before this existed).
 */

export type TeamNameDisplay = NonNullable<TournamentPreferences["teamNameDisplay"]>;

type NamingTeam = Pick<Team, "name" | "reference" | "shortReference" | "useInstitutionPrefix">;
type NamingInstitution = Pick<Institution, "name" | "code"> | undefined;

/** Tabbycat `_construct_long_name`: institution name + reference, or the reference alone. */
export function teamLongName(team: NamingTeam, institution: NamingInstitution): string {
  const reference = (team.reference ?? team.name).trim();
  if (team.useInstitutionPrefix && institution?.name.trim()) {
    // Same rule as the registration form's institution prefix (never doubled).
    return reference ? prefixedTeamName(reference, institution.name) : institution.name.trim();
  }
  return reference;
}

/** Tabbycat `_construct_short_name`: institution code + short reference (or reference). */
export function teamShortName(team: NamingTeam, institution: NamingInstitution): string {
  const reference = (team.shortReference?.trim() || team.reference || team.name).trim();
  if (team.useInstitutionPrefix && institution) {
    const code = (institution.code?.trim() || institution.name.trim()).slice(0, 20);
    return reference ? `${code} ${reference.slice(0, 35)}` : code;
  }
  return reference.slice(0, 56);
}

/**
 * The team with its names brought up to date. Only teams with a `reference` are changed; the
 * displayed `name` follows `display` (default "long").
 */
export function withTeamNames<T extends Team>(team: T, institution: NamingInstitution, display: TeamNameDisplay | undefined): T {
  if (team.reference === undefined) return team;
  const longName = teamLongName(team, institution);
  const shortName = teamShortName(team, institution);
  const name = (display === "short" ? shortName : longName) || team.name;
  if (team.longName === longName && team.shortName === shortName && team.name === name) return team;
  return { ...team, longName, shortName, name };
}

/** The teams whose names change (after an institution rename, or a new display choice). */
export function teamsNeedingNames<T extends Team>(
  teams: readonly T[],
  institutions: ReadonlyArray<Pick<Institution, "id" | "name" | "code">>,
  display: TeamNameDisplay | undefined
): T[] {
  const byId = new Map(institutions.map((institution) => [institution.id, institution]));
  return teams.flatMap((team) => {
    const next = withTeamNames(team, team.institutionId ? byId.get(team.institutionId) : undefined, display);
    return next === team ? [] : [next];
  });
}

export interface TeamNameConversion<T extends Team = Team> {
  team: T;
  /** The team after conversion (reference set, prefix on or off). */
  converted: T;
  /** True when the institution was found at the start of the name and moved to the prefix. */
  prefixed: boolean;
}

function stripPrefix(name: string, prefix: string | undefined): string | null {
  const value = prefix?.trim();
  if (!value) return null;
  const lower = name.toLowerCase();
  if (lower === value.toLowerCase()) return "";
  return lower.startsWith(`${value.toLowerCase()} `) ? name.slice(value.length).trim() : null;
}

/**
 * Tabbycat's `convertteamnames`: a team named after its institution ("Auckland 1", or by code
 * "AUCK 1") becomes reference "1" with the institution prefix on, so it still reads "Auckland 1".
 * Other teams get their name as reference with no prefix. Teams that already have a reference
 * are left alone. The names shown do not change unless `display` is "short".
 */
export function convertTeamNames<T extends Team>(
  teams: readonly T[],
  institutions: ReadonlyArray<Pick<Institution, "id" | "name" | "code">>,
  display: TeamNameDisplay | undefined
): TeamNameConversion<T>[] {
  const byId = new Map(institutions.map((institution) => [institution.id, institution]));
  return teams
    .filter((team) => team.reference === undefined && !team.isSwing)
    .map((team) => {
      const institution = team.institutionId ? byId.get(team.institutionId) : undefined;
      const name = team.name.trim();
      const reference = institution
        ? stripPrefix(name, institution.name) ?? stripPrefix(name, institution.code)
        : null;
      const prefixed = reference !== null;
      const converted = withTeamNames(
        { ...team, reference: prefixed ? reference : name, useInstitutionPrefix: prefixed },
        institution,
        display
      );
      return { team, converted, prefixed };
    });
}

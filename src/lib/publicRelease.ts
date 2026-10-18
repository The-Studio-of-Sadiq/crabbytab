import type { BreakCategory, Round, Team, TournamentPreferences } from "@/types";

/**
 * Tournament-level public releases (Tabbycat's "release tab" switches). They
 * are separate from the per-round results / team-speaks releases: a released
 * tab shows full standings over every completed preliminary round, including
 * silent ones, and a released break category shows its generated break.
 * Everything defaults to unreleased.
 */
export interface PublicRelease {
  teamTab: boolean;
  speakerTab: boolean;
  repliesTab: boolean;
  breakCategoryIds: Set<string>;
}

export type ReleasePreferences = Pick<
  TournamentPreferences,
  "releaseTeamTab" | "releaseSpeakerTab" | "releaseRepliesTab" | "releasedBreakCategoryIds"
>;

export function getPublicRelease(preferences?: Partial<TournamentPreferences> | null): PublicRelease {
  return {
    teamTab: preferences?.releaseTeamTab === true,
    speakerTab: preferences?.releaseSpeakerTab === true,
    repliesTab: preferences?.releaseRepliesTab === true && preferences?.replyScoresEnabled !== false,
    breakCategoryIds: new Set(
      Array.isArray(preferences?.releasedBreakCategoryIds) ? preferences.releasedBreakCategoryIds : []
    ),
  };
}

export function isAnyTabReleased(release: PublicRelease): boolean {
  return release.teamTab || release.speakerTab || release.repliesTab;
}

/** Rounds a released tab covers: completed, non-cancelled preliminary rounds. */
export function isTabRound(round: Pick<Round, "stage" | "cancelled" | "completed">): boolean {
  return round.stage === "preliminary" && round.cancelled !== true && round.completed === true;
}

/** Returns new preferences with one release switched on or off. */
export function setRelease(
  preferences: TournamentPreferences,
  change:
    | { kind: "teamTab" | "speakerTab" | "repliesTab"; released: boolean }
    | { kind: "break"; categoryId: string; released: boolean }
): TournamentPreferences {
  if (change.kind === "break") {
    const current = new Set(preferences.releasedBreakCategoryIds ?? []);
    if (change.released) current.add(change.categoryId);
    else current.delete(change.categoryId);
    return { ...preferences, releasedBreakCategoryIds: [...current].sort() };
  }
  const key = ({
    teamTab: "releaseTeamTab",
    speakerTab: "releaseSpeakerTab",
    repliesTab: "releaseRepliesTab",
  } as const)[change.kind];
  return { ...preferences, [key]: change.released };
}

/** True when the team broke in at least one released category. */
export function isInReleasedBreak(team: Pick<Team, "breakCategoryIds">, release: PublicRelease): boolean {
  return Boolean(team.breakCategoryIds?.some((categoryId) => release.breakCategoryIds.has(categoryId)));
}

/**
 * Removes break results from a team unless it broke in a released category,
 * so the public projection does not reveal an unreleased break (or that a
 * team failed to break).
 */
export function redactUnreleasedBreak<T extends Partial<Pick<Team, "breakStatus" | "breakCategoryIds" | "eliminatedInRoundId">>>(
  team: T,
  release: PublicRelease
): T {
  if (isInReleasedBreak(team, release)) {
    return { ...team, breakCategoryIds: team.breakCategoryIds?.filter((id) => release.breakCategoryIds.has(id)) };
  }
  const redacted = { ...team };
  delete redacted.breakStatus;
  delete redacted.breakCategoryIds;
  delete redacted.eliminatedInRoundId;
  return redacted;
}

export interface PublicBreakTeam {
  seed: number;
  team: Team;
}

export interface PublicBreakCategory {
  category: BreakCategory;
  teams: PublicBreakTeam[];
}

/**
 * The public break for released categories, highest priority first. Uses the
 * snapshot stored when the break was generated; a break generated before
 * snapshots existed falls back to the teams marked as breaking, ordered by
 * `rankOf` (lower first) and then by name.
 */
export function buildPublicBreak(
  categories: BreakCategory[],
  teams: Team[],
  release: PublicRelease,
  rankOf: (teamId: string) => number | undefined = () => undefined
): PublicBreakCategory[] {
  const teamById = new Map(teams.map((team) => [team.id, team]));
  return [...categories]
    .filter((category) => release.breakCategoryIds.has(category.id))
    .sort((left, right) => (right.priority || 0) - (left.priority || 0) || left.seq - right.seq)
    .map((category) => {
      const breakingTeams = category.generatedBreak
        ? category.generatedBreak.breakingTeamIds
            .map((teamId) => teamById.get(teamId))
            .filter((team): team is Team => Boolean(team))
        : teams
            .filter((team) => team.breakCategoryIds?.includes(category.id))
            .sort((left, right) =>
              (rankOf(left.id) ?? Number.MAX_SAFE_INTEGER) - (rankOf(right.id) ?? Number.MAX_SAFE_INTEGER) ||
              left.name.localeCompare(right.name)
            );
      return { category, teams: breakingTeams.map((team, index) => ({ seed: index + 1, team })) };
    })
    .filter((entry) => entry.teams.length > 0);
}

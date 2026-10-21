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
  /** Tabbycat `speaker_category_tabs_released`; absent follows the speaker tab. */
  speakerCategoryTabs: boolean;
  /** Tabbycat `all_results_released`: results of every completed round, silent and elimination included. */
  allResults: boolean;
  breakCategoryIds: Set<string>;
  /** Participant lists (Tabbycat's public participants / institutions / adjudication core pages). */
  participants: boolean;
  institutions: boolean;
  adjudicatorCore: boolean;
  breakingAdjudicators: boolean;
}

export type ReleasePreferences = Pick<
  TournamentPreferences,
  | "releaseTeamTab"
  | "releaseSpeakerTab"
  | "releaseRepliesTab"
  | "releaseSpeakerCategoryTabs"
  | "releaseAllResults"
  | "releasedBreakCategoryIds"
  | "publicParticipants"
  | "publicInstitutionsList"
  | "publicAdjudicatorCore"
  | "publicBreakingAdjudicators"
  | PublicSiteReleasePreference
>;

/**
 * Public-site switches released from the same panel (their values are read through
 * getPublicSiteSettings in lib/publicFeatures.ts).
 */
export const PUBLIC_SITE_RELEASE_KEYS = {
  adjudicatorTab: "releaseAdjudicatorTab",
  ballots: "releaseBallots",
  privateBallots: "releasePrivateBallots",
  breakCategoryTabs: "releaseBreakCategoryTabs",
  recordPages: "publicRecordPages",
  sideAllocations: "publicSideAllocations",
  bracket: "publicBracket",
  diversity: "publicDiversity",
  vetoStatistics: "publicVetoStatistics",
  feedbackProgress: "publicFeedbackProgress",
  motionTab: "motionTabReleased",
} as const satisfies Record<string, keyof TournamentPreferences>;

export type PublicSiteReleaseKind = keyof typeof PUBLIC_SITE_RELEASE_KEYS;
type PublicSiteReleasePreference = (typeof PUBLIC_SITE_RELEASE_KEYS)[PublicSiteReleaseKind];

/** Release switches that map one-to-one onto a boolean preference. */
export type BooleanReleaseKind =
  | "teamTab"
  | "speakerTab"
  | "repliesTab"
  | "speakerCategoryTabs"
  | "allResults"
  | "participants"
  | "institutions"
  | "adjudicatorCore"
  | "breakingAdjudicators"
  | PublicSiteReleaseKind;

/** Release switches stored on PublicRelease (the tabs and participant lists). */
export type PublicListReleaseKind = Exclude<BooleanReleaseKind, PublicSiteReleaseKind>;

const RELEASE_PREFERENCE_KEYS = {
  teamTab: "releaseTeamTab",
  speakerTab: "releaseSpeakerTab",
  repliesTab: "releaseRepliesTab",
  speakerCategoryTabs: "releaseSpeakerCategoryTabs",
  allResults: "releaseAllResults",
  participants: "publicParticipants",
  institutions: "publicInstitutionsList",
  adjudicatorCore: "publicAdjudicatorCore",
  breakingAdjudicators: "publicBreakingAdjudicators",
  ...PUBLIC_SITE_RELEASE_KEYS,
} as const satisfies Record<BooleanReleaseKind, keyof ReleasePreferences>;

export function getPublicRelease(preferences?: Partial<TournamentPreferences> | null): PublicRelease {
  return {
    teamTab: preferences?.releaseTeamTab === true,
    speakerTab: preferences?.releaseSpeakerTab === true,
    repliesTab: preferences?.releaseRepliesTab === true && preferences?.replyScoresEnabled !== false,
    speakerCategoryTabs: typeof preferences?.releaseSpeakerCategoryTabs === "boolean"
      ? preferences.releaseSpeakerCategoryTabs
      : preferences?.releaseSpeakerTab === true,
    allResults: preferences?.releaseAllResults === true,
    breakCategoryIds: new Set(
      Array.isArray(preferences?.releasedBreakCategoryIds) ? preferences.releasedBreakCategoryIds : []
    ),
    participants: preferences?.publicParticipants === true,
    institutions: preferences?.publicInstitutionsList === true,
    adjudicatorCore: preferences?.publicAdjudicatorCore === true,
    breakingAdjudicators: preferences?.publicBreakingAdjudicators === true,
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
    | { kind: BooleanReleaseKind; released: boolean }
    | { kind: "break"; categoryId: string; released: boolean }
): TournamentPreferences {
  if (change.kind === "break") {
    const current = new Set(preferences.releasedBreakCategoryIds ?? []);
    if (change.released) current.add(change.categoryId);
    else current.delete(change.categoryId);
    return { ...preferences, releasedBreakCategoryIds: [...current].sort() };
  }
  return { ...preferences, [RELEASE_PREFERENCE_KEYS[change.kind]]: change.released };
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
  /** Break rank: teams on the same tab rank share one (1, 2, 2, 4). */
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
      // Teams on the same tab rank share a break rank (Tabbycat break_rank: 1, 2, 2, 4).
      const ranks = breakingTeams.map((team) => rankOf(team.id));
      return {
        category,
        teams: breakingTeams.map((team, index) => {
          const firstTied = ranks[index] === undefined ? index : ranks.indexOf(ranks[index]);
          return { seed: firstTied + 1, team };
        }),
      };
    })
    .filter((entry) => entry.teams.length > 0);
}

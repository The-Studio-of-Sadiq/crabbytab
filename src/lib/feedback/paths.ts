import type {
  FeedbackPath,
  FeedbackPathConfig,
  FeedbackSourceRole,
  FeedbackTargetRole,
  Round,
  TournamentPreferences,
} from "@/types";

/**
 * Feedback paths: who gives feedback on whom. One resolved FeedbackPathConfig drives the
 * expected-feedback tracker, the private portals (client and server), the tab-room entry
 * form and the printed forms, so they cannot disagree.
 */

const NO_ADJUDICATOR_PATHS = {
  chairOnPanellists: false,
  chairOnTrainees: false,
  panellistsOnChair: false,
  traineesOnChair: false,
  adjudicatorsOnEachOther: false,
};

/**
 * The pre-wave-3 presets as explicit paths. Teams were always expected to rate the chair
 * (the progress tracker counted only that), so the presets keep teams on the chair, which is
 * also Tabbycat's default ("orallist").
 */
export const LEGACY_FEEDBACK_PATHS: Record<FeedbackPath, FeedbackPathConfig> = {
  chairs_to_panel: {
    ...NO_ADJUDICATOR_PATHS,
    teams: "chair",
    chairOnPanellists: true,
    chairOnTrainees: true,
    onTeams: false,
  },
  two_way: {
    teams: "chair",
    chairOnPanellists: true,
    chairOnTrainees: true,
    panellistsOnChair: true,
    traineesOnChair: true,
    adjudicatorsOnEachOther: false,
    onTeams: false,
  },
  everyone: {
    ...NO_ADJUDICATOR_PATHS,
    teams: "all_adjudicators",
    adjudicatorsOnEachOther: true,
    onTeams: true,
  },
};

export const DEFAULT_FEEDBACK_PATH: FeedbackPath = "two_way";

const TEAM_TARGETS = new Set(["chair", "orallist", "voting_allowed", "all_allowed", "all_voting", "all_adjudicators", "none"]);

/** Team modes in which a team owes one submission, on the orallist (any voting adjudicator counts). */
const ORALLIST_EXPECTED = new Set(["orallist", "voting_allowed", "all_allowed"]);
const BOOLEAN_KEYS = [
  "chairOnPanellists",
  "chairOnTrainees",
  "panellistsOnChair",
  "traineesOnChair",
  "adjudicatorsOnEachOther",
  "onTeams",
] as const;

export function isFeedbackPathConfig(value: unknown): value is FeedbackPathConfig {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return TEAM_TARGETS.has(record.teams as string) &&
    BOOLEAN_KEYS.every((key) => typeof record[key] === "boolean") &&
    (record.panellistsOnEachOther === undefined || typeof record.panellistsOnEachOther === "boolean");
}

/** A preset name or an explicit config, as a config. Unknown values fall back to the default preset. */
export function toFeedbackPathConfig(path: FeedbackPath | FeedbackPathConfig | undefined): FeedbackPathConfig {
  if (isFeedbackPathConfig(path)) return path;
  return LEGACY_FEEDBACK_PATHS[typeof path === "string" && path in LEGACY_FEEDBACK_PATHS ? path : DEFAULT_FEEDBACK_PATH];
}

type PathPreferences = Pick<TournamentPreferences, "feedbackPath" | "feedbackPaths" | "eliminationFeedbackPaths">;

/** The paths used in preliminary rounds. */
export function preliminaryFeedbackPaths(preferences?: Partial<PathPreferences>): FeedbackPathConfig {
  return isFeedbackPathConfig(preferences?.feedbackPaths)
    ? preferences!.feedbackPaths!
    : toFeedbackPathConfig(preferences?.feedbackPath);
}

/** The paths that apply in a round: elimination rounds may have their own. */
export function feedbackPathsForRound(
  preferences: Partial<PathPreferences> | undefined,
  round: Pick<Round, "stage"> | undefined
): FeedbackPathConfig {
  if (round?.stage === "elimination" && isFeedbackPathConfig(preferences?.eliminationFeedbackPaths)) {
    return preferences!.eliminationFeedbackPaths!;
  }
  return preliminaryFeedbackPaths(preferences);
}

/** Whether a participant in `sourceRole` gives feedback on an adjudicator in `targetRole`. */
export function isFeedbackPathAllowed(
  config: FeedbackPathConfig,
  sourceRole: FeedbackSourceRole,
  targetRole: FeedbackTargetRole
): boolean {
  if (sourceRole === "team") {
    switch (config.teams) {
      case "chair":
        return targetRole === "chair";
      case "orallist":
      case "voting_allowed":
      case "all_voting":
        return targetRole !== "trainee";
      case "all_allowed":
      case "all_adjudicators":
        return true;
      default:
        return false;
    }
  }
  if (config.adjudicatorsOnEachOther) return true;
  if (sourceRole === "panellist" && targetRole === "panellist" && config.panellistsOnEachOther) return true;
  if (sourceRole === "chair") {
    return (targetRole === "panellist" && config.chairOnPanellists) ||
      (targetRole === "trainee" && config.chairOnTrainees);
  }
  if (targetRole !== "chair") return false;
  return sourceRole === "panellist" ? config.panellistsOnChair : config.traineesOnChair;
}

/**
 * Whether feedback from `sourceRole` on `targetRole` is expected (counted as owed). Only team
 * feedback differs from what is allowed: in the orallist modes a team owes one submission, which
 * `expectsOneTeamSubmission` describes; here the chair stands for the orallist.
 */
export function isFeedbackPathExpected(
  config: FeedbackPathConfig,
  sourceRole: FeedbackSourceRole,
  targetRole: FeedbackTargetRole
): boolean {
  if (sourceRole === "team" && ORALLIST_EXPECTED.has(config.teams)) return targetRole === "chair";
  return isFeedbackPathAllowed(config, sourceRole, targetRole);
}

/** Team modes where one submission on any voting adjudicator settles what a team owes. */
export function expectsOneTeamSubmission(config: FeedbackPathConfig): boolean {
  return ORALLIST_EXPECTED.has(config.teams);
}

/** One-line description of a config for summaries and the print page. */
export function describeFeedbackPaths(config: FeedbackPathConfig): string {
  const parts = [
    {
      chair: "teams on the chair",
      orallist: "teams on the orallist (voting adjudicators allowed)",
      voting_allowed: "teams on the orallist (any voting adjudicator allowed)",
      all_allowed: "teams on the orallist (any adjudicator allowed)",
      all_voting: "teams on every voting adjudicator",
      all_adjudicators: "teams on every adjudicator",
      none: null,
    }[config.teams] ?? null,
    config.adjudicatorsOnEachOther ? "every adjudicator on every other" : null,
    !config.adjudicatorsOnEachOther && config.chairOnPanellists ? "chair on panellists" : null,
    !config.adjudicatorsOnEachOther && config.chairOnTrainees ? "chair on trainees" : null,
    !config.adjudicatorsOnEachOther && config.panellistsOnChair ? "panellists on chair" : null,
    !config.adjudicatorsOnEachOther && config.traineesOnChair ? "trainees on chair" : null,
    !config.adjudicatorsOnEachOther && config.panellistsOnEachOther ? "panellists on each other" : null,
    config.onTeams ? "feedback on teams" : null,
  ].filter((part): part is string => part !== null);
  return parts.length ? parts.join(", ") : "no feedback paths";
}

import type { TournamentFormat, TournamentPreferences } from "@/types";
import { FORMAT_PRESETS, defaultPreferences, rulesPresetPreferences, type RulesPreset } from "@/lib/setup/presets";

/**
 * Tournament configuration as a standalone file (Tabbycat's `exportconfig` / `importconfig`) and
 * applying a rules preset to an existing tournament (Tabbycat's options-presets-confirm). Both
 * end in the same plan: the settings that would change, shown to the organiser before anything is
 * saved, with settings that cannot change listed separately (docs/data-import-export.md).
 *
 * Only settings travel. Tournament-specific state (the current round, which tabs and break
 * categories are released, the schedule) is never exported or imported, so loading a file can
 * never release results or tabs in another tournament.
 */

export const CONFIG_FILE_KIND = "crabbytab.tournament-config";
export const CONFIG_FILE_VERSION = 1;
export const MAX_CONFIG_FILE_BYTES = 1_000_000;

/** Settings that describe this tournament's state rather than its rules. */
export const NON_TRANSFERABLE_PREFERENCES = [
  "currentRoundId",
  "releasedBreakCategoryIds",
  "releaseBreakCategoryTabs",
  "releaseTeamTab",
  "releaseSpeakerTab",
  "releaseRepliesTab",
  "releaseAdjudicatorTab",
  "motionTabReleased",
  "releaseBallots",
  "releasePrivateBallots",
  "scheduleEvents",
] as const;

/** Every setting CrabbyTab knows (TournamentPreferences); anything else in a file is skipped. */
export const KNOWN_PREFERENCE_KEYS: readonly string[] = [
  "teamsInDebate", "substantiveSpeakers", "replyScoresEnabled", "minSpeakerScore", "maxSpeakerScore",
  "stepSpeakerScore", "minReplyScore", "maxReplyScore", "drawRule", "sideAllocationRule", "ballotDoubleEntry",
  "publicDraw", "publicResults", "publicStandings", "publicMotions", "feedbackEnabled", "feedbackMinScore",
  "feedbackMaxScore", "feedbackQuestions", "teamFeedbackQuestions", "adjudicatorFeedbackQuestions", "feedbackPath",
  "feedbackPaths", "eliminationFeedbackPaths", "feedbackInEliminationRounds", "feedbackScoreStep",
  "feedbackIntroduction", "showUnexpectedFeedback", "feedbackImportantThreshold", "checkInExpiresAfterHours",
  "publicCheckInStatus", "teamSeedMode", "publicLanguage", "teamStandingsPrecedence", "teamStandingsExtra",
  "speakerStandingsPrecedence", "speakerStandingsExtra", "speakerTrim", "standingsMissedDebates",
  "standingsMissedReplies", "oddBracketMethod", "pairingMethod", "conflictAvoidance", "pullupRestriction",
  "repeatMatchupPenalty", "institutionClashPenalty", "minAdjScoreToVote", "adjConflictPenalty", "adjHistoryPenalty",
  "importanceMismatchPenalty", "adjudicatorPanelStrategy", "usePreformedPanels", "preformedPanelPlacement",
  "panelSizingMode", "feedbackSourceWeights", "skipAdjCheckins", "noPanellistAdjs", "noTraineeAdjs",
  "teamInstitutionPenalty", "teamHistoryPenalty", "avoidSameInstitution", "avoidTeamHistory",
  "previouslySawPullupPenalty", "sideBalancePenalty", "pairingDeviationPenalty", "maxTimesPerSide",
  "maxAllowedSideImbalance", "pullupPenalty", "preliminaryPanelsPerScheduleSlot", "bpPullupDistribution",
  "bpPositionCost", "renyiOrder", "bpPositionCostExponent", "bpAssignmentMethod", "byeTeamResults",
  "byeTeamSelectionMethod", "eliminationSideRule", "marginIncludesDissenters", "ballotIntroExplanation",
  "teamScoreIncludesGhosts", "ballotMode", "eliminationBallotMode", "ballotCheckMode", "assistantAccess",
  "individualBallots", "privateBallotConfirmation", "privateUrlBallots", "allowSelfSplitBallots",
  "allowLowPointWins", "winnersInBallots", "scoreAggregation", "speakersInBallots", "speakerRanks", "scoreCriteria",
  "maximumMargin", "stepReplyScore", "requireSubstantiveForReply", "sideNames", "enableMotions",
  "enableMotionVetoes", "enableForfeits", "publicParticipants", "publicInstitutionsList", "publicAdjudicatorCore",
  "publicBreakingAdjudicators", "notifyDrawReleased", "notifyBallotReceipt", "notifyTeamPoints",
  "notifyMotionsReleased", "notifyBallotConfirmed", "allowSelfCheckIn", "ballotReturnLocation",
  "feedbackReturnLocation", "ballotsConfirmDigits", "ballotsHideMotions", "speakerCategories", "publicDrawMode",
  "publicRecordPages", "adjudicatorTabShows", "teamTabLimit", "speakerTabLimit", "repliesTabLimit",
  "publicBreakMetrics", "publicBreakCategories", "publicSideAllocations", "publicBracket", "publicDiversity",
  "publicVetoStatistics", "publicFeedbackProgress", "showTeamInstitutions", "showAdjudicatorInstitutions",
  "teamCodeNames", "participantCodeNames", "showEmoji", "showSpeakersInDraw", "showSplittingAdjudicators",
  "searchEngineIndexing", "welcomeMessage", "tournamentStaff", "publicMotionsOrder", "showMotionsInResults",
  "publicBallotForm", "publicFeedbackForm", "publicFormsUsePassword", "venueCategories",
  "venueCheckInExpiresAfterHours", "preliminaryPanels", "preparationTime", "publicSchedule",
  "enableMotionPreferences", "teamNameDisplay",
];

export interface TournamentConfigFile {
  kind: typeof CONFIG_FILE_KIND;
  version: number;
  exportedAt: string;
  /** Where the file came from (information only). */
  source: { name: string; format: TournamentFormat };
  format: TournamentFormat;
  preferences: Partial<TournamentPreferences>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function transferable(key: string): boolean {
  return !(NON_TRANSFERABLE_PREFERENCES as readonly string[]).includes(key);
}

/** The settings-only file for a tournament. */
export function buildConfigFile(
  tournament: { name: string; format: TournamentFormat; preferences?: Partial<TournamentPreferences> },
  now = new Date().toISOString()
): TournamentConfigFile {
  const preferences = Object.fromEntries(
    Object.entries(tournament.preferences ?? {}).filter(([key, value]) => transferable(key) && value !== undefined)
  ) as Partial<TournamentPreferences>;
  return {
    kind: CONFIG_FILE_KIND,
    version: CONFIG_FILE_VERSION,
    exportedAt: now,
    source: { name: tournament.name, format: tournament.format },
    format: tournament.format,
    preferences,
  };
}

export type ParsedConfigFile =
  | { ok: true; file: TournamentConfigFile; skipped: Array<{ key: string; reason: "unknown" | "not_transferable" }> }
  | { ok: false; errors: string[] };

function valueKind(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

/**
 * Reads and validates a configuration file. Unknown and tournament-specific settings are skipped
 * (and listed); a value whose type does not match the setting refuses the whole file.
 */
export function parseConfigFile(text: string): ParsedConfigFile {
  if (text.length > MAX_CONFIG_FILE_BYTES) return { ok: false, errors: ["The file is larger than 1 MB."] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { ok: false, errors: ["The file is not valid JSON."] };
  }
  if (!isPlainObject(parsed) || parsed.kind !== CONFIG_FILE_KIND) {
    return { ok: false, errors: ["This is not a CrabbyTab tournament configuration file."] };
  }
  if (typeof parsed.version !== "number" || !Number.isInteger(parsed.version) || parsed.version < 1) {
    return { ok: false, errors: ["The file has no valid version."] };
  }
  if (parsed.version > CONFIG_FILE_VERSION) {
    return { ok: false, errors: ["The file was made by a newer version of CrabbyTab."] };
  }
  const format = parsed.format;
  if (!FORMAT_PRESETS.some((preset) => preset.id === format)) {
    return { ok: false, errors: ["The file names an unknown format."] };
  }
  if (!isPlainObject(parsed.preferences)) return { ok: false, errors: ["The file has no settings."] };

  const reference = defaultPreferences(format as TournamentFormat) as unknown as Record<string, unknown>;
  const errors: string[] = [];
  const skipped: Array<{ key: string; reason: "unknown" | "not_transferable" }> = [];
  const preferences: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.preferences)) {
    if (!transferable(key)) {
      skipped.push({ key, reason: "not_transferable" });
      continue;
    }
    if (!KNOWN_PREFERENCE_KEYS.includes(key)) {
      skipped.push({ key, reason: "unknown" });
      continue;
    }
    const kind = valueKind(value);
    if (kind === "null" || kind === "undefined" || kind === "function" || kind === "bigint" || kind === "symbol") {
      errors.push(`${key}: the value is empty or not allowed.`);
      continue;
    }
    if (kind === "number" && !Number.isFinite(value)) {
      errors.push(`${key}: the number is not finite.`);
      continue;
    }
    const expected = reference[key] === undefined ? undefined : valueKind(reference[key]);
    if (expected && expected !== kind) {
      errors.push(`${key}: expected ${expected}, found ${kind}.`);
      continue;
    }
    preferences[key] = value;
  }
  const teamsInDebate = preferences.teamsInDebate;
  if (teamsInDebate !== undefined && teamsInDebate !== 2 && teamsInDebate !== 4) {
    errors.push("teamsInDebate must be 2 or 4.");
  }
  const formatTeams = format === "bp" ? 4 : 2;
  if (teamsInDebate !== undefined && teamsInDebate !== formatTeams) {
    errors.push(`teamsInDebate (${String(teamsInDebate)}) does not match the format (${formatTeams} teams per debate).`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    skipped,
    file: {
      kind: CONFIG_FILE_KIND,
      version: parsed.version,
      exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : "",
      source: isPlainObject(parsed.source) && typeof parsed.source.name === "string"
        ? { name: parsed.source.name, format: format as TournamentFormat }
        : { name: "", format: format as TournamentFormat },
      format: format as TournamentFormat,
      preferences: preferences as Partial<TournamentPreferences>,
    },
  };
}

export interface ConfigChange {
  key: string;
  from: unknown;
  to: unknown;
}

export interface ConfigPlan {
  /** Settings that will change (format first when it changes). */
  changes: ConfigChange[];
  /** Settings that would change but cannot, with the reason. */
  blocked: Array<ConfigChange & { reason: "locked_by_ballots" | "draw_exists" }>;
  /** The tournament's format and settings after applying `changes`. */
  next: { format: TournamentFormat; preferences: TournamentPreferences };
  /** Problems with the result that refuse the whole apply. */
  errors: string[];
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * What applying `incoming` to the tournament changes. Settings fixed once ballots exist
 * (`lockedFields`, from lockedSettingsFields) and a different number of teams per debate once a
 * draw exists are kept and listed as blocked; nothing else in the tournament is touched.
 */
export function planConfigApply(
  current: { format: TournamentFormat; preferences: TournamentPreferences },
  incoming: { format: TournamentFormat; preferences: Partial<TournamentPreferences> },
  context: { lockedFields: readonly string[]; hasDebates: boolean }
): ConfigPlan {
  const changes: ConfigChange[] = [];
  const blocked: ConfigPlan["blocked"] = [];
  const preferences: Record<string, unknown> = { ...current.preferences };
  const currentPreferences = current.preferences as unknown as Record<string, unknown>;
  const teamsChange = (incoming.format === "bp" ? 4 : 2) !== (current.format === "bp" ? 4 : 2);
  let format = current.format;

  if (incoming.format !== current.format) {
    const change = { key: "format", from: current.format, to: incoming.format };
    if (context.lockedFields.includes("format")) blocked.push({ ...change, reason: "locked_by_ballots" });
    else if (teamsChange && context.hasDebates) blocked.push({ ...change, reason: "draw_exists" });
    else {
      changes.push(change);
      format = incoming.format;
    }
  }
  const formatBlocked = format !== incoming.format;
  for (const [key, value] of Object.entries(incoming.preferences)) {
    if (!transferable(key) || value === undefined || sameValue(currentPreferences[key], value)) continue;
    const change = { key, from: currentPreferences[key], to: value };
    if (context.lockedFields.includes(key)) blocked.push({ ...change, reason: "locked_by_ballots" });
    else if (key === "teamsInDebate" && value !== currentPreferences.teamsInDebate && (context.hasDebates || formatBlocked)) {
      blocked.push({ ...change, reason: "draw_exists" });
    } else {
      changes.push(change);
      preferences[key] = value;
    }
  }

  const next = preferences as unknown as TournamentPreferences;
  const errors: string[] = [];
  // Half a format (another format's speakers and scores on this one's draw) is never applied.
  if (formatBlocked) {
    errors.push(`These settings are for ${incoming.format}; this tournament stays ${current.format} because ${
      context.lockedFields.includes("format") ? "ballots have been entered" : "a draw exists"
    }.`);
  }
  if ((next.teamsInDebate ?? (format === "bp" ? 4 : 2)) !== (format === "bp" ? 4 : 2)) {
    errors.push("The number of teams per debate would not match the format.");
  }
  if (next.minSpeakerScore > next.maxSpeakerScore) errors.push("The lowest speaker score would be above the highest.");
  if (next.minReplyScore > next.maxReplyScore) errors.push("The lowest reply score would be above the highest.");
  return { changes, blocked, next: { format, preferences: next }, errors };
}

/** Applying a rules preset to an existing tournament: the preset's format and settings bundle. */
export function planPresetApply(
  current: { format: TournamentFormat; preferences: TournamentPreferences },
  preset: RulesPreset,
  context: { lockedFields: readonly string[]; hasDebates: boolean }
): ConfigPlan {
  return planConfigApply(current, { format: preset.format, preferences: rulesPresetPreferences(preset) }, context);
}

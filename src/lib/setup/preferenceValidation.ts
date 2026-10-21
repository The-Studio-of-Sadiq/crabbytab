import { validateScoreCriteria } from "@/lib/ballots/ballotRules";
import { isPolyFormat, validatePolyTeamsInDebate } from "@/lib/debateSides";
import { isFeedbackPathConfig } from "@/lib/feedback/paths";
import { FEEDBACK_QUESTION_TYPES, validateFeedbackQuestions } from "@/lib/feedback/questions";
import { isLocale } from "@/lib/i18n/config";
import { validateScheduleEvents } from "@/lib/schedule/events";
import { SIDE_NAME_OPTIONS } from "@/lib/sideNames";
import { validateSpeakerCategories } from "@/lib/speakerCategories";
import { ALL_SPEAKER_METRICS, ALL_TEAM_METRICS } from "@/lib/standings/metrics";
import { normaliseCategory } from "@/lib/venues/venues";
import type {
  FeedbackQuestion,
  Round,
  ScheduleEvent,
  ScoreCriterion,
  SpeakerCategory,
  TournamentFormat,
  TournamentPreferences,
} from "@/types";

/**
 * One validation of tournament preferences for every way they are saved: the settings pages (through
 * saveTournamentCommand) and the REST API's PATCH /preferences. Each known preference has a rule:
 * its type, the values an enumerated setting may take, and for structured settings (schedule, score
 * criteria, room categories, feedback questions, speaker categories, feedback paths) the same
 * validators their own pages and endpoints use.
 *
 * Only preferences that change are checked, so settings saved by older versions keep loading and
 * saving; a value the rules refuse can only be replaced, not introduced.
 */

export interface PreferenceProblem {
  /** The preference name. */
  key: string;
  message: string;
}

export interface PreferenceValidationContext {
  format: TournamentFormat;
  /** The tournament's rounds, to check that schedule events and the current round name real rounds. */
  rounds?: Pick<Round, "id">[];
}

type Check = (value: unknown, context: PreferenceValidationContext) => string[];

const BOOLEAN: Check = (value) => (typeof value === "boolean" ? [] : ["must be true or false"]);

function text(max: number): Check {
  return (value) => {
    if (typeof value !== "string") return ["must be text"];
    return value.length > max ? [`must be at most ${max} characters`] : [];
  };
}

function number(options: { min?: number; max?: number; integer?: boolean; positive?: boolean } = {}): Check {
  return (value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return ["must be a finite number"];
    if (options.integer && !Number.isInteger(value)) return ["must be a whole number"];
    if (options.positive && value <= 0) return ["must be above 0"];
    if (options.min !== undefined && value < options.min) return [`must be at least ${options.min}`];
    if (options.max !== undefined && value > options.max) return [`must be at most ${options.max}`];
    return [];
  };
}

function oneOf(values: readonly string[]): Check {
  return (value) => (typeof value === "string" && values.includes(value) ? [] : [`must be one of: ${values.join(", ")}`]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function list(item: (value: unknown, index: number) => string[], max: number): Check {
  return (value) => {
    if (!Array.isArray(value)) return ["must be a list"];
    if (value.length > max) return [`may hold at most ${max} entries`];
    return value.flatMap((entry, index) => item(entry, index));
  };
}

function metricList(metrics: readonly string[], max: number, repeatable: readonly string[] = []): Check {
  return (value) => {
    if (!Array.isArray(value)) return ["must be a list of metric ids"];
    if (value.length > max) return [`may hold at most ${max} metrics`];
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const metric of value) {
      if (typeof metric !== "string" || !metrics.includes(metric)) {
        problems.push(`${String(metric)} is not a metric (one of: ${metrics.join(", ")})`);
        continue;
      }
      if (seen.has(metric) && !repeatable.includes(metric)) problems.push(`lists ${metric} twice`);
      seen.add(metric);
    }
    return problems;
  };
}

/** Fields must be present with these types; other fields are refused. */
function shape(value: unknown, fields: Record<string, { type: "string" | "number" | "boolean" | "strings"; optional?: boolean }>, label: string): string[] {
  if (!isRecord(value)) return [`${label} must be an object`];
  const problems: string[] = [];
  for (const key of Object.keys(value)) {
    if (!(key in fields) && value[key] !== undefined) problems.push(`${label}: ${key} is not a known field`);
  }
  for (const [key, field] of Object.entries(fields)) {
    const entry = value[key];
    if (entry === undefined) {
      if (!field.optional) problems.push(`${label}: ${key} is required`);
      continue;
    }
    const ok = field.type === "strings"
      ? Array.isArray(entry) && entry.every((item) => typeof item === "string")
      : field.type === "number"
        ? typeof entry === "number" && Number.isFinite(entry)
        : typeof entry === field.type;
    if (!ok) problems.push(`${label}: ${key} must be ${field.type === "strings" ? "a list of text" : field.type === "string" ? "text" : `a ${field.type}`}`);
  }
  return problems;
}

const QUESTION_TYPES: string[] = FEEDBACK_QUESTION_TYPES.map((option) => option.type);

const feedbackQuestions: Check = (value) => {
  if (!Array.isArray(value)) return ["must be a list of questions"];
  const problems = value.flatMap((question, index) => {
    const found = shape(question, {
      id: { type: "string" }, label: { type: "string" }, type: { type: "string" }, required: { type: "boolean" },
      options: { type: "strings", optional: true }, min: { type: "number", optional: true }, max: { type: "number", optional: true },
    }, `question ${index + 1}`);
    if (found.length === 0 && !QUESTION_TYPES.includes((question as FeedbackQuestion).type)) {
      found.push(`question ${index + 1}: type must be one of: ${QUESTION_TYPES.join(", ")}`);
    }
    return found;
  });
  if (problems.length) return problems;
  const error = validateFeedbackQuestions(value as FeedbackQuestion[]);
  return error ? [error] : [];
};

const scoreCriteria: Check = (value) => {
  if (!Array.isArray(value)) return ["must be a list of criteria"];
  if (value.length > 20) return ["may hold at most 20 criteria"];
  const problems = value.flatMap((criterion, index) => {
    const found = shape(criterion, {
      id: { type: "string" }, name: { type: "string" }, seq: { type: "number" }, speechType: { type: "string" },
      weight: { type: "number" }, minScore: { type: "number" }, maxScore: { type: "number" }, step: { type: "number" },
      required: { type: "boolean" },
    }, `criterion ${index + 1}`);
    if (found.length === 0 && !["all", "substantive", "reply"].includes((criterion as ScoreCriterion).speechType)) {
      found.push(`criterion ${index + 1}: speechType must be one of: all, substantive, reply`);
    }
    return found;
  });
  if (problems.length) return problems;
  const criteria = value as ScoreCriterion[];
  const ids = new Set<string>();
  for (const criterion of criteria) {
    if (!criterion.id.trim() || ids.has(criterion.id)) problems.push(`criterion id ${criterion.id || "(blank)"} must be unique`);
    ids.add(criterion.id);
  }
  return [...problems, ...validateScoreCriteria(criteria)];
};

const scheduleEvents: Check = (value, context) => {
  if (!Array.isArray(value)) return ["must be a list of events"];
  const problems = value.flatMap((event, index) => shape(event, {
    id: { type: "string" }, type: { type: "string" }, title: { type: "string", optional: true },
    startTime: { type: "string" }, endTime: { type: "string", optional: true }, roundId: { type: "string", optional: true },
  }, `event ${index + 1}`));
  if (problems.length) return problems;
  const events = value as ScheduleEvent[];
  // Without the rounds at hand (a caller that does not load them) round references are not checked.
  const rounds = context.rounds ?? events.flatMap((event) => (event.roundId ? [{ id: event.roundId }] : []));
  return validateScheduleEvents(events, rounds).map((problem) => (problem.eventId ? `event ${problem.eventId}: ${problem.message}` : problem.message));
};

const venueCategories: Check = (value) => {
  if (!Array.isArray(value)) return ["must be a list of room categories"];
  const problems: string[] = [];
  const names = new Set<string>();
  value.forEach((info, index) => {
    const found = shape(info, {
      name: { type: "string" }, description: { type: "string", optional: true },
      displayInName: { type: "string", optional: true }, publicTooltip: { type: "boolean", optional: true },
    }, `category ${index + 1}`);
    if (found.length) {
      problems.push(...found);
      return;
    }
    const category = info as { name: string; description?: string; displayInName?: string };
    const name = category.name.trim();
    if (!name || name.length > 80 || /[/,;]/.test(name)) problems.push(`category ${index + 1}: the name must be 1-80 characters without / , or ;`);
    if (names.has(normaliseCategory(name))) problems.push(`category ${name} is listed twice`);
    names.add(normaliseCategory(name));
    if ((category.description?.length ?? 0) > 300) problems.push(`category ${name}: the description must be at most 300 characters`);
    if (category.displayInName !== undefined && !["none", "prefix", "suffix"].includes(category.displayInName)) {
      problems.push(`category ${name}: displayInName must be one of: none, prefix, suffix`);
    }
  });
  return problems;
};

const speakerCategories: Check = (value) => {
  if (!Array.isArray(value)) return ["must be a list of categories"];
  const problems = value.flatMap((category, index) => shape(category, {
    id: { type: "string" }, name: { type: "string" }, slug: { type: "string" }, seq: { type: "number" },
    public: { type: "boolean" }, limit: { type: "number", optional: true },
  }, `category ${index + 1}`));
  return problems.length ? problems : validateSpeakerCategories(value as SpeakerCategory[]);
};

const feedbackPaths: Check = (value) => (isFeedbackPathConfig(value) ? [] : ["must be a feedback path configuration"]);

const FEEDBACK_ROLES = ["team", "chair", "panellist", "trainee"];
const FEEDBACK_TARGETS = ["chair", "panellist", "trainee"];
const feedbackSourceWeights: Check = (value) => {
  if (!isRecord(value)) return ["must be an object of weights"];
  return Object.entries(value).flatMap(([key, weight]) => {
    const [source, target, ...rest] = key.split("_on_");
    if (rest.length || !FEEDBACK_ROLES.includes(source) || !FEEDBACK_TARGETS.includes(target ?? "")) return [`${key} is not a source_on_target pair`];
    return typeof weight === "number" && Number.isFinite(weight) && weight >= 0 ? [] : [`${key} must be a number of at least 0`];
  });
};

const teamsInDebate: Check = (value, context) => {
  if (isPolyFormat(context.format)) {
    const problem = validatePolyTeamsInDebate(value);
    return problem ? [problem] : [];
  }
  const expected = context.format === "bp" ? 4 : 2;
  return value === expected ? [] : [`must be ${expected} for this format`];
};

const currentRoundId: Check = (value, context) => {
  if (typeof value !== "string") return ["must be a round id"];
  return context.rounds && !context.rounds.some((round) => round.id === value) ? ["does not name a round of this tournament"] : [];
};

const NON_NEGATIVE = number({ min: 0 });
const NON_NEGATIVE_INTEGER = number({ min: 0, integer: true });
const POSITIVE = number({ positive: true });
const ANY_NUMBER = number();
const SHORT_TEXT = text(500);
const LONG_TEXT = text(20_000);

/** Every preference and its rule. `satisfies` keeps this in step with TournamentPreferences. */
export const PREFERENCE_RULES = {
  teamNameDisplay: oneOf(["long", "short"]),
  teamsInDebate,
  substantiveSpeakers: number({ min: 1, max: 10, integer: true }),
  replyScoresEnabled: BOOLEAN,
  minSpeakerScore: ANY_NUMBER,
  maxSpeakerScore: ANY_NUMBER,
  stepSpeakerScore: POSITIVE,
  minReplyScore: ANY_NUMBER,
  maxReplyScore: ANY_NUMBER,
  drawRule: oneOf(["power_paired", "random", "round_robin", "bracket"]),
  sideAllocationRule: oneOf(["balanced", "random", "preallocated", "manual_ballot"]),
  ballotDoubleEntry: BOOLEAN,
  publicDraw: BOOLEAN,
  publicResults: BOOLEAN,
  publicStandings: BOOLEAN,
  publicMotions: BOOLEAN,
  feedbackEnabled: BOOLEAN,
  feedbackMinScore: ANY_NUMBER,
  feedbackMaxScore: ANY_NUMBER,
  feedbackQuestions,
  teamFeedbackQuestions: feedbackQuestions,
  adjudicatorFeedbackQuestions: feedbackQuestions,
  feedbackPath: oneOf(["chairs_to_panel", "two_way", "everyone"]),
  feedbackPaths,
  eliminationFeedbackPaths: feedbackPaths,
  feedbackInEliminationRounds: BOOLEAN,
  feedbackScoreStep: POSITIVE,
  feedbackIntroduction: LONG_TEXT,
  showUnexpectedFeedback: BOOLEAN,
  feedbackImportantThreshold: NON_NEGATIVE,
  checkInExpiresAfterHours: NON_NEGATIVE,
  publicCheckInStatus: BOOLEAN,
  teamSeedMode: oneOf(["off", "numeric", "title"]),
  publicLanguage: (value) => (isLocale(value) ? [] : ["must be a supported language code"]),
  teamStandingsPrecedence: metricList(ALL_TEAM_METRICS, 8, ["wbw"]),
  teamStandingsExtra: metricList(ALL_TEAM_METRICS, ALL_TEAM_METRICS.length),
  speakerStandingsPrecedence: metricList(ALL_SPEAKER_METRICS, 8),
  speakerStandingsExtra: metricList(ALL_SPEAKER_METRICS, ALL_SPEAKER_METRICS.length),
  speakerTrim: NON_NEGATIVE_INTEGER,
  standingsMissedDebates: number({ integer: true }),
  standingsMissedReplies: number({ integer: true }),
  oddBracketMethod: oneOf([
    "pullup_top", "pullup_bottom", "pullup_middle", "pullup_random", "intermediate", "intermediate_bubble",
    "intermediate1", "intermediate2", "pullup_lowest_ds_rank", "pullup_lowest_ds_rank_npulls",
  ]),
  pairingMethod: oneOf(["slide", "fold", "adjacent", "random", "fold_top_adjacent_rest"]),
  conflictAvoidance: oneOf(["off", "one_up_one_down", "min_cost", "min_cost_with_pullups"]),
  pullupRestriction: oneOf(["none", "least_pulled", "lowest_draw_strength_speaks", "lowest_draw_strength_wins"]),
  repeatMatchupPenalty: NON_NEGATIVE,
  institutionClashPenalty: NON_NEGATIVE,
  minAdjScoreToVote: ANY_NUMBER,
  adjConflictPenalty: NON_NEGATIVE,
  adjHistoryPenalty: NON_NEGATIVE,
  importanceMismatchPenalty: NON_NEGATIVE,
  adjudicatorPanelStrategy: oneOf(["crabbytab_v1", "panel_average", "tabbycat_voting", "tabbycat_consensus"]),
  usePreformedPanels: BOOLEAN,
  preformedPanelPlacement: oneOf(["optimise", "direct"]),
  panelSizingMode: oneOf(["fixed", "by_priority"]),
  feedbackSourceWeights,
  skipAdjCheckins: BOOLEAN,
  noPanellistAdjs: BOOLEAN,
  noTraineeAdjs: BOOLEAN,
  teamInstitutionPenalty: NON_NEGATIVE,
  teamHistoryPenalty: NON_NEGATIVE,
  avoidSameInstitution: BOOLEAN,
  avoidTeamHistory: BOOLEAN,
  previouslySawPullupPenalty: NON_NEGATIVE,
  sideBalancePenalty: NON_NEGATIVE,
  pairingDeviationPenalty: NON_NEGATIVE,
  maxTimesPerSide: NON_NEGATIVE_INTEGER,
  maxAllowedSideImbalance: NON_NEGATIVE_INTEGER,
  pullupPenalty: NON_NEGATIVE,
  preliminaryPanelsPerScheduleSlot: number({ min: 1, integer: true }),
  bpPullupDistribution: oneOf(["anywhere", "top", "bottom"]),
  bpPositionCost: oneOf(["simple", "renyi_entropy", "sum_squared_deviations"]),
  renyiOrder: NON_NEGATIVE,
  bpPositionCostExponent: NON_NEGATIVE,
  bpAssignmentMethod: oneOf(["hungarian", "hungarian_unshuffled", "random"]),
  byeTeamResults: oneOf(["absent", "win"]),
  byeTeamSelectionMethod: oneOf(["none", "lowest_ranked", "random"]),
  eliminationSideRule: oneOf(["by_seed", "random"]),
  marginIncludesDissenters: BOOLEAN,
  ballotIntroExplanation: LONG_TEXT,
  teamScoreIncludesGhosts: BOOLEAN,
  ballotMode: oneOf(["consensus", "voting"]),
  eliminationBallotMode: oneOf(["consensus", "voting"]),
  ballotCheckMode: oneOf(["review", "blind"]),
  assistantAccess: oneOf(["all_areas", "results_draw", "results_only", "none"]),
  individualBallots: BOOLEAN,
  privateBallotConfirmation: oneOf(["chair", "tab_room"]),
  privateUrlBallots: BOOLEAN,
  privateUrlFeedback: BOOLEAN,
  allowSelfSplitBallots: BOOLEAN,
  allowLowPointWins: BOOLEAN,
  winnersInBallots: oneOf(["none", "high-points", "tied-points", "low-points"]),
  scoreAggregation: oneOf(["mean", "median"]),
  speakersInBallots: oneOf(["always", "prelim", "never"]),
  speakerRanks: oneOf(["none", "any", "high-points"]),
  scoreCriteria,
  maximumMargin: NON_NEGATIVE,
  stepReplyScore: POSITIVE,
  requireSubstantiveForReply: BOOLEAN,
  sideNames: oneOf(SIDE_NAME_OPTIONS),
  enableMotions: BOOLEAN,
  enableMotionVetoes: BOOLEAN,
  enableMotionReuse: BOOLEAN,
  enableForfeits: BOOLEAN,
  releaseTeamTab: BOOLEAN,
  releaseSpeakerTab: BOOLEAN,
  releaseRepliesTab: BOOLEAN,
  releasedBreakCategoryIds: list((id) => (typeof id === "string" && id.length > 0 ? [] : ["every entry must be a break category id"]), 200),
  publicParticipants: BOOLEAN,
  publicInstitutionsList: BOOLEAN,
  publicAdjudicatorCore: BOOLEAN,
  publicBreakingAdjudicators: BOOLEAN,
  notifyDrawReleased: BOOLEAN,
  notifyBallotReceipt: BOOLEAN,
  notifyTeamPoints: BOOLEAN,
  notifyMotionsReleased: BOOLEAN,
  notifyBallotConfirmed: BOOLEAN,
  allowSelfCheckIn: BOOLEAN,
  ballotReturnLocation: SHORT_TEXT,
  feedbackReturnLocation: SHORT_TEXT,
  ballotsConfirmDigits: BOOLEAN,
  ballotsHideMotions: BOOLEAN,
  speakerCategories,
  publicDrawMode: oneOf(["off", "current", "all"]),
  currentRoundId,
  publicRecordPages: BOOLEAN,
  releaseAdjudicatorTab: BOOLEAN,
  adjudicatorTabShows: oneOf(["test", "final", "all"]),
  releaseBallots: BOOLEAN,
  releasePrivateBallots: BOOLEAN,
  teamTabLimit: NON_NEGATIVE_INTEGER,
  speakerTabLimit: NON_NEGATIVE_INTEGER,
  repliesTabLimit: NON_NEGATIVE_INTEGER,
  releaseBreakCategoryTabs: BOOLEAN,
  releaseSpeakerCategoryTabs: BOOLEAN,
  releaseAllResults: BOOLEAN,
  showUnaccredited: BOOLEAN,
  publicBreakMetrics: number({ min: -1, integer: true }),
  publicBreakCategories: BOOLEAN,
  publicSideAllocations: BOOLEAN,
  publicBracket: BOOLEAN,
  publicDiversity: BOOLEAN,
  publicVetoStatistics: BOOLEAN,
  publicFeedbackProgress: BOOLEAN,
  showTeamInstitutions: BOOLEAN,
  showAdjudicatorInstitutions: BOOLEAN,
  teamCodeNames: oneOf(["off", "all-tooltips", "admin-tooltips-code", "admin-tooltips-real", "everywhere"]),
  participantCodeNames: oneOf(["off", "everywhere"]),
  showEmoji: BOOLEAN,
  showSpeakersInDraw: BOOLEAN,
  showSplittingAdjudicators: BOOLEAN,
  searchEngineIndexing: oneOf(["all", "homepage-only", "none"]),
  welcomeMessage: LONG_TEXT,
  tournamentStaff: LONG_TEXT,
  publicMotionsOrder: oneOf(["forward", "reverse"]),
  motionTabReleased: BOOLEAN,
  showMotionsInResults: BOOLEAN,
  publicBallotForm: BOOLEAN,
  publicFeedbackForm: BOOLEAN,
  publicFormsUsePassword: BOOLEAN,
  venueCategories,
  venueCheckInExpiresAfterHours: NON_NEGATIVE,
  preliminaryPanels: number({ min: 1, integer: true }),
  preparationTime: ANY_NUMBER,
  publicSchedule: BOOLEAN,
  scheduleEvents,
  enableMotionPreferences: BOOLEAN,
} satisfies Record<keyof TournamentPreferences, Check>;

export function isKnownPreference(key: string): key is keyof TournamentPreferences {
  return Object.prototype.hasOwnProperty.call(PREFERENCE_RULES, key);
}

/** Problems with one preference value; [] when it is valid. Unknown preferences are reported. */
export function preferenceValueProblems(key: string, value: unknown, context: PreferenceValidationContext): string[] {
  if (!isKnownPreference(key)) return ["is not a known preference"];
  return (PREFERENCE_RULES[key] as Check)(value, context);
}

/** Pairs that must stay ordered (Tabbycat options/forms.py refuses a minimum above the maximum). */
const ORDERED_PAIRS: Array<[keyof TournamentPreferences, keyof TournamentPreferences]> = [
  ["minSpeakerScore", "maxSpeakerScore"],
  ["minReplyScore", "maxReplyScore"],
  ["feedbackMinScore", "feedbackMaxScore"],
];

function changed(previous: Partial<TournamentPreferences> | undefined, next: Partial<TournamentPreferences>, key: string): boolean {
  const before = (previous as Record<string, unknown> | undefined)?.[key];
  const after = (next as Record<string, unknown>)[key];
  return JSON.stringify(before) !== JSON.stringify(after);
}

/**
 * Problems with the preferences that change from `previous` to `next` (every known preference when
 * there is no previous version). Removed preferences (`undefined`) fall back to their defaults and
 * are not checked; preferences CrabbyTab does not know are left to the caller.
 */
export function preferenceChangeProblems(
  previous: Partial<TournamentPreferences> | undefined,
  next: Partial<TournamentPreferences>,
  context: PreferenceValidationContext
): PreferenceProblem[] {
  const problems: PreferenceProblem[] = [];
  const values = next as Record<string, unknown>;
  for (const key of Object.keys(values)) {
    if (!isKnownPreference(key) || values[key] === undefined || !changed(previous, next, key)) continue;
    for (const message of preferenceValueProblems(key, values[key], context)) problems.push({ key, message });
  }
  for (const [low, high] of ORDERED_PAIRS) {
    if (!changed(previous, next, low) && !changed(previous, next, high)) continue;
    const lowValue = next[low];
    const highValue = next[high];
    if (typeof lowValue === "number" && typeof highValue === "number" && lowValue >= highValue) {
      problems.push({ key: low, message: `must be below ${high}` });
    }
  }
  return problems;
}

export function describePreferenceProblems(problems: PreferenceProblem[]): string {
  return `Some settings are not valid: ${problems.map((problem) => `${problem.key} ${problem.message}`).join("; ")}.`;
}

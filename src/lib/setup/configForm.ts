import type { TournamentFormat, TournamentPreferences } from "@/types";

/**
 * The settings form (app/[tournamentSlug]/config/ConfigForm.tsx) shows every preference with a
 * value. For preferences a tournament never saved it shows the value the engine falls back to
 * (draw generator, ballot validation, allocator...), so the page never misstates how the tournament
 * runs. Saving writes only the preferences the organiser actually changed: an untouched save leaves
 * the stored preferences exactly as they were, and a fallback shown here is never persisted (which
 * would freeze it, or — when a display default differed from the engine — silently change results).
 */
export function configFormDefaults(format: TournamentFormat): TournamentPreferences {
  const bp = format === "bp";
  return {
    teamsInDebate: bp ? 4 : 2,
    // result.ts substantiveSpeakerCount: 2 for BP, otherwise 3.
    substantiveSpeakers: bp ? 2 : 3,
    replyScoresEnabled: false,
    // lib/scoring/validator.ts fallbacks.
    minSpeakerScore: 68,
    maxSpeakerScore: 84,
    stepSpeakerScore: 1,
    minReplyScore: 34,
    maxReplyScore: 42,
    drawRule: "power_paired",
    sideAllocationRule: "balanced",
    ballotDoubleEntry: false,
    publicDraw: true,
    publicResults: true,
    publicStandings: true,
    publicMotions: true,
    publicCheckInStatus: false,
    checkInExpiresAfterHours: 0,
    feedbackEnabled: true,
    feedbackMinScore: 1,
    feedbackMaxScore: 10,
    feedbackQuestions: [],
    // lib/draw/allocator.ts and features/tournament/application/allocation.ts fallbacks.
    minAdjScoreToVote: 1.5,
    adjConflictPenalty: 1000000,
    adjHistoryPenalty: 10000,
    importanceMismatchPenalty: 10000000,
    adjudicatorPanelStrategy: "crabbytab_v1",
    usePreformedPanels: false,
    skipAdjCheckins: false,
    noPanellistAdjs: false,
    noTraineeAdjs: false,
    // lib/draw/generator.ts fallbacks (not Tabbycat's 1: a tournament with no saved value is drawn with 200).
    teamInstitutionPenalty: 200,
    teamHistoryPenalty: 1000,
    avoidSameInstitution: true,
    avoidTeamHistory: true,
    previouslySawPullupPenalty: 0,
    sideBalancePenalty: 0,
    pairingDeviationPenalty: 0,
    maxTimesPerSide: 5,
    maxAllowedSideImbalance: 0,
    // twoTeamDraw.ts DEFAULT_TWO_TEAM_DRAW_CONFIG (Tabbycat's own default is intermediate_bubble).
    oddBracketMethod: "pullup_top",
    pairingMethod: "fold",
    conflictAvoidance: "one_up_one_down",
    pullupRestriction: "none",
    pullupPenalty: 0,
    bpPullupDistribution: "anywhere",
    bpPositionCost: "renyi_entropy",
    renyiOrder: 1.0,
    bpPositionCostExponent: 4.0,
    bpAssignmentMethod: "hungarian",
    byeTeamResults: "absent",
    byeTeamSelectionMethod: "none",
    // result.ts treats absent as off (Tabbycat default False).
    marginIncludesDissenters: false,
    ballotIntroExplanation: "",
    teamScoreIncludesGhosts: false,
  };
}

/** What the form shows: the stored preferences over the engine fallbacks. */
export function configFormPreferences(
  stored: Partial<TournamentPreferences> | undefined,
  format: TournamentFormat
): TournamentPreferences {
  return { ...configFormDefaults(format), ...(stored ?? {}) } as TournamentPreferences;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The preferences whose value differs between what the form loaded and what it holds now. */
export function changedConfigPreferences(
  baseline: Partial<TournamentPreferences>,
  edited: Partial<TournamentPreferences>
): Partial<TournamentPreferences> {
  const before = baseline as Record<string, unknown>;
  const after = edited as Record<string, unknown>;
  const changes: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!sameValue(before[key], after[key])) changes[key] = after[key];
  }
  return changes as Partial<TournamentPreferences>;
}

/**
 * The preferences to save: the stored preferences (as they are now, so a change made elsewhere
 * since the form loaded is kept) with only the organiser's edits applied. A field the organiser
 * cleared back to `undefined` is removed so its fallback applies. With no edits the stored object
 * is returned unchanged.
 */
export function configPreferencesToSave(
  stored: TournamentPreferences | undefined,
  baseline: Partial<TournamentPreferences>,
  edited: Partial<TournamentPreferences>
): TournamentPreferences {
  const changes = changedConfigPreferences(baseline, edited) as Record<string, unknown>;
  const current = (stored ?? {}) as TournamentPreferences;
  if (Object.keys(changes).length === 0) return current;
  const next = { ...current } as Record<string, unknown>;
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next as unknown as TournamentPreferences;
}

/**
 * When the stored preferences change while the form is open (live sync), the form shows the new
 * values but keeps the organiser's own unsaved edits on top.
 */
export function rebaseConfigPreferences(
  oldBaseline: Partial<TournamentPreferences>,
  newBaseline: TournamentPreferences,
  edited: Partial<TournamentPreferences>
): TournamentPreferences {
  return { ...newBaseline, ...changedConfigPreferences(oldBaseline, edited) } as TournamentPreferences;
}

export type ConfigFormProblem =
  | "substantiveSpeakers"
  | "speakerScoreNumbers"
  | "speakerScoreRange"
  | "speakerScoreStep"
  | "replyScoreNumbers"
  | "replyScoreRange"
  | "feedbackScoreNumbers"
  | "feedbackScoreRange"
  | "minAdjScoreToVote"
  | "renyiOrder"
  | "bpPositionCostExponent";

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * Checks the settings form before it saves (Tabbycat options/forms.py: every minimum below its
 * maximum). Numbers left empty in the form are NaN and refused rather than saved. Ranges are
 * checked on the effective values, so a stored minimum and a newly typed maximum are compared too.
 */
export function configFormProblems(prefs: Partial<TournamentPreferences>, format: TournamentFormat): ConfigFormProblem[] {
  const effective = configFormPreferences(prefs, format);
  const problems: ConfigFormProblem[] = [];
  const speakers = effective.substantiveSpeakers;
  if (!finite(speakers) || !Number.isInteger(speakers) || speakers < 1) problems.push("substantiveSpeakers");

  if (!finite(effective.minSpeakerScore) || !finite(effective.maxSpeakerScore)) problems.push("speakerScoreNumbers");
  else if (effective.minSpeakerScore >= effective.maxSpeakerScore) problems.push("speakerScoreRange");
  if (!finite(effective.stepSpeakerScore) || effective.stepSpeakerScore <= 0) problems.push("speakerScoreStep");

  if (effective.replyScoresEnabled) {
    if (!finite(effective.minReplyScore) || !finite(effective.maxReplyScore)) problems.push("replyScoreNumbers");
    else if (effective.minReplyScore >= effective.maxReplyScore) problems.push("replyScoreRange");
  }
  if (effective.feedbackEnabled !== false) {
    if (!finite(effective.feedbackMinScore) || !finite(effective.feedbackMaxScore)) problems.push("feedbackScoreNumbers");
    else if (effective.feedbackMinScore >= effective.feedbackMaxScore) problems.push("feedbackScoreRange");
  }
  if (!finite(effective.minAdjScoreToVote)) problems.push("minAdjScoreToVote");
  if (!finite(effective.renyiOrder) || (effective.renyiOrder as number) < 0) problems.push("renyiOrder");
  if (!finite(effective.bpPositionCostExponent) || (effective.bpPositionCostExponent as number) < 0) {
    problems.push("bpPositionCostExponent");
  }
  return problems;
}

/** A number typed into the form: the value, or NaN when the field is empty or not a number. */
export function parseNumberField(value: string): number {
  return value.trim() === "" ? Number.NaN : Number(value);
}

/** What a number field shows: blank while the organiser has emptied it. */
export function numberFieldValue(value: number | undefined): number | "" {
  return typeof value === "number" && Number.isFinite(value) ? value : "";
}

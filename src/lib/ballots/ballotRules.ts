import type {
  Round,
  RoundStage,
  ScoreAggregation,
  ScoreCriterion,
  SpeakerRanksMode,
  SpeakersInBallots,
  TournamentPreferences,
  WinnerDeclaration,
} from "@/types";

/**
 * Readers for the results preferences added in wave 5, each with the default that keeps older
 * tournaments behaving as before. Tabbycat names are in brackets.
 */

type Prefs = Partial<TournamentPreferences> | undefined;

/**
 * How a debate's winner is decided (`winners_in_ballots`). Tournaments saved before this setting
 * existed used `allowLowPointWins`: on, the entered result overrides the scores ("low-points");
 * off, the winner must have the higher total, which is "none" with the winner read from the scores.
 */
export function winnerDeclarationFor(preferences: Prefs): WinnerDeclaration {
  const mode = preferences?.winnersInBallots;
  if (mode === "none" || mode === "high-points" || mode === "tied-points" || mode === "low-points") return mode;
  return preferences?.allowLowPointWins ? "low-points" : "none";
}

/** True when ballots carry an explicit winner (or BP ranks) that is not simply read from the totals. */
export function declaresWinner(preferences: Prefs): boolean {
  return winnerDeclarationFor(preferences) !== "none";
}

/** `score_aggregation_function`. */
export function scoreAggregationFor(preferences: Prefs): ScoreAggregation {
  return preferences?.scoreAggregation === "median" ? "median" : "mean";
}

/** `speakers_in_ballots`. */
export function speakersInBallotsFor(preferences: Prefs): SpeakersInBallots {
  const value = preferences?.speakersInBallots;
  return value === "prelim" || value === "never" ? value : "always";
}

/**
 * Whether ballots for a round of `stage` ask for speaker scores. "prelim" drops them in
 * elimination rounds, "never" everywhere, as Tabbycat's `get_result_class`.
 */
export function ballotsHaveSpeakerScores(preferences: Prefs, stage: RoundStage | undefined): boolean {
  const mode = speakersInBallotsFor(preferences);
  if (mode === "never") return false;
  if (mode === "prelim") return stage !== "elimination";
  return true;
}

/** `speaker_ranks`. */
export function speakerRanksFor(preferences: Prefs): SpeakerRanksMode {
  const value = preferences?.speakerRanks;
  return value === "any" || value === "high-points" ? value : "none";
}

/** `reply_score_step`; before it existed CrabbyTab used half the substantive step. */
export function replyScoreStep(preferences: Prefs): number {
  const step = preferences?.stepReplyScore;
  if (typeof step === "number" && Number.isFinite(step) && step > 0) return step;
  return (preferences?.stepSpeakerScore ?? 1) / 2;
}

/** `require_substantive_for_reply`; Tabbycat's default is on. */
export function requireSubstantiveForReply(preferences: Prefs): boolean {
  return preferences?.requireSubstantiveForReply !== false;
}

/** `maximum_margin`; 0 means no limit. */
export function maximumMarginFor(preferences: Prefs): number {
  const value = preferences?.maximumMargin;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** `enable_motion_reuse`; on unless explicitly turned off (see TournamentPreferences.enableMotionReuse). */
export function motionReuseEnabled(preferences: Prefs): boolean {
  return preferences?.enableMotionReuse !== false;
}

/** `enable_motions`; on unless explicitly turned off. */
export function motionsEnabled(preferences: Prefs): boolean {
  return preferences?.enableMotions !== false;
}

/** Tabbycat `Round.weight`: a positive integer, 1 when unset or invalid. */
export function roundWeight(round: Pick<Round, "weight"> | undefined | null): number {
  const weight = round?.weight;
  return typeof weight === "number" && Number.isInteger(weight) && weight >= 0 ? weight : 1;
}

/* -------------------------------------------------------------------------- */
/* Panel aggregation                                                          */
/* -------------------------------------------------------------------------- */

/** Strips floating-point noise without rounding to a display precision. */
export function cleanScore(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

/**
 * Combines one speech's scores from several adjudicators. "median" is Tabbycat's
 * `median_or_rounded_up_mean`: the median of an odd panel, and the mean rounded UP to a whole
 * number for an even panel (so 75 and 76 give 76, and 75.5 and 76 give 76).
 */
export function aggregateScoreValues(values: number[], aggregation: ScoreAggregation): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (aggregation === "mean") return cleanScore(mean);
  if (values.length % 2 === 0) return Math.ceil(cleanScore(mean));
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) / 2];
}

/* -------------------------------------------------------------------------- */
/* Score criteria                                                             */
/* -------------------------------------------------------------------------- */

/** The tournament's criteria in sequence order; empty when speakers get a single score. */
export function scoreCriteriaFor(preferences: Prefs): ScoreCriterion[] {
  return [...(preferences?.scoreCriteria ?? [])]
    .filter((criterion) => criterion && typeof criterion.id === "string")
    .sort((a, b) => a.seq - b.seq);
}

/** Criteria that apply to a speech (`ScoreCriterion.applies_to_position`). */
export function criteriaForSpeech(criteria: ScoreCriterion[], isReply: boolean): ScoreCriterion[] {
  return criteria.filter((criterion) =>
    criterion.speechType === "all" ||
    (criterion.speechType === "reply" ? isReply : !isReply)
  );
}

/** Σ weight × criterion score; a blank criterion counts as 0 (Tabbycat stores optional blanks as 0). */
export function weightedCriteriaScore(criteria: ScoreCriterion[], values: Record<string, number> | undefined): number {
  return cleanScore(
    criteria.reduce((sum, criterion) => {
      const value = values?.[criterion.id];
      return sum + (typeof value === "number" && Number.isFinite(value) ? value * criterion.weight : 0);
    }, 0)
  );
}

/** True when `value` is `min` plus a whole number of `step`s (to 0.001). */
export function isOnStep(value: number, min: number, step: number): boolean {
  if (!(step > 0)) return true;
  const steps = (value - min) / step;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

/** An error message for one criterion score, or "" when it is valid. Blank is valid when optional. */
export function validateCriterionScore(criterion: ScoreCriterion, value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return criterion.required ? `${criterion.name}: enter a score.` : "";
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return `${criterion.name}: the score must be a number.`;
  if (value < criterion.minScore || value > criterion.maxScore) {
    return `${criterion.name}: ${value} is outside ${criterion.minScore}–${criterion.maxScore}.`;
  }
  if (!isOnStep(value, criterion.minScore, criterion.step)) {
    return `${criterion.name}: ${value} is not a multiple of ${criterion.step} from ${criterion.minScore}.`;
  }
  return "";
}

/** Problems with a set of criteria definitions (for the settings form); empty when valid. */
export function validateScoreCriteria(criteria: ScoreCriterion[]): string[] {
  const errors: string[] = [];
  const names = new Set<string>();
  for (const criterion of criteria) {
    const label = criterion.name.trim() || "A criterion";
    if (!criterion.name.trim()) errors.push("Every criterion needs a name.");
    const key = `${criterion.speechType}:${criterion.name.trim().toLowerCase()}`;
    if (names.has(key)) errors.push(`${label} is listed twice for the same speeches.`);
    names.add(key);
    if (!(Number.isFinite(criterion.weight) && criterion.weight > 0)) errors.push(`${label}: the weight must be greater than 0.`);
    if (!(Number.isFinite(criterion.minScore) && Number.isFinite(criterion.maxScore) && criterion.minScore < criterion.maxScore)) {
      errors.push(`${label}: the minimum must be below the maximum.`);
    }
    if (!(Number.isFinite(criterion.step) && criterion.step > 0)) errors.push(`${label}: the step must be greater than 0.`);
  }
  return errors;
}

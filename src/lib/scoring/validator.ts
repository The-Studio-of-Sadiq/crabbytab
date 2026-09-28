import { TournamentPreferences } from "@/types";

export interface ScoreValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates a substantive speaker score against tournament preferences.
 * Must be within [minSpeakerScore, maxSpeakerScore] and a valid step increment.
 */
export function validateSpeakerScore(
  score: number,
  preferences?: Partial<TournamentPreferences>
): ScoreValidationResult {
  const min = preferences?.minSpeakerScore ?? 68;
  const max = preferences?.maxSpeakerScore ?? 84;
  const step = preferences?.stepSpeakerScore ?? 1;

  if (typeof score !== "number" || isNaN(score)) {
    return { valid: false, error: "Score must be a valid number." };
  }

  if (score < min || score > max) {
    return {
      valid: false,
      error: `Substantive score (${score}) must be between ${min} and ${max}.`,
    };
  }

  // Check step increment: (score - min) % step === 0 (accounting for floating point precision)
  const diff = Math.round((score - min) * 100) / 100;
  const stepCount = Math.round(diff / step);
  const reconstructed = Math.round((stepCount * step) * 100) / 100;

  if (Math.abs(diff - reconstructed) > 0.001) {
    return {
      valid: false,
      error: `Score must be a multiple of ${step} (between ${min} and ${max}).`,
    };
  }

  return { valid: true };
}

/**
 * Validates a reply speaker score against tournament preferences.
 * Must be within [minReplyScore, maxReplyScore] and a valid step increment (typically half of substantive step).
 */
export function validateReplyScore(
  score: number,
  preferences?: Partial<TournamentPreferences>
): ScoreValidationResult {
  const min = preferences?.minReplyScore ?? 34;
  const max = preferences?.maxReplyScore ?? 42;
  const step = (preferences?.stepSpeakerScore ?? 1) / 2; // Reply step is half substantive step (e.g. 0.5)

  if (typeof score !== "number" || isNaN(score)) {
    return { valid: false, error: "Reply score must be a valid number." };
  }

  if (score < min || score > max) {
    return {
      valid: false,
      error: `Reply score (${score}) must be between ${min} and ${max}.`,
    };
  }

  const diff = Math.round((score - min) * 100) / 100;
  const stepCount = Math.round(diff / step);
  const reconstructed = Math.round((stepCount * step) * 100) / 100;

  if (Math.abs(diff - reconstructed) > 0.001) {
    return {
      valid: false,
      error: `Reply score must be a multiple of ${step} (between ${min} and ${max}).`,
    };
  }

  return { valid: true };
}

/**
 * Validates an adjudicator feedback score against tournament preferences.
 */
export function validateFeedbackScore(
  score: number,
  preferences?: Partial<TournamentPreferences>
): ScoreValidationResult {
  const min = preferences?.feedbackMinScore ?? 1;
  const max = preferences?.feedbackMaxScore ?? 10;

  if (typeof score !== "number" || isNaN(score)) {
    return { valid: false, error: "Feedback score must be a valid number." };
  }

  if (score < min || score > max) {
    return {
      valid: false,
      error: `Feedback score (${score}) must be between ${min} and ${max}.`,
    };
  }

  return { valid: true };
}

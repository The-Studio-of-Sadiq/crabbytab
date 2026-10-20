import type {
  Debate,
  FeedbackAnswer,
  FeedbackPath,
  FeedbackPathConfig,
  FeedbackQuestion,
  FeedbackQuestionType,
  FeedbackSourceRole,
  FeedbackTargetRole,
  Round,
} from "@/types";
import { isFeedbackPathAllowed, toFeedbackPathConfig } from "./paths";

/** Every answer type, in the order the question editor lists them. */
export const FEEDBACK_QUESTION_TYPES: Array<{ type: FeedbackQuestionType; label: string }> = [
  { type: "text", label: "Short text" },
  { type: "textarea", label: "Long text" },
  { type: "integer", label: "Whole number box" },
  { type: "float", label: "Decimal number box" },
  { type: "integer_scale", label: "Integer scale (pick one)" },
  { type: "scale", label: "Number in range" },
  { type: "yes_no", label: "Yes / No" },
  { type: "checkbox", label: "Checkbox" },
  { type: "select_one", label: "Select one" },
  { type: "select_many", label: "Select many" },
];

/** Types whose answers are numbers (averaged in the per-question analysis). */
export const NUMERIC_FEEDBACK_QUESTION_TYPES: ReadonlySet<FeedbackQuestionType> =
  new Set(["scale", "integer", "float", "integer_scale"]);
/** Types whose answers are booleans (tallied as yes/no). */
export const BOOLEAN_FEEDBACK_QUESTION_TYPES: ReadonlySet<FeedbackQuestionType> = new Set(["yes_no", "checkbox"]);

/** Integer scales are shown as one choice per value; keep that list printable. */
export const MAX_INTEGER_SCALE_CHOICES = 21;

/** The values an integer scale offers, or [] when its bounds are invalid. */
export function integerScaleChoices(question: Pick<FeedbackQuestion, "min" | "max">): number[] {
  const { min, max } = question;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min! >= max! || max! - min! + 1 > MAX_INTEGER_SCALE_CHOICES) {
    return [];
  }
  return Array.from({ length: max! - min! + 1 }, (_, index) => min! + index);
}

/** "from 1 to 5", "at least 0", "at most 10" or "" for a numeric question's bounds. */
export function numericBoundsText(question: Pick<FeedbackQuestion, "min" | "max">): string {
  const hasMin = Number.isFinite(question.min);
  const hasMax = Number.isFinite(question.max);
  if (hasMin && hasMax) return `from ${question.min} to ${question.max}`;
  if (hasMin) return `at least ${question.min}`;
  if (hasMax) return `at most ${question.max}`;
  return "";
}

export function questionsForFeedbackSource(
  sourceType: "team" | "adjudicator",
  preferences?: {
    feedbackQuestions?: FeedbackQuestion[];
    teamFeedbackQuestions?: FeedbackQuestion[];
    adjudicatorFeedbackQuestions?: FeedbackQuestion[];
  }
): FeedbackQuestion[] {
  return sourceType === "team"
    ? preferences?.teamFeedbackQuestions ?? preferences?.feedbackQuestions ?? []
    : preferences?.adjudicatorFeedbackQuestions ?? preferences?.feedbackQuestions ?? [];
}

export function isFeedbackEnabledForRound(
  debate: Pick<Debate, "postponed">,
  round: Pick<Round, "stage" | "feedbackEnabled"> | undefined,
  feedbackInEliminationRounds = true
): boolean {
  return !debate.postponed &&
    (round?.feedbackEnabled ?? (round?.stage !== "elimination" || feedbackInEliminationRounds));
}

/**
 * Whether a participant of a debate may give feedback on another. `path` is a preset or an
 * explicit config (see paths.ts); pass the round's paths from `feedbackPathsForRound`.
 * Roles default from the chair flags, so a non-chair adjudicator counts as a panellist
 * unless `sourceRole` / `targetRole` say "trainee".
 */
export function canSubmitParticipantFeedback(input: {
  sourceType: "team" | "adjudicator";
  sourceId: string;
  sourceIsChair: boolean;
  sourceRole?: FeedbackSourceRole;
  targetType: "team" | "adjudicator";
  targetId: string;
  targetIsChair: boolean;
  targetRole?: FeedbackTargetRole;
  path: FeedbackPath | FeedbackPathConfig;
}): boolean {
  if (input.sourceId === input.targetId) return false;
  const config = toFeedbackPathConfig(input.path);
  if (input.targetType === "team") return config.onTeams;
  const sourceRole: FeedbackSourceRole = input.sourceType === "team"
    ? "team"
    : input.sourceRole ?? (input.sourceIsChair ? "chair" : "panellist");
  const targetRole: FeedbackTargetRole = input.targetRole ?? (input.targetIsChair ? "chair" : "panellist");
  return isFeedbackPathAllowed(config, sourceRole, targetRole);
}

export function isFeedbackAnswerRecord(value: unknown): value is Record<string, FeedbackAnswer> {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(([id, answer]) =>
      id.length > 0 &&
      (answer === null ||
        typeof answer === "string" ||
        (typeof answer === "number" && Number.isFinite(answer)) ||
        typeof answer === "boolean" ||
        (Array.isArray(answer) && answer.every((option) => typeof option === "string")))
    );
}

export function validateFeedbackQuestions(questions: FeedbackQuestion[]): string | null {
  const ids = new Set<string>();
  for (const question of questions) {
    if (!question.id.trim() || ids.has(question.id)) return "Each feedback question must have a unique ID.";
    ids.add(question.id);
    if (!question.label.trim()) return "Every feedback question needs a label.";
    if (
      (question.type === "select_one" || question.type === "select_many") &&
      (!question.options?.length || question.options.some((option) => !option.trim()))
    ) {
      return `Add at least one non-empty option for “${question.label}”.`;
    }
    if (
      question.type === "scale" &&
      (!Number.isFinite(question.min) || !Number.isFinite(question.max) || question.min! >= question.max!)
    ) {
      return `Set a valid minimum and maximum for “${question.label}”.`;
    }
    if (question.type === "integer_scale" && integerScaleChoices(question).length === 0) {
      return `Set whole-number bounds for “${question.label}” with the minimum below the maximum (at most ${MAX_INTEGER_SCALE_CHOICES} choices).`;
    }
    if (question.type === "integer" || question.type === "float") {
      for (const bound of [question.min, question.max]) {
        if (bound !== undefined && (!Number.isFinite(bound) || (question.type === "integer" && !Number.isInteger(bound)))) {
          return `The bounds of “${question.label}” must be ${question.type === "integer" ? "whole numbers" : "numbers"}.`;
        }
      }
      if (question.min !== undefined && question.max !== undefined && question.min > question.max) {
        return `The minimum of “${question.label}” is above its maximum.`;
      }
    }
  }
  return null;
}

export function validateFeedbackAnswers(
  questions: FeedbackQuestion[],
  answers: Record<string, FeedbackAnswer>
): string | null {
  const configurationError = validateFeedbackQuestions(questions);
  if (configurationError) return configurationError;

  const questionIds = new Set(questions.map((question) => question.id));
  if (Object.keys(answers).some((id) => !questionIds.has(id))) {
    return "Feedback contains an answer for an unknown question.";
  }

  for (const question of questions) {
    const answer = answers[question.id];
    const isEmpty = answer === undefined || answer === null ||
      (typeof answer === "string" && !answer.trim()) ||
      (Array.isArray(answer) && answer.length === 0) ||
      // A required checkbox must be ticked (Tabbycat: "I confirm …" style questions).
      (question.type === "checkbox" && answer === false);
    if (question.required && isEmpty) {
      return question.type === "checkbox" ? `Please tick “${question.label}”.` : `Please answer “${question.label}”.`;
    }
    if (isEmpty) continue;

    if (question.type === "scale") {
      if (typeof answer !== "number" || !Number.isFinite(answer) ||
        answer < question.min! || answer > question.max!) {
        return `“${question.label}” must be a number from ${question.min} to ${question.max}.`;
      }
    } else if (question.type === "select_one") {
      if (typeof answer !== "string" || !question.options?.includes(answer)) {
        return `Choose a valid option for “${question.label}”.`;
      }
    } else if (question.type === "select_many") {
      if (!Array.isArray(answer) || answer.some((value) => !question.options?.includes(value))) {
        return `Choose valid options for “${question.label}”.`;
      }
    } else if (question.type === "integer_scale") {
      if (typeof answer !== "number" || !integerScaleChoices(question).includes(answer)) {
        return `Choose a whole number from ${question.min} to ${question.max} for “${question.label}”.`;
      }
    } else if (question.type === "integer" || question.type === "float") {
      const wrongKind = typeof answer !== "number" || !Number.isFinite(answer) ||
        (question.type === "integer" && !Number.isInteger(answer));
      if (wrongKind || (question.min !== undefined && answer < question.min) ||
        (question.max !== undefined && answer > question.max)) {
        const bounds = numericBoundsText(question);
        return `“${question.label}” must be ${question.type === "integer" ? "a whole number" : "a number"}${bounds ? ` ${bounds}` : ""}.`;
      }
    } else if (question.type === "checkbox" && typeof answer !== "boolean") {
      return `“${question.label}” must be ticked or left blank.`;
    } else if (question.type === "yes_no" && typeof answer !== "boolean") {
      return `Choose yes or no for “${question.label}”.`;
    } else if ((question.type === "text" || question.type === "textarea") && typeof answer !== "string") {
      return `Enter text for “${question.label}”.`;
    }
  }
  return null;
}

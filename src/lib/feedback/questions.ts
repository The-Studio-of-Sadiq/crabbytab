import type { Debate, FeedbackAnswer, FeedbackPath, FeedbackQuestion, Round } from "@/types";

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

export function canSubmitParticipantFeedback(input: {
  sourceType: "team" | "adjudicator";
  sourceId: string;
  sourceIsChair: boolean;
  targetType: "team" | "adjudicator";
  targetId: string;
  targetIsChair: boolean;
  path: FeedbackPath;
}): boolean {
  if (input.sourceId === input.targetId) return false;
  if (input.sourceType === "team") {
    return input.targetType === "adjudicator" ||
      (input.path === "everyone" && input.targetType === "team");
  }
  if (input.targetType === "team") return input.path === "everyone";
  if (input.path === "everyone") return true;
  if (input.path === "chairs_to_panel") return input.sourceIsChair && !input.targetIsChair;
  return input.sourceIsChair !== input.targetIsChair;
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
      (Array.isArray(answer) && answer.length === 0);
    if (question.required && isEmpty) return `Please answer “${question.label}”.`;
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
    } else if (question.type === "yes_no" && typeof answer !== "boolean") {
      return `Choose yes or no for “${question.label}”.`;
    } else if ((question.type === "text" || question.type === "textarea") && typeof answer !== "string") {
      return `Enter text for “${question.label}”.`;
    }
  }
  return null;
}

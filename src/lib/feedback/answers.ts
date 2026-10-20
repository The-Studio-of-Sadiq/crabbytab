import type { FeedbackAnswer, FeedbackQuestion, FeedbackSubmission } from "@/types";
import { BOOLEAN_FEEDBACK_QUESTION_TYPES, NUMERIC_FEEDBACK_QUESTION_TYPES } from "./questions";

export type FeedbackQuestionAnalysis =
  | { kind: "numeric"; question: FeedbackQuestion; answered: number; average?: number; min?: number; max?: number }
  | { kind: "boolean"; question: FeedbackQuestion; answered: number; yes: number; no: number }
  | { kind: "choice"; question: FeedbackQuestion; answered: number; counts: Array<{ option: string; count: number }> }
  | { kind: "text"; question: FeedbackQuestion; answered: number; responses: string[] };

function isAnswered(answer: FeedbackAnswer | undefined): boolean {
  return answer !== undefined && answer !== null &&
    !(typeof answer === "string" && !answer.trim()) &&
    !(Array.isArray(answer) && answer.length === 0);
}

/**
 * Per-question summaries of the answers in `submissions`: average/min/max for numeric
 * questions, yes/no tallies for yes-no and checkbox questions, option counts for selects and
 * the responses themselves for text. Answers of the wrong kind (for example from before a
 * question's type changed) are left out rather than guessed at.
 */
export function analyzeFeedbackAnswers(
  questions: FeedbackQuestion[],
  submissions: Array<Pick<FeedbackSubmission, "answers">>
): FeedbackQuestionAnalysis[] {
  return questions.map((question): FeedbackQuestionAnalysis => {
    const answers = submissions
      .map((submission) => submission.answers?.[question.id])
      .filter(isAnswered) as Array<Exclude<FeedbackAnswer, null>>;

    if (NUMERIC_FEEDBACK_QUESTION_TYPES.has(question.type)) {
      const values = answers.filter((answer): answer is number => typeof answer === "number" && Number.isFinite(answer));
      return {
        kind: "numeric",
        question,
        answered: values.length,
        ...(values.length ? {
          average: values.reduce((sum, value) => sum + value, 0) / values.length,
          min: Math.min(...values),
          max: Math.max(...values),
        } : {}),
      };
    }
    if (BOOLEAN_FEEDBACK_QUESTION_TYPES.has(question.type)) {
      // An unticked checkbox is a "no" when it was saved as false.
      const values = submissions
        .map((submission) => submission.answers?.[question.id])
        .filter((answer): answer is boolean => typeof answer === "boolean");
      const yes = values.filter(Boolean).length;
      return { kind: "boolean", question, answered: values.length, yes, no: values.length - yes };
    }
    if (question.type === "select_one" || question.type === "select_many") {
      const chosen = answers.flatMap((answer) =>
        Array.isArray(answer) ? answer : typeof answer === "string" ? [answer] : []
      );
      const answered = answers.filter((answer) => Array.isArray(answer) || typeof answer === "string").length;
      const known = new Set(question.options ?? []);
      const options = [...(question.options ?? []), ...new Set(chosen.filter((option) => !known.has(option)))];
      return {
        kind: "choice",
        question,
        answered,
        counts: options.map((option) => ({ option, count: chosen.filter((value) => value === option).length })),
      };
    }
    const responses = answers.filter((answer): answer is string => typeof answer === "string").map((answer) => answer.trim());
    return { kind: "text", question, answered: responses.length, responses };
  });
}

/** Agree/disagree tally of the "agree with the decision" answers. */
export function agreementTally(submissions: Array<Pick<FeedbackSubmission, "agreeWithDecision">>): {
  agree: number;
  disagree: number;
  answered: number;
} {
  const answered = submissions.filter((submission) => typeof submission.agreeWithDecision === "boolean");
  const agree = answered.filter((submission) => submission.agreeWithDecision).length;
  return { agree, disagree: answered.length - agree, answered: answered.length };
}

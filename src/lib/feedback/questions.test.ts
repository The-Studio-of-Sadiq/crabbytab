import { describe, expect, it } from "vitest";
import type { FeedbackQuestion } from "@/types";
import { isFeedbackAnswerRecord, validateFeedbackAnswers, validateFeedbackQuestions } from "./questions";

const questions: FeedbackQuestion[] = [
  { id: "clarity", label: "How clear was the adjudication?", type: "scale", required: true, min: 1, max: 5 },
  { id: "notes", label: "Additional notes", type: "textarea", required: false },
  { id: "areas", label: "Areas to improve", type: "select_many", required: false, options: ["Clarity", "Time"] },
];

describe("feedback questionnaires", () => {
  it("accepts complete, correctly typed answers", () => {
    expect(validateFeedbackAnswers(questions, { clarity: 4, notes: "", areas: ["Clarity"] })).toBeNull();
  });

  it("requires configured required answers", () => {
    expect(validateFeedbackAnswers(questions, {})).toBe("Please answer “How clear was the adjudication?”.");
  });

  it("validates rating bounds and selected options", () => {
    expect(validateFeedbackAnswers(questions, { clarity: 6 })).toContain("from 1 to 5");
    expect(validateFeedbackAnswers(questions, { clarity: 3, areas: ["Other"] })).toContain("valid options");
    expect(validateFeedbackAnswers(questions, { clarity: 3, extra: "unexpected" })).toContain("unknown question");
  });

  it("narrows untrusted answer values before they are saved", () => {
    expect(isFeedbackAnswerRecord({ rating: 4, notes: "Clear", consent: true, topics: ["style"] })).toBe(true);
    expect(isFeedbackAnswerRecord({ rating: { arbitrary: true } })).toBe(false);
    expect(isFeedbackAnswerRecord({ topics: [1] })).toBe(false);
  });

  it("rejects invalid questionnaire configuration", () => {
    expect(validateFeedbackQuestions([
      { id: "same", label: "One", type: "text", required: true },
      { id: "same", label: "Two", type: "text", required: false },
    ])).toContain("unique ID");
  });
});

import { describe, expect, it } from "vitest";
import type { FeedbackQuestion } from "@/types";
import {
  integerScaleChoices,
  isFeedbackAnswerRecord,
  validateFeedbackAnswers,
  validateFeedbackQuestions,
} from "./questions";

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

describe("Tabbycat question types", () => {
  const typed: FeedbackQuestion[] = [
    { id: "int", label: "Whole", type: "integer", required: false, min: 0, max: 10 },
    { id: "float", label: "Decimal", type: "float", required: false, min: 0.5, max: 2.5 },
    { id: "open", label: "Open", type: "float", required: false },
    { id: "iscale", label: "Scale", type: "integer_scale", required: false, min: 1, max: 5 },
    { id: "box", label: "I confirm", type: "checkbox", required: true },
  ];

  it("accepts valid answers of each type", () => {
    expect(validateFeedbackAnswers(typed, { int: 7, float: 1.25, open: -40.5, iscale: 3, box: true })).toBeNull();
  });

  it("integer boxes take whole numbers within optional bounds", () => {
    expect(validateFeedbackAnswers(typed, { int: 7.5, box: true })).toContain("whole number from 0 to 10");
    expect(validateFeedbackAnswers(typed, { int: 11, box: true })).toContain("from 0 to 10");
    expect(validateFeedbackAnswers(typed, { int: "7" as never, box: true })).toContain("whole number");
  });

  it("float boxes take any finite number within optional bounds", () => {
    expect(validateFeedbackAnswers(typed, { float: 3, box: true })).toContain("from 0.5 to 2.5");
    expect(validateFeedbackAnswers(typed, { open: Number.NaN, box: true })).toContain("must be a number");
  });

  it("integer scales take only listed whole values", () => {
    expect(validateFeedbackAnswers(typed, { iscale: 2.5, box: true })).toContain("whole number from 1 to 5");
    expect(validateFeedbackAnswers(typed, { iscale: 6, box: true })).toContain("whole number from 1 to 5");
    expect(integerScaleChoices({ min: 1, max: 5 })).toEqual([1, 2, 3, 4, 5]);
  });

  it("a required checkbox must be ticked; an optional one may be false", () => {
    expect(validateFeedbackAnswers(typed, { box: false })).toBe("Please tick “I confirm”.");
    expect(validateFeedbackAnswers(typed, {})).toBe("Please tick “I confirm”.");
    expect(validateFeedbackAnswers([{ ...typed[4], required: false }], { box: false })).toBeNull();
    expect(validateFeedbackAnswers(typed, { box: "yes" as never })).toContain("ticked");
  });

  it("validates the configuration of the new types", () => {
    expect(validateFeedbackQuestions([{ id: "a", label: "A", type: "integer_scale", required: false, min: 1.5, max: 5 }]))
      .toContain("whole-number bounds");
    expect(validateFeedbackQuestions([{ id: "a", label: "A", type: "integer_scale", required: false, min: 0, max: 100 }]))
      .toContain("at most");
    expect(validateFeedbackQuestions([{ id: "a", label: "A", type: "integer", required: false, min: 0.5 }]))
      .toContain("whole numbers");
    expect(validateFeedbackQuestions([{ id: "a", label: "A", type: "float", required: false, min: 3, max: 1 }]))
      .toContain("above its maximum");
    expect(validateFeedbackQuestions([{ id: "a", label: "A", type: "float", required: false }])).toBeNull();
  });
});

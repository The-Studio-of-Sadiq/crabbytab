import { describe, expect, it } from "vitest";
import type { FeedbackQuestion, FeedbackSubmission } from "@/types";
import { agreementTally, analyzeFeedbackAnswers } from "./answers";

const questions: FeedbackQuestion[] = [
  { id: "n", label: "Clarity", type: "integer_scale", required: false, min: 1, max: 5 },
  { id: "f", label: "Minutes late", type: "float", required: false },
  { id: "yn", label: "On time?", type: "yes_no", required: false },
  { id: "cb", label: "Gave oral", type: "checkbox", required: false },
  { id: "s", label: "Strengths", type: "select_many", required: false, options: ["Clarity", "Fairness"] },
  { id: "t", label: "Notes", type: "textarea", required: false },
];

const answers = (values: FeedbackSubmission["answers"]) => ({ answers: values });

describe("per-question answer analysis", () => {
  const analysis = analyzeFeedbackAnswers(questions, [
    answers({ n: 4, f: 1.5, yn: true, cb: true, s: ["Clarity"], t: "Great" }),
    answers({ n: 2, f: 0, yn: false, cb: false, s: ["Clarity", "Fairness"], t: "  " }),
    answers({ n: "4" as never, s: ["Legacy option"] }),
    answers(undefined),
  ]);

  it("averages numeric questions over valid numbers only", () => {
    expect(analysis[0]).toMatchObject({ kind: "numeric", answered: 2, average: 3, min: 2, max: 4 });
    expect(analysis[1]).toMatchObject({ kind: "numeric", answered: 2, average: 0.75 });
  });

  it("tallies yes/no and checkbox answers", () => {
    expect(analysis[2]).toMatchObject({ kind: "boolean", answered: 2, yes: 1, no: 1 });
    expect(analysis[3]).toMatchObject({ kind: "boolean", answered: 2, yes: 1, no: 1 });
  });

  it("counts options, keeping options no longer configured", () => {
    expect(analysis[4]).toMatchObject({
      kind: "choice",
      answered: 3,
      counts: [
        { option: "Clarity", count: 2 },
        { option: "Fairness", count: 1 },
        { option: "Legacy option", count: 1 },
      ],
    });
  });

  it("lists non-empty text responses", () => {
    expect(analysis[5]).toMatchObject({ kind: "text", answered: 1, responses: ["Great"] });
  });

  it("reports no average when nobody answered", () => {
    expect(analyzeFeedbackAnswers([questions[0]], [])[0]).toEqual({ kind: "numeric", question: questions[0], answered: 0 });
  });
});

describe("agreement tally", () => {
  it("counts agree and disagree, skipping unanswered", () => {
    expect(agreementTally([{ agreeWithDecision: true }, { agreeWithDecision: false }, { agreeWithDecision: true }, {}]))
      .toEqual({ agree: 2, disagree: 1, answered: 3 });
  });
});

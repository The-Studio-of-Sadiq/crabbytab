import { describe, expect, it } from "vitest";
import type { FeedbackQuestion } from "@/types";
import type { RegistrationSettings } from "@/lib/registration/types";
import {
  defaultRegistrationSettings,
  parseRegistrationEntry,
  parseRegistrationSettings,
  toPublicForm,
} from "@/lib/registration/validation";

const NOW = Date.parse("2026-10-20T10:00:00Z");
const diet: FeedbackQuestion = { id: "diet", label: "Dietary needs", type: "text", required: true };

function settings(overrides: Partial<RegistrationSettings> = {}): RegistrationSettings {
  return { ...defaultRegistrationSettings("Spring Open", 2), enabled: true, institutionRegistration: true, ...overrides };
}

const institution = (institutionRequest: Record<string, unknown>) => ({
  kind: "institution",
  institution: "Dhaka",
  contactName: "Coach",
  contactEmail: "c@x.org",
  institutionRequest: { teamsRequested: 2, adjudicatorsRequested: 1, ...institutionRequest },
  answers: {},
});

describe("coach questions (Tabbycat reg-coach-questions)", () => {
  it("are saved with the settings and shown on the public form", () => {
    const parsed = parseRegistrationSettings({ ...settings(), coachQuestions: [diet] }, "Spring Open");
    expect(parsed.coachQuestions).toEqual([diet]);
    expect(toPublicForm(parsed, NOW).coachQuestions).toEqual([diet]);
    // Settings saved before coach questions existed have none.
    expect(toPublicForm(settings(), NOW).coachQuestions).toEqual([]);
  });

  it("are answered by the institution's contact and validated like the institution questions", () => {
    const withCoach = settings({ coachQuestions: [diet] });
    const entry = parseRegistrationEntry(institution({ coachAnswers: { diet: " Vegetarian " } }), withCoach);
    expect(entry.institutionRequest?.coachAnswers).toEqual({ diet: "Vegetarian" });
    expect(() => parseRegistrationEntry(institution({}), withCoach)).toThrow();
    expect(() => parseRegistrationEntry(institution({ coachAnswers: { other: "x" } }), withCoach)).toThrow(/form has changed/);
    expect(parseRegistrationEntry(institution({}), settings()).institutionRequest).not.toHaveProperty("coachAnswers");
  });
});

import { describe, expect, it } from "vitest";
import type { Team } from "@/types";
import { renderEmailTemplate, resolveEmailRecipients, teamBreakCategoryNames, type EmailBreakCategory } from "./messaging";
import { DEFAULT_EMAIL_TEMPLATES, parseEmailSettings, TEMPLATE_EVENT_INFO, templateFor } from "./settings";

const categories: EmailBreakCategory[] = [
  { id: "novice", name: "Novice", isGeneral: false, seq: 3 },
  { id: "open", name: "Open", isGeneral: true, seq: 1 },
  { id: "esl", name: "ESL", isGeneral: false, seq: 2 },
];

const team: Team = {
  id: "team-1",
  tournamentId: "t1",
  name: "Oxford A",
  codeName: "Fox",
  emoji: "🦊",
  institutionName: "Oxford",
  speakers: [
    { id: "s1", name: "Jane Doe", email: "jane@example.org" },
    { id: "s2", name: "John Roe", email: "john@example.org" },
    { id: "s3", name: "No Email" },
  ],
  breakCategories: ["novice"],
  speakerCategories: [],
};

describe("team registration details email (Tabbycat team_email_subject / team_email_message)", () => {
  it("lists general categories and the team's own, in category order", () => {
    expect(teamBreakCategoryNames(team, categories)).toBe("Open, Novice");
    expect(teamBreakCategoryNames({ breakCategories: [] }, [])).toBe("");
  });

  it("gives every speaker of the team the team's speakers, code name, emoji and categories", () => {
    const recipients = resolveEmailRecipients("all_teams", [team], [], [], undefined, { breakCategories: categories });
    expect(recipients.map((recipient) => recipient.email)).toEqual(["jane@example.org", "john@example.org"]);
    const { subject, body } = DEFAULT_EMAIL_TEMPLATES.team_registration;
    expect(renderEmailTemplate(subject, recipients[0], "Cup")).toBe("Registration for Cup");
    expect(renderEmailTemplate(body, recipients[1], "Cup")).toContain(
      "Hi John Roe,\n\nYou are registered as Oxford A in Cup with Jane Doe, John Roe, No Email."
    );
    expect(
      renderEmailTemplate("{{code_name}} {{emoji}} {{break_categories}}", recipients[0], "Cup")
    ).toBe("Fox 🦊 Open, Novice");
  });

  it("renders the team variables empty for adjudicators and without categories", () => {
    const recipients = resolveEmailRecipients("all_teams", [{ ...team, codeName: undefined, emoji: undefined }], [], []);
    expect(renderEmailTemplate("[{{code_name}}][{{emoji}}][{{break_categories}}]", recipients[0], "Cup")).toBe("[][][]");
  });

  it("is a saved, editable per-tournament template that accepts its variables", () => {
    expect(TEMPLATE_EVENT_INFO.team_registration.variables).toEqual(
      expect.arrayContaining(["speakers", "code_name", "emoji", "break_categories"])
    );
    const parsed = parseEmailSettings({
      templates: { team_registration: { subject: "{{tournament}}: {{team}}", body: "{{speakers}} / {{code_name}} / {{emoji}} / {{break_categories}}" } },
    });
    expect(templateFor({ ...parsed }, "team_registration").body).toBe("{{speakers}} / {{code_name}} / {{emoji}} / {{break_categories}}");
    expect(() => parseEmailSettings({ templates: { team_registration: { subject: "x", body: "{{members}}" } } })).toThrow(
      "Unknown email template variable"
    );
  });
});

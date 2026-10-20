import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMAIL_TEMPLATES,
  parseEmailSettings,
  readEmailSettings,
  replyToHeader,
  TEMPLATE_EVENTS,
  templateFor,
} from "./settings";
import { EmailCampaignInputError, prepareEmailMessages, renderEmailTemplate, DELIVERY_REF_HEADER } from "./messaging";

describe("email settings", () => {
  it("has a renderable default template for every event", () => {
    for (const event of TEMPLATE_EVENTS) {
      const template = DEFAULT_EMAIL_TEMPLATES[event];
      expect(() => renderEmailTemplate(template.body, { email: "a@b.co", name: "A" }, "Cup")).not.toThrow();
    }
  });

  it("validates Reply-To and keeps only templates that differ from the defaults", () => {
    const parsed = parseEmailSettings({
      replyToName: "Tab \"Team\"\n",
      replyToAddress: " TAB@Example.org ",
      registrationEmails: true,
      templates: {
        draw_teams: { subject: "Draw for {{team}}", body: "Hi {{name}}, {{side}}" },
        team_points: DEFAULT_EMAIL_TEMPLATES.team_points,
      },
    });
    expect(parsed.replyToAddress).toBe("tab@example.org");
    expect(parsed.replyToName).toBe("Tab Team");
    expect(parsed.registrationEmails).toBe(true);
    expect(Object.keys(parsed.templates)).toEqual(["draw_teams"]);
    expect(replyToHeader(parsed)).toBe("\"Tab Team\" <tab@example.org>");
    expect(replyToHeader({ replyToName: "", replyToAddress: "" })).toBeUndefined();
  });

  it("refuses unknown variables, unknown events, multi-line subjects and bad addresses", () => {
    expect(() => parseEmailSettings({ templates: { draw_teams: { subject: "x", body: "{{secret}}" } } })).toThrow(EmailCampaignInputError);
    expect(() => parseEmailSettings({ templates: { nope: { subject: "x", body: "y" } } })).toThrow(/Unknown email event/);
    expect(() => parseEmailSettings({ templates: { draw_teams: { subject: "a\nb", body: "y" } } })).toThrow(/one line/);
    expect(() => parseEmailSettings({ replyToAddress: "not-an-address" })).toThrow(/Reply-To/);
    expect(() => parseEmailSettings({ replyToName: "Tab" })).toThrow(/Reply-To address/);
  });

  it("falls back to defaults for malformed stored settings", () => {
    const settings = readEmailSettings({ templates: { draw_teams: { subject: 3 } }, replyToAddress: 5 });
    expect(settings.replyToAddress).toBe("");
    expect(templateFor(settings, "draw_teams")).toBe(DEFAULT_EMAIL_TEMPLATES.draw_teams);
  });

  it("adds Reply-To and the delivery reference to every message", () => {
    const [message] = prepareEmailMessages([{ email: "a@b.co", name: "A" }], "Cup", undefined, "S", "B", {
      replyTo: "tab@example.org",
      ref: "t1/c1",
    });
    expect(message.replyTo).toBe("tab@example.org");
    expect(message.headers).toEqual({ [DELIVERY_REF_HEADER]: "t1/c1" });
  });
});

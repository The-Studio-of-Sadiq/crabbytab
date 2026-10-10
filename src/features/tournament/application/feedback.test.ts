import { describe, expect, it } from "vitest";

import { addFeedbackCommand } from "./feedback";

describe("addFeedbackCommand", () => {
  it("persists and queues private feedback before writing a redacted audit event", async () => {
    const calls: string[] = [];
    let savedFeedback: Array<{ id: string; comments?: string }> = [];
    let auditDetails: Record<string, unknown> | undefined;

    await addFeedbackCommand({
      roundId: "round-1",
      debateId: "debate-1",
      sourceType: "team",
      sourceId: "team-1",
      sourceName: "Team A",
      score: 8,
      comments: "Sensitive feedback text",
      confirmed: false,
    }, {
      tournamentId: "tournament-1",
      feedback: [],
      privatePasscode: "secret-passcode",
      teams: [{ id: "team-1", privateUrlKey: "team-private-key" }],
      adjudicators: [],
      repository: {
        saveFeedback(items) { calls.push("local"); savedFeedback = items; },
      },
      async queuePrivateRecord(feedback, privateUrlKey, passcode) {
        calls.push("private-sync");
        expect(feedback.comments).toBe("Sensitive feedback text");
        expect(privateUrlKey).toBe("team-private-key");
        expect(passcode).toBe("secret-passcode");
      },
      async recordAuditEvent(event) {
        calls.push("audit");
        auditDetails = event.details;
      },
    });

    expect(savedFeedback).toHaveLength(1);
    expect(calls).toEqual(["local", "private-sync", "audit"]);
    expect(JSON.stringify(auditDetails)).not.toContain("Sensitive feedback text");
    expect(JSON.stringify(auditDetails)).not.toContain("secret-passcode");
  });

  it("rejects missing required questionnaire answers before persisting", async () => {
    let persisted = false;
    await expect(addFeedbackCommand({
      roundId: "round-1",
      debateId: "debate-1",
      sourceType: "team",
      sourceId: "team-1",
      sourceName: "Team A",
      score: 8,
      confirmed: false,
    }, {
      tournamentId: "tournament-1",
      feedback: [],
      questions: [{
        id: "reason",
        label: "Reason for score",
        type: "textarea",
        required: true,
      }],
      teams: [],
      adjudicators: [],
      repository: {
        saveFeedback() { persisted = true; },
      },
      async queuePrivateRecord() {},
      async recordAuditEvent() {},
    })).rejects.toThrow("Please answer “Reason for score”.");
    expect(persisted).toBe(false);
  });
});
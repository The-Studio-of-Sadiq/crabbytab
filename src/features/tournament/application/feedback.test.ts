import { describe, expect, it } from "vitest";

import type { Debate, FeedbackSubmission } from "@/types";
import { addFeedbackCommand, adminFeedbackLinkError, reviewFeedbackCommand } from "./feedback";

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
describe("reviewFeedbackCommand", () => {
  const base: FeedbackSubmission = {
    id: "fb-1",
    tournamentId: "t",
    roundId: "r1",
    debateId: "d1",
    targetAdjudicatorId: "chair",
    targetAdjudicatorName: "Chair",
    sourceType: "team",
    sourceId: "aff",
    sourceName: "Aff",
    score: 3,
    confirmed: true,
    timestamp: "",
  };

  it("ignores a submission without deleting it and audits the change", async () => {
    let saved: FeedbackSubmission[] = [];
    const audits: string[] = [];
    await reviewFeedbackCommand("fb-1", { ignored: true }, {
      feedback: [base],
      repository: { saveFeedback(items) { saved = items; } },
      async recordAuditEvent(event) { audits.push(event.summary); },
    });
    expect(saved).toEqual([{ ...base, ignored: true }]);
    expect(audits).toEqual(["Feedback on Chair ignored"]);
  });

  it("does nothing when the state is unchanged and refuses unknown ids", async () => {
    const audits: string[] = [];
    const input = {
      feedback: [base],
      repository: { saveFeedback() { audits.push("saved"); } },
      async recordAuditEvent() { audits.push("audit"); },
    };
    await reviewFeedbackCommand("fb-1", { confirmed: true }, input);
    expect(audits).toEqual([]);
    await expect(reviewFeedbackCommand("missing", { ignored: true }, input)).rejects.toThrow("no longer exists");
  });
});

describe("adminFeedbackLinkError", () => {
  const debate = {
    id: "d1",
    roundId: "r1",
    teams: { AFF: { teamId: "aff", teamName: "Aff", side: "AFF" } },
    adjudicators: { chairId: "chair", panellistIds: ["wing"], panellistNames: [], traineeIds: [], traineeNames: [] },
  } as unknown as Debate;
  const link = { roundId: "r1", debateId: "d1", targetAdjudicatorId: "chair", sourceType: "team" as const, sourceId: "aff" };

  it("accepts a real round, debate, adjudicator and source", () => {
    expect(adminFeedbackLinkError(link, [debate])).toBeNull();
    expect(adminFeedbackLinkError({ ...link, sourceType: "adjudicator", sourceId: "wing" }, [debate])).toBeNull();
  });

  it("rejects placeholders and participants from elsewhere", () => {
    expect(adminFeedbackLinkError({ ...link, debateId: "direct-feedback", roundId: "r-all" }, [debate]))
      .toBe("Choose a debate from the selected round.");
    expect(adminFeedbackLinkError({ ...link, targetAdjudicatorId: "other" }, [debate]))
      .toBe("The adjudicator did not sit on that debate.");
    expect(adminFeedbackLinkError({ ...link, sourceId: "neg" }, [debate]))
      .toBe("The source did not take part in that debate.");
    expect(adminFeedbackLinkError({ ...link, sourceType: "adjudicator", sourceId: "chair" }, [debate]))
      .toBe("An adjudicator cannot give feedback on themselves.");
  });
});

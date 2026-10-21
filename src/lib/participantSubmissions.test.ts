import { describe, expect, it } from "vitest";
import type { Debate, Tournament } from "@/types";
import { checkParticipantFeedback, privateUrlFeedbackEnabled } from "@/lib/participantSubmissions";

describe("private-URL feedback switch (Tabbycat participant_feedback)", () => {
  it("is on unless turned off", () => {
    expect(privateUrlFeedbackEnabled(undefined)).toBe(true);
    expect(privateUrlFeedbackEnabled({} as Tournament["preferences"])).toBe(true);
    expect(privateUrlFeedbackEnabled({ privateUrlFeedback: false } as Tournament["preferences"])).toBe(false);
  });

  it("refuses private-URL feedback when it is off, whatever the record", () => {
    const result = checkParticipantFeedback({ targetType: "adjudicator", targetId: "j1", score: 5 }, {
      tournament: { id: "t1", format: "wsdc", preferences: { feedbackEnabled: true, privateUrlFeedback: false } } as unknown as Tournament,
      tournamentId: "t1",
      participant: { type: "team", id: "team-1", name: "Team 1" },
      debate: { id: "d1", roundId: "r1", teams: {}, adjudicators: { chairId: "j1" } } as unknown as Debate,
      round: undefined,
      teams: new Map(),
      id: "feedback-1",
      timestamp: "2026-10-21T00:00:00.000Z",
    });
    expect(result).toEqual({ ok: false, status: 403, error: "Feedback through private URLs is turned off for this tournament." });
  });
});

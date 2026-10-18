import { describe, expect, it, vi } from "vitest";

import {
  baselineNotificationsCommand,
  describeNotificationSummary,
  hasAutomaticRoundNotifications,
  sendDueNotificationsCommand,
} from "./notifications";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("automatic notification commands", () => {
  it("only runs when a round notification is opted in", () => {
    expect(hasAutomaticRoundNotifications({})).toBe(false);
    expect(hasAutomaticRoundNotifications({ notifyDrawReleased: true })).toBe(true);
    expect(hasAutomaticRoundNotifications({ notifyTeamPoints: true })).toBe(true);
  });

  it("repeats until the server is idle and totals the results", async () => {
    const responses = [
      { status: "sent", sent: 3, failed: 1 },
      { status: "sent", sent: 0, failed: 0 },
      { status: "sent", sent: 2, failed: 0 },
      { status: "idle" },
    ];
    const fetchImpl = vi.fn(async () => jsonResponse(responses.shift()));
    const summary = await sendDueNotificationsCommand({ tournamentId: "t1", idToken: "token", fetchImpl });
    expect(summary).toEqual({ campaigns: 2, sent: 5, failed: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(describeNotificationSummary(summary)).toBe(" Notifications: 5 sent, 1 failed (see email history).");
  });

  it("stops after the step limit", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: "sent", sent: 1, failed: 0 }));
    await sendDueNotificationsCommand({ tournamentId: "t1", idToken: "token", fetchImpl, maxSteps: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("surfaces server errors", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "SMTP_HOST must be configured." }, 503));
    await expect(sendDueNotificationsCommand({ tournamentId: "t1", idToken: "token", fetchImpl })).rejects.toThrow(
      "SMTP_HOST must be configured."
    );
  });

  it("sends the baseline events", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ action: "baseline", events: ["draw_teams"] });
      return jsonResponse({ skipped: 4 });
    });
    await expect(
      baselineNotificationsCommand({ tournamentId: "t1", idToken: "token", events: ["draw_teams"], fetchImpl })
    ).resolves.toBe(4);
  });
});

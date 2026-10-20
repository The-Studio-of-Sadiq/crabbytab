import type { RoundNotificationEvent } from "@/lib/email/notifications";
import type { TournamentPreferences } from "@/types";

/** Client commands for the automatic notification route (`/api/tournaments/[id]/notifications`). */

export function hasAutomaticRoundNotifications(
  preferences:
    | Partial<Pick<TournamentPreferences, "notifyDrawReleased" | "notifyTeamPoints" | "notifyMotionsReleased" | "notifyBallotConfirmed">>
    | undefined
): boolean {
  return preferences?.notifyDrawReleased === true || preferences?.notifyTeamPoints === true ||
    preferences?.notifyMotionsReleased === true || preferences?.notifyBallotConfirmed === true;
}

export interface DueNotificationsSummary {
  campaigns: number;
  sent: number;
  failed: number;
}

/** Most chunks sent per trigger; a later upload or the email page picks up anything left. */
export const MAX_NOTIFICATION_STEPS = 20;

async function postNotifications(
  tournamentId: string,
  idToken: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(`/api/tournaments/${encodeURIComponent(tournamentId)}/notifications`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof result.error === "string" ? result.error : "Could not send notifications.");
  }
  return result;
}

/**
 * Sends every due notification chunk, one request per chunk so each stays within the server's time
 * limit. The server decides what is due from the cloud copy, so this is safe to call after any
 * upload.
 */
export async function sendDueNotificationsCommand(input: {
  tournamentId: string;
  idToken: string;
  fetchImpl?: typeof fetch;
  maxSteps?: number;
}): Promise<DueNotificationsSummary> {
  const fetchImpl = input.fetchImpl || fetch;
  const summary: DueNotificationsSummary = { campaigns: 0, sent: 0, failed: 0 };
  for (let step = 0; step < (input.maxSteps ?? MAX_NOTIFICATION_STEPS); step += 1) {
    const result = await postNotifications(input.tournamentId, input.idToken, { action: "send" }, fetchImpl);
    if (result.status !== "sent") break;
    const sent = Number(result.sent) || 0;
    const failed = Number(result.failed) || 0;
    if (sent + failed > 0) summary.campaigns += 1;
    summary.sent += sent;
    summary.failed += failed;
  }
  return summary;
}

/** Marks already-released rounds as notified so opting in does not email past rounds. */
export async function baselineNotificationsCommand(input: {
  tournamentId: string;
  idToken: string;
  events: Array<RoundNotificationEvent | "ballot_confirmed">;
  fetchImpl?: typeof fetch;
}): Promise<number> {
  const result = await postNotifications(
    input.tournamentId,
    input.idToken,
    { action: "baseline", events: input.events },
    input.fetchImpl || fetch
  );
  return Number(result.skipped) || 0;
}

export function describeNotificationSummary(summary: DueNotificationsSummary): string {
  if (summary.campaigns === 0) return "";
  return ` Notifications: ${summary.sent} sent${summary.failed > 0 ? `, ${summary.failed} failed (see email history)` : ""}.`;
}

import { NextRequest, NextResponse } from "next/server";
import { authorizeTournamentEmailRequest, EmailAuthorizationError } from "@/lib/email/authorize";
import { EmailCampaignInputError } from "@/lib/email/messaging";
import { ROUND_NOTIFICATION_EVENTS, type RoundNotificationEvent } from "@/lib/email/notifications";
import { baselineRoundNotifications, sendNextRoundNotification } from "@/lib/email/notificationService";
import { EmailProviderConfigError } from "@/lib/email/provider";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Automatic notifications for released draws and results, driven by tournament administrators.
 *
 * - `{ action: "send" }` sends the next due chunk (at most one campaign) and reports it; clients
 *   call again until the status is "idle". Called after every cloud upload and from the email page.
 * - `{ action: "baseline", events }` marks what is already released as skipped, so switching a
 *   notification on mid-tournament does not email old rounds.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(tournamentId)) {
    return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  }
  let body: { action?: unknown; events?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const events = Array.isArray(body.events)
    ? body.events.filter((event): event is RoundNotificationEvent =>
        ROUND_NOTIFICATION_EVENTS.includes(event as RoundNotificationEvent)
      )
    : [];
  if (body.action !== "send" && !(body.action === "baseline" && events.length > 0)) {
    return NextResponse.json({ error: "Invalid notification request." }, { status: 400 });
  }

  try {
    const user = await authorizeTournamentEmailRequest(request, tournamentId);
    const firestore = getAdminFirestore();
    if (body.action === "baseline") {
      const skipped = await baselineRoundNotifications(firestore, tournamentId, events);
      return NextResponse.json({ skipped }, { headers: { "Cache-Control": "no-store" } });
    }
    const result = await sendNextRoundNotification({
      firestore,
      tournamentId,
      sender: { uid: user.uid, email: user.email || "", name: user.name || user.email || user.uid },
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof EmailAuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof EmailCampaignInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof EmailProviderConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error(
      "Automatic notification failed:",
      error instanceof Error ? error.message : "Unknown notification error."
    );
    return NextResponse.json({ error: "Could not send notifications. Check the server logs." }, { status: 502 });
  }
}

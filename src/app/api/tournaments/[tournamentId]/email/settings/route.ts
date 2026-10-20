import { NextRequest, NextResponse } from "next/server";
import { EmailCampaignInputError } from "@/lib/email/messaging";
import {
  DEFAULT_EMAIL_TEMPLATES,
  emailSettingsRef,
  parseEmailSettings,
  readEmailSettings,
} from "@/lib/email/settings";
import {
  assertStillAdministrator,
  authorizeTournamentAdministrator,
  isValidTournamentId,
} from "@/lib/tournamentAdminAuth";

export const runtime = "nodejs";

/**
 * Per-tournament email settings (Reply-To and saved templates; docs/email-notifications.md).
 * Administrators only. GET returns the settings with the default templates, PUT replaces them.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params;
  if (!isValidTournamentId(tournamentId)) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  const authorization = await authorizeTournamentAdministrator(request, tournamentId, "Only tournament administrators can manage email.");
  if ("error" in authorization) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  try {
    const settings = readEmailSettings((await emailSettingsRef(authorization.tournamentRef).get()).data());
    return NextResponse.json(
      { settings, defaults: DEFAULT_EMAIL_TEMPLATES, webhookConfigured: Boolean(process.env.EMAIL_WEBHOOK_SECRET) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Could not load email settings." }, { status: 503 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params;
  if (!isValidTournamentId(tournamentId)) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  const authorization = await authorizeTournamentAdministrator(request, tournamentId, "Only tournament administrators can manage email.");
  if ("error" in authorization) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  let parsed;
  try {
    parsed = parseEmailSettings(await request.json());
  } catch (error) {
    const message = error instanceof EmailCampaignInputError ? error.message : "Invalid request body.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const stored = { ...parsed, updatedAt: new Date().toISOString(), updatedBy: authorization.user.uid };
  try {
    await authorization.firestore.runTransaction(async (transaction) => {
      await assertStillAdministrator(transaction, authorization);
      transaction.set(emailSettingsRef(authorization.tournamentRef), stored);
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save email settings." }, { status: 409 });
  }
  return NextResponse.json({ settings: stored });
}

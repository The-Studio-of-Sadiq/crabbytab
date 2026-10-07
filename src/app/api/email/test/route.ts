import { NextRequest, NextResponse } from "next/server";
import {
  authorizeTournamentEmailRequest,
  EmailAuthorizationError,
} from "@/lib/email/authorize";
import {
  createSmtpEmailProvider,
  EmailProviderConfigError,
} from "@/lib/email/provider";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    body = parsed;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { tournamentId, recipientEmail } = body;
  if (typeof tournamentId !== "string" || !tournamentId.trim()) {
    return NextResponse.json({ error: "A tournament ID is required." }, { status: 400 });
  }
  if (
    typeof recipientEmail !== "string" ||
    recipientEmail.trim().length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail.trim())
  ) {
    return NextResponse.json({ error: "Enter a valid test recipient email address." }, { status: 400 });
  }
  const testRecipient = recipientEmail.trim();

  try {
    await authorizeTournamentEmailRequest(request, tournamentId);
    const provider = createSmtpEmailProvider();
    await provider.verifyConnection();
    await provider.send({
      to: testRecipient,
      subject: "CrabbyTab SMTP test",
      text: "Your tournament's SMTP email provider is configured and working.",
    });

    return NextResponse.json({ message: `Test email sent to ${testRecipient}.` });
  } catch (error) {
    if (error instanceof EmailAuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof EmailProviderConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    const message = error instanceof Error ? error.message : "Unknown SMTP error.";
    console.error("SMTP test email failed:", message);
    return NextResponse.json(
      {
        error: "Could not connect to the SMTP provider or send the test email. Check the server logs.",
      },
      { status: 502 }
    );
  }
}

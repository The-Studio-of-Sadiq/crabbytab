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

export async function POST(request: NextRequest) {
  let body: { tournamentId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (typeof body.tournamentId !== "string" || !body.tournamentId.trim()) {
    return NextResponse.json({ error: "A tournament ID is required." }, { status: 400 });
  }

  try {
    const user = await authorizeTournamentEmailRequest(request, body.tournamentId);
    if (!user.email) {
      return NextResponse.json(
        { error: "Add an email address to your account before testing SMTP." },
        { status: 400 }
      );
    }

    const provider = createSmtpEmailProvider();
    await provider.verifyConnection();
    await provider.send({
      to: user.email,
      subject: "CrabbyTab SMTP test",
      text: "Your tournament's SMTP email provider is configured and working.",
    });

    return NextResponse.json({ message: `Test email sent to ${user.email}.` });
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

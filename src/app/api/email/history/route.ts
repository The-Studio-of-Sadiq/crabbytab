import { NextRequest, NextResponse } from "next/server";
import {
  authorizeTournamentEmailRequest,
  EmailAuthorizationError,
} from "@/lib/email/authorize";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const tournamentId = request.nextUrl.searchParams.get("tournamentId");
  if (!tournamentId || tournamentId.includes("/") || tournamentId.length > 128) {
    return NextResponse.json({ error: "A valid tournament ID is required." }, { status: 400 });
  }

  try {
    await authorizeTournamentEmailRequest(request, tournamentId);
    const snapshot = await getAdminFirestore()
      .collection("tournaments")
      .doc(tournamentId)
      .collection("emailCampaigns")
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    return NextResponse.json({
      campaigns: snapshot.docs.map((document) => document.data()),
    });
  } catch (error) {
    if (error instanceof EmailAuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error(
      "Email campaign history failed:",
      error instanceof Error ? error.message : "Unknown history error."
    );
    return NextResponse.json(
      { error: "Could not load email history. Check the server logs." },
      { status: 503 }
    );
  }
}

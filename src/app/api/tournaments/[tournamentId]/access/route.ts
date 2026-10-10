import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin";
import { isGlobalAdminUid } from "@/lib/globalAdmin";
import { resolveTournamentAccessRole } from "@/lib/tournamentAccess";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(tournamentId)) {
    return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  }
  const token = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token) return NextResponse.json({ error: "Sign in to check tournament access." }, { status: 401 });

  let auth;
  let firestore;
  try {
    auth = getAdminAuth();
    firestore = getAdminFirestore();
  } catch {
    return NextResponse.json({ error: "Server-side Firebase authorization is not configured." }, { status: 503 });
  }

  let user;
  try {
    user = await auth.verifyIdToken(token);
  } catch {
    return NextResponse.json({ error: "Your sign-in has expired. Please sign in again." }, { status: 401 });
  }

  if (isGlobalAdminUid(user.uid)) {
    return NextResponse.json(
      { role: "admin", globalAdmin: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const tournamentSnapshot = await firestore.collection("tournaments").doc(tournamentId).get();
    if (!tournamentSnapshot.exists) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
    const staffSnapshot = await tournamentSnapshot.ref.collection("staff").doc(user.uid).get();
    const data = tournamentSnapshot.data()!;
    const role = resolveTournamentAccessRole(
      { ownerId: data.ownerId, admins: data.admins },
      user.uid,
      staffSnapshot.data()?.role,
      false
    );
    return NextResponse.json(
      { role, globalAdmin: false },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Could not check tournament access." }, { status: 503 });
  }
}
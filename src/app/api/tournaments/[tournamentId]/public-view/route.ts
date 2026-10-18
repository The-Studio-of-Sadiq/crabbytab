import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin";
import { isGlobalAdminUid } from "@/lib/globalAdmin";
import { publishPublicView, PublicViewError } from "@/lib/publicView/store";
import { resolveTournamentAccessRole } from "@/lib/tournamentAccess";

export const runtime = "nodejs";

/**
 * Rebuilds and publishes the cached public view of a tournament. Called after cloud uploads (and,
 * once Firestore is the source of truth, after release actions).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(tournamentId)) {
    return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  }
  const token = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token) {
    return NextResponse.json({ error: "Sign in as a tournament administrator to publish." }, { status: 401 });
  }

  let body: { clientFingerprint?: unknown; force?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // An empty body is a valid forced-check publish.
  }
  const clientFingerprint =
    typeof body.clientFingerprint === "string" && /^[0-9a-f]{1,32}$/.test(body.clientFingerprint)
      ? body.clientFingerprint
      : undefined;

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

  try {
    if (!isGlobalAdminUid(user.uid)) {
      const tournamentRef = firestore.collection("tournaments").doc(tournamentId);
      const [tournamentSnapshot, staffSnapshot] = await Promise.all([
        tournamentRef.get(),
        tournamentRef.collection("staff").doc(user.uid).get(),
      ]);
      if (!tournamentSnapshot.exists) {
        return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
      }
      const data = tournamentSnapshot.data()!;
      const role = resolveTournamentAccessRole(
        { ownerId: data.ownerId, admins: data.admins },
        user.uid,
        staffSnapshot.data()?.role,
        false
      );
      if (role !== "admin") {
        return NextResponse.json(
          { error: "Only tournament administrators can publish the public view." },
          { status: 403 }
        );
      }
    }

    const result = await publishPublicView({
      tournamentId,
      clientFingerprint,
      force: body.force === true,
      firestore,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PublicViewError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Could not publish public view:", error);
    return NextResponse.json({ error: "Could not publish the public view." }, { status: 503 });
  }
}

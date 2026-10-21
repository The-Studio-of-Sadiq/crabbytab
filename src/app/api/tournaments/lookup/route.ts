import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin";
import { isGlobalAdminUid } from "@/lib/globalAdmin";
import { resolveTournamentAccessRole } from "@/lib/tournamentAccess";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug")?.trim();
  if (!slug || slug.length > 128) {
    return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  }

  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return NextResponse.json({ error: "Sign in to open this tournament." }, { status: 401 });

  let auth;
  let firestore;
  try {
    auth = getAdminAuth();
    firestore = getAdminFirestore();
  } catch {
    return NextResponse.json({ error: "Server-side Firebase authorization is not configured." }, { status: 503 });
  }

  let uid: string;
  try {
    uid = (await auth.verifyIdToken(token)).uid;
  } catch {
    return NextResponse.json({ error: "Your sign-in has expired. Please sign in again." }, { status: 401 });
  }

  try {
    const snapshot = await firestore.collection("tournaments").where("slug", "==", slug).limit(2).get();
    if (snapshot.docs.length > 1) {
      return NextResponse.json(
        { error: "This tournament slug is ambiguous. Contact a tournament administrator." },
        { status: 409 }
      );
    }
    const tournamentDocument = snapshot.docs[0];
    if (!tournamentDocument) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });

    const data = tournamentDocument.data();
    const globalAdmin = isGlobalAdminUid(uid);
    const assistant = await tournamentDocument.ref.collection("staff").doc(uid).get();
    const role = resolveTournamentAccessRole(
      {
        ownerId: data.ownerId,
        admins: data.admins && typeof data.admins === "object" ? data.admins : undefined,
      },
      uid,
      assistant.data()?.role,
      globalAdmin
    );

    if (!role) {
      return NextResponse.json({ error: "This account is not assigned to this tournament." }, { status: 403 });
    }

    const safeData = role === "admin"
      ? data
      : Object.fromEntries(
          ["name", "nameLower", "shortName", "slug", "format", "active", "preferences", "createdAt", "updatedAt"]
            .filter((field) => data[field] !== undefined)
            .map((field) => [field, data[field]])
        );

    return NextResponse.json({
      id: tournamentDocument.id,
      data: safeData,
      role,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load this tournament from Firestore." }, { status: 503 });
  }
}

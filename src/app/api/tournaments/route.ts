import { NextRequest, NextResponse } from "next/server";
import type { DocumentData } from "firebase-admin/firestore";
import type { TournamentFormat } from "@/types";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin";
import { isGlobalAdminUid } from "@/lib/globalAdmin";
import { listAccessibleTournaments } from "@/lib/accessibleTournaments";

export const runtime = "nodejs";

const tournamentFormats = new Set<TournamentFormat>(["bp", "uadc", "australs", "wsdc", "custom_2team", "poly"]);

function toSummary(id: string, data: DocumentData, accessRole: "admin" | "dataEntry") {
  const slug = typeof data.slug === "string" ? data.slug : id.replace(/^tourn-/, "");
  const format: TournamentFormat = tournamentFormats.has(data.format) ? data.format : "bp";
  return {
    id,
    slug,
    name: typeof data.name === "string" ? data.name : slug,
    format,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : "",
    accessRole,
  };
}

export async function GET(request: NextRequest) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return NextResponse.json({ error: "Sign in to load your tournaments." }, { status: 401 });

  let auth;
  let firestore;
  try {
    auth = getAdminAuth();
    firestore = getAdminFirestore();
  } catch {
    return NextResponse.json({ error: "Server-side Firebase authorization is not configured." }, { status: 503 });
  }

  let uid: string;
  let email: string | undefined;
  try {
    const decoded = await auth.verifyIdToken(token);
    uid = decoded.uid;
    email = decoded.email;
  } catch {
    return NextResponse.json({ error: "Your sign-in has expired. Please sign in again." }, { status: 401 });
  }

  try {
    const globalAdmin = isGlobalAdminUid(uid);
    const tournaments = (await listAccessibleTournaments({ firestore, uid, email, globalAdmin }))
      .map(({ id, data, role }) => toSummary(id, data, role));
    return NextResponse.json({
      role: globalAdmin
        ? "globalAdmin"
        : tournaments.some((tournament) => tournament.accessRole === "admin")
          ? "admin"
          : tournaments.length
            ? "assistant"
            : "none",
      tournaments,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not list tournaments:", error);
    return NextResponse.json({ error: "Could not load tournaments from Firestore." }, { status: 503 });
  }
}

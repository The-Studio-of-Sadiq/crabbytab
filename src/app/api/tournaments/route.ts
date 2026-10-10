import { NextRequest, NextResponse } from "next/server";
import type { DocumentData } from "firebase-admin/firestore";
import type { TournamentFormat } from "@/types";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin";
import { isGlobalAdminUid } from "@/lib/globalAdmin";

export const runtime = "nodejs";

const tournamentFormats = new Set<TournamentFormat>(["bp", "uadc", "australs", "wsdc", "custom_2team"]);

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
  try {
    uid = (await auth.verifyIdToken(token)).uid;
  } catch {
    return NextResponse.json({ error: "Your sign-in has expired. Please sign in again." }, { status: 401 });
  }

  try {
    const tournamentSnapshot = await firestore.collection("tournaments").get();
    if (isGlobalAdminUid(uid)) {
      return NextResponse.json({
        role: "globalAdmin",
        tournaments: tournamentSnapshot.docs.map((document) => toSummary(document.id, document.data(), "admin")),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const accessibleTournaments = await Promise.all(tournamentSnapshot.docs.map(async (document) => {
      const data = document.data();
      const assistant = await document.ref.collection("staff").doc(uid).get();
      return assistant.data()?.role === "dataEntry"
        ? toSummary(document.id, data, "dataEntry")
        : null;
    }));

    const tournaments = accessibleTournaments.filter((tournament) => tournament !== null);
    return NextResponse.json({
      role: tournaments.length ? "assistant" : "none",
      tournaments,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load tournaments from Firestore." }, { status: 503 });
  }
}

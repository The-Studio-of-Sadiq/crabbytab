import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin";
import { isGlobalAdminUid } from "@/lib/globalAdmin";
import { isTournamentAdministrator } from "@/lib/tournamentAccess";
import { createApiToken, hashApiToken, isApiTokenScope } from "@/lib/apiTokens";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function authorize(request: NextRequest, tournamentId: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(tournamentId)) {
    return { error: "Tournament not found.", status: 404 as const };
  }
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return { error: "Sign in as a tournament administrator.", status: 401 as const };

  let auth;
  let firestore;
  try {
    auth = getAdminAuth();
    firestore = getAdminFirestore();
  } catch {
    return { error: "Server-side Firebase authorization is not configured.", status: 503 as const };
  }

  let user;
  try {
    user = await auth.verifyIdToken(token);
  } catch {
    return { error: "Your sign-in has expired. Please sign in again.", status: 401 as const };
  }

  const tournamentRef = firestore.collection("tournaments").doc(tournamentId);
  const [tournamentSnapshot, staffSnapshot] = await Promise.all([
    tournamentRef.get(),
    tournamentRef.collection("staff").doc(user.uid).get(),
  ]);
  if (!tournamentSnapshot.exists) return { error: "Tournament not found.", status: 404 as const };
  const tournament = tournamentSnapshot.data()!;
  const globalAdmin = isGlobalAdminUid(user.uid);
  if (
    !globalAdmin &&
    !isTournamentAdministrator(
      { ownerId: tournament.ownerId, admins: tournament.admins },
      user.uid
    ) &&
    staffSnapshot.data()?.role !== "admin"
  ) {
    return { error: "Only tournament administrators can manage API tokens.", status: 403 as const };
  }
  return { tournamentRef, firestore };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params;
  const authorization = await authorize(request, tournamentId);
  if ("error" in authorization) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  try {
    const snapshot = await authorization.tournamentRef.collection("apiTokens").get();
    return NextResponse.json({
      tokens: snapshot.docs.map((document) => {
        const data = document.data();
        return {
          id: document.id,
          name: data.name,
          scope: data.scope,
          createdAt: data.createdAt,
          lastUsedAt: data.lastUsedAt ?? null,
        };
      }),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not list tournament API tokens:", error);
    return NextResponse.json({ error: "Could not load API tokens." }, { status: 503 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params;
  const authorization = await authorize(request, tournamentId);
  if ("error" in authorization) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const name = isRecord(body) && typeof body.name === "string" ? body.name.trim() : "";
  const scope = isRecord(body) ? body.scope : undefined;
  if (name.length < 1 || name.length > 80 || !isApiTokenScope(scope)) {
    return NextResponse.json({ error: "Enter a token name (1–80 characters) and a supported read-only scope." }, { status: 400 });
  }

  const secret = createApiToken();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  try {
    await authorization.tournamentRef.collection("apiTokens").doc(id).create({
      name,
      scope,
      tokenHash: hashApiToken(secret),
      createdAt,
    });
    return NextResponse.json({
      token: { id, name, scope, createdAt, secret },
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not create tournament API token:", error);
    return NextResponse.json({ error: "Could not create API token." }, { status: 503 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params;
  const authorization = await authorize(request, tournamentId);
  if ("error" in authorization) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const id = isRecord(body) && typeof body.id === "string" ? body.id : "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    return NextResponse.json({ error: "Choose a valid API token." }, { status: 400 });
  }
  try {
    await authorization.tournamentRef.collection("apiTokens").doc(id).delete();
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Could not revoke tournament API token:", error);
    return NextResponse.json({ error: "Could not revoke API token." }, { status: 503 });
  }
}

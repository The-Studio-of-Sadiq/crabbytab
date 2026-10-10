import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

async function authorizeAdministrator(request: NextRequest, tournamentId: string) {
  const token = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1];
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
  const tournamentSnapshot = await tournamentRef.get();
  if (!tournamentSnapshot.exists) return { error: "Tournament not found.", status: 404 as const };
  const tournament = tournamentSnapshot.data();
  if (tournament?.ownerId !== user.uid && tournament?.admins?.[user.uid] !== true) {
    return { error: "Only tournament administrators can manage staff.", status: 403 as const };
  }
  return { auth, firestore, tournamentRef, tournament, user };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params;
  if (!validId(tournamentId)) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  const authorization = await authorizeAdministrator(request, tournamentId);
  if ("error" in authorization) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  const staffSnapshot = await authorization.tournamentRef.collection("staff").get();
  return NextResponse.json(
    { staff: staffSnapshot.docs.map((document) => ({ ...document.data(), uid: document.id })) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params;
  if (!validId(tournamentId)) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  const authorization = await authorizeAdministrator(request, tournamentId);
  if ("error" in authorization) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const email = isRecord(body) && typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address for an existing account." }, { status: 400 });
  }

  let invitedUser;
  try {
    invitedUser = await authorization.auth.getUserByEmail(email);
  } catch (error) {
    if (isRecord(error) && error.code === "auth/user-not-found") {
      return NextResponse.json({ error: "No existing account was found for that email." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not look up that account." }, { status: 500 });
  }

  const { tournamentRef, tournament, user } = authorization;
  if (invitedUser.uid === tournament.ownerId || tournament.admins?.[invitedUser.uid] === true) {
    return NextResponse.json({ error: "That user already has administrator access." }, { status: 409 });
  }

  try {
    await authorization.firestore.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(tournamentRef);
      const current = currentSnapshot.data();
      if (!currentSnapshot.exists || (current?.ownerId !== user.uid && current?.admins?.[user.uid] !== true)) {
        throw new Error("Tournament staff permissions changed. Reload and try again.");
      }
      transaction.set(tournamentRef.collection("staff").doc(invitedUser.uid), {
        email: invitedUser.email || email,
        displayName: invitedUser.displayName || "",
        role: "dataEntry",
        addedAt: new Date().toISOString(),
        addedBy: user.uid,
      });
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not assign staff role." },
      { status: 409 }
    );
  }

  return NextResponse.json({ uid: invitedUser.uid, email: invitedUser.email || email, role: "dataEntry" });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params;
  if (!validId(tournamentId)) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  const authorization = await authorizeAdministrator(request, tournamentId);
  if ("error" in authorization) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const uid = isRecord(body) ? body.uid : undefined;
  if (!validId(uid)) return NextResponse.json({ error: "Invalid staff account." }, { status: 400 });

  try {
    await authorization.firestore.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(authorization.tournamentRef);
      const current = currentSnapshot.data();
      if (!currentSnapshot.exists || (current?.ownerId !== authorization.user.uid && current?.admins?.[authorization.user.uid] !== true)) {
        throw new Error("Tournament staff permissions changed. Reload and try again.");
      }
      const staffRef = authorization.tournamentRef.collection("staff").doc(uid);
      const staffSnapshot = await transaction.get(staffRef);
      if (staffSnapshot.data()?.role !== "dataEntry") throw new Error("That account is not a data-entry assistant.");
      transaction.delete(staffRef);
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not remove staff role." },
      { status: 409 }
    );
  }

  return NextResponse.json({ uid, removed: true });
}
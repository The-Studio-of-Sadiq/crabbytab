import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin";
import { isGlobalAdminUid } from "@/lib/globalAdmin";
import { isTournamentAdministrator } from "@/lib/tournamentAccess";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function validUid(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("/");
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
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
  const globalAdmin = isGlobalAdminUid(user.uid);
  const current = tournamentSnapshot.data()!;
  const staffRole = (await tournamentRef.collection("staff").doc(user.uid).get()).data()?.role;
  if (
    !globalAdmin &&
    !isTournamentAdministrator(
      { ownerId: current.ownerId, admins: current.admins },
      user.uid
    ) &&
    staffRole !== "admin"
  ) {
    return { error: "Only tournament administrators can manage staff.", status: 403 as const };
  }
  return { auth, firestore, tournamentRef, user, globalAdmin };
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

  try {
    const staffSnapshot = await authorization.tournamentRef.collection("staff").get();
    return NextResponse.json(
      {
        staff: staffSnapshot.docs.map((document) => ({ ...document.data(), uid: document.id })),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Could not load tournament staff." }, { status: 503 });
  }
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
  const emails = isRecord(body) && Array.isArray(body.emails) ? body.emails : [];
  const requestedRole = isRecord(body) ? body.role : undefined;
  if (requestedRole !== undefined && requestedRole !== "admin" && requestedRole !== "dataEntry") {
    return NextResponse.json({ error: "Choose a valid tournament role." }, { status: 400 });
  }
  const role = requestedRole === "admin" ? "admin" : "dataEntry";
  const normalizedEmails = emails.map(normalizeEmail);
  if (
    emails.length === 0 ||
    emails.length > 100 ||
    normalizedEmails.some((email) => email === null)
  ) {
    return NextResponse.json({ error: "Enter between one and 100 valid account email addresses." }, { status: 400 });
  }
  const uniqueEmails = [...new Set(normalizedEmails.filter((email): email is string => email !== null))];
  let invitedUsers;
  try {
    invitedUsers = await Promise.all(uniqueEmails.map((email) => authorization.auth.getUserByEmail(email)));
  } catch (error) {
    if (isRecord(error) && error.code === "auth/user-not-found") {
      return NextResponse.json({ error: "An account for one of those email addresses does not exist." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not look up the requested Firebase accounts." }, { status: 500 });
  }

  const { tournamentRef, user } = authorization;

  const addedAt = new Date().toISOString();
  let staffAssignments: Array<{ uid: string; email: string; displayName: string; role: "admin" | "dataEntry"; addedAt: string }>;
  try {
    staffAssignments = await authorization.firestore.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(tournamentRef);
      const current = currentSnapshot.data();
      const actorStaffSnapshot = await transaction.get(
        tournamentRef.collection("staff").doc(user.uid)
      );
      if (
        !currentSnapshot.exists ||
        (!authorization.globalAdmin &&
          !isTournamentAdministrator(
            { ownerId: current?.ownerId, admins: current?.admins },
            user.uid
          ) &&
          actorStaffSnapshot.data()?.role !== "admin")
      ) {
        throw new Error("Tournament staff permissions changed. Reload and try again.");
      }
      const assignments = invitedUsers.map((invitedUser) => {
        const assignmentRole: "admin" | "dataEntry" = isGlobalAdminUid(invitedUser.uid) ||
          isTournamentAdministrator(
            { ownerId: current?.ownerId, admins: current?.admins },
            invitedUser.uid
          )
          ? "admin" as const
          : role;
        return {
          uid: invitedUser.uid,
          email: invitedUser.email || "",
          displayName: invitedUser.displayName || "",
          role: assignmentRole,
          addedAt,
        };
      });
      for (const assignment of assignments) {
        transaction.set(tournamentRef.collection("staff").doc(assignment.uid), {
          email: assignment.email,
          displayName: assignment.displayName,
          role: assignment.role,
          addedAt: assignment.addedAt,
          addedBy: user.uid,
        });
      }
      return assignments;
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not assign staff role." },
      { status: 409 }
    );
  }

  return NextResponse.json({
    staff: staffAssignments,
  });
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
  if (!validUid(uid)) return NextResponse.json({ error: "Invalid staff account." }, { status: 400 });

  try {
    await authorization.firestore.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(authorization.tournamentRef);
      const current = currentSnapshot.data();
      const actorStaffSnapshot = await transaction.get(
        authorization.tournamentRef.collection("staff").doc(authorization.user.uid)
      );
      if (
        !currentSnapshot.exists ||
        (!authorization.globalAdmin &&
          !isTournamentAdministrator(
            { ownerId: current?.ownerId, admins: current?.admins },
            authorization.user.uid
          ) &&
          actorStaffSnapshot.data()?.role !== "admin")
      ) {
        throw new Error("Tournament staff permissions changed. Reload and try again.");
      }
      const staffRef = authorization.tournamentRef.collection("staff").doc(uid);
      const staffSnapshot = await transaction.get(staffRef);
      if (!["admin", "dataEntry"].includes(staffSnapshot.data()?.role)) {
        throw new Error("That account does not have a removable tournament role.");
      }
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
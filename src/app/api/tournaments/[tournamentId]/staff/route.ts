import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin";
import { isGlobalAdminUid } from "@/lib/globalAdmin";

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
  if (!globalAdmin) {
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
    const [staffSnapshot, accountPages] = await Promise.all([
      authorization.tournamentRef.collection("staff").get(),
      (async () => {
        const accounts: Array<{ uid: string; email: string; displayName: string }> = [];
        let pageToken: string | undefined;
        do {
          const page = await authorization.auth.listUsers(1000, pageToken);
          accounts.push(...page.users
            .filter((account) =>
              !isGlobalAdminUid(account.uid)
            )
            .map((account) => ({
              uid: account.uid,
              email: account.email || "",
              displayName: account.displayName || "",
            })));
          pageToken = page.pageToken;
        } while (pageToken);
        return accounts;
      })(),
    ]);
    return NextResponse.json(
      {
        staff: staffSnapshot.docs.map((document) => ({ ...document.data(), uid: document.id })),
        accounts: accountPages,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Could not load tournament assistants or Firebase accounts." }, { status: 503 });
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
  const uids = isRecord(body) && Array.isArray(body.uids) ? body.uids : [];
  if (uids.length === 0 || uids.length > 100 || !uids.every(validUid)) {
    return NextResponse.json({ error: "Select between one and 100 existing Firebase accounts." }, { status: 400 });
  }
  const uniqueUids = [...new Set(uids)];
  let invitedUsers;
  try {
    invitedUsers = await Promise.all(uniqueUids.map((uid) => authorization.auth.getUser(uid)));
  } catch (error) {
    if (isRecord(error) && error.code === "auth/user-not-found") {
      return NextResponse.json({ error: "A selected Firebase account no longer exists." }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not look up the selected Firebase accounts." }, { status: 500 });
  }

  const { tournamentRef, user } = authorization;

  const addedAt = new Date().toISOString();
  try {
    await authorization.firestore.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(tournamentRef);
      const current = currentSnapshot.data();
      if (!currentSnapshot.exists || !authorization.globalAdmin) {
        throw new Error("Tournament staff permissions changed. Reload and try again.");
      }
      for (const invitedUser of invitedUsers) {
        transaction.set(tournamentRef.collection("staff").doc(invitedUser.uid), {
          email: invitedUser.email || "",
          displayName: invitedUser.displayName || "",
          role: "dataEntry",
          addedAt,
          addedBy: user.uid,
        });
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not assign staff role." },
      { status: 409 }
    );
  }

  return NextResponse.json({
    staff: invitedUsers.map((invitedUser) => ({
      uid: invitedUser.uid,
      email: invitedUser.email || "",
      displayName: invitedUser.displayName || "",
      role: "dataEntry",
      addedAt,
    })),
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
      if (!currentSnapshot.exists || !authorization.globalAdmin) {
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
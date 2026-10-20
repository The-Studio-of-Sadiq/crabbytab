import { NextRequest, NextResponse } from "next/server";
import { isGlobalAdminUid } from "@/lib/globalAdmin";
import { normalizeEmail } from "@/lib/linkTokens";
import { isTournamentAdministrator } from "@/lib/tournamentAccess";
import { groupPermissions, normalizePermissionAssignment } from "@/lib/staffPermissions";
import {
  assertStillAdministrator,
  authorizeTournamentAdministrator,
  isValidTournamentId as validId,
} from "@/lib/tournamentAdminAuth";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validUid(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("/");
}

/**
 * Permission groups of a data-entry staff member (docs/staff-access.md). `permissions` is derived
 * from the groups and stored so firestore.rules can check direct live writes.
 */
function permissionFields(body: unknown) {
  const record = isRecord(body) ? body : {};
  const { groups, extraPermissions } = normalizePermissionAssignment(record);
  return { groups, extraPermissions, permissions: groupPermissions({ groups, extraPermissions }) };
}

const authorizeAdministrator = (request: NextRequest, tournamentId: string) =>
  authorizeTournamentAdministrator(request, tournamentId, "Only tournament administrators can manage staff.");

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
      const current = await assertStillAdministrator(transaction, authorization);
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
          ...(assignment.role === "dataEntry" ? permissionFields(body) : {}),
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
      await assertStillAdministrator(transaction, authorization);
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
/** Changes the permission groups of one data-entry staff member. */
export async function PATCH(
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
  const fields = permissionFields(body);
  try {
    await authorization.firestore.runTransaction(async (transaction) => {
      await assertStillAdministrator(transaction, authorization);
      const staffRef = authorization.tournamentRef.collection("staff").doc(uid);
      const staffSnapshot = await transaction.get(staffRef);
      if (staffSnapshot.data()?.role !== "dataEntry") {
        throw new Error("Permission groups apply to data-entry staff only.");
      }
      transaction.update(staffRef, { ...fields, permissionsUpdatedAt: new Date().toISOString(), permissionsUpdatedBy: authorization.user.uid });
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not change staff permissions." },
      { status: 409 }
    );
  }
  return NextResponse.json({ uid, ...fields });
}

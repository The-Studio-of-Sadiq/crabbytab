import { NextRequest, NextResponse } from "next/server";
import { customPermissionGroupsRef } from "@/lib/staffAccessServer";
import {
  groupPermissions,
  normalizeCustomGroups,
  validateCustomGroups,
} from "@/lib/staffPermissions";
import {
  assertStillAdministrator,
  authorizeTournamentAdministrator,
  isValidTournamentId,
} from "@/lib/tournamentAdminAuth";

export const runtime = "nodejs";

/**
 * Organiser-defined permission groups (Tabbycat `users.Group`; docs/staff-access.md). Only
 * tournament administrators read or change them. The definitions are server-only; saving them
 * recomputes the stored `permissions` of every data-entry staff member in the same transaction,
 * so firestore.rules and the assistant routes agree at once.
 */

const authorize = (request: NextRequest, tournamentId: string) =>
  authorizeTournamentAdministrator(request, tournamentId, "Only tournament administrators can manage permission groups.");

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params;
  if (!isValidTournamentId(tournamentId)) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  const authorization = await authorize(request, tournamentId);
  if ("error" in authorization) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }
  try {
    const snapshot = await customPermissionGroupsRef(authorization.tournamentRef).get();
    return NextResponse.json(
      { groups: normalizeCustomGroups(snapshot.data()?.groups) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Could not load permission groups." }, { status: 503 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params;
  if (!isValidTournamentId(tournamentId)) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
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
  const submitted = body && typeof body === "object" ? (body as Record<string, unknown>).groups : undefined;
  const problems = validateCustomGroups(submitted);
  if (problems.length > 0) return NextResponse.json({ error: problems.join(" "), problems }, { status: 400 });
  const groups = normalizeCustomGroups(submitted);

  try {
    const updatedStaff = await authorization.firestore.runTransaction(async (transaction) => {
      await assertStillAdministrator(transaction, authorization);
      const staffSnapshot = await transaction.get(
        authorization.tournamentRef.collection("staff").where("role", "==", "dataEntry")
      );
      const now = new Date().toISOString();
      transaction.set(customPermissionGroupsRef(authorization.tournamentRef), {
        groups,
        updatedAt: now,
        updatedBy: authorization.user.uid,
      });
      let count = 0;
      for (const document of staffSnapshot.docs) {
        const data = document.data();
        // Removed groups stay listed on the staff member and grant nothing (never the default).
        const permissions = groupPermissions({ groups: data.groups, extraPermissions: data.extraPermissions }, groups);
        const current = Array.isArray(data.permissions) ? data.permissions : null;
        if (current && current.length === permissions.length && current.every((item, index) => item === permissions[index])) continue;
        transaction.update(document.ref, { permissions, permissionsUpdatedAt: now, permissionsUpdatedBy: authorization.user.uid });
        count += 1;
      }
      return count;
    });
    return NextResponse.json({ groups, updatedStaff });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save permission groups." },
      { status: 409 }
    );
  }
}

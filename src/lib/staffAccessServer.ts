import type { DecodedIdToken } from "firebase-admin/auth";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import type { NextRequest } from "next/server";
import type { Tournament } from "@/types";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin";
import { resolveStaffPermissions, type StaffPermission } from "@/lib/staffPermissions";

/**
 * Server-side authorization of data-entry staff (docs/staff-access.md). Every assistant route
 * resolves the caller's permissions here from their `staff/{uid}` document and the tournament's
 * `assistantAccess` level, and re-checks them inside each write transaction so a revoked or
 * narrowed assignment takes effect immediately.
 */

export interface DataEntryAuthorization {
  firestore: Firestore;
  tournamentRef: DocumentReference;
  staffRef: DocumentReference;
  user: DecodedIdToken;
  tournament: Tournament;
  actorName: string;
  permissions: StaffPermission[];
}

export type DataEntryAuthorizationResult = DataEntryAuthorization | { error: string; status: 401 | 403 | 404 | 503 };

export async function authorizeDataEntryStaff(
  request: NextRequest,
  tournamentId: string
): Promise<DataEntryAuthorizationResult> {
  const token = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token) return { error: "Sign in as a data-entry assistant.", status: 401 };
  let firestore: Firestore;
  let user: DecodedIdToken;
  try {
    firestore = getAdminFirestore();
    const auth = getAdminAuth();
    try {
      user = await auth.verifyIdToken(token);
    } catch {
      return { error: "Your sign-in has expired. Please sign in again.", status: 401 };
    }
  } catch {
    return { error: "Server-side Firebase authorization is not configured.", status: 503 };
  }
  const tournamentRef = firestore.collection("tournaments").doc(tournamentId);
  const staffRef = tournamentRef.collection("staff").doc(user.uid);
  let tournamentSnapshot;
  let staffSnapshot;
  try {
    [tournamentSnapshot, staffSnapshot] = await Promise.all([tournamentRef.get(), staffRef.get()]);
  } catch {
    return { error: "Could not check tournament access.", status: 503 };
  }
  if (!tournamentSnapshot.exists) return { error: "Tournament not found.", status: 404 };
  const staff = staffSnapshot.data();
  if (staff?.role !== "dataEntry") {
    return { error: "Data-entry access is not assigned to this account.", status: 403 };
  }
  const tournament = { ...tournamentSnapshot.data(), id: tournamentSnapshot.id } as Tournament;
  const permissions = resolveStaffPermissions(staff, tournament.preferences?.assistantAccess);
  if (permissions.length === 0) {
    return { error: "Data-entry access is switched off for this tournament.", status: 403 };
  }
  const staffName = staff.name ?? staff.displayName;
  const actorName = typeof staffName === "string" && staffName ? staffName : user.email || "Data-entry assistant";
  return { firestore, tournamentRef, staffRef, user, tournament, actorName, permissions };
}

export class DataEntryAccessChangedError extends Error {
  constructor(message = "Data-entry access was revoked.") {
    super(message);
  }
}

/**
 * Re-reads the staff document inside a transaction. The tournament's access level is the one read
 * when the request was authorized (an extra read per record is not worth it for a setting that
 * changes rarely); a changed group assignment applies at once.
 */
export async function currentDataEntryPermissions(
  transaction: Transaction,
  authorization: Pick<DataEntryAuthorization, "staffRef" | "tournament">
): Promise<StaffPermission[]> {
  const staff = (await transaction.get(authorization.staffRef)).data();
  if (staff?.role !== "dataEntry") throw new DataEntryAccessChangedError();
  return resolveStaffPermissions(staff, authorization.tournament.preferences?.assistantAccess);
}

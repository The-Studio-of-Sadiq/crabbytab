import type { DecodedIdToken } from "firebase-admin/auth";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import type { NextRequest } from "next/server";
import type { Tournament } from "@/types";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin";
import {
  normalizeCustomGroups,
  resolveStaffPermissions,
  usesCustomGroups,
  type CustomPermissionGroup,
  type StaffPermission,
} from "@/lib/staffPermissions";

/** Organiser-defined permission groups (docs/staff-access.md), server-only. */
export function customPermissionGroupsRef(tournamentRef: DocumentReference): DocumentReference {
  return tournamentRef.collection("serverOnly").doc("staffPermissionGroups");
}

/**
 * Reads the custom groups only when the staff member uses one, so ordinary assistants cost no
 * extra read. Inside a transaction the read is part of it.
 */
export async function loadCustomPermissionGroups(
  tournamentRef: DocumentReference,
  staff: { groups?: unknown } | undefined,
  transaction?: Transaction
): Promise<CustomPermissionGroup[]> {
  if (!usesCustomGroups(staff)) return [];
  const ref = customPermissionGroupsRef(tournamentRef);
  const snapshot = transaction ? await transaction.get(ref) : await ref.get();
  return normalizeCustomGroups(snapshot.data()?.groups);
}

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
  let customGroups: CustomPermissionGroup[];
  try {
    customGroups = await loadCustomPermissionGroups(tournamentRef, staff);
  } catch {
    return { error: "Could not check tournament access.", status: 503 };
  }
  const permissions = resolveStaffPermissions(staff, tournament.preferences?.assistantAccess, customGroups);
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
  authorization: Pick<DataEntryAuthorization, "staffRef" | "tournament" | "tournamentRef">
): Promise<StaffPermission[]> {
  const staff = (await transaction.get(authorization.staffRef)).data();
  if (staff?.role !== "dataEntry") throw new DataEntryAccessChangedError();
  const customGroups = await loadCustomPermissionGroups(authorization.tournamentRef, staff, transaction);
  return resolveStaffPermissions(staff, authorization.tournament.preferences?.assistantAccess, customGroups);
}

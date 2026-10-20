import type { Auth, DecodedIdToken } from "firebase-admin/auth";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import type { NextRequest } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin";
import { isGlobalAdminUid } from "@/lib/globalAdmin";
import { isTournamentAdministrator } from "@/lib/tournamentAccess";

export interface TournamentAdministratorAuthorization {
  auth: Auth;
  firestore: Firestore;
  tournamentRef: DocumentReference;
  user: DecodedIdToken;
  globalAdmin: boolean;
}

export type TournamentAdministratorAuthorizationResult =
  | TournamentAdministratorAuthorization
  | { error: string; status: 401 | 403 | 404 | 503 };

export function isValidTournamentId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/**
 * Verifies the Bearer ID token and that its account administers the tournament (owner, listed
 * admin, staff admin or global admin). Routes that then write should re-check inside their
 * transaction with `assertStillAdministrator`.
 */
export async function authorizeTournamentAdministrator(
  request: NextRequest,
  tournamentId: string,
  forbiddenMessage = "Only tournament administrators can do this."
): Promise<TournamentAdministratorAuthorizationResult> {
  const token = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token) return { error: "Sign in as a tournament administrator.", status: 401 };

  let auth: Auth;
  let firestore: Firestore;
  try {
    auth = getAdminAuth();
    firestore = getAdminFirestore();
  } catch {
    return { error: "Server-side Firebase authorization is not configured.", status: 503 };
  }

  let user: DecodedIdToken;
  try {
    user = await auth.verifyIdToken(token);
  } catch {
    return { error: "Your sign-in has expired. Please sign in again.", status: 401 };
  }

  const tournamentRef = firestore.collection("tournaments").doc(tournamentId);
  let tournamentData: Record<string, unknown> | undefined;
  let staffRole: unknown;
  try {
    const [tournamentSnapshot, staffSnapshot] = await Promise.all([
      tournamentRef.get(),
      tournamentRef.collection("staff").doc(user.uid).get(),
    ]);
    if (!tournamentSnapshot.exists) return { error: "Tournament not found.", status: 404 };
    tournamentData = tournamentSnapshot.data();
    staffRole = staffSnapshot.data()?.role;
  } catch {
    return { error: "Could not check tournament access.", status: 503 };
  }
  const globalAdmin = isGlobalAdminUid(user.uid);
  if (
    !globalAdmin &&
    !isTournamentAdministrator(
      { ownerId: tournamentData?.ownerId, admins: tournamentData?.admins as Record<string, unknown> | undefined },
      user.uid
    ) &&
    staffRole !== "admin"
  ) {
    return { error: forbiddenMessage, status: 403 };
  }
  return { auth, firestore, tournamentRef, user, globalAdmin };
}

export type TournamentAccessFields = Record<string, unknown> & {
  ownerId?: unknown;
  admins?: Record<string, unknown>;
};

export class StaleAuthorizationError extends Error {
  constructor() {
    super("Tournament staff permissions changed. Reload and try again.");
  }
}

/** Re-checks administrator access inside a transaction; returns the tournament's data. */
export async function assertStillAdministrator(
  transaction: Transaction,
  authorization: Pick<TournamentAdministratorAuthorization, "tournamentRef" | "user" | "globalAdmin">
): Promise<TournamentAccessFields> {
  const { tournamentRef, user, globalAdmin } = authorization;
  const currentSnapshot = await transaction.get(tournamentRef);
  const current = currentSnapshot.data();
  const actorStaffSnapshot = await transaction.get(tournamentRef.collection("staff").doc(user.uid));
  if (
    !currentSnapshot.exists ||
    (!globalAdmin &&
      !isTournamentAdministrator({ ownerId: current?.ownerId, admins: current?.admins }, user.uid) &&
      actorStaffSnapshot.data()?.role !== "admin")
  ) {
    throw new StaleAuthorizationError();
  }
  return (current ?? {}) as TournamentAccessFields;
}

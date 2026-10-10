import { Auth, DecodedIdToken } from "firebase-admin/auth";
import { DocumentSnapshot } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin";
import { isGlobalAdminUid } from "@/lib/globalAdmin";

export class EmailAuthorizationError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export async function authorizeTournamentEmailRequest(
  request: NextRequest,
  tournamentId: string
): Promise<DecodedIdToken> {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer (.+)$/);
  if (!match) {
    throw new EmailAuthorizationError("Sign in to use tournament email.", 401);
  }

  let user: DecodedIdToken;
  let auth: Auth;
  try {
    auth = getAdminAuth();
  } catch {
    throw new EmailAuthorizationError(
      "Server-side Firebase authorization is not configured.",
      503
    );
  }

  try {
    user = await auth.verifyIdToken(match[1]);
  } catch {
    throw new EmailAuthorizationError("Your sign-in has expired. Please sign in again.", 401);
  }

  let tournamentSnapshot: DocumentSnapshot;
  try {
    tournamentSnapshot = await getAdminFirestore()
      .collection("tournaments")
      .doc(tournamentId)
      .get();
  } catch {
    throw new EmailAuthorizationError(
      "Server-side Firebase authorization is not configured.",
      503
    );
  }

  if (!tournamentSnapshot.exists) {
    throw new EmailAuthorizationError("Tournament not found.", 404);
  }

  const tournament = tournamentSnapshot.data();
  const isOwnerOrAdmin =
    isGlobalAdminUid(user.uid) ||
    tournament?.ownerId === user.uid ||
    Boolean(tournament?.admins?.[user.uid]);

  if (!isOwnerOrAdmin) {
    throw new EmailAuthorizationError("Only tournament administrators can send email.", 403);
  }

  return user;
}

import { NextRequest, NextResponse } from "next/server";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin";
import {
  checkPrivateApiRateLimit,
  checkPrivateFailureLimit,
  clientAddressFromHeaders,
  recordPrivateFailure,
} from "@/lib/privateTeamRateLimit";
import {
  acceptInvitation,
  assertInvitationUsable,
  InvitationError,
  loadInvitationByToken,
  previewInvitation,
  validateNewAccount,
} from "@/lib/staffInvitations";

export const runtime = "nodejs";

/** Failed (unknown or wrong) invitation tokens per client address per hour. */
const MAX_FAILED_TOKENS = 30;
/** Accounts created through invitations per client address per hour. */
const MAX_ACCOUNTS_PER_ADDRESS = 10;
const NO_STORE = { "Cache-Control": "no-store" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function accountExists(auth: Auth, email: string): Promise<boolean> {
  try {
    await auth.getUserByEmail(email);
    return true;
  } catch (error) {
    if (isRecord(error) && error.code === "auth/user-not-found") return false;
    throw error;
  }
}

/**
 * Public invitation endpoint. `preview` describes the invitation a token names; `accept` grants
 * its role to the signed-in account; `register` creates the invited account (the only way to
 * create one in CrabbyTab) and accepts in the same request. Every action presents the token, and
 * wrong tokens are throttled per client address.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) throw new Error("not an object");
    body = parsed;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const action = body.action;
  if (action !== "preview" && action !== "accept" && action !== "register") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  let auth: Auth;
  let firestore: Firestore;
  try {
    auth = getAdminAuth();
    firestore = getAdminFirestore();
  } catch {
    return NextResponse.json({ error: "Server-side Firebase authorization is not configured." }, { status: 503 });
  }

  const address = clientAddressFromHeaders(request.headers);
  const limit = await checkPrivateFailureLimit(firestore, address, "invite", MAX_FAILED_TOKENS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many invalid invitation links from this network. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const now = Date.now();
  try {
    if (action === "preview") {
      const loaded = await loadInvitationByToken(firestore, body.token);
      const preview = previewInvitation(loaded, now);
      return NextResponse.json(
        { invitation: preview, accountExists: preview.state === "pending" ? await accountExists(auth, preview.email) : undefined },
        { headers: NO_STORE }
      );
    }

    if (action === "accept") {
      const idToken = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1];
      if (!idToken) return NextResponse.json({ error: "Sign in to accept this invitation." }, { status: 401 });
      let account;
      try {
        account = await auth.verifyIdToken(idToken);
      } catch {
        return NextResponse.json({ error: "Your sign-in has expired. Please sign in again." }, { status: 401 });
      }
      const accepted = await acceptInvitation({
        firestore,
        token: body.token,
        account: { uid: account.uid, email: account.email, displayName: account.name },
        now,
      });
      return NextResponse.json(accepted, { headers: NO_STORE });
    }

    const { password, displayName } = validateNewAccount(body);
    const loaded = await loadInvitationByToken(firestore, body.token);
    assertInvitationUsable(loaded.record, now);
    if (await accountExists(auth, loaded.record.email)) {
      throw new InvitationError("An account already exists for this email address. Sign in to accept the invitation.", 409);
    }
    const creation = await checkPrivateApiRateLimit(firestore, address, "invite-account", MAX_ACCOUNTS_PER_ADDRESS, now);
    if (!creation.allowed) {
      return NextResponse.json(
        { error: "Too many accounts were created from this network. Try again later." },
        { status: 429, headers: { "Retry-After": String(creation.retryAfterSeconds) } }
      );
    }
    let created;
    try {
      // The address is verified: the invitation reached it (or an administrator vouched for it).
      created = await auth.createUser({ email: loaded.record.email, password, displayName, emailVerified: true });
    } catch (error) {
      if (isRecord(error) && error.code === "auth/email-already-exists") {
        throw new InvitationError("An account already exists for this email address. Sign in to accept the invitation.", 409);
      }
      if (isRecord(error) && error.code === "auth/invalid-password") {
        throw new InvitationError("Choose a stronger password.", 400);
      }
      throw error;
    }
    try {
      const accepted = await acceptInvitation({
        firestore,
        token: body.token,
        account: { uid: created.uid, email: created.email, displayName },
        now,
      });
      return NextResponse.json({ ...accepted, email: loaded.record.email }, { headers: NO_STORE });
    } catch (error) {
      // The account exists either way; signing in and accepting again finishes the job.
      if (error instanceof InvitationError) {
        throw new InvitationError(`Your account was created, but ${error.message.charAt(0).toLowerCase()}${error.message.slice(1)}`, error.status);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof InvitationError) {
      if (error.badToken) {
        await recordPrivateFailure(firestore, address, "invite", MAX_FAILED_TOKENS, now).catch((recordError) =>
          console.warn("Could not record a failed invitation attempt:", recordError instanceof Error ? recordError.message : recordError)
        );
      }
      return NextResponse.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    }
    console.error("Invitation request failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not process the invitation. Try again." }, { status: 503 });
  }
}

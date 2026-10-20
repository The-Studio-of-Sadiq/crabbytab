import { NextRequest, NextResponse } from "next/server";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { deliverMessages } from "@/lib/email/deliver";
import { isValidRecordId, linkOrigin, recordIdForEmail } from "@/lib/linkTokens";
import {
  buildInvitationEmail,
  invitationLink,
  invitationsCollection,
  InvitationError,
  issueInvitations,
  parseExpiryDays,
  parseInvitationEmails,
  parseInvitationRole,
  renewInvitation,
  summarizeInvitation,
  type InvitationIssue,
  type StaffInvitationRecord,
} from "@/lib/staffInvitations";
import {
  assertStillAdministrator,
  authorizeTournamentAdministrator,
  isValidTournamentId,
  StaleAuthorizationError,
  type TournamentAdministratorAuthorization,
} from "@/lib/tournamentAdminAuth";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function authorize(request: NextRequest, params: Promise<{ tournamentId: string }>) {
  const { tournamentId } = await params;
  if (!isValidTournamentId(tournamentId)) {
    return { response: NextResponse.json({ error: "Tournament not found." }, { status: 404 }) };
  }
  const authorization = await authorizeTournamentAdministrator(
    request,
    tournamentId,
    "Only tournament administrators can manage staff."
  );
  if ("error" in authorization) {
    return { response: NextResponse.json({ error: authorization.error }, { status: authorization.status }) };
  }
  return { authorization, tournamentId };
}

async function readBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return isRecord(body) ? body : null;
  } catch {
    return null;
  }
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof InvitationError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof StaleAuthorizationError) return NextResponse.json({ error: error.message }, { status: 409 });
  console.error(fallback, error instanceof Error ? error.message : error);
  return NextResponse.json({ error: fallback }, { status: 503 });
}

/** Emails each issued link and records the outcome on its invitation. */
async function sendAndRecord(
  request: NextRequest,
  firestore: Firestore,
  collection: ReturnType<typeof invitationsCollection>,
  authorization: TournamentAdministratorAuthorization,
  tournamentName: string,
  issues: InvitationIssue[],
  now: number
) {
  const origin = linkOrigin(request.nextUrl.origin);
  const links = issues.map((issue) => ({ id: issue.id, email: issue.email, link: invitationLink(origin, issue.token) }));
  const outcomes = await deliverMessages(
    issues.map((issue, index) => ({
      to: issue.email,
      ...buildInvitationEmail({
        tournamentName,
        role: issue.role,
        link: links[index].link,
        expiresAt: issue.expiresAt,
        inviterName: authorization.user.name || authorization.user.email,
      }),
    }))
  );
  const sentAt = new Date(now).toISOString();
  await Promise.all(
    issues.map((issue, index) => {
      const reference: DocumentReference = collection.doc(issue.id);
      return firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const record = snapshot.data() as StaffInvitationRecord | undefined;
        if (!record) return;
        const { deliveryError: _previousError, ...rest } = record;
        transaction.set(
          reference,
          outcomes[index].delivered
            ? { ...rest, sendCount: (record.sendCount || 0) + 1, lastSentAt: sentAt }
            : { ...rest, deliveryError: outcomes[index].error }
        );
      });
    })
  );
  return links.map((link, index) => ({ ...link, delivered: outcomes[index].delivered, error: outcomes[index].error }));
}

async function listSummaries(collection: ReturnType<typeof invitationsCollection>, now: number) {
  const snapshot = await collection.get();
  return snapshot.docs
    .map((document) => summarizeInvitation(document.id, document.data() as StaffInvitationRecord, now))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const result = await authorize(request, params);
  if ("response" in result) return result.response;
  try {
    const invitations = await listSummaries(invitationsCollection(result.authorization.tournamentRef), Date.now());
    return NextResponse.json({ invitations }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, "Could not load staff invitations.");
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const result = await authorize(request, params);
  if ("response" in result) return result.response;
  const { authorization, tournamentId } = result;
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  const emails = parseInvitationEmails(body.emails);
  const role = parseInvitationRole(body.role);
  const expiryDays = parseExpiryDays(body.expiryDays);
  if (!emails) return NextResponse.json({ error: "Enter between one and 50 valid email addresses." }, { status: 400 });
  if (!role) return NextResponse.json({ error: "Choose a valid tournament role." }, { status: 400 });
  if (expiryDays === null) return NextResponse.json({ error: "Choose an expiry between 1 and 30 days." }, { status: 400 });

  const { firestore, tournamentRef, user } = authorization;
  const collection = invitationsCollection(tournamentRef);
  const now = Date.now();
  try {
    const { issues, tournamentName } = await firestore.runTransaction(async (transaction) => {
      const tournament = await assertStillAdministrator(transaction, authorization);
      const existing = await Promise.all(emails.map((email) => transaction.get(collection.doc(recordIdForEmail(email)))));
      const issued = issueInvitations({
        emails,
        role,
        expiryDays,
        tournamentId,
        actorUid: user.uid,
        now,
        existing: new Map(existing.map((snapshot) => [snapshot.id, snapshot.data() as StaffInvitationRecord | undefined])),
      });
      for (const { issue, record } of issued) transaction.set(collection.doc(issue.id), record);
      return {
        issues: issued.map(({ issue }) => issue),
        tournamentName: typeof tournament.name === "string" ? tournament.name : "your tournament",
      };
    });
    const links = await sendAndRecord(request, firestore, collection, authorization, tournamentName, issues, now);
    return NextResponse.json({ invitations: await listSummaries(collection, now), links }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, "Could not create staff invitations.");
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const result = await authorize(request, params);
  if ("response" in result) return result.response;
  const { authorization, tournamentId } = result;
  const body = await readBody(request);
  if (!body || body.action !== "resend" || !isValidRecordId(body.invitationId)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const expiryDays = parseExpiryDays(body.expiryDays);
  if (expiryDays === null) return NextResponse.json({ error: "Choose an expiry between 1 and 30 days." }, { status: 400 });
  const invitationId = body.invitationId;
  const { firestore, tournamentRef } = authorization;
  const collection = invitationsCollection(tournamentRef);
  const now = Date.now();
  try {
    const { issue, tournamentName } = await firestore.runTransaction(async (transaction) => {
      const tournament = await assertStillAdministrator(transaction, authorization);
      const snapshot = await transaction.get(collection.doc(invitationId));
      const record = snapshot.data() as StaffInvitationRecord | undefined;
      if (!record) throw new InvitationError("Invitation not found.", 404);
      const renewed = renewInvitation(record, { id: invitationId, tournamentId, expiryDays, now });
      transaction.set(collection.doc(invitationId), renewed.record);
      return {
        issue: renewed.issue,
        tournamentName: typeof tournament.name === "string" ? tournament.name : "your tournament",
      };
    });
    const links = await sendAndRecord(request, firestore, collection, authorization, tournamentName, [issue], now);
    return NextResponse.json({ invitations: await listSummaries(collection, now), links }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, "Could not resend the invitation.");
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const result = await authorize(request, params);
  if ("response" in result) return result.response;
  const { authorization } = result;
  const body = await readBody(request);
  if (!body || !isValidRecordId(body.invitationId)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const invitationId = body.invitationId;
  const { firestore, tournamentRef, user } = authorization;
  const collection = invitationsCollection(tournamentRef);
  const now = Date.now();
  try {
    await firestore.runTransaction(async (transaction) => {
      await assertStillAdministrator(transaction, authorization);
      const snapshot = await transaction.get(collection.doc(invitationId));
      const record = snapshot.data() as StaffInvitationRecord | undefined;
      if (!record) throw new InvitationError("Invitation not found.", 404);
      if (record.status !== "pending") {
        throw new InvitationError(
          record.status === "accepted"
            ? "This invitation was already accepted; remove the staff member instead."
            : "This invitation is already revoked.",
          409
        );
      }
      transaction.update(collection.doc(invitationId), {
        status: "revoked",
        revokedAt: new Date(now).toISOString(),
        revokedBy: user.uid,
      });
    });
    return NextResponse.json({ invitations: await listSummaries(collection, now) }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, "Could not revoke the invitation.");
  }
}

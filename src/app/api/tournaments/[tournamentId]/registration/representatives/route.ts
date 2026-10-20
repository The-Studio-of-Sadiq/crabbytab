import { NextRequest, NextResponse } from "next/server";
import { deliverMessages } from "@/lib/email/deliver";
import { isValidRecordId, linkOrigin } from "@/lib/linkTokens";
import {
  buildRepresentativeEmail,
  issueRepresentative,
  parseRepresentativeInput,
  readSettings,
  registrationRefs,
  RegistrationError,
  representativeIdFor,
  representativeLink,
  summarizeRepresentative,
} from "@/lib/registration/service";
import type { RegistrationRepresentative } from "@/lib/registration/types";
import { assertStillAdministrator, type TournamentAdministratorAuthorization } from "@/lib/tournamentAdminAuth";
import { authorizeRegistrationAdmin, NO_STORE, readJsonBody, registrationErrorResponse } from "../shared";

export const runtime = "nodejs";

async function listRepresentatives(authorization: TournamentAdministratorAuthorization) {
  const snapshot = await registrationRefs(authorization.tournamentRef).representatives.get();
  return snapshot.docs
    .map((document) => summarizeRepresentative(document.data() as RegistrationRepresentative))
    .sort((left, right) => left.institution.name.localeCompare(right.institution.name));
}

/** Emails a freshly issued link and records the outcome; returns the link for manual sharing. */
async function sendLink(
  request: NextRequest,
  authorization: TournamentAdministratorAuthorization,
  record: RegistrationRepresentative,
  token: string,
  context: { slug: string; tournamentName: string; closesAt?: string }
) {
  const link = representativeLink(linkOrigin(request.nextUrl.origin), context.slug, token);
  const [outcome] = await deliverMessages([
    {
      to: record.email,
      ...buildRepresentativeEmail({
        tournamentName: context.tournamentName,
        institutionName: record.institution.name,
        name: record.name,
        link,
        closesAt: context.closesAt,
      }),
    },
  ]);
  const reference = registrationRefs(authorization.tournamentRef).representatives.doc(record.id);
  await authorization.firestore.runTransaction(async (transaction) => {
    const current = (await transaction.get(reference)).data() as RegistrationRepresentative | undefined;
    if (!current || current.tokenHash !== record.tokenHash) return;
    const { deliveryError: _previous, ...rest } = current;
    transaction.set(
      reference,
      outcome.delivered
        ? { ...rest, sendCount: current.sendCount + 1, lastSentAt: new Date().toISOString() }
        : { ...rest, deliveryError: outcome.error }
    );
  });
  return { email: record.email, link, delivered: outcome.delivered, error: outcome.error };
}

async function issueAndSend(
  request: NextRequest,
  authorization: TournamentAdministratorAuthorization,
  build: (previous: RegistrationRepresentative | undefined) => ReturnType<typeof issueRepresentative>,
  id: string,
  requireExisting: boolean
) {
  const refs = registrationRefs(authorization.tournamentRef);
  const issued = await authorization.firestore.runTransaction(async (transaction) => {
    const tournament = await assertStillAdministrator(transaction, authorization);
    const [previousSnapshot, settingsSnapshot] = await Promise.all([
      transaction.get(refs.representatives.doc(id)),
      transaction.get(refs.settingsRef),
    ]);
    const previous = previousSnapshot.data() as RegistrationRepresentative | undefined;
    if (requireExisting && !previous) throw new RegistrationError("Representative not found.", 404);
    if (requireExisting && previous?.status === "revoked") {
      throw new RegistrationError("This representative's link was revoked. Add them again to issue a new one.", 409);
    }
    const slug = typeof tournament.slug === "string" ? tournament.slug : "";
    if (!slug) throw new RegistrationError("Give the tournament a URL slug before sending registration links.", 409);
    const { record, token } = build(previous);
    transaction.set(refs.representatives.doc(record.id), record);
    const settings = readSettings(settingsSnapshot.data());
    return {
      record,
      token,
      slug,
      tournamentName: typeof tournament.name === "string" ? tournament.name : "the tournament",
      closesAt: settings?.closesAt,
    };
  });
  return sendLink(request, authorization, issued.record, issued.token, issued);
}

/** Adds (or re-issues) a representative for an institution and emails their link. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const result = await authorizeRegistrationAdmin(request, params);
  if ("response" in result) return result.response;
  const { authorization, tournamentId } = result;
  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  try {
    const input = parseRepresentativeInput(body);
    const now = Date.now();
    const link = await issueAndSend(
      request,
      authorization,
      (previous) => issueRepresentative(input, { tournamentId, actorUid: authorization.user.uid, now, previous }),
      representativeIdFor(input.institution, input.email),
      false
    );
    return NextResponse.json({ representatives: await listRepresentatives(authorization), link }, { headers: NO_STORE });
  } catch (error) {
    return registrationErrorResponse(error, "Could not add the representative.");
  }
}

/** `{action: "resend", representativeId}`: a new link (the old one stops working), emailed again. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const result = await authorizeRegistrationAdmin(request, params);
  if ("response" in result) return result.response;
  const { authorization, tournamentId } = result;
  const body = await readJsonBody(request);
  if (!body || body.action !== "resend" || !isValidRecordId(body.representativeId)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  try {
    const now = Date.now();
    const link = await issueAndSend(
      request,
      authorization,
      (record) => {
        if (!record) throw new RegistrationError("Representative not found.", 404);
        return issueRepresentative(
          {
            institution: record.institution,
            email: record.email,
            name: record.name,
            teamQuota: record.teamQuota,
            adjudicatorQuota: record.adjudicatorQuota,
          },
          { tournamentId, actorUid: authorization.user.uid, now, previous: record }
        );
      },
      body.representativeId,
      true
    );
    return NextResponse.json({ representatives: await listRepresentatives(authorization), link }, { headers: NO_STORE });
  } catch (error) {
    return registrationErrorResponse(error, "Could not resend the link.");
  }
}

/** Revokes a representative's link. Their submissions stay in the queue. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const result = await authorizeRegistrationAdmin(request, params);
  if ("response" in result) return result.response;
  const { authorization } = result;
  const body = await readJsonBody(request);
  if (!body || !isValidRecordId(body.representativeId)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const reference = registrationRefs(authorization.tournamentRef).representatives.doc(body.representativeId);
  try {
    await authorization.firestore.runTransaction(async (transaction) => {
      await assertStillAdministrator(transaction, authorization);
      const current = (await transaction.get(reference)).data() as RegistrationRepresentative | undefined;
      if (!current) throw new RegistrationError("Representative not found.", 404);
      transaction.set(reference, { ...current, status: "revoked" });
    });
    return NextResponse.json({ representatives: await listRepresentatives(authorization) }, { headers: NO_STORE });
  } catch (error) {
    return registrationErrorResponse(error, "Could not revoke the link.");
  }
}

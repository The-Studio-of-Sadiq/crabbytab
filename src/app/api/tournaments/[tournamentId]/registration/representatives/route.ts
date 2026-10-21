import { NextRequest, NextResponse } from "next/server";
import { isValidRecordId } from "@/lib/linkTokens";
import {
  issueRepresentative,
  parseRepresentativeInput,
  registrationRefs,
  RegistrationError,
  representativeIdFor,
} from "@/lib/registration/service";
import type { RegistrationRepresentative } from "@/lib/registration/types";
import { assertStillAdministrator } from "@/lib/tournamentAdminAuth";
import { authorizeRegistrationAdmin, NO_STORE, readJsonBody, registrationErrorResponse } from "../shared";
import { issueAndSend, listRepresentatives } from "../representativeLinks";

export const runtime = "nodejs";

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

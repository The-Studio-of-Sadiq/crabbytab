import { NextRequest, NextResponse } from "next/server";
import { isValidRecordId } from "@/lib/linkTokens";
import { parseReviewAction, reviewSubmission } from "@/lib/registration/service";
import { assertStillAdministrator } from "@/lib/tournamentAdminAuth";
import { authorizeRegistrationAdmin, NO_STORE, readJsonBody, registrationErrorResponse } from "../shared";

export const runtime = "nodejs";

/**
 * One review action on a submission: `edit` (pending only), `reject`, `reopen`, and the approval
 * steps `claim` → (the reviewer's device creates the team or adjudicator) → `approve`, or
 * `release` to give a claimed submission back. Every action names the revision it saw.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const result = await authorizeRegistrationAdmin(request, params);
  if ("response" in result) return result.response;
  const { authorization } = result;
  const body = await readJsonBody(request);
  const action = parseReviewAction(body?.action);
  if (!body || !action || !isValidRecordId(body.submissionId)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  try {
    const submission = await reviewSubmission({
      firestore: authorization.firestore,
      tournamentRef: authorization.tournamentRef,
      assertAdministrator: (transaction) => assertStillAdministrator(transaction, authorization),
      reviewerUid: authorization.user.uid,
      action,
      submissionId: body.submissionId,
      revision: body.revision,
      data: body.data,
      reason: body.reason,
      entityId: body.entityId,
      entityName: body.entityName,
      now: Date.now(),
    });
    return NextResponse.json({ submission }, { headers: NO_STORE });
  } catch (error) {
    return registrationErrorResponse(error, "Could not update the submission.");
  }
}

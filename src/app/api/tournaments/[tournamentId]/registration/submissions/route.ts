import { NextRequest, NextResponse } from "next/server";
import { isValidRecordId } from "@/lib/linkTokens";
import { issueRepresentative, parseReviewAction, representativeIdFor, reviewSubmission } from "@/lib/registration/service";
import { issueAndSend } from "../representativeLinks";
import { entryName } from "@/lib/registration/validation";
import { sendTemplatedEmail } from "@/lib/email/templatedEmail";
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
      teamsAllocated: body.teamsAllocated,
      adjudicatorsAllocated: body.adjudicatorsAllocated,
      now: Date.now(),
    });
    if (action === "allocate" && submission.institution) {
      // The institution's coach becomes its representative, with the allocated places, and gets
      // their link in the "places allocated" email.
      const institution = submission.institution;
      const link = await issueAndSend(
        request,
        authorization,
        (previous) => issueRepresentative(
          {
            institution,
            email: submission.contactEmail,
            name: submission.contactName,
            teamQuota: submission.teamsAllocated ?? 0,
            adjudicatorQuota: submission.adjudicatorsAllocated ?? 0,
          },
          { tournamentId: authorization.tournamentRef.id, actorUid: authorization.user.uid, now: Date.now(), previous }
        ),
        representativeIdFor(institution, submission.contactEmail),
        false
      );
      return NextResponse.json({ submission, link }, { headers: NO_STORE });
    }
    if (action === "approve") {
      // Registration approved (docs/email-notifications.md): only when switched on in the email settings.
      const tournamentName = (await authorization.tournamentRef.get()).data()?.name;
      await sendTemplatedEmail({
        tournamentRef: authorization.tournamentRef,
        tournamentName: typeof tournamentName === "string" ? tournamentName : "the tournament",
        event: "registration_approved",
        recipient: {
          email: submission.contactEmail,
          name: submission.contactName,
          entry: submission.approvedEntityName || entryName(submission),
          institution: submission.institution?.name ?? "",
        },
        when: (settings) => settings.registrationEmails,
      });
    }
    return NextResponse.json({ submission }, { headers: NO_STORE });
  } catch (error) {
    return registrationErrorResponse(error, "Could not update the submission.");
  }
}

import type { NextRequest } from "next/server";
import { sendTemplatedEmail } from "@/lib/email/templatedEmail";
import { linkOrigin } from "@/lib/linkTokens";
import {
  issueRepresentative,
  readSettings,
  registrationRefs,
  RegistrationError,
  representativeLink,
  summarizeRepresentative,
} from "@/lib/registration/service";
import type { RegistrationRepresentative } from "@/lib/registration/types";
import { assertStillAdministrator, type TournamentAdministratorAuthorization } from "@/lib/tournamentAdminAuth";

/**
 * Issuing and emailing institution representative links, shared by the representatives route and
 * institution approvals (an approved institution's coach becomes its representative).
 */

export async function listRepresentatives(authorization: TournamentAdministratorAuthorization) {
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
  context: { slug: string; tournamentName: string; teamQuota: number; adjudicatorQuota: number }
) {
  const link = representativeLink(linkOrigin(request.nextUrl.origin), context.slug, token);
  // Places allocated (Tabbycat "slots allocated"): the tournament's saved template, with the link.
  const places = (value: number) => (value > 0 ? String(value) : "unlimited");
  const outcome = (await sendTemplatedEmail({
    tournamentRef: authorization.tournamentRef,
    tournamentName: context.tournamentName,
    event: "slots_allocated",
    recipient: {
      email: record.email,
      name: record.name || record.institution.name,
      institution: record.institution.name,
      url: link,
      teamsAllocated: places(record.teamQuota ?? context.teamQuota),
      adjudicatorsAllocated: places(record.adjudicatorQuota ?? context.adjudicatorQuota),
    },
  }))!;
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

export async function issueAndSend(
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
      teamQuota: settings?.teamQuotaPerInstitution ?? 0,
      adjudicatorQuota: settings?.adjudicatorQuotaPerInstitution ?? 0,
    };
  });
  return sendLink(request, authorization, issued.record, issued.token, issued);
}

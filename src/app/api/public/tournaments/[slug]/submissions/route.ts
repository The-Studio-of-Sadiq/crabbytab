import { NextRequest, NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import type { BallotSubmission, Tournament } from "@/types";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import {
  checkPrivateApiRateLimit,
  checkPrivateFailureLimit,
  clientAddressFromHeaders,
  recordPrivateFailure,
} from "@/lib/privateTeamRateLimit";
import { resolveTournamentBySlug } from "@/lib/registration/service";
import { spamSignal } from "@/lib/registration/validation";
import { getPublicSiteSettings } from "@/lib/publicFeatures";
import { MAX_PUBLIC_SUBMISSION_BYTES, parsePublicSubmission, PUBLIC_FORMS_DOCUMENT, verifyPublicPassword } from "@/lib/publicForms";
import { applyParticipantSubmissions, loadParticipantAssignments } from "@/lib/participantSubmissions";
import { sendBallotReceipts } from "@/lib/email/notificationService";

export const runtime = "nodejs";

/** Submissions per hour: per address per tournament, per address overall, per tournament. */
const PER_ADDRESS_PER_TOURNAMENT = 60;
const PER_ADDRESS = 120;
const PER_TOURNAMENT = 3000;
/** Wrong public passwords per address per hour. */
const MAX_FAILED_PASSWORDS = 20;
const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200, headers: Record<string, string> = NO_STORE) {
  return NextResponse.json(body, { status, headers });
}

function getFirestore(): Firestore | null {
  try {
    return getAdminFirestore();
  } catch {
    return null;
  }
}

/**
 * Public ballots wait for the tab room: anyone can pick a name on a public form. They are also
 * kept out of individual-ballot merging (no `singleAdjudicator`), because an adjudicator's new
 * individual sheet replaces their earlier one, and a public form must never replace a sheet the
 * adjudicator sent from their private URL.
 */
function asPublicBallot(ballot: BallotSubmission): BallotSubmission {
  const { confirmedBy: _confirmedBy, confirmedTimestamp: _confirmedTimestamp, singleAdjudicator: _single, ...rest } = ballot;
  return { ...rest, confirmed: false, submitterType: "public" };
}

/**
 * Public (non-private-URL) ballot and feedback forms (roadmap #26; Tabbycat participant_ballots /
 * participant_feedback = "public"). The participant is chosen on the form, so:
 * - only debates in released draws with announced panels can be submitted for;
 * - ballots and feedback are saved unconfirmed, for the tab room to confirm;
 * - the optional public password, a honeypot, a minimum fill time and per-address and
 *   per-tournament rate limits guard against abuse.
 * Validation is the same as for private URLs (lib/participantSubmissions.ts).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (Number(request.headers.get("content-length") ?? 0) > MAX_PUBLIC_SUBMISSION_BYTES) {
    return json({ error: "This submission is too large." }, 413);
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_PUBLIC_SUBMISSION_BYTES) return json({ error: "This submission is too large." }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  const submission = parsePublicSubmission(body);
  if ("error" in submission) return json({ error: submission.error }, 400);

  const now = Date.now();
  const signal = spamSignal({ honeypot: submission.honeypot, startedAt: submission.startedAt }, now);
  // A filled honeypot gets an ordinary-looking answer, so automated senders learn nothing.
  if (signal === "honeypot") return json({ received: true });
  if (signal === "too_fast") return json({ error: "That was quick! Check your entry and submit again." }, 400);
  if (signal) return json({ error: "This form has expired. Reload the page and submit again." }, 400);

  const firestore = getFirestore();
  if (!firestore) return json({ error: "Public forms are not available on this server." }, 503);
  const address = clientAddressFromHeaders(request.headers);

  try {
    const tournamentRef = await resolveTournamentBySlug(firestore, slug);
    if (!tournamentRef) return json({ error: "Tournament not found." }, 404);
    const passwordFailures = await checkPrivateFailureLimit(firestore, `${tournamentRef.id}:${address}`, "public-form-password", MAX_FAILED_PASSWORDS, now);
    if (!passwordFailures.allowed) {
      return NextResponse.json(
        { error: "Too many wrong passwords from this network. Try again later." },
        { status: 429, headers: { ...NO_STORE, "Retry-After": String(passwordFailures.retryAfterSeconds) } }
      );
    }
    for (const [identity, scope, max] of [
      [`${tournamentRef.id}:${address}`, "public-form-address-tournament", PER_ADDRESS_PER_TOURNAMENT],
      [address, "public-form-address", PER_ADDRESS],
      [tournamentRef.id, "public-form-tournament", PER_TOURNAMENT],
    ] as const) {
      const limit = await checkPrivateApiRateLimit(firestore, identity, scope, max, now);
      if (!limit.allowed) {
        return NextResponse.json(
          { error: "Too many submissions right now. Try again later." },
          { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSeconds) } }
        );
      }
    }

    const tournamentSnapshot = await tournamentRef.get();
    if (!tournamentSnapshot.exists) return json({ error: "Tournament not found." }, 404);
    const tournament = { ...tournamentSnapshot.data(), id: tournamentSnapshot.id } as Tournament;
    const settings = getPublicSiteSettings(tournament.preferences);
    const enabled = submission.kind === "ballot" ? settings.ballotForm : settings.feedbackForm;
    if (!enabled) return json({ error: "This form is not open." }, 403);

    if (settings.formsUsePassword) {
      const stored = (await tournamentRef.collection("serverOnly").doc(PUBLIC_FORMS_DOCUMENT).get()).data();
      if (!stored?.passwordHash) return json({ error: "The tournament has not set a password for this form yet." }, 503);
      if (!verifyPublicPassword(stored, submission.password)) {
        await recordPrivateFailure(firestore, `${tournamentRef.id}:${address}`, "public-form-password", MAX_FAILED_PASSWORDS, now).catch(
          (error) => console.warn("Could not record a wrong public form password:", error instanceof Error ? error.message : error)
        );
        return json({ error: "The password is incorrect." }, 403);
      }
    }

    const collection = submission.participantType === "adjudicator" ? "adjudicators" : "teams";
    const actorSnapshot = await tournamentRef.collection(collection).doc(submission.participantId).get();
    const actor = actorSnapshot.data();
    if (!actorSnapshot.exists || !actor || typeof actor.deletedAt === "string") {
      return json({ error: "That participant was not found." }, 404);
    }

    const assignments = await loadParticipantAssignments(tournamentRef, submission.participantType, actorSnapshot.id);
    // Public forms only offer debates whose panel has been announced.
    const assignedDebates = new Map(
      [...assignments.assignedDebates].filter(([, debate]) => assignments.roundById.get(debate.roundId)?.adjudicatorsRevealed === true)
    );
    const result = await applyParticipantSubmissions(
      {
        firestore,
        tournamentRef,
        tournament,
        tournamentId: tournamentRef.id,
        actorType: submission.participantType,
        actorDocument: actorSnapshot,
        actor: { ...actor, name: typeof actor.name === "string" ? actor.name : "" },
        assignedDebates,
        teams: assignments.teams,
        roundById: assignments.roundById,
        pending: [{ collection: submission.kind === "ballot" ? "ballots" : "feedback", record: submission.record }],
      },
      { adjustBallot: asPublicBallot, feedbackConfirmed: false }
    );
    if (!result.ok) return json({ error: result.error }, result.status);

    if (submission.kind === "ballot" && result.writtenBallots.length > 0) {
      await sendBallotReceipts({
        firestore,
        tournament,
        adjudicator: { id: actorSnapshot.id, name: String(actor.name ?? ""), email: typeof actor.email === "string" ? actor.email : undefined },
        ballots: result.writtenBallots.filter((ballot) => ballot.discarded !== true && ballot.submitterId === actorSnapshot.id),
        debates: assignedDebates,
        rounds: assignments.roundById,
      }).catch((error) => console.warn("Could not send a public ballot receipt:", error instanceof Error ? error.message : error));
    }
    return json({ received: true });
  } catch (error) {
    console.error("Public form submission failed:", error instanceof Error ? error.message : error);
    return json({ error: "Could not save the submission. Try again later." }, 503);
  }
}

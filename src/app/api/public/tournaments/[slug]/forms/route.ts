import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { DocumentReference, Firestore, QuerySnapshot } from "firebase-admin/firestore";
import type { Adjudicator, BallotSubmission, Debate, Round, Team, Tournament } from "@/types";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import {
  checkPrivateApiRateLimit,
  checkPrivateFailureLimit,
  clientAddressFromHeaders,
  recordPrivateFailure,
} from "@/lib/privateTeamRateLimit";
import { resolveTournamentBySlug } from "@/lib/registration/service";
import { getPublicViewReader, publicCacheHeaders, PublicViewError } from "@/lib/publicView/store";
import type { PublicDerived } from "@/lib/publicView/derived";
import { buildPrivateBallot } from "@/lib/privateBallot";
import { planPrivateBallotWrites, supersededBallotUpdate } from "@/lib/privateSync";
import { planIndividualBallotWrites, usesIndividualBallots } from "@/lib/privateIndividualBallots";
import { loadParticipantDebates, loadTeamsById } from "@/lib/privateParticipantData";
import { isRoundLockedForPortalBallots } from "@/features/tournament/application/stateGuards";
import { motionsVisible } from "@/features/tournament/application/motionRelease";
import { sendBallotReceipts } from "@/lib/email/notificationService";
import { getPublicSiteSettings, publicUsesTeamCodeNames } from "@/lib/publicFeatures";
import { hasCodeName } from "@/lib/codeNames";
import {
  buildPublicFeedback,
  isPublicFormEnabled,
  publicBallotRound,
  publicFeedbackOptions,
  publicFormsRequirePassword,
  PublicFormError,
  selectPublicBallotDebate,
  type PublicFormKind,
  type PublicFormSourceType,
} from "@/lib/publicForms";
import { PUBLIC_FORMS_PASSWORD_DOCUMENT, verifyPublicFormsPassword } from "@/lib/publicFormsPassword";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 64_000;
/** Requests per hour per client address per tournament (a whole room may share one network). */
const PER_ADDRESS = 240;
/** Requests per hour per tournament. */
const PER_TOURNAMENT = 6_000;
/** Wrong passwords per hour per client address per tournament before the form refuses them. */
const MAX_FAILED_PASSWORDS = 30;

function json(body: unknown, status = 200, headers: Record<string, string> = NO_STORE) {
  return NextResponse.json(body, { status, headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validDocumentId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("/");
}

/**
 * Who appears in the public form pickers (Tabbycat's public ballot and feedback index pages). Read
 * from the published public view, so a busy page costs Firestore nothing beyond the cached snapshot.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const reader = await getPublicViewReader(slug);
    const [tournament, derived] = await Promise.all([reader.readBase("tournament"), reader.readBase("derived")]);
    const record = (tournament ?? {}) as Partial<Tournament>;
    return json(
      {
        tournament: { name: record.name ?? "", shortName: record.shortName, format: record.format },
        forms: (derived as PublicDerived | undefined)?.publicForms ?? null,
      },
      200,
      publicCacheHeaders(15, 30)
    );
  } catch (error) {
    if (error instanceof PublicViewError && error.status < 500) return json({ error: error.message }, error.status);
    console.error("Could not load the public forms:", error instanceof Error ? error.message : error);
    return json({ error: "Could not load the forms. Try again later." }, 503);
  }
}

/**
 * Preferences sent with a form: what the ballot and feedback forms need, without the parts the
 * public projection also withholds (the unreleased schedule, private speaker categories, room
 * category notes).
 */
function formPreferences(preferences: Tournament["preferences"] | undefined): Tournament["preferences"] {
  const { scheduleEvents: _schedule, speakerCategories, venueCategories: _venues, ...rest } = preferences ?? ({} as Tournament["preferences"]);
  void _schedule;
  void _venues;
  return {
    ...rest,
    speakerCategories: (speakerCategories ?? []).filter((category) => category.public === true),
  } as Tournament["preferences"];
}

interface FormRequest {
  action: "load" | "submit";
  kind: PublicFormKind;
  sourceType: PublicFormSourceType;
  sourceId: string;
  password: unknown;
  ballot: unknown;
  feedback: unknown;
}

function parseRequest(body: Record<string, unknown>): FormRequest | null {
  const { action, kind, sourceType, sourceId } = body;
  if (action !== "load" && action !== "submit") return null;
  if (kind !== "ballot" && kind !== "feedback") return null;
  if (sourceType !== "adjudicator" && sourceType !== "team") return null;
  if (kind === "ballot" && sourceType !== "adjudicator") return null;
  if (!validDocumentId(sourceId)) return null;
  return { action, kind, sourceType, sourceId, password: body.password, ballot: body.ballot, feedback: body.feedback };
}

/**
 * Public ballot and feedback forms (docs/public-pages-and-notifications.md, "Public forms").
 * `{action: "load" | "submit", kind: "ballot" | "feedback", sourceType, sourceId, password?,
 * ballot? | feedback?}`. Every request checks that the form is on, the tournament password when one
 * is required, and the rate limits; submissions are validated exactly like private-URL submissions.
 * Public ballots are always stored unconfirmed for the tab room to confirm (Tabbycat).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ error: "This submission is too large." }, 413);
  let parsed: FormRequest | null;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: "This submission is too large." }, 413);
    const body: unknown = JSON.parse(text);
    parsed = isRecord(body) ? parseRequest(body) : null;
  } catch {
    parsed = null;
  }
  if (!parsed) return json({ error: "Invalid request body." }, 400);
  const form = parsed;

  let firestore: Firestore;
  try {
    firestore = getAdminFirestore();
  } catch {
    return json({ error: "Public forms are not available on this server." }, 503);
  }
  const address = clientAddressFromHeaders(request.headers);

  try {
    const tournamentRef = await resolveTournamentBySlug(firestore, slug);
    if (!tournamentRef) return json({ error: "Tournament not found." }, 404);
    const clientIdentity = `${tournamentRef.id}:${address}`;
    const failures = await checkPrivateFailureLimit(firestore, clientIdentity, "public-form", MAX_FAILED_PASSWORDS);
    if (!failures.allowed) {
      return NextResponse.json(
        { error: "Too many incorrect passwords from this network. Try again later." },
        { status: 429, headers: { ...NO_STORE, "Retry-After": String(failures.retryAfterSeconds) } }
      );
    }

    const tournamentSnapshot = await tournamentRef.get();
    if (!tournamentSnapshot.exists) return json({ error: "Tournament not found." }, 404);
    const tournament = { ...tournamentSnapshot.data(), id: tournamentSnapshot.id } as Tournament;
    if (!isPublicFormEnabled(tournament.preferences, form.kind)) {
      return json({
        error: form.kind === "ballot"
          ? "This tournament does not take ballots through the public form."
          : "This tournament does not take feedback through the public form.",
      }, 403);
    }

    if (publicFormsRequirePassword(tournament.preferences)) {
      const stored = (await tournamentRef.collection("serverOnly").doc(PUBLIC_FORMS_PASSWORD_DOCUMENT).get()).data();
      if (!verifyPublicFormsPassword(stored?.password, form.password)) {
        await recordPrivateFailure(firestore, clientIdentity, "public-form", MAX_FAILED_PASSWORDS).catch((error) =>
          console.warn("Could not record a failed public form password:", error instanceof Error ? error.message : error)
        );
        return json({ error: "That password isn't correct.", passwordRequired: true }, 403);
      }
    }

    for (const [identity, scope, max] of [
      [clientIdentity, "public-form-address", PER_ADDRESS],
      [tournamentRef.id, "public-form-tournament", PER_TOURNAMENT],
    ] as const) {
      const limit = await checkPrivateApiRateLimit(firestore, identity, scope, max);
      if (!limit.allowed) {
        return NextResponse.json(
          { error: "Too many form requests right now. Try again later." },
          { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSeconds) } }
        );
      }
    }

    const sourceSnapshot = await tournamentRef
      .collection(form.sourceType === "adjudicator" ? "adjudicators" : "teams")
      .doc(form.sourceId)
      .get();
    const sourceData = sourceSnapshot.data();
    if (!sourceSnapshot.exists || !sourceData || typeof sourceData.deletedAt === "string") {
      return json({ error: "That participant was not found." }, 404);
    }
    const roundsSnapshot = await tournamentRef.collection("rounds").get();
    const roundsById = new Map(
      roundsSnapshot.docs
        .filter((document) => typeof document.data().deletedAt !== "string")
        .map((document) => [document.id, { ...document.data(), id: document.id } as Round])
    );

    if (form.kind === "ballot") {
      return await handleBallot({
        firestore,
        tournamentRef,
        tournament,
        form,
        adjudicator: { ...sourceData, id: sourceSnapshot.id } as Adjudicator,
        roundsById,
      });
    }
    return await handleFeedback({
      firestore,
      tournamentRef,
      tournament,
      form,
      source: { ...sourceData, id: sourceSnapshot.id } as { id: string; name?: string },
      roundsById,
    });
  } catch (error) {
    if (error instanceof PublicFormError) return json({ error: error.message }, error.status);
    console.error("Public form request failed:", error instanceof Error ? error.message : error);
    return json({ error: "Could not process the form. Try again later." }, 503);
  }
}

interface HandlerContext {
  firestore: Firestore;
  tournamentRef: DocumentReference;
  tournament: Tournament;
  form: FormRequest;
  roundsById: Map<string, Round>;
}

function teamNamer(tournament: Tournament) {
  const codes = publicUsesTeamCodeNames(getPublicSiteSettings(tournament.preferences).teamCodeNames);
  return (team: Pick<Team, "name" | "codeName"> | undefined, fallback = "") =>
    team ? (codes && hasCodeName(team) ? team.codeName!.trim() : team.name) : fallback;
}

async function handleBallot(context: HandlerContext & { adjudicator: Adjudicator }) {
  const { firestore, tournamentRef, tournament, form, adjudicator, roundsById } = context;
  const round = publicBallotRound([...roundsById.values()], tournament.preferences?.currentRoundId);
  if (!round) throw new PublicFormError("No round is open for ballots right now.", 409);
  const roundHasMotions = !(await tournamentRef.collection("motions").where("rounds", "array-contains", round.id).limit(1).get()).empty;
  const { debates } = await loadParticipantDebates(tournamentRef, adjudicator.id);
  const debate = selectPublicBallotDebate({ round, roundHasMotions, adjudicator, debates: debates.values() });
  const teams = await loadTeamsById(
    tournamentRef,
    Object.values(debate.teams || {}).flatMap((slot) => (slot?.teamId ? [slot.teamId] : []))
  );
  const nameOf = teamNamer(tournament);

  if (form.action === "load") {
    const showMotion = motionsVisible(round);
    const { motionId, motionText, adjudicators: panel, ...rest } = debate;
    return json({
      kind: "ballot",
      tournament: { id: tournament.id, name: tournament.name, format: tournament.format, preferences: formPreferences(tournament.preferences) },
      round: { id: round.id, name: round.name, seq: round.seq, ...(round.stage ? { stage: round.stage } : {}) },
      adjudicator: { id: adjudicator.id, name: adjudicator.name, isChair: panel?.chairId === adjudicator.id },
      debate: {
        id: rest.id,
        roundId: rest.roundId,
        roundSeq: rest.roundSeq,
        venueName: rest.venueName,
        sidesConfirmed: rest.sidesConfirmed,
        flags: rest.flags,
        teams: Object.fromEntries(
          Object.entries(rest.teams || {}).map(([side, slot]) => [
            side,
            slot ? { side: slot.side, teamId: slot.teamId, teamName: nameOf(teams.get(slot.teamId), slot.teamName) } : slot,
          ])
        ),
        // Ids only: the ballot needs the chair, and names may be code names publicly.
        adjudicators: {
          chairId: panel?.chairId,
          panellistIds: panel?.panellistIds ?? [],
          panellistNames: [],
          traineeIds: [],
          traineeNames: [],
        },
        ...(showMotion && motionId ? { motionId } : {}),
        ...(showMotion && motionText ? { motionText } : {}),
      },
      teams: [...teams.values()].map((team) => ({
        id: team.id,
        name: nameOf(team),
        speakers: (team.speakers || []).map((speaker) => ({ id: speaker.id, name: speaker.name })),
      })),
    });
  }

  if (!isRecord(form.ballot)) throw new PublicFormError("The ballot is invalid.");
  // The id and submitter come from the server, never from the form.
  let built: BallotSubmission;
  try {
    built = buildPrivateBallot(
      { ...form.ballot, id: `ballot-${debate.id}-adj-${adjudicator.id}-${randomUUID()}`, submitterType: "judge", submitterId: adjudicator.id },
      { tournament, adjudicator, debate, teams, tournamentId: tournament.id, round }
    );
  } catch (error) {
    // The same validation (and messages) as private-URL ballots.
    throw new PublicFormError(error instanceof Error ? error.message : "The ballot is invalid.");
  }
  // Anyone can open a public form, so a public ballot never confirms itself (Tabbycat): the tab
  // room confirms it. Individual-ballot rounds store it as the adjudicator's own sheet.
  const { confirmedBy: _confirmedBy, confirmedTimestamp: _confirmedTimestamp, ...unconfirmed } = built;
  void _confirmedBy;
  void _confirmedTimestamp;
  const individual = usesIndividualBallots(tournament, round);
  const ballot: BallotSubmission = { ...unconfirmed, confirmed: false, ...(individual ? { singleAdjudicator: true } : {}) };

  const ballotCollection = tournamentRef.collection("ballots");
  const written = await firestore.runTransaction(async (transaction) => {
    const snapshot: QuerySnapshot = await transaction.get(ballotCollection.where("debateId", "==", debate.id));
    const existing = snapshot.docs.map((document) => ({ id: document.id, data: document.data() as Partial<BallotSubmission> }));
    const existingByDebate = new Map([[debate.id, existing]]);
    const locked = new Set(isRoundLockedForPortalBallots(round) ? [debate.id] : []);
    const plan = individual
      ? planIndividualBallotWrites({
          submissions: [ballot],
          existingByDebate,
          lockedDebateIds: locked,
          debates: new Map([[debate.id, debate]]),
          rulesFor: () => ({ format: tournament.format, preferences: tournament.preferences, stage: round?.stage }),
          autoConfirm: false,
          timestamp: new Date().toISOString(),
        })
      : planPrivateBallotWrites([ballot], existingByDebate, locked);
    const existingById = new Map(existing.map((record) => [record.id, record.data]));
    for (const id of plan.discardExistingIds) {
      transaction.update(ballotCollection.doc(id), supersededBallotUpdate(existingById.get(id) ?? {}));
    }
    for (const write of plan.writes) transaction.set(ballotCollection.doc(write.id), write);
    return plan.writes;
  });

  await sendBallotReceipts({
    firestore,
    tournament,
    adjudicator: { id: adjudicator.id, name: adjudicator.name, email: adjudicator.email },
    ballots: written.filter((item) => item.discarded !== true && item.submitterId === adjudicator.id),
    debates: new Map([[debate.id, debate]]),
    rounds: roundsById,
  });
  return json({ received: true, confirmed: false });
}

async function handleFeedback(context: HandlerContext & { source: { id: string; name?: string } }) {
  const { tournamentRef, tournament, form, source, roundsById } = context;
  const { debates } = await loadParticipantDebates(tournamentRef, source.id);
  const teams = await loadTeamsById(
    tournamentRef,
    [...debates.values()].flatMap((debate) =>
      Object.values(debate.teams || {}).flatMap((slot) => (slot?.teamId ? [slot.teamId] : []))
    )
  );
  const nameOf = teamNamer(tournament);
  const feedbackContext = {
    preferences: tournament.preferences,
    sourceType: form.sourceType,
    sourceId: source.id,
    debates: [...debates.values()] as Debate[],
    roundsById,
    teamName: (teamId: string, drawnName: string | undefined) => nameOf(teams.get(teamId), drawnName ?? ""),
  };

  if (form.action === "load") {
    let options = publicFeedbackOptions(feedbackContext);
    // Participant code names (Tabbycat `participant_code_names` "everywhere"): the form shows the
    // code names; the stored record keeps the real name, as for private-URL feedback.
    if (getPublicSiteSettings(tournament.preferences).participantCodeNames === "everywhere") {
      const ids = [...new Set(options.filter((option) => option.targetType === "adjudicator").map((option) => option.targetId))];
      const snapshots = await Promise.all(ids.map((id) => tournamentRef.collection("adjudicators").doc(id).get()));
      const codeNames = new Map(snapshots.map((snapshot) => {
        const data = snapshot.data() as Partial<Adjudicator> | undefined;
        return [snapshot.id, data?.anonymous === true ? "" : data?.codeName?.trim() || ""];
      }));
      options = options.map((option) =>
        option.targetType === "adjudicator" ? { ...option, targetName: codeNames.get(option.targetId) ?? "" } : option
      );
    }
    return json({
      kind: "feedback",
      tournament: { id: tournament.id, name: tournament.name, format: tournament.format, preferences: formPreferences(tournament.preferences) },
      source: { type: form.sourceType, id: source.id, name: form.sourceType === "team" ? nameOf(teams.get(source.id), source.name ?? "") : source.name ?? "" },
      options,
    });
  }

  const feedback = buildPublicFeedback(form.feedback, {
    ...feedbackContext,
    tournamentId: tournament.id,
    sourceName: source.name ?? "",
    id: `feedback-public-${source.id}-${randomUUID()}`,
    timestamp: new Date().toISOString(),
  });
  await tournamentRef.collection("feedback").doc(feedback.id).set(feedback);
  return json({ received: true });
}

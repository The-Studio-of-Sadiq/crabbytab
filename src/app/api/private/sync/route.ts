import { NextRequest, NextResponse } from "next/server";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { Round, Tournament } from "@/types";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import {
  checkPrivateApiRateLimit,
  checkPrivateFailureLimit,
  clientAddressFromHeaders,
  recordPrivateFailure,
} from "@/lib/privateTeamRateLimit";
import { passcodesMatch } from "@/lib/passcode";
import { getPrivatePortalBallots, sanitizeTeamPrivateDebate } from "@/lib/privatePortalBallots";
import { loadBallotsForDebates } from "@/lib/privateParticipantData";
import { sendBallotReceipts } from "@/lib/email/notificationService";
import { parseSelfCheckInRequest, selfCheckInError, selfCheckInStatus } from "@/lib/selfCheckIn";
import { getPublicSiteSettings } from "@/lib/publicFeatures";
import {
  applyParticipantSubmissions,
  loadParticipantAssignments,
  type ParticipantSubmissionInput,
} from "@/lib/participantSubmissions";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validDocumentId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("/");
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    body = parsed;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { tournamentId, privateUrlKey, passcode } = body;
  const pending = body.pending === undefined ? [] : body.pending;
  const checkIn = parseSelfCheckInRequest(body.checkIn);
  if (
    checkIn === "invalid" ||
    !validDocumentId(tournamentId) ||
    typeof privateUrlKey !== "string" ||
    privateUrlKey.length === 0 ||
    privateUrlKey.length > 128 ||
    typeof passcode !== "string" ||
    passcode.length === 0 ||
    passcode.length > 128 ||
    !Array.isArray(pending) ||
    pending.length > 100
  ) {
    return NextResponse.json({ error: "Invalid private sync details." }, { status: 400 });
  }

  try {
    const firestore = getAdminFirestore();
    const clientIdentity = `${tournamentId}:${clientAddressFromHeaders(request.headers)}`;
    const failureLimit = await checkPrivateFailureLimit(firestore, clientIdentity, "sync");
    if (!failureLimit.allowed) {
      return NextResponse.json(
        { error: "Too many private sync requests. Try again later." },
        { status: 429, headers: { "Retry-After": String(failureLimit.retryAfterSeconds) } }
      );
    }
    const noteFailedAttempt = () => recordPrivateFailure(firestore, clientIdentity, "sync").catch((error) => {
      console.error("Could not record failed private sync attempt:", error);
    });
    const tournamentRef = firestore.collection("tournaments").doc(tournamentId);
    const tournamentSnapshot = await tournamentRef.get();
    if (!tournamentSnapshot.exists) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
    const tournament = {
      ...tournamentSnapshot.data(),
      id: tournamentSnapshot.id,
    } as Tournament;

    const [adjudicatorSnapshot, teamIdentitySnapshot] = await Promise.all([
      tournamentRef.collection("adjudicators").where("privateUrlKey", "==", privateUrlKey).get(),
      tournamentRef.collection("teams").where("privateUrlKey", "==", privateUrlKey).get(),
    ]);
    const adjudicatorDocument = adjudicatorSnapshot.docs.find(
      (document) => typeof document.data().deletedAt !== "string"
    );
    const adjudicator = adjudicatorDocument?.data();
    const teamDocument = teamIdentitySnapshot.docs.find(
      (document) => typeof document.data().deletedAt !== "string"
    );
    const team = teamDocument?.data();
    if (!adjudicatorDocument && !teamDocument) {
      await noteFailedAttempt();
      return NextResponse.json({ error: "Invalid private link or passcode." }, { status: 403 });
    }

    let rateLimit: Awaited<ReturnType<typeof checkPrivateApiRateLimit>>;
    try {
      rateLimit = await checkPrivateApiRateLimit(
        firestore,
        `${tournamentId}:${privateUrlKey}`,
        "sync"
      );
    } catch (error) {
      console.error("Could not enforce private sync rate limit:", error);
      return NextResponse.json(
        { error: "Could not process private sync request. Try again later." },
        { status: 503 }
      );
    }
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many private sync requests. Try again later." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      );
    }

    const actorType = passcodesMatch(adjudicator?.privatePasscode, passcode)
      ? "adjudicator"
      : passcodesMatch(team?.privatePasscode, passcode)
        ? "team"
        : null;
    const actorDocument = actorType === "adjudicator" ? adjudicatorDocument : teamDocument;
    const actor = actorType === "adjudicator" ? adjudicator : team;
    if (!actorType || !actorDocument || !actor) {
      await noteFailedAttempt();
      return NextResponse.json({ error: "Invalid private link or passcode." }, { status: 403 });
    }

    // Only this participant's debates in published draws, and their teams.
    const { roundById, assignedDebates, teams } = await loadParticipantAssignments(tournamentRef, actorType, actorDocument.id);
    if (checkIn) {
      const refusal = selfCheckInError(tournament.preferences, [...roundById.values()], checkIn);
      if (refusal) return NextResponse.json({ error: refusal }, { status: 403 });
    }

    const submitted = await applyParticipantSubmissions({
      firestore,
      tournamentRef,
      tournament,
      tournamentId,
      actorType,
      actorDocument,
      actor: actor as ParticipantSubmissionInput["actor"],
      assignedDebates,
      teams,
      roundById,
      pending: pending as unknown[],
    });
    if (!submitted.ok) return NextResponse.json({ error: submitted.error }, { status: submitted.status });
    const { uploadedCount, writtenBallots } = submitted;
    // Self check-in for the current round. The version bump makes a later upload of an older local
    // copy record a sync conflict instead of silently overwriting the participant's check-in.
    let actorAvailability = {
      checkedIn: actor.checkedIn,
      checkedInAt: actor.checkedInAt,
      roundAvailability: actor.roundAvailability,
      roundAvailabilityAt: actor.roundAvailabilityAt,
    };
    if (checkIn) {
      const checkedInAt = new Date().toISOString();
      await actorDocument.ref.update(
        new FieldPath("roundAvailability", checkIn.roundId),
        checkIn.available,
        new FieldPath("roundAvailabilityAt", checkIn.roundId),
        checkedInAt,
        "syncVersion",
        FieldValue.increment(1)
      );
      actorAvailability = {
        ...actorAvailability,
        roundAvailability: { ...(actor.roundAvailability || {}), [checkIn.roundId]: checkIn.available },
        roundAvailabilityAt: { ...(actor.roundAvailabilityAt || {}), [checkIn.roundId]: checkedInAt },
      };
    }

    if (writtenBallots.length > 0 && actorType === "adjudicator") {
      await sendBallotReceipts({
        firestore,
        tournament,
        adjudicator: { id: actorDocument.id, name: actor.name, email: actor.email },
        ballots: writtenBallots.filter((ballot) => ballot.discarded !== true),
        debates: assignedDebates,
        rounds: roundById,
      });
    }

    const [assignedBallots, feedbackSnapshot, roundsSnapshot] = await Promise.all([
      loadBallotsForDebates(tournamentRef, assignedDebates.keys()),
      tournamentRef.collection("feedback").where("sourceId", "==", actorDocument.id).get(),
      tournamentRef.collection("rounds").get(),
    ]);
    const allRounds = roundsSnapshot.docs.map((document) => ({
      ...document.data(),
      id: document.id,
    } as Round & { deletedAt?: string })).filter((round) => typeof round.deletedAt !== "string");
    const ballots = getPrivatePortalBallots(
      assignedBallots.filter((ballot) => assignedDebates.has(ballot.debateId)),
      allRounds,
      actorType,
      tournament.preferences?.publicResults !== false,
      getPublicSiteSettings(tournament.preferences).privateBallots
    );
    const feedback = feedbackSnapshot.docs.map((document) => ({
      ...document.data(),
      id: document.id,
    }));

    const assignedTeamIds = new Set(
      [...assignedDebates.values()].flatMap((debate) =>
        Object.values(debate.teams || {}).map((slot) => slot?.teamId).filter(Boolean)
      )
    );
    const assignedRoundIds = new Set(
      [...assignedDebates.values()].map((debate) => debate.roundId)
    );
    const privateTeams = [...teams.values()]
      .filter((team) => assignedTeamIds.has(team.id))
      .map((team) => {
        return {
          id: team.id,
          tournamentId,
          name: team.name,
          institutionName: team.institutionName,
          speakers: Array.isArray(team.speakers)
            ? team.speakers.map((speaker) => ({
                id: speaker.id,
                name: speaker.name,
                categories: speaker.categories,
              }))
            : [],
          breakCategories: team.breakCategories || [],
          speakerCategories: team.speakerCategories || [],
        };
      });
    const privateRounds = roundsSnapshot.docs
      .filter((document) => assignedRoundIds.has(document.id))
      .map((document) => ({ ...document.data(), id: document.id }));
    const safeAdjudicator = actorType === "adjudicator" && adjudicator ? {
      tournamentId,
      name: adjudicator.name,
      institutionId: adjudicator.institutionId,
      institutionName: adjudicator.institutionName,
      baseScore: adjudicator.baseScore,
      trainee: adjudicator.trainee,
      independent: adjudicator.independent,
      checkedIn: adjudicator.checkedIn,
      conflicts: [],
    } : undefined;
    const safeTeam = actorType === "team" ? {
      tournamentId,
      name: actor.name,
      institutionId: actor.institutionId,
      institutionName: actor.institutionName,
      speakers: Array.isArray(actor.speakers)
        ? actor.speakers.map((speaker: Record<string, unknown>) => ({
            id: speaker.id,
            name: speaker.name,
            categories: speaker.categories,
          }))
        : [],
      breakCategories: actor.breakCategories || [],
      speakerCategories: actor.speakerCategories || [],
      privateUrlKey,
      checkedIn: actor.checkedIn,
    } : undefined;

    const roundsById = new Map(allRounds.map((round) => [round.id, round]));
    const responseDebates = [...assignedDebates.values()].map((debate) =>
      actorType === "team"
        ? sanitizeTeamPrivateDebate(
            debate,
            roundsById.get(debate.roundId),
            tournament.preferences?.publicResults !== false
          )
        : debate
    );

    return NextResponse.json({
      uploadedCount,
      selfCheckIn: selfCheckInStatus(tournament.preferences, [...roundById.values()], actorAvailability),
      ballots,
      feedback,
      tournament: {
        id: tournament.id,
        name: tournament.name,
        shortName: tournament.shortName,
        slug: tournament.slug,
        format: tournament.format,
        preferences: tournament.preferences,
      },
      ...(safeAdjudicator ? { adjudicator: { ...safeAdjudicator, id: actorDocument.id, privateUrlKey } } : {}),
      ...(safeTeam ? { team: { ...safeTeam, id: actorDocument.id } } : {}),
      teams: privateTeams,
      rounds: privateRounds,
      debates: responseDebates,
    });
  } catch (error) {
    console.error("Private portal sync failed:", error);
    return NextResponse.json({ error: "Could not sync private portal data. Try again later." }, { status: 503 });
  }
}

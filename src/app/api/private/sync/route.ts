import { NextRequest, NextResponse } from "next/server";
import { FieldPath, FieldValue, type QuerySnapshot } from "firebase-admin/firestore";
import {
  Adjudicator,
  BallotSubmission,
  FeedbackSubmission,
  Round,
  Team,
  Tournament,
} from "@/types";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import {
  checkPrivateApiRateLimit,
  checkPrivateFailureLimit,
  clientAddressFromHeaders,
  recordPrivateFailure,
} from "@/lib/privateTeamRateLimit";
import { passcodesMatch } from "@/lib/passcode";
import { findTeamsByPrivateKey, matchPrivateTeamCredential } from "@/lib/privateSpeakerAccess";
import { buildPrivateBallot, privateUrlBallotsEnabled } from "@/lib/privateBallot";
import {
  filterParticipantVisibleDebates,
  isDrawVisibleToAdjudicators,
  getPrivatePortalBallots,
  sanitizeTeamPrivateDebate,
} from "@/lib/privatePortalBallots";
import { selectAssignedDebates, supersededBallotUpdate } from "@/lib/privateSync";
import { checkParticipantFeedback, planParticipantBallotWrites } from "@/lib/participantSubmissions";
import { applyPrivateBallotConfirmation } from "@/lib/privateIndividualBallots";
import { loadBallotsForDebates, loadParticipantDebates, loadPortalVenues, loadTeamsById } from "@/lib/privateParticipantData";
import { sendBallotReceipts } from "@/lib/email/notificationService";
import { parseSelfCheckInRequest, selfCheckInError, selfCheckInStatus } from "@/lib/selfCheckIn";
import { checkInEvent } from "@/lib/checkins/history";
import { getPublicSiteSettings } from "@/lib/publicFeatures";

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

    const [adjudicatorSnapshot, teamCandidates] = await Promise.all([
      tournamentRef.collection("adjudicators").where("privateUrlKey", "==", privateUrlKey).get(),
      // The team's own key, or one of its speakers' keys: either acts as that team only.
      findTeamsByPrivateKey(tournamentRef.collection("teams"), privateUrlKey),
    ]);
    const adjudicatorDocument = adjudicatorSnapshot.docs.find(
      (document) => typeof document.data().deletedAt !== "string"
    );
    const adjudicator = adjudicatorDocument?.data();
    const teamDocument = teamCandidates.length === 1 ? teamCandidates[0] : undefined;
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
      : matchPrivateTeamCredential(team, privateUrlKey, passcode)
        ? "team"
        : null;
    const actorDocument = actorType === "adjudicator" ? adjudicatorDocument : teamDocument;
    const actor = actorType === "adjudicator" ? adjudicator : team;
    if (!actorType || !actorDocument || !actor) {
      await noteFailedAttempt();
      return NextResponse.json({ error: "Invalid private link or passcode." }, { status: 403 });
    }

    // Only this participant's debates (via the debates' participant index) and their teams.
    const [{ debates: participantDebates }, feedbackRoundsSnapshot] = await Promise.all([
      loadParticipantDebates(tournamentRef, actorDocument.id),
      tournamentRef.collection("rounds").get(),
    ]);
    const roundById = new Map(
      feedbackRoundsSnapshot.docs
        .filter((document) => typeof document.data().deletedAt !== "string")
        .map((document) => [document.id, { ...document.data(), id: document.id } as Round])
    );
    if (checkIn) {
      const refusal = selfCheckInError(tournament.preferences, [...roundById.values()], checkIn);
      if (refusal) return NextResponse.json({ error: refusal }, { status: 403 });
    }

    // The index only narrows the read; assignment is checked from the debates themselves.
    const actorDebates = selectAssignedDebates(participantDebates, actorType, actorDocument.id);
    // Participants never see (or submit for) debates from unpublished draws; a teams-only release
    // reaches team portals but not adjudicators.
    const assignedDebates = new Map(
      filterParticipantVisibleDebates(actorDebates.values(), roundById, actorType).map((debate) => [debate.id, debate])
    );
    const teams: Map<string, Team> = await loadTeamsById(
      tournamentRef,
      [...assignedDebates.values()].flatMap((debate) =>
        Object.values(debate.teams || {}).flatMap((slot) => (slot?.teamId ? [slot.teamId] : []))
      )
    );

    const batch = firestore.batch();
    let uploadedCount = 0;
    const ballotSubmissions: BallotSubmission[] = [];
    for (const item of pending as unknown[]) {
      if (!isRecord(item) || !isRecord(item.record)) {
        return NextResponse.json({ error: "An offline submission is invalid." }, { status: 400 });
      }
      const collectionName = item.collection;
      const record = item.record;
      const debateId = record.debateId;
      if (
        (collectionName !== "ballots" && collectionName !== "feedback") ||
        !validDocumentId(record.id) ||
        typeof debateId !== "string" ||
        !assignedDebates.has(debateId)
      ) {
        return NextResponse.json({ error: "An offline submission is not valid for this adjudicator." }, { status: 403 });
      }

      if (collectionName === "ballots") {
        if (actorType !== "adjudicator") {
          return NextResponse.json({ error: "Teams cannot submit ballots." }, { status: 403 });
        }
        if (!privateUrlBallotsEnabled(tournament)) {
          return NextResponse.json(
            { error: "Ballot submission through private URLs is turned off for this tournament. Give your ballot to the tab room." },
            { status: 403 }
          );
        }
        const debate = assignedDebates.get(debateId)!;
        const canVote =
          !actor.trainee &&
          (debate.adjudicators?.chairId === actorDocument.id ||
            debate.adjudicators?.panellistIds?.includes(actorDocument.id));
        if (!canVote) {
          return NextResponse.json({ error: "Only the chair or a voting panellist may submit a ballot." }, { status: 403 });
        }
        let ballot: BallotSubmission;
        try {
          ballot = buildPrivateBallot(record, {
            tournament,
            adjudicator: { ...actor, id: actorDocument.id } as Adjudicator,
            debate,
            teams,
            tournamentId,
            round: roundById.get(debate.roundId),
          });
        } catch (error) {
          return NextResponse.json(
            { error: error instanceof Error ? error.message : "The ballot is invalid." },
            { status: 400 }
          );
        }
        ballotSubmissions.push(applyPrivateBallotConfirmation(ballot, tournament, roundById.get(debate.roundId)));
      } else {
        const debate = assignedDebates.get(debateId)!;
        const checked = checkParticipantFeedback(record, {
          tournament,
          tournamentId,
          participant: { type: actorType, id: actorDocument.id, name: actor.name },
          debate,
          round: roundById.get(debate.roundId),
          teams,
          id: record.id as string,
          timestamp: new Date().toISOString(),
        });
        if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: checked.status });
        const feedback = checked.feedback;
        const feedbackRef = tournamentRef.collection("feedback").doc(feedback.id);
        const existingFeedback = await feedbackRef.get();
        if (
          existingFeedback.exists &&
          existingFeedback.data()?.sourceId !== actorDocument.id
        ) {
          return NextResponse.json(
            { error: "The feedback identifier is already in use." },
            { status: 403 }
          );
        }
        batch.set(feedbackRef, feedback);
      }
      uploadedCount += 1;
    }

    let writtenBallots: BallotSubmission[] = [];
    if (ballotSubmissions.length > 0) {
      const ballotCollection = tournamentRef.collection("ballots");
      const committed = await firestore.runTransaction(async (transaction) => {
        const debateIds = [...new Set(ballotSubmissions.map((ballot) => ballot.debateId))];
        const existingBallotsByDebate = new Map<string, QuerySnapshot>();
        for (const debateId of debateIds) {
          const snapshot = await transaction.get(
            ballotCollection.where("debateId", "==", debateId)
          );
          existingBallotsByDebate.set(debateId, snapshot);
        }
        const existingSubmissions = await Promise.all(
          ballotSubmissions.map((ballot) => transaction.get(ballotCollection.doc(ballot.id)))
        );
        if (existingSubmissions.some(
          (snapshot) => snapshot.exists && snapshot.data()?.submitterId !== actorDocument.id
        )) {
          return false;
        }

        const existingByDebate = new Map(debateIds.map((debateId) => [
          debateId,
          existingBallotsByDebate.get(debateId)!.docs.map((document) => ({
            id: document.id,
            data: document.data() as Partial<BallotSubmission>,
          })),
        ]));
        const plan = planParticipantBallotWrites({
          submissions: ballotSubmissions,
          existingByDebate,
          debates: assignedDebates,
          roundById,
          tournament,
          timestamp: new Date().toISOString(),
        });
        const existingById = new Map(
          [...existingBallotsByDebate.values()].flatMap((snapshot) =>
            snapshot.docs.map((document) => [document.id, document.data() as Partial<BallotSubmission>] as const)
          )
        );
        for (const id of plan.discardExistingIds) {
          transaction.update(ballotCollection.doc(id), supersededBallotUpdate(existingById.get(id) ?? {}));
        }
        for (const ballot of plan.writes) {
          transaction.set(ballotCollection.doc(ballot.id), ballot);
        }
        writtenBallots = plan.writes;
        return true;
      });
      if (!committed) {
        return NextResponse.json(
          { error: "This ballot identifier belongs to another adjudicator." },
          { status: 403 }
        );
      }
    }

    if (uploadedCount > 0) await batch.commit();
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
        // Check-in history (lib/checkins/history.ts); self check-ins are rare, so not capped here.
        "checkInHistory",
        FieldValue.arrayUnion(checkInEvent({ available: checkIn.available, source: "self", roundId: checkIn.roundId, at: checkedInAt })),
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
        // Receipts cover what this adjudicator submitted, not a merge of the panel's sheets.
        ballots: writtenBallots.filter((ballot) => ballot.discarded !== true && ballot.submitterId === actorDocument.id),
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
    // Room links (online rooms, maps) for debates of rounds still running.
    const venues = await loadPortalVenues(
      tournamentRef,
      [...assignedDebates.values()].filter((debate) => roundsById.get(debate.roundId)?.completed !== true)
    );
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
      venues,
    });
  } catch (error) {
    console.error("Private portal sync failed:", error);
    return NextResponse.json({ error: "Could not sync private portal data. Try again later." }, { status: 503 });
  }
}

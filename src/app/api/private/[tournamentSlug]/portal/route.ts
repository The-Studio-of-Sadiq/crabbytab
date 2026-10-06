import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { DocumentReference, Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { Debate, DebateSide, FeedbackSubmission } from "@/types";

type PortalAction =
  | "team-check-in"
  | "adjudicator-check-in"
  | "team-feedback"
  | "adjudicator-feedback"
  | "ballot";

class PortalRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new PortalRequestError(`Invalid ${key}.`, 400);
  }
  return value;
}

function requiredNumber(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PortalRequestError(`Invalid ${key}.`, 400);
  }
  return value;
}

async function findTournament(db: Firestore, slug: string) {
  for (const id of [`tourn-${slug}`, slug]) {
    const snapshot = await db.collection("tournaments").doc(id).get();
    if (snapshot.exists) return snapshot;
  }

  const query = await db.collection("tournaments").where("slug", "==", slug).limit(1).get();
  return query.empty ? null : query.docs[0];
}

async function findPasscodeEntity(
  tournamentRef: DocumentReference,
  collectionName: "teams" | "adjudicators",
  passcode: string
) {
  const matches = await tournamentRef
    .collection(collectionName)
    .where("privateUrlKey", "==", passcode)
    .limit(1)
    .get();
  return matches.empty ? null : matches.docs[0];
}

function isAssignedAdjudicator(debate: Debate, adjudicatorId: string): boolean {
  const panel = debate.adjudicators;
  return Boolean(
    panel &&
      (panel.chairId === adjudicatorId ||
        panel.panellistIds?.includes(adjudicatorId) ||
        panel.traineeIds?.includes(adjudicatorId))
  );
}

async function submitFeedback(
  tournamentRef: DocumentReference,
  tournament: Record<string, unknown>,
  sourceType: "team" | "adjudicator",
  source: QueryDocumentSnapshot,
  payload: Record<string, unknown>
): Promise<FeedbackSubmission> {
  const roundId = requiredString(payload, "roundId");
  const debateId = requiredString(payload, "debateId");
  const targetAdjudicatorId = requiredString(payload, "targetAdjudicatorId");
  const score = requiredNumber(payload, "score");
  const preferences = isRecord(tournament.preferences) ? tournament.preferences : {};
  const minScore = typeof preferences.feedbackMinScore === "number" ? preferences.feedbackMinScore : 1;
  const maxScore = typeof preferences.feedbackMaxScore === "number" ? preferences.feedbackMaxScore : 10;

  if (preferences.feedbackEnabled === false) {
    throw new PortalRequestError("Feedback is disabled for this tournament.", 403);
  }
  if (score < minScore || score > maxScore) {
    throw new PortalRequestError(`Feedback score must be between ${minScore} and ${maxScore}.`, 400);
  }

  const [debateSnapshot, targetSnapshot] = await Promise.all([
    tournamentRef.collection("debates").doc(debateId).get(),
    tournamentRef.collection("adjudicators").doc(targetAdjudicatorId).get(),
  ]);
  if (!debateSnapshot.exists || !targetSnapshot.exists) {
    throw new PortalRequestError("The selected debate or adjudicator could not be found.", 404);
  }

  const debate = debateSnapshot.data() as Debate;
  if (debate.roundId !== roundId) {
    throw new PortalRequestError("The selected round does not match the debate.", 400);
  }
  const isInDebate = sourceType === "team"
    ? Object.values(debate.teams || {}).some((slot) => slot?.teamId === source.id)
    : isAssignedAdjudicator(debate, source.id);
  if (!isInDebate || !isAssignedAdjudicator(debate, targetAdjudicatorId)) {
    throw new PortalRequestError("This passcode is not eligible to submit feedback for that debate.", 403);
  }
  if (sourceType === "adjudicator" && targetAdjudicatorId === source.id) {
    throw new PortalRequestError("Adjudicators cannot submit feedback about themselves.", 400);
  }

  const comments = typeof payload.comments === "string" ? payload.comments.trim() : "";
  if (comments.length > 4000) {
    throw new PortalRequestError("Feedback comments cannot exceed 4000 characters.", 400);
  }
  const feedback: FeedbackSubmission = {
    id: `fb-${randomUUID()}`,
    tournamentId: tournamentRef.id,
    roundId,
    debateId,
    targetAdjudicatorId,
    targetAdjudicatorName: String(targetSnapshot.get("name") || ""),
    sourceType,
    sourceId: source.id,
    sourceName: String(source.get("name") || ""),
    score,
    agreeWithDecision: typeof payload.agreeWithDecision === "boolean" ? payload.agreeWithDecision : undefined,
    comments,
    confirmed: true,
    timestamp: new Date().toISOString(),
  };

  await tournamentRef.collection("feedback").doc(feedback.id).set(feedback);
  return feedback;
}

async function submitBallot(
  db: Firestore,
  tournamentRef: DocumentReference,
  adjudicator: QueryDocumentSnapshot,
  payload: Record<string, unknown>
) {
  const debateId = requiredString(payload, "debateId");
  const roundId = requiredString(payload, "roundId");
  const [debateSnapshot, roundSnapshot] = await Promise.all([
    tournamentRef.collection("debates").doc(debateId).get(),
    tournamentRef.collection("rounds").doc(roundId).get(),
  ]);
  if (!debateSnapshot.exists || !roundSnapshot.exists) {
    throw new PortalRequestError("The selected debate or round could not be found.", 404);
  }

  const debate = debateSnapshot.data() as Debate;
  if (debate.roundId !== roundId || debate.adjudicators?.chairId !== adjudicator.id) {
    throw new PortalRequestError("Only the assigned chair may submit this debate's ballot.", 403);
  }

  const speakerScoresInput = payload.speakerScores;
  const teamScoresInput = payload.teamScores;
  if (!isRecord(speakerScoresInput) || !isRecord(teamScoresInput)) {
    throw new PortalRequestError("The ballot is missing speaker or team scores.", 400);
  }

  const speakerScores: Record<string, Array<{
    speakerId: string;
    speakerName: string;
    position: number;
    score: number;
  }>> = {};
  const teamScores: Record<string, {
    side: DebateSide;
    teamId: string;
    points: number;
    totalSpeakerScore: number;
    win?: boolean;
    margin?: number;
    rank?: number;
  }> = {};
  const updatedTeams = { ...debate.teams };
  const tournamentTeams = tournamentRef.collection("teams");

  for (const [side, slot] of Object.entries(debate.teams || {})) {
    if (!slot?.teamId) continue;
    const submittedTeamScore = teamScoresInput[side];
    const submittedSpeakerScores = speakerScoresInput[side];
    if (!isRecord(submittedTeamScore) || !Array.isArray(submittedSpeakerScores)) {
      throw new PortalRequestError(`The ballot is missing scores for ${side}.`, 400);
    }

    const teamSnapshot = await tournamentTeams.doc(slot.teamId).get();
    if (!teamSnapshot.exists) {
      throw new PortalRequestError("A team in this debate could not be found.", 404);
    }
    const teamData = teamSnapshot.data() || {};
    const actualSpeakers = Array.isArray(teamData.speakers) ? teamData.speakers : [];
    const safeSpeakerScores = submittedSpeakerScores.map((entry) => {
      if (!isRecord(entry)) throw new PortalRequestError("Invalid speaker score entry.", 400);
      const speakerId = requiredString(entry, "speakerId");
      const speakerName = requiredString(entry, "speakerName");
      const score = requiredNumber(entry, "score");
      const position = requiredNumber(entry, "position");
      const actualSpeaker = actualSpeakers.find(
        (speaker) => isRecord(speaker) && speaker.id === speakerId
      );
      const placeholderPrefix = `spk-${side}-`;
      const placeholderIndex = speakerId.startsWith(placeholderPrefix)
        ? speakerId.slice(placeholderPrefix.length)
        : "";
      const isPortalPlaceholder =
        speakerId === `reply-${side}` || /^\d+$/.test(placeholderIndex);
      if (
        (!actualSpeaker && !isPortalPlaceholder) ||
        position < 1 ||
        position > 4 ||
        !Number.isInteger(position) ||
        (speakerId === `reply-${side}` && position !== 4) ||
        (speakerId.startsWith(placeholderPrefix) && position === 4) ||
        score < 0 ||
        score > 120 ||
        speakerName.length > 120
      ) {
        throw new PortalRequestError("A speaker score is invalid for this debate.", 400);
      }
      return {
        speakerId,
        speakerName: actualSpeaker ? String(actualSpeaker.name || "") : speakerName,
        position,
        score,
      };
    });
    const points = requiredNumber(submittedTeamScore, "points");
    const totalSpeakerScore = requiredNumber(submittedTeamScore, "totalSpeakerScore");
    const maxPoints = Object.keys(debate.teams).length === 4 ? 3 : 1;
    if (points < 0 || points > maxPoints || totalSpeakerScore < 0) {
      throw new PortalRequestError(`The team score for ${side} is invalid.`, 400);
    }

    const safeTeamScore = {
      side: side as DebateSide,
      teamId: slot.teamId,
      points,
      totalSpeakerScore,
      ...(typeof submittedTeamScore.win === "boolean" ? { win: submittedTeamScore.win } : {}),
      ...(typeof submittedTeamScore.margin === "number" && Number.isFinite(submittedTeamScore.margin)
        ? { margin: submittedTeamScore.margin }
        : {}),
      ...(typeof submittedTeamScore.rank === "number" &&
      Number.isInteger(submittedTeamScore.rank) &&
      submittedTeamScore.rank >= 1 &&
      submittedTeamScore.rank <= 4
        ? { rank: submittedTeamScore.rank }
        : {}),
    };
    speakerScores[side] = safeSpeakerScores;
    teamScores[side] = safeTeamScore;
    updatedTeams[side as DebateSide] = {
      ...slot,
      points,
      speakerScoreTotal:
        safeSpeakerScores.reduce((total, entry) => total + entry.score, 0) ||
        totalSpeakerScore ||
        slot.speakerScoreTotal,
    };
  }

  const now = new Date().toISOString();
  const ballot = {
    id: `ballot-${debateId}-private-${randomUUID()}`,
    tournamentId: tournamentRef.id,
    roundId,
    debateId,
    version: 1,
    confirmed: true,
    discarded: false,
    submitterType: "judge" as const,
    submitterId: adjudicator.id,
    submitterName: String(adjudicator.get("name") || ""),
    ...(typeof payload.motionId === "string" ? { motionId: payload.motionId } : {}),
    ...(typeof payload.motionText === "string" ? { motionText: payload.motionText } : {}),
    speakerScores,
    teamScores,
    chairId: adjudicator.id,
    timestamp: now,
    confirmedBy: String(adjudicator.get("name") || ""),
    confirmedTimestamp: now,
  };
  const updatedDebate: Debate = {
    ...debate,
    resultStatus: "confirmed",
    teams: updatedTeams,
  };

  const ballots = await tournamentRef.collection("ballots").where("debateId", "==", debateId).get();
  const batch = db.batch();
  batch.set(tournamentRef.collection("ballots").doc(ballot.id), ballot);
  ballots.docs.forEach((snapshot) => {
    batch.update(snapshot.ref, { confirmed: false, discarded: true });
  });
  batch.update(debateSnapshot.ref, {
    resultStatus: "confirmed",
    teams: updatedTeams,
  });
  const round = roundSnapshot.data() || {};
  if (round.resultsReleased || round.teamSpeaksReleased) {
    batch.update(roundSnapshot.ref, {
      resultsReleased: false,
      teamSpeaksReleased: false,
    });
  }
  await batch.commit();

  return { ballot, debate: updatedDebate };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tournamentSlug: string }> }
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const passcode = typeof body.passcode === "string" ? body.passcode : "";
  const action = body.action as PortalAction;
  const payload = isRecord(body.payload) ? body.payload : {};
  if (passcode.length < 12 || passcode.length > 32) {
    return NextResponse.json({ error: "A valid private passcode is required." }, { status: 401 });
  }
  if (
    !["team-check-in", "adjudicator-check-in", "team-feedback", "adjudicator-feedback", "ballot"]
      .includes(action)
  ) {
    return NextResponse.json({ error: "Unsupported participant action." }, { status: 400 });
  }

  try {
    const { tournamentSlug } = await params;
    const db = getAdminFirestore();
    const tournamentSnapshot = await findTournament(db, tournamentSlug);
    if (!tournamentSnapshot) {
      throw new PortalRequestError("Tournament not found.", 404);
    }
    const tournamentRef = tournamentSnapshot.ref;
    const tournament = tournamentSnapshot.data() || {};

    if (action === "team-check-in" || action === "team-feedback") {
      const team = await findPasscodeEntity(tournamentRef, "teams", passcode);
      if (!team) throw new PortalRequestError("Invalid team passcode.", 401);

      if (action === "team-check-in") {
        if (typeof payload.checkedIn !== "boolean") {
          throw new PortalRequestError("Invalid check-in value.", 400);
        }
        await team.ref.update({ checkedIn: payload.checkedIn });
        return NextResponse.json({ checkedIn: payload.checkedIn });
      }

      const feedback = await submitFeedback(tournamentRef, tournament, "team", team, payload);
      return NextResponse.json({ feedback }, { status: 201 });
    }

    const adjudicator = await findPasscodeEntity(tournamentRef, "adjudicators", passcode);
    if (!adjudicator) throw new PortalRequestError("Invalid adjudicator passcode.", 401);

    if (action === "adjudicator-check-in") {
      if (typeof payload.checkedIn !== "boolean") {
        throw new PortalRequestError("Invalid check-in value.", 400);
      }
      await adjudicator.ref.update({ checkedIn: payload.checkedIn });
      return NextResponse.json({ checkedIn: payload.checkedIn });
    }
    if (action === "adjudicator-feedback") {
      const feedback = await submitFeedback(tournamentRef, tournament, "adjudicator", adjudicator, payload);
      return NextResponse.json({ feedback }, { status: 201 });
    }

    const result = await submitBallot(db, tournamentRef, adjudicator, payload);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof PortalRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Participant portal action failed:", error);
    return NextResponse.json(
      { error: "Unable to save this participant action. Please try again." },
      { status: 503 }
    );
  }
}

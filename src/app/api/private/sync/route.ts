import { NextRequest, NextResponse } from "next/server";
import type { QuerySnapshot } from "firebase-admin/firestore";
import {
  Adjudicator,
  BallotSubmission,
  Debate,
  FeedbackSubmission,
  Round,
  Team,
  Tournament,
} from "@/types";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { checkPrivateApiRateLimit } from "@/lib/privateTeamRateLimit";
import { buildPrivateBallot } from "@/lib/privateBallot";
import { getPrivatePortalBallots, sanitizeTeamPrivateDebate } from "@/lib/privatePortalBallots";
import { validateFeedbackScore } from "@/lib/scoring/validator";
import {
  canSubmitParticipantFeedback,
  isFeedbackAnswerRecord,
  isFeedbackEnabledForRound,
  questionsForFeedbackSource,
  validateFeedbackAnswers,
} from "@/lib/feedback/questions";

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
  if (
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

    const actorType = adjudicator?.privatePasscode === passcode
      ? "adjudicator"
      : team?.privatePasscode === passcode
        ? "team"
        : null;
    const actorDocument = actorType === "adjudicator" ? adjudicatorDocument : teamDocument;
    const actor = actorType === "adjudicator" ? adjudicator : team;
    if (!actorType || !actorDocument || !actor) {
      return NextResponse.json({ error: "Invalid private link or passcode." }, { status: 403 });
    }

    const [teamsSnapshot, debatesSnapshot] = await Promise.all([
      tournamentRef.collection("teams").get(),
      tournamentRef.collection("debates").get(),
    ]);
    const feedbackRoundsSnapshot = await tournamentRef.collection("rounds").get();
    const roundById = new Map(
      feedbackRoundsSnapshot.docs
        .filter((document) => typeof document.data().deletedAt !== "string")
        .map((document) => [document.id, { ...document.data(), id: document.id } as Round])
    );
    const allDebates = new Map<string, Debate>(
      debatesSnapshot.docs
        .filter((document) => typeof document.data().deletedAt !== "string")
        .map((document) => [
          document.id,
          { ...document.data(), id: document.id } as Debate,
        ] as const)
    );
    const teams = new Map<string, Team>(
      teamsSnapshot.docs
        .filter((document) => typeof document.data().deletedAt !== "string")
        .map((document) => [
          document.id,
          { ...document.data(), id: document.id } as Team,
        ] as const)
    );
    const assignedDebates = new Map(
      debatesSnapshot.docs
        .map((document) => [document.id, allDebates.get(document.id)!] as const)
        .filter(([, debate]) => actorType === "adjudicator"
          ? debate.adjudicators?.chairId === actorDocument.id ||
            debate.adjudicators?.panellistIds?.includes(actorDocument.id) ||
            debate.adjudicators?.traineeIds?.includes(actorDocument.id)
          : Object.values(debate.teams || {}).some((slot) => slot?.teamId === actorDocument.id))
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
          });
        } catch (error) {
          return NextResponse.json(
            { error: error instanceof Error ? error.message : "The ballot is invalid." },
            { status: 400 }
          );
        }
        ballotSubmissions.push(ballot);
      } else {
        const debate = assignedDebates.get(debateId)!;
        const panel = debate.adjudicators;
        const targetType = record.targetType === undefined
          ? "adjudicator"
          : record.targetType === "adjudicator" || record.targetType === "team"
            ? record.targetType
            : undefined;
        if (!targetType) {
          return NextResponse.json({ error: "Feedback target type is invalid." }, { status: 400 });
        }
        const targetAdjudicatorId = typeof record.targetAdjudicatorId === "string"
          ? record.targetAdjudicatorId
          : undefined;
        const targetTeamId = typeof record.targetTeamId === "string"
          ? record.targetTeamId
          : undefined;
        const score = record.score;
        const answers = record.answers === undefined ? {} : record.answers;
        const targetAdjudicatorIsAssigned =
          typeof targetAdjudicatorId === "string" &&
          (panel.chairId === targetAdjudicatorId ||
            panel.panellistIds?.includes(targetAdjudicatorId) ||
            panel.traineeIds?.includes(targetAdjudicatorId));
        const targetTeamSlot = typeof targetTeamId === "string"
          ? Object.values(debate.teams || {}).find((slot) => slot?.teamId === targetTeamId)
          : undefined;
        const sourceIsAuthorized =
          record.sourceType === actorType &&
          record.sourceId === actorDocument.id &&
          (actorType === "adjudicator" || Object.values(debate.teams || {}).some((slot) => slot?.teamId === actorDocument.id));
        const targetIsAuthorized = targetType === "adjudicator"
          ? targetAdjudicatorIsAssigned && targetAdjudicatorId !== actorDocument.id
          : targetType === "team" && Boolean(targetTeamSlot) &&
            (actorType !== "team" || targetTeamId !== actorDocument.id);
        const targetId = targetType === "adjudicator" ? targetAdjudicatorId : targetTeamId;
        const targetIsChair = Boolean(targetAdjudicatorId && panel.chairId === targetAdjudicatorId);
        const feedbackAllowed = canSubmitParticipantFeedback({
          sourceType: actorType,
          sourceId: actorDocument.id,
          sourceIsChair: actorType === "adjudicator" && panel.chairId === actorDocument.id,
          targetType,
          targetId: targetId || "",
          targetIsChair,
          path: tournament.preferences?.feedbackPath || "two_way",
        });
        const round = roundById.get(debate.roundId);
        if (
          !sourceIsAuthorized ||
          !targetIsAuthorized ||
          !feedbackAllowed ||
          tournament.preferences?.feedbackEnabled === false ||
          !isFeedbackEnabledForRound(
            debate,
            round,
            tournament.preferences?.feedbackInEliminationRounds !== false
          )
        ) {
          return NextResponse.json({ error: "Feedback does not match this participant or debate." }, { status: 403 });
        }
        if (
          typeof score !== "number" ||
          !validateFeedbackScore(score, tournament.preferences).valid ||
          (record.comments !== undefined &&
            (typeof record.comments !== "string" || record.comments.length > 5000)) ||
          (record.agreeWithDecision !== undefined && typeof record.agreeWithDecision !== "boolean") ||
          !isFeedbackAnswerRecord(answers) ||
          Boolean(validateFeedbackAnswers(
            questionsForFeedbackSource(actorType, tournament.preferences),
            answers
          ))
        ) {
          return NextResponse.json({ error: "Feedback contains invalid details." }, { status: 400 });
        }
        const feedback: FeedbackSubmission = {
          id: record.id,
          tournamentId,
          roundId: debate.roundId,
          debateId: debate.id,
          targetType,
          ...(targetType === "adjudicator" ? {
            targetAdjudicatorId: targetAdjudicatorId!,
            targetAdjudicatorName:
              panel.chairId === targetAdjudicatorId
                ? panel.chairName || ""
                : panel.panellistIds?.includes(targetAdjudicatorId as string)
                  ? panel.panellistNames?.[panel.panellistIds.indexOf(targetAdjudicatorId as string)] || ""
                  : panel.traineeNames?.[panel.traineeIds?.indexOf(targetAdjudicatorId as string) ?? -1] || "",
          } : {
            targetTeamId: targetTeamId!,
            targetTeamName: teams.get(targetTeamId as string)?.name || targetTeamSlot?.teamName || "",
          }),
          sourceType: actorType,
          sourceId: actorDocument.id,
          sourceName: actor.name,
          score,
          ...(typeof record.agreeWithDecision === "boolean"
            ? { agreeWithDecision: record.agreeWithDecision }
            : {}),
          ...(typeof record.comments === "string" ? { comments: record.comments } : {}),
          ...(Object.keys(answers).length > 0 ? { answers } : {}),
          confirmed: true,
          timestamp: new Date().toISOString(),
        };
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

        const pendingIdsToDiscard = new Set<string>();
        for (const debateId of debateIds) {
          const group = ballotSubmissions.filter((ballot) => ballot.debateId === debateId);
          const finalChairIndex = group.reduce(
            (lastIndex, ballot, index) => ballot.confirmed ? index : lastIndex,
            -1
          );
          if (finalChairIndex >= 0) {
            group.slice(0, finalChairIndex).forEach((ballot) => pendingIdsToDiscard.add(ballot.id));
            for (const existing of existingBallotsByDebate.get(debateId)!.docs) {
              if (existing.data().discarded !== true) {
                transaction.update(existing.ref, {
                  confirmed: false,
                  discarded: true,
                });
              }
            }
          }
        }

        const nextVersionByDebate = new Map<string, number>();
        for (const debateId of debateIds) {
          const currentVersion = existingBallotsByDebate.get(debateId)!.docs.reduce(
            (version, document) =>
              Math.max(version, Number(document.data().version) || 0),
            0
          );
          nextVersionByDebate.set(debateId, currentVersion);
        }
        for (const ballot of ballotSubmissions) {
          const version = (nextVersionByDebate.get(ballot.debateId) || 0) + 1;
          nextVersionByDebate.set(ballot.debateId, version);
          const discarded = pendingIdsToDiscard.has(ballot.id);
          transaction.set(ballotCollection.doc(ballot.id), {
            ...ballot,
            version,
            confirmed: ballot.confirmed && !discarded,
            discarded,
          });
        }
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

    const [ballotsSnapshot, feedbackSnapshot, roundsSnapshot] = await Promise.all([
      tournamentRef.collection("ballots").get(),
      tournamentRef.collection("feedback").where("sourceId", "==", actorDocument.id).get(),
      tournamentRef.collection("rounds").get(),
    ]);
    const allRounds = roundsSnapshot.docs.map((document) => ({
      ...document.data(),
      id: document.id,
    } as Round & { deletedAt?: string })).filter((round) => typeof round.deletedAt !== "string");
    const ballots = getPrivatePortalBallots(ballotsSnapshot.docs
      .filter((document) =>
        typeof document.data().deletedAt !== "string" &&
        assignedDebates.has(document.data().debateId)
      )
      .map((document) => ({ ...document.data(), id: document.id } as BallotSubmission)),
      allRounds,
      actorType,
      tournament.preferences?.publicResults !== false
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
    const privateTeams = teamsSnapshot.docs
      .filter((document) => assignedTeamIds.has(document.id))
      .map((document) => {
        const team = document.data();
        return {
          id: document.id,
          tournamentId,
          name: team.name,
          institutionName: team.institutionName,
          speakers: Array.isArray(team.speakers)
            ? team.speakers.map((speaker: Record<string, unknown>) => ({
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

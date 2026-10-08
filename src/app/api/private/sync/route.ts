import { NextRequest, NextResponse } from "next/server";
import {
  Adjudicator,
  BallotSubmission,
  Debate,
  FeedbackSubmission,
  Team,
  Tournament,
} from "@/types";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { buildPrivateBallot } from "@/lib/privateBallot";
import { validateFeedbackScore } from "@/lib/scoring/validator";

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

    const [adjudicatorSnapshot, teamsSnapshot, debatesSnapshot] = await Promise.all([
      tournamentRef.collection("adjudicators").where("privateUrlKey", "==", privateUrlKey).limit(1).get(),
      tournamentRef.collection("teams").get(),
      tournamentRef.collection("debates").get(),
    ]);
    const adjudicatorDocument = adjudicatorSnapshot.docs[0];
    const adjudicator = adjudicatorDocument?.data();
    const teamDocument = teamsSnapshot.docs.find((document) => document.data().privateUrlKey === privateUrlKey);
    const team = teamDocument?.data();
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

    const [
      /* snapshots already fetched above */
    ] = [];
    /*
      tournamentRef.collection("debates").get(),
      tournamentRef.collection("teams").get(),
    ]);
    */
    const allDebates = new Map(
      debatesSnapshot.docs.map((document) => [
        document.id,
        { ...document.data(), id: document.id } as Debate,
      ])
    );
    const teams = new Map(
      teamsSnapshot.docs.map((document) => [
        document.id,
        { ...document.data(), id: document.id } as Team,
      ])
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
    const existingBallotsSnapshot = await tournamentRef.collection("ballots").get();
    let uploadedCount = 0;
    const pendingBallotByDebate = new Map<string, BallotSubmission>();
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
        const previousVersion = existingBallotsSnapshot.docs
          .filter((document) => document.data().debateId === ballot.debateId)
          .reduce((version, document) => Math.max(version, Number(document.data().version) || 0), 0);
        ballot.version = previousVersion + 1;
        for (const existing of existingBallotsSnapshot.docs) {
          if (existing.data().debateId === ballot.debateId && existing.id !== ballot.id) {
            batch.set(existing.ref, {
              ...existing.data(),
              confirmed: false,
              discarded: true,
            });
          }
        }
        const previousPendingBallot = pendingBallotByDebate.get(ballot.debateId);
        if (previousPendingBallot && previousPendingBallot.id !== ballot.id) {
          batch.set(tournamentRef.collection("ballots").doc(previousPendingBallot.id), {
            ...previousPendingBallot,
            confirmed: false,
            discarded: true,
          });
        }
        pendingBallotByDebate.set(ballot.debateId, ballot);
        batch.set(tournamentRef.collection("ballots").doc(ballot.id), {
          ...ballot,
        });
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
        if (
          !sourceIsAuthorized ||
          !targetIsAuthorized
        ) {
          return NextResponse.json({ error: "Feedback does not match this participant or debate." }, { status: 403 });
        }
        if (
          typeof score !== "number" ||
          !validateFeedbackScore(score, tournament.preferences).valid ||
          (record.comments !== undefined &&
            (typeof record.comments !== "string" || record.comments.length > 5000)) ||
          (record.agreeWithDecision !== undefined && typeof record.agreeWithDecision !== "boolean")
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
          ...(isRecord(record.answers) ? { answers: record.answers } : {}),
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

    if (uploadedCount > 0) await batch.commit();

    const [ballotsSnapshot, feedbackSnapshot] = await Promise.all([
      tournamentRef.collection("ballots").get(),
      tournamentRef.collection("feedback").where("sourceId", "==", actorDocument.id).get(),
    ]);
    const ballots = ballotsSnapshot.docs
      .filter((document) => assignedDebates.has(document.data().debateId))
      .map((document) => ({ ...document.data(), id: document.id }));
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
    const privateRounds = (await tournamentRef.collection("rounds").get()).docs
      .filter((document) => assignedRoundIds.has(document.id))
      .map((document) => ({ ...document.data(), id: document.id }));
    const safeAdjudicator = actorType === "adjudicator" ? {
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
      debates: [...assignedDebates.values()],
    });
  } catch (error) {
    console.error("Private portal sync failed:", error);
    return NextResponse.json({ error: "Could not sync private portal data. Try again later." }, { status: 503 });
  }
}

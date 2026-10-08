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
    privateUrlKey.length > 128 ||
    typeof passcode !== "string" ||
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

    const adjudicatorSnapshot = await tournamentRef
      .collection("adjudicators")
      .where("privateUrlKey", "==", privateUrlKey)
      .limit(1)
      .get();
    const adjudicatorDocument = adjudicatorSnapshot.docs[0];
    const adjudicator = adjudicatorDocument?.data();
    if (!adjudicator || adjudicator.privatePasscode !== passcode) {
      return NextResponse.json({ error: "Invalid adjudicator link or passcode." }, { status: 403 });
    }

    const [debatesSnapshot, teamsSnapshot] = await Promise.all([
      tournamentRef.collection("debates").get(),
      tournamentRef.collection("teams").get(),
    ]);
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
        .filter(([, debate]) => {
          const panel = debate.adjudicators || {};
          return (
            panel.chairId === adjudicatorDocument.id ||
            panel.panellistIds?.includes(adjudicatorDocument.id) ||
            panel.traineeIds?.includes(adjudicatorDocument.id)
          );
        })
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
        const debate = assignedDebates.get(debateId)!;
        const canVote =
          !adjudicator.trainee &&
          (debate.adjudicators?.chairId === adjudicatorDocument.id ||
            debate.adjudicators?.panellistIds?.includes(adjudicatorDocument.id));
        if (!canVote) {
          return NextResponse.json({ error: "Only the chair or a voting panellist may submit a ballot." }, { status: 403 });
        }
        let ballot: BallotSubmission;
        try {
          ballot = buildPrivateBallot(record, {
            tournament,
            adjudicator: { ...adjudicator, id: adjudicatorDocument.id } as Adjudicator,
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
        const targetAdjudicatorId = record.targetAdjudicatorId;
        const score = record.score;
        const targetIsAssigned =
          typeof targetAdjudicatorId === "string" &&
          (panel.chairId === targetAdjudicatorId ||
            panel.panellistIds?.includes(targetAdjudicatorId) ||
            panel.traineeIds?.includes(targetAdjudicatorId));
        if (
          record.sourceType !== "adjudicator" ||
          record.sourceId !== adjudicatorDocument.id ||
          !targetIsAssigned
        ) {
          return NextResponse.json({ error: "Feedback does not match this adjudicator or debate." }, { status: 403 });
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
          targetAdjudicatorId,
          targetAdjudicatorName:
            panel.chairId === targetAdjudicatorId
              ? panel.chairName || ""
              : panel.panellistIds?.includes(targetAdjudicatorId)
                ? panel.panellistNames?.[panel.panellistIds.indexOf(targetAdjudicatorId)] || ""
                : panel.traineeNames?.[panel.traineeIds?.indexOf(targetAdjudicatorId) ?? -1] || "",
          sourceType: "adjudicator",
          sourceId: adjudicatorDocument.id,
          sourceName: adjudicator.name,
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
          existingFeedback.data()?.sourceId !== adjudicatorDocument.id
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
      tournamentRef.collection("feedback").where("sourceId", "==", adjudicatorDocument.id).get(),
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
    const safeAdjudicator = {
      tournamentId,
      name: adjudicator.name,
      institutionId: adjudicator.institutionId,
      institutionName: adjudicator.institutionName,
      baseScore: adjudicator.baseScore,
      trainee: adjudicator.trainee,
      independent: adjudicator.independent,
      checkedIn: adjudicator.checkedIn,
      conflicts: [],
    };

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
      adjudicator: { ...safeAdjudicator, id: adjudicatorDocument.id, privateUrlKey },
      teams: privateTeams,
      rounds: privateRounds,
      debates: [...assignedDebates.values()],
    });
  } catch (error) {
    console.error("Private portal sync failed:", error);
    return NextResponse.json({ error: "Could not sync private portal data. Try again later." }, { status: 503 });
  }
}

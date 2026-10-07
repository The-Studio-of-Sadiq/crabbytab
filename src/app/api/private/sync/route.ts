import { NextRequest, NextResponse } from "next/server";
import { BallotSubmission, FeedbackSubmission } from "@/types";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

interface PendingItem {
  collection: "ballots" | "feedback";
  record: BallotSubmission | FeedbackSubmission;
}

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
    const tournament = await tournamentRef.get();
    if (!tournament.exists) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });

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

    const debatesSnapshot = await tournamentRef.collection("debates").get();
    const assignedDebates = new Map(
      debatesSnapshot.docs
        .map((document) => [document.id, document.data()] as const)
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
      const { collection: collectionName, record } = item as unknown as PendingItem;
      if (
        (collectionName !== "ballots" && collectionName !== "feedback") ||
        !validDocumentId(record.id) ||
        !assignedDebates.has(record.debateId)
      ) {
        return NextResponse.json({ error: "An offline submission is not valid for this adjudicator." }, { status: 403 });
      }

      if (collectionName === "ballots") {
        const ballot = record as BallotSubmission;
        if (
          ballot.submitterType !== "judge" ||
          ballot.submitterId !== adjudicatorDocument.id ||
          ballot.debateId !== record.debateId
        ) {
          return NextResponse.json({ error: "A ballot does not match this adjudicator." }, { status: 403 });
        }
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
          tournamentId,
        });
      } else {
        const feedback = record as FeedbackSubmission;
        const debate = assignedDebates.get(feedback.debateId);
        const panel = debate?.adjudicators || {};
        const targetIsAssigned =
          panel.chairId === feedback.targetAdjudicatorId ||
          panel.panellistIds?.includes(feedback.targetAdjudicatorId) ||
          panel.traineeIds?.includes(feedback.targetAdjudicatorId);
        if (
          feedback.sourceType !== "adjudicator" ||
          feedback.sourceId !== adjudicatorDocument.id ||
          !targetIsAssigned
        ) {
          return NextResponse.json({ error: "Feedback does not match this adjudicator or debate." }, { status: 403 });
        }
        batch.set(tournamentRef.collection("feedback").doc(feedback.id), {
          ...feedback,
          tournamentId,
        });
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

    return NextResponse.json({ uploadedCount, ballots, feedback });
  } catch (error) {
    console.error("Private portal sync failed:", error);
    return NextResponse.json({ error: "Could not sync private portal data. Try again later." }, { status: 503 });
  }
}

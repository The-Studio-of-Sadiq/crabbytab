import { NextRequest, NextResponse } from "next/server";
import type { BallotSubmission, Debate, Round } from "@/types";
import { AssistantConfirmationError, planAssistantConfirmation } from "@/lib/assistantBallotConfirmation";
import { isRecord, validDataEntryId } from "@/lib/dataEntrySync";
import { authorizeDataEntryStaff, currentDataEntryPermissions, DataEntryAccessChangedError } from "@/lib/staffAccessServer";
import { assertStaffPermission, StaffPermissionError } from "@/lib/staffPermissions";

export const runtime = "nodejs";

/**
 * Data-entry staff confirming a ballot someone else entered (docs/staff-access.md).
 *
 * `{ action: "confirm", ballotId, version }` confirms the pending version (review checks);
 * `{ action: "check", ballotId, version, entry }` confirms it only when the assistant's blind
 * re-entry matches it, and otherwise answers 409 with the differences. Requires the
 * "results.confirm_others" permission, re-checked in the transaction that writes.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params;
  if (!validDataEntryId(tournamentId)) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  const authorization = await authorizeDataEntryStaff(request, tournamentId);
  if ("error" in authorization) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (
    !isRecord(body) ||
    (body.action !== "confirm" && body.action !== "check") ||
    !validDataEntryId(body.ballotId) ||
    typeof body.version !== "number" ||
    !Number.isInteger(body.version) ||
    (body.action === "check" && !isRecord(body.entry))
  ) {
    return NextResponse.json({ error: "Invalid ballot confirmation request." }, { status: 400 });
  }
  const ballotId = body.ballotId;
  const version = body.version;
  const reentry = body.action === "check" ? (body.entry as Record<string, unknown>) : undefined;

  try {
    assertStaffPermission(authorization.permissions, "results.confirm_others");
    const { firestore, tournamentRef, tournament, user, actorName } = authorization;
    const ballots = tournamentRef.collection("ballots");
    const result = await firestore.runTransaction(async (transaction) => {
      assertStaffPermission(await currentDataEntryPermissions(transaction, authorization), "results.confirm_others");
      const ballotSnapshot = await transaction.get(ballots.doc(ballotId));
      const ballotData = ballotSnapshot.data();
      if (!ballotSnapshot.exists || typeof ballotData?.deletedAt === "string" || typeof ballotData?.debateId !== "string") {
        throw new AssistantConfirmationError("That ballot no longer exists.", 404);
      }
      const debateId = ballotData.debateId;
      const [debateSnapshot, debateBallotsSnapshot] = await Promise.all([
        transaction.get(tournamentRef.collection("debates").doc(debateId)),
        transaction.get(ballots.where("debateId", "==", debateId)),
      ]);
      const debateData = debateSnapshot.data();
      const debate = debateSnapshot.exists && typeof debateData?.deletedAt !== "string"
        ? ({ ...debateData, id: debateSnapshot.id } as Debate)
        : undefined;
      const roundSnapshot = debate ? await transaction.get(tournamentRef.collection("rounds").doc(debate.roundId)) : null;
      const roundData = roundSnapshot?.data();
      const round = roundSnapshot?.exists && typeof roundData?.deletedAt !== "string"
        ? ({ ...roundData, id: roundSnapshot.id } as Round)
        : undefined;
      const debateBallots = debateBallotsSnapshot.docs
        .filter((document) => typeof document.data().deletedAt !== "string")
        .map((document) => ({ ...document.data(), id: document.id }) as BallotSubmission & { syncVersion?: number });
      const plan = await planAssistantConfirmation({
        ballotId,
        version,
        reentry: reentry as AssistantConfirmationInputEntry | undefined,
        debateBallots,
        debate,
        round,
        actor: { uid: user.uid, name: actorName },
        format: tournament.format,
        timestamp: new Date().toISOString(),
      });
      // Every write moves the sync version on, so a device holding an older copy gets a conflict.
      const written = plan.ballots.map((item) => ({
        ...item,
        syncVersion: (Number((item as { syncVersion?: number }).syncVersion) || 0) + 1,
      }));
      for (const item of written) transaction.set(ballots.doc(item.id), item);
      const nextDebate = {
        ...plan.debate,
        syncVersion: (Number((debate as { syncVersion?: number } | undefined)?.syncVersion) || 0) + 1,
      };
      transaction.set(tournamentRef.collection("debates").doc(nextDebate.id), nextDebate);
      return { ballots: written, debate: nextDebate };
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AssistantConfirmationError) {
      return NextResponse.json(
        { error: error.message, ...(error.differences ? { differences: error.differences } : {}) },
        { status: error.status }
      );
    }
    if (error instanceof StaffPermissionError || error instanceof DataEntryAccessChangedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Assistant ballot confirmation failed:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Could not confirm the ballot. Try again." }, { status: 503 });
  }
}

type AssistantConfirmationInputEntry = Pick<
  BallotSubmission,
  "motionId" | "motionText" | "speakerScores" | "teamScores" | "sheets" | "vetoes" | "forfeitSide"
>;

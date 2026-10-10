import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin";
import { isGlobalAdminUid } from "@/lib/globalAdmin";
import { AuditCategory, AuditEvent } from "@/types";

export const runtime = "nodejs";

const categories = new Set<AuditCategory>([
  "tournament",
  "draw",
  "allocation",
  "ballot",
  "standings",
  "break",
  "feedback",
  "email",
  "venue",
]);
const MAX_EVENTS = 5000;

type ReleaseEvent = Pick<
  AuditEvent,
  "id" | "tournamentId" | "timestamp" | "category" | "action" | "summary"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidEvent(
  value: unknown,
  documentId: string,
  tournamentId: string
): value is ReleaseEvent {
  if (!isRecord(value)) return false;
  return (
    value.id === documentId &&
    /^[A-Za-z0-9_-]{1,128}$/.test(documentId) &&
    value.tournamentId === tournamentId &&
    typeof value.timestamp === "string" &&
    value.timestamp.length <= 100 &&
    Number.isFinite(Date.parse(value.timestamp)) &&
    typeof value.category === "string" &&
    categories.has(value.category as AuditCategory) &&
    typeof value.action === "string" &&
    value.action.length > 0 &&
    value.action.length <= 200 &&
    typeof value.summary === "string" &&
    value.summary.length > 0 &&
    value.summary.length <= 2000
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(tournamentId)) {
    return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  }

  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token) {
    return NextResponse.json({ error: "Sign in as a tournament administrator to release the audit log." }, { status: 401 });
  }

  let auth;
  try {
    auth = getAdminAuth();
  } catch {
    return NextResponse.json({ error: "Server-side Firebase authorization is not configured." }, { status: 503 });
  }
  let user;
  try {
    user = await auth.verifyIdToken(token);
  } catch {
    return NextResponse.json({ error: "Your sign-in has expired. Please sign in again." }, { status: 401 });
  }

  try {
    const firestore = getAdminFirestore();
    const tournamentRef = firestore.collection("tournaments").doc(tournamentId);
    const tournamentSnapshot = await tournamentRef.get();
    if (!tournamentSnapshot.exists) {
      return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
    }
    const tournament = tournamentSnapshot.data();
    if (
      !isGlobalAdminUid(user.uid) &&
      tournament?.ownerId !== user.uid &&
      tournament?.admins?.[user.uid] !== true
    ) {
      return NextResponse.json({ error: "Only tournament administrators can release the audit log." }, { status: 403 });
    }

    const auditSnapshot = await tournamentRef.collection("auditEvents").get();
    if (auditSnapshot.size > MAX_EVENTS) {
      return NextResponse.json(
        { error: `The audit log contains more than ${MAX_EVENTS} events and cannot be released in one snapshot.` },
        { status: 413 }
      );
    }
    const events = auditSnapshot.docs.map((document) => document.data());
    if (!auditSnapshot.docs.every((document, index) =>
      isValidEvent(events[index], document.id, tournamentId)
    )) {
      return NextResponse.json(
        { error: "The stored audit log contains an invalid event and cannot be released." },
        { status: 409 }
      );
    }
    const sourceEvents = events as ReleaseEvent[];
    const orderedEvents = [...sourceEvents].sort(
      (left, right) =>
        Date.parse(left.timestamp) - Date.parse(right.timestamp) ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    );
    const releaseId = randomUUID();
    const releasedAt = new Date().toISOString();
    const eventsRef = tournamentRef.collection("auditReleases").doc(releaseId).collection("events");
    const releasedEvents: Array<{
      id: string;
      sequence: number;
      previousHash: string;
      hash: string;
    }> = [];
    let previousHash = "0".repeat(64);

    for (let start = 0; start < orderedEvents.length; start += 400) {
      const batch = firestore.batch();
      const chunk = orderedEvents.slice(start, start + 400);
      for (const [chunkIndex, event] of chunk.entries()) {
        const sequence = start + chunkIndex + 1;
        const publicEvent = {
          sequence,
          timestamp: event.timestamp,
          category: event.category,
          action: event.action,
          summary: event.summary,
        };
        const canonicalEvent = JSON.stringify(publicEvent);
        const hash = createHash("sha256")
          .update(`crabbytab-audit-v1\n${previousHash}\n${canonicalEvent}`)
          .digest("hex");
        batch.create(eventsRef.doc(String(sequence).padStart(6, "0")), {
          ...publicEvent,
          previousHash,
          hash,
        });
        releasedEvents.push({ id: event.id, sequence, previousHash, hash });
        previousHash = hash;
      }
      await batch.commit();
    }

    await tournamentRef.collection("auditReleases").doc("current").set({
      releaseId,
      releasedAt,
      eventCount: orderedEvents.length,
    });

    return NextResponse.json({
      releaseId,
      releasedAt,
      eventCount: orderedEvents.length,
      events: releasedEvents,
    });
  } catch (error) {
    console.error("Could not release the tournament audit log:", error);
    return NextResponse.json(
      { error: "Could not release the audit log. Try again later." },
      { status: 503 }
    );
  }
}

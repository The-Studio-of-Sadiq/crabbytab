import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin";
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
const MAX_BODY_BYTES = 12 * 1024 * 1024;

type ReleaseInput = Pick<AuditEvent, "id" | "timestamp" | "category" | "action" | "summary">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidEvent(value: unknown): value is ReleaseInput {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/.test(value.id) &&
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
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Audit log is too large to release in one snapshot." }, { status: 413 });
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isRecord(body) || !Array.isArray(body.events) || body.events.length > MAX_EVENTS) {
    return NextResponse.json(
      { error: `Provide an audit log containing no more than ${MAX_EVENTS} events.` },
      { status: 400 }
    );
  }
  if (!body.events.every(isValidEvent)) {
    return NextResponse.json({ error: "The audit log contains an invalid event." }, { status: 400 });
  }

  const events = body.events as ReleaseInput[];
  if (new Set(events.map((event) => event.id)).size !== events.length) {
    return NextResponse.json({ error: "The audit log contains duplicate event IDs." }, { status: 400 });
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
      tournament?.ownerId !== user.uid &&
      tournament?.admins?.[user.uid] !== true
    ) {
      return NextResponse.json({ error: "Only tournament administrators can release the audit log." }, { status: 403 });
    }

    const orderedEvents = [...events].sort(
      (left, right) =>
        Date.parse(left.timestamp) - Date.parse(right.timestamp) ||
        left.id.localeCompare(right.id)
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

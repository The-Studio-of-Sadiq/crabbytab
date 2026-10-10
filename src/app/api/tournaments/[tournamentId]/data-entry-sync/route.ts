import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

const collectionFields = {
  teams: [
    "id", "tournamentId", "name", "breakStatus", "breakCategoryIds", "eliminatedInRoundId",
    "codeName", "institutionId", "institutionName", "speakers", "breakCategories",
    "speakerCategories", "seed", "emoji", "checkedIn", "roundAvailability",
  ],
  adjudicators: [
    "id", "tournamentId", "name", "email", "institutionId", "institutionName", "baseScore",
    "testScore", "trainee", "independent", "checkedIn", "roundAvailability", "gender",
  ],
  institutions: ["id", "tournamentId", "name", "code", "region"],
  ballots: [
    "id", "tournamentId", "roundId", "debateId", "version", "confirmed", "discarded", "submitterType",
    "submitterId", "submitterName", "motionId", "motionText", "speakerScores", "teamScores", "chairId", "timestamp",
    "confirmedBy", "confirmedTimestamp",
  ],
  feedback: [
    "id", "tournamentId", "roundId", "debateId", "targetType", "targetAdjudicatorId",
    "targetAdjudicatorName", "targetTeamId", "targetTeamName", "sourceType", "sourceId", "sourceName", "score",
    "agreeWithDecision", "comments", "answers", "confirmed", "timestamp",
  ],
} as const;

const sides = ["OG", "OO", "CG", "CO", "AFF", "NEG"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function pickFields(value: Record<string, unknown>, fields: readonly string[]) {
  return Object.fromEntries(fields.filter((field) => value[field] !== undefined).map((field) => [field, value[field]]));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)])
    );
  }
  return value;
}

function recordsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function generatePrivateKey(prefix = "") {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let key = prefix ? `${prefix}_` : "";
  while (key.length < (prefix ? prefix.length + 1 : 0) + 12) {
    for (const value of randomBytes(16)) {
      if (value >= 240) continue;
      key += alphabet[value % alphabet.length];
      if (key.length === (prefix ? prefix.length + 1 : 0) + 12) break;
    }
  }
  return key;
}

function safeRecord(
  collectionName: keyof typeof collectionFields,
  value: unknown,
  tournamentId: string
): Record<string, unknown> {
  if (!isRecord(value) || !validId(value.id) || value.tournamentId !== tournamentId) {
    throw new Error(`Invalid ${collectionName} record.`);
  }
  const record = pickFields(value, collectionFields[collectionName]);
  if (collectionName === "teams") {
    record.speakers = Array.isArray(value.speakers)
      ? value.speakers.filter(isRecord).map((speaker) => pickFields(speaker, ["id", "name", "categories"]))
      : [];
  }
  return record;
}

async function resolveStaffSync(request: NextRequest, tournamentId: string) {
  const token = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token) return { error: "Sign in as a data-entry assistant.", status: 401 as const };
  let auth;
  let firestore;
  try {
    auth = getAdminAuth();
    firestore = getAdminFirestore();
  } catch {
    return { error: "Server-side Firebase authorization is not configured.", status: 503 as const };
  }
  let user;
  try {
    user = await auth.verifyIdToken(token);
  } catch {
    return { error: "Your sign-in has expired. Please sign in again.", status: 401 as const };
  }
  const tournamentRef = firestore.collection("tournaments").doc(tournamentId);
  const staffRef = tournamentRef.collection("staff").doc(user.uid);
  const [tournamentSnapshot, staffSnapshot] = await Promise.all([
    tournamentRef.get(),
    staffRef.get(),
  ]);
  if (!tournamentSnapshot.exists) return { error: "Tournament not found.", status: 404 as const };
  if (staffSnapshot.data()?.role !== "dataEntry") {
    return { error: "Data-entry access is not assigned to this account.", status: 403 as const };
  }
  return { firestore, tournamentRef, staffRef, user };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params;
  if (!validId(tournamentId)) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  const authorization = await resolveStaffSync(request, tournamentId);
  if ("error" in authorization) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!isRecord(body) || !isRecord(body.collections) || !Array.isArray(body.debates)) {
    return NextResponse.json({ error: "Invalid data-entry sync payload." }, { status: 400 });
  }
  const collectionsInput = body.collections as Record<string, unknown>;
  if (JSON.stringify(body).length > 4_000_000) {
    return NextResponse.json({ error: "Sync payload is too large. Upload fewer records at a time." }, { status: 413 });
  }

  let records: Array<{ collectionName: keyof typeof collectionFields; record: Record<string, unknown> }>;
  try {
    records = (Object.keys(collectionFields) as Array<keyof typeof collectionFields>).flatMap((collectionName) => {
      const values = collectionsInput[collectionName];
      if (values === undefined) return [];
      if (!Array.isArray(values) || values.length > 5000) throw new Error(`Invalid ${collectionName} collection.`);
      return values.map((value) => ({ collectionName, record: safeRecord(collectionName, value, tournamentId) }));
    });
    if (body.debates.length > 5000) throw new Error("Too many debate results in one sync.");
    if (!body.debates.every((debate) => isRecord(debate) && validId(debate.id))) {
      throw new Error("Invalid debate result record.");
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid sync record." }, { status: 400 });
  }

  try {
    let archivedConflictCount = 0;
    for (const { collectionName, record } of records) {
      const recordRef = authorization.tournamentRef.collection(collectionName).doc(record.id as string);
      const conflictRef = authorization.tournamentRef.collection("syncConflicts").doc();
      const archived = await authorization.firestore.runTransaction(async (transaction) => {
        const staffSnapshot = await transaction.get(authorization.staffRef);
        if (staffSnapshot.data()?.role !== "dataEntry") throw new Error("Data-entry access was revoked.");
        const snapshot = await transaction.get(recordRef);
        const current: Record<string, unknown> | null = snapshot.exists
          ? { ...snapshot.data(), id: snapshot.id }
          : null;
        const merged: Record<string, unknown> = current ? { ...current, ...record } : record;
        if (collectionName === "teams") {
          const currentSpeakers = current?.speakers;
          const incomingSpeakers = record.speakers;
          if (current && Array.isArray(currentSpeakers) && Array.isArray(incomingSpeakers)) {
            const cloudSpeakersById = new Map(
              currentSpeakers.filter(isRecord).map((speaker) => [speaker.id, speaker])
            );
            merged.speakers = [
              ...currentSpeakers.filter(isRecord).map((speaker) => speaker.id),
              ...incomingSpeakers.filter(isRecord).map((speaker) => speaker.id),
            ].filter((id, index, all) => all.indexOf(id) === index).map((id) => {
              const existingSpeaker = cloudSpeakersById.get(id);
              const incomingSpeaker = incomingSpeakers.find((speaker) => isRecord(speaker) && speaker.id === id);
              return { ...(existingSpeaker || {}), ...(isRecord(incomingSpeaker) ? incomingSpeaker : {}) };
            });
          }
          merged.privateUrlKey = typeof merged.privateUrlKey === "string" ? merged.privateUrlKey : generatePrivateKey("team");
          merged.privatePasscode = typeof merged.privatePasscode === "string" ? merged.privatePasscode : generatePrivateKey();
        }
        if (collectionName === "adjudicators") {
          merged.privateUrlKey = typeof merged.privateUrlKey === "string" ? merged.privateUrlKey : generatePrivateKey("adj");
          merged.privatePasscode = typeof merged.privatePasscode === "string" ? merged.privatePasscode : generatePrivateKey();
        }
        if (current && recordsEqual(current, merged)) return false;
        if (current) {
          transaction.create(conflictRef, {
            id: conflictRef.id,
            collectionName,
            recordId: record.id,
            record: current,
            archivedAt: new Date().toISOString(),
            archivedBy: authorization.user.uid,
          });
        }
        transaction.set(recordRef, merged);
        return Boolean(current);
      });
      archivedConflictCount += Number(archived);
    }

    for (const debate of body.debates as Record<string, unknown>[]) {
      const debateRef = authorization.tournamentRef.collection("debates").doc(debate.id as string);
      const conflictRef = authorization.tournamentRef.collection("syncConflicts").doc();
      const archived = await authorization.firestore.runTransaction(async (transaction) => {
        const staffSnapshot = await transaction.get(authorization.staffRef);
        if (staffSnapshot.data()?.role !== "dataEntry") throw new Error("Data-entry access was revoked.");
        const snapshot = await transaction.get(debateRef);
        if (!snapshot.exists) throw new Error(`Debate ${debate.id} no longer exists.`);
        const current: Record<string, unknown> = { ...snapshot.data(), id: snapshot.id };
        const currentTeams = current.teams;
        const localTeams = debate.teams;
        if (!isRecord(currentTeams) || !isRecord(localTeams)) throw new Error(`Debate ${debate.id} has invalid result data.`);
        const teams = { ...currentTeams };
        for (const side of sides) {
          const currentSlot = currentTeams[side];
          const localSlot = localTeams[side];
          if (currentSlot === undefined && localSlot === undefined) continue;
          if (!isRecord(currentSlot) || !isRecord(localSlot) || currentSlot.teamId !== localSlot.teamId) {
            throw new Error(`Debate ${debate.id} team assignments changed; only administrators can sync them.`);
          }
          const updatedSlot = { ...currentSlot };
          for (const field of ["points", "speakerScoreTotal"] as const) {
            if (localSlot[field] !== undefined) updatedSlot[field] = localSlot[field];
          }
          teams[side] = updatedSlot;
        }
        if (!["none", "draft", "confirmed"].includes(String(debate.resultStatus))) {
          throw new Error(`Debate ${debate.id} has an invalid result status.`);
        }
        const updated = { ...current, resultStatus: debate.resultStatus, teams };
        if (recordsEqual(current, updated)) return false;
        transaction.create(conflictRef, {
          id: conflictRef.id,
          collectionName: "debates",
          recordId: debate.id,
          record: current,
          archivedAt: new Date().toISOString(),
          archivedBy: authorization.user.uid,
        });
        transaction.update(debateRef, { resultStatus: debate.resultStatus, teams });
        return true;
      });
      archivedConflictCount += Number(archived);
    }

    return NextResponse.json({ archivedConflictCount });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not sync assistant data." },
      { status: 409 }
    );
  }
}
import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

function pickFields(value: Record<string, unknown>, fields: string[]) {
  return Object.fromEntries(fields.filter((field) => value[field] !== undefined).map((field) => [field, value[field]]));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tournamentId: string }> }
) {
  const { tournamentId } = await params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(tournamentId)) {
    return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  }
  const token = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token) return NextResponse.json({ error: "Sign in to load tournament data." }, { status: 401 });

  let auth;
  let firestore;
  try {
    auth = getAdminAuth();
    firestore = getAdminFirestore();
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
    const tournamentRef = firestore.collection("tournaments").doc(tournamentId);
    const tournamentSnapshot = await tournamentRef.get();
    if (!tournamentSnapshot.exists) return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
    const source = tournamentSnapshot.data()!;
    const staffSnapshot = await tournamentRef.collection("staff").doc(user.uid).get();
    if (staffSnapshot.data()?.role !== "dataEntry") {
      return NextResponse.json({ error: "Data-entry access is not assigned to this account." }, { status: 403 });
    }

    const names = [
      "rounds", "teams", "adjudicators", "venues", "motions", "breakCategories",
      "debates", "ballots", "feedback", "institutions",
    ] as const;
    const snapshots = await Promise.all(names.map((name) => tournamentRef.collection(name).get()));
    const records = Object.fromEntries(names.map((name, index) => [
      name,
      snapshots[index].docs.map((document) => ({ ...document.data(), id: document.id })),
    ])) as unknown as Record<(typeof names)[number], Array<Record<string, unknown>>>;

    const tournament = {
      ...pickFields(source, ["name", "nameLower", "shortName", "slug", "format", "seq", "active", "preferences", "createdAt", "updatedAt", "migratedAt"]),
      id: tournamentSnapshot.id,
      ownerId: "",
      admins: {},
    };
    const collections = {
      rounds: records.rounds.map((round) => pickFields(round, [
        "id", "tournamentId", "seq", "name", "abbreviation", "stage", "drawType", "drawStatus",
        "adjudicatorsRevealed", "feedbackWeight", "silent", "motionsReleased", "resultsReleased",
        "teamSpeaksReleased", "breakCategoryIds", "eliminationAdvanced", "cancelled", "completed", "createdAt",
      ])),
      teams: records.teams.map((team) => ({
        ...pickFields(team, [
          "id", "tournamentId", "name", "breakStatus", "breakCategoryIds", "eliminatedInRoundId",
          "codeName", "institutionId", "institutionName", "breakCategories", "speakerCategories",
          "seed", "emoji", "checkedIn", "roundAvailability",
        ]),
        speakers: Array.isArray(team.speakers)
          ? team.speakers.map((speaker: Record<string, unknown>) => pickFields(speaker, ["id", "name", "categories"]))
          : [],
      })),
      adjudicators: records.adjudicators.map((adjudicator) => pickFields(adjudicator, [
        "id", "tournamentId", "name", "email", "institutionId", "institutionName", "baseScore",
        "testScore", "trainee", "independent", "checkedIn", "roundAvailability", "gender",
      ])),
      venues: records.venues.map((venue) => pickFields(venue, [
        "id", "tournamentId", "name", "priority", "category", "capacity", "accessible", "online", "available",
      ])),
      motions: records.motions.map((motion) => pickFields(motion, [
        "id", "tournamentId", "text", "reference", "infoSlide", "rounds", "seq", "released",
      ])),
      breakCategories: records.breakCategories.map((category) => pickFields(category, [
        "id", "tournamentId", "name", "slug", "seq", "breakSize", "reserveSize", "isGeneral", "priority",
      ])),
      debates: records.debates.map((debate) => pickFields(debate, [
        "id", "tournamentId", "roundId", "roundSeq", "byeTeamId", "byeResult", "breakCategoryId",
        "venueId", "venueName", "bracket", "roomRank", "importance", "resultStatus", "sidesConfirmed",
        "flags", "teams", "adjudicators", "motionId", "motionText",
      ])),
      ballots: records.ballots.map((ballot) => pickFields(ballot, [
        "id", "tournamentId", "roundId", "debateId", "version", "confirmed", "discarded", "submitterType", "submitterId",
        "submitterName", "motionId", "motionText", "speakerScores", "teamScores", "chairId", "timestamp",
        "confirmedBy", "confirmedTimestamp",
      ])),
      feedback: records.feedback.map((submission) => pickFields(submission, [
        "id", "tournamentId", "roundId", "debateId", "targetType", "targetAdjudicatorId",
        "targetAdjudicatorName", "targetTeamId", "targetTeamName", "sourceType", "sourceId", "sourceName", "score",
        "agreeWithDecision", "comments", "answers", "confirmed", "timestamp",
      ])),
      institutions: records.institutions.map((institution) => pickFields(institution, [
        "id", "tournamentId", "name", "code", "region",
      ])),
      auditEvents: [],
    };

    return NextResponse.json({ tournament, collections }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load assistant tournament data." }, { status: 503 });
  }
}
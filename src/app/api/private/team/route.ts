import { NextRequest, NextResponse } from "next/server";
import { Debate } from "@/types";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

function validDocumentId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("/");
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { tournamentId, privateUrlKey } = body;
  if (
    !validDocumentId(tournamentId) ||
    typeof privateUrlKey !== "string" ||
    privateUrlKey.length === 0 ||
    privateUrlKey.length > 128
  ) {
    return NextResponse.json({ error: "Invalid private team link." }, { status: 400 });
  }

  try {
    const firestore = getAdminFirestore();
    const tournamentRef = firestore.collection("tournaments").doc(tournamentId);
    const [tournamentSnapshot, teamSnapshot] = await Promise.all([
      tournamentRef.get(),
      tournamentRef.collection("teams").where("privateUrlKey", "==", privateUrlKey).limit(1).get(),
    ]);
    const teamDocument = teamSnapshot.docs[0];
    if (!tournamentSnapshot.exists || !teamDocument) {
      return NextResponse.json({ error: "This private team link is invalid." }, { status: 404 });
    }

    const teamData = teamDocument.data();
    const [debatesSnapshot, roundsSnapshot, feedbackSnapshot] = await Promise.all([
      tournamentRef.collection("debates").get(),
      tournamentRef.collection("rounds").get(),
      tournamentRef.collection("feedback").where("sourceId", "==", teamDocument.id).get(),
    ]);
    const debates = debatesSnapshot.docs
      .map((document) => ({ ...document.data(), id: document.id } as Debate))
      .filter((debate) =>
        Object.values(debate.teams || {}).some(
          (slot) => slot?.teamId === teamDocument.id
        )
      );
    const roundIds = new Set(debates.map((debate) => debate.roundId));
    const rounds = roundsSnapshot.docs
      .filter((document) => roundIds.has(document.id))
      .map((document) => ({ ...document.data(), id: document.id }));
    const tournamentData = tournamentSnapshot.data()!;

    return NextResponse.json({
      team: {
        id: teamDocument.id,
        tournamentId,
        name: teamData.name,
        breakStatus: teamData.breakStatus,
        breakCategoryIds: teamData.breakCategoryIds,
        eliminatedInRoundId: teamData.eliminatedInRoundId,
        codeName: teamData.codeName,
        institutionId: teamData.institutionId,
        institutionName: teamData.institutionName,
        speakers: Array.isArray(teamData.speakers)
          ? teamData.speakers.map((speaker: Record<string, unknown>) => ({
              id: speaker.id,
              name: speaker.name,
              categories: speaker.categories,
            }))
          : [],
        breakCategories: teamData.breakCategories || [],
        speakerCategories: teamData.speakerCategories || [],
        privateUrlKey,
        checkedIn: teamData.checkedIn,
      },
      tournament: {
        id: tournamentSnapshot.id,
        name: tournamentData.name,
        shortName: tournamentData.shortName,
        slug: tournamentData.slug,
        format: tournamentData.format,
        preferences: tournamentData.preferences,
      },
      rounds,
      debates,
      feedback: feedbackSnapshot.docs.map((document) => ({
        ...document.data(),
        id: document.id,
      })),
    });
  } catch (error) {
    console.error("Could not load private team portal:", error);
    return NextResponse.json(
      { error: "Could not load private team data. Try again later." },
      { status: 503 }
    );
  }
}

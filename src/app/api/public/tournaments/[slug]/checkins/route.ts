import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { isAvailableForRound } from "@/lib/roundAvailability";
import type { Adjudicator, Round, Team, Tournament } from "@/types";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  if (!slug || slug.length > 128) {
    return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  }

  try {
    const firestore = getAdminFirestore();
    const tournaments = await firestore.collection("tournaments").where("slug", "==", slug).limit(2).get();
    if (tournaments.size !== 1) {
      return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
    }
    const tournamentDocument = tournaments.docs[0];
    const tournament = tournamentDocument.data() as Tournament;
    if (tournament.preferences?.publicCheckInStatus !== true) {
      return NextResponse.json({ error: "Public check-in status is disabled." }, { status: 403 });
    }

    const [teamsSnapshot, adjudicatorsSnapshot, roundsSnapshot] = await Promise.all([
      tournamentDocument.ref.collection("teams").get(),
      tournamentDocument.ref.collection("adjudicators").get(),
      tournamentDocument.ref.collection("rounds").get(),
    ]);
    const teams = teamsSnapshot.docs
      .filter((document) => typeof document.data().deletedAt !== "string")
      .map((document) => ({ ...document.data(), id: document.id } as Team));
    const adjudicators = adjudicatorsSnapshot.docs
      .filter((document) => typeof document.data().deletedAt !== "string")
      .map((document) => ({ ...document.data(), id: document.id } as Adjudicator));
    const rounds = roundsSnapshot.docs
      .filter((document) => typeof document.data().deletedAt !== "string")
      .map((document) => ({ ...document.data(), id: document.id } as Round))
      .filter((round) => !round.cancelled)
      .sort((left, right) => left.seq - right.seq);
    const now = Date.now();
    const expiryHours = tournament.preferences?.checkInExpiresAfterHours;

    return NextResponse.json({
      tournamentName: tournament.shortName || tournament.name,
      updatedAt: new Date(now).toISOString(),
      rounds: rounds.map((round) => ({
        id: round.id,
        name: round.name,
        teamsPresent: teams.filter((team) => isAvailableForRound(team, round, expiryHours, now)).length,
        teamsTotal: teams.length,
        adjudicatorsPresent: adjudicators.filter((adj) => isAvailableForRound(adj, round, expiryHours, now)).length,
        adjudicatorsTotal: adjudicators.length,
      })),
    }, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("Could not load public check-in status:", error);
    return NextResponse.json({ error: "Could not load public check-in status." }, { status: 503 });
  }
}

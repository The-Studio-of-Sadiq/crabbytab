import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { hashApiToken, isApiTokenScope, readBearerToken } from "@/lib/apiTokens";
import type { Adjudicator, Debate, Round, Team, Tournament, Venue } from "@/types";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) {
    return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  }
  const bearer = readBearerToken(request.headers.get("authorization"));
  if (!bearer) {
    return NextResponse.json({ error: "A valid API bearer token is required." }, { status: 401 });
  }

  const roundSeqText = request.nextUrl.searchParams.get("roundSeq");
  const requestedRoundSeq = roundSeqText === null ? undefined : Number(roundSeqText);
  if (
    requestedRoundSeq !== undefined &&
    (!Number.isInteger(requestedRoundSeq) || requestedRoundSeq < 1)
  ) {
    return NextResponse.json({ error: "roundSeq must be a positive integer." }, { status: 400 });
  }

  try {
    const firestore = getAdminFirestore();
    const tournamentMatches = await firestore.collection("tournaments")
      .where("slug", "==", slug)
      .limit(2)
      .get();
    if (tournamentMatches.size !== 1) {
      return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
    }
    const tournamentDocument = tournamentMatches.docs[0];
    const tokenSnapshot = await tournamentDocument.ref.collection("apiTokens")
      .where("tokenHash", "==", hashApiToken(bearer))
      .limit(1)
      .get();
    const scope = tokenSnapshot.docs[0]?.data().scope;
    if (!tokenSnapshot.docs[0] || !isApiTokenScope(scope)) {
      return NextResponse.json({ error: "API token is invalid or has been revoked." }, { status: 401 });
    }

    const tournamentData = tournamentDocument.data() as Tournament;
    const [roundsSnapshot, debatesSnapshot, teamsSnapshot, adjudicatorsSnapshot, venuesSnapshot] = await Promise.all([
      tournamentDocument.ref.collection("rounds").get(),
      tournamentDocument.ref.collection("debates").get(),
      tournamentDocument.ref.collection("teams").get(),
      tournamentDocument.ref.collection("adjudicators").get(),
      tournamentDocument.ref.collection("venues").get(),
    ]);
    const activeRecords = <T extends { data(): Record<string, unknown> }>(documents: T[]) =>
      documents.filter((document) => typeof document.data().deletedAt !== "string");
    const allRounds = activeRecords(roundsSnapshot.docs)
      .map((document) => ({ ...document.data(), id: document.id } as Round))
      .filter((round) => !round.cancelled)
      .sort((left, right) => left.seq - right.seq);
    const rounds = allRounds.filter((round) =>
      requestedRoundSeq === undefined || round.seq === requestedRoundSeq
    );
    if (requestedRoundSeq !== undefined && rounds.length === 0) {
      return NextResponse.json({ error: "Round not found." }, { status: 404 });
    }
    const visibleRounds = rounds.filter((round) =>
      scope === "read:draws" ||
      (tournamentData.preferences?.publicDraw !== false &&
        (round.drawStatus === "confirmed" || round.drawStatus === "released"))
    );
    const roundIds = new Set(visibleRounds.map((round) => round.id));
    const debates = activeRecords(debatesSnapshot.docs)
      .map((document) => ({ ...document.data(), id: document.id } as Debate))
      .filter((debate) => roundIds.has(debate.roundId) && !debate.postponed)
      .sort((left, right) =>
        left.roundSeq - right.roundSeq ||
        left.roomRank - right.roomRank ||
        left.id.localeCompare(right.id)
      );
    const teamsById = new Map(activeRecords(teamsSnapshot.docs).map((document) =>
      [document.id, { ...document.data(), id: document.id } as Team]
    ));
    const adjudicatorsById = new Map(activeRecords(adjudicatorsSnapshot.docs).map((document) =>
      [document.id, { ...document.data(), id: document.id } as Adjudicator]
    ));
    const venuesById = new Map(activeRecords(venuesSnapshot.docs).map((document) =>
      [document.id, { ...document.data(), id: document.id } as Venue]
    ));
    const revealPanels = new Set(visibleRounds
      .filter((round) => scope === "read:draws" || round.adjudicatorsRevealed === true)
      .map((round) => round.id));

    return NextResponse.json({
      tournament: {
        id: tournamentDocument.id,
        name: tournamentData.name,
        shortName: tournamentData.shortName,
        slug: tournamentData.slug,
        format: tournamentData.format,
      },
      rounds: visibleRounds.map((round) => ({
        id: round.id,
        seq: round.seq,
        name: round.name,
        stage: round.stage,
        drawStatus: round.drawStatus,
      })),
      debates: debates.map((debate) => ({
        id: debate.id,
        roundId: debate.roundId,
        roundSeq: debate.roundSeq,
        roomRank: debate.roomRank,
        bracket: debate.bracket,
        venue: debate.venueId ? venuesById.get(debate.venueId)?.name ?? debate.venueName : debate.venueName,
        teams: Object.fromEntries(Object.entries(debate.teams || {}).map(([side, slot]) => [
          side,
          slot?.teamId
            ? {
                id: slot.teamId,
                name: teamsById.get(slot.teamId)?.name ?? slot.teamName,
                side,
              }
            : null,
        ])),
        adjudicators: revealPanels.has(debate.roundId) ? {
          chair: debate.adjudicators.chairId
            ? {
                id: debate.adjudicators.chairId,
                name: adjudicatorsById.get(debate.adjudicators.chairId)?.name ?? debate.adjudicators.chairName,
              }
            : null,
          panellists: (debate.adjudicators.panellistIds || []).map((id, index) => ({
            id,
            name: adjudicatorsById.get(id)?.name ?? debate.adjudicators.panellistNames[index] ?? "",
          })),
          trainees: (debate.adjudicators.traineeIds || []).map((id, index) => ({
            id,
            name: adjudicatorsById.get(id)?.name ?? debate.adjudicators.traineeNames[index] ?? "",
          })),
        } : null,
      })),
    }, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Could not load tournament draw API data:", error);
    return NextResponse.json({ error: "Could not load tournament draw data." }, { status: 503 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  Adjudicator,
  BallotSubmission,
  BreakCategory,
  Debate,
  Institution,
  Motion,
  Round,
  Team,
  Tournament,
  Venue,
} from "@/types";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

function pick<T extends object, K extends keyof T>(
  value: T,
  keys: K[]
): Pick<T, K> {
  return Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]])) as Pick<T, K>;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) {
    return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
  }

  try {
    const firestore = getAdminFirestore();
    const tournamentSnapshot = await firestore
      .collection("tournaments")
      .where("slug", "==", slug)
      .limit(1)
      .get();
    const tournamentDocument = tournamentSnapshot.docs[0];
    if (!tournamentDocument) {
      return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
    }

    const tournamentData = tournamentDocument.data();
    const preferences = tournamentData.preferences || {};
    const tournament = {
      ...pick(tournamentData, [
        "name",
        "nameLower",
        "shortName",
        "slug",
        "format",
        "seq",
        "active",
        "preferences",
        "createdAt",
        "updatedAt",
        "migratedAt",
      ] as (keyof typeof tournamentData)[]),
      id: tournamentDocument.id,
      ownerId: "",
      admins: {},
    } as Tournament;

    const tournamentRef = tournamentDocument.ref;
    const [roundsSnapshot, teamsSnapshot, adjudicatorsSnapshot, debatesSnapshot, ballotsSnapshot,
      motionsSnapshot, breakCategoriesSnapshot, institutionsSnapshot, venuesSnapshot] = await Promise.all([
      tournamentRef.collection("rounds").get(),
      tournamentRef.collection("teams").get(),
      tournamentRef.collection("adjudicators").get(),
      tournamentRef.collection("debates").get(),
      tournamentRef.collection("ballots").get(),
      tournamentRef.collection("motions").get(),
      tournamentRef.collection("breakCategories").get(),
      tournamentRef.collection("institutions").get(),
      tournamentRef.collection("venues").get(),
    ]);

    const allRounds: Round[] = roundsSnapshot.docs.map((document) => ({
      ...document.data(),
      id: document.id,
    } as Round));
    const visibleRounds = allRounds.filter((round) => {
      if (round.cancelled) return false;
      const publishedDraw =
        preferences.publicDraw !== false &&
        (round.drawStatus === "confirmed" || round.drawStatus === "released");
      const publishedResults =
        preferences.publicResults !== false &&
        round.resultsReleased === true &&
        round.silent !== true;
      return (
        publishedDraw ||
        publishedResults ||
        (preferences.publicDraw !== false &&
          (round.drawStatus === "confirmed" || round.drawStatus === "released") &&
          round.adjudicatorsRevealed === true)
      );
    });
    const visibleRoundIds = new Set(visibleRounds.map((round) => round.id));
    const visibleRoundById = new Map(visibleRounds.map((round) => [round.id, round]));
    const visibleMotionIds = new Set(
      preferences.publicMotions !== false
        ? motionsSnapshot.docs
            .filter((document) => document.data().released === true)
            .map((document) => document.id)
        : []
    );
    const debates: Array<Partial<Debate> & { id: string }> = debatesSnapshot.docs
      .map((document) => ({ ...document.data(), id: document.id } as Debate))
      .filter((debate) => visibleRoundIds.has(debate.roundId))
      .map((debate) => {
        const round = visibleRoundById.get(debate.roundId)!;
        const revealAdjudicators =
          preferences.publicDraw !== false && round.adjudicatorsRevealed === true;
        return {
          ...pick(debate, [
            "tournamentId",
            "roundId",
            "roundSeq",
            "byeTeamId",
            "breakCategoryId",
            "venueId",
            "venueName",
            "bracket",
            "roomRank",
            "importance",
            "sidesConfirmed",
            "teams",
          ] as (keyof Debate)[]),
          id: debate.id,
          byeResult:
            round.resultsReleased === true &&
            round.silent !== true &&
            preferences.publicResults !== false
              ? debate.byeResult
              : undefined,
          resultStatus:
            round.resultsReleased === true &&
            round.silent !== true &&
            preferences.publicResults !== false
              ? debate.resultStatus
              : "none",
          motionId: debate.motionId && visibleMotionIds.has(debate.motionId) ? debate.motionId : undefined,
          motionText: debate.motionId && visibleMotionIds.has(debate.motionId) ? debate.motionText : undefined,
          adjudicators: revealAdjudicators
            ? pick(debate.adjudicators, [
                "chairId",
                "chairName",
                "panellistIds",
                "panellistNames",
                "traineeIds",
                "traineeNames",
              ])
            : { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
        };
      });

    const visibleBallotIds = new Set(
      ballotsSnapshot.docs
        .filter((document) => {
          const ballot = document.data();
          const round = visibleRoundById.get(ballot.roundId);
          return (
            preferences.publicResults !== false &&
            round?.resultsReleased === true &&
            round.silent !== true &&
            ballot.confirmed === true &&
            ballot.discarded !== true
          );
        })
        .map((document) => document.id)
    );
    const ballots = ballotsSnapshot.docs
      .filter((document) => visibleBallotIds.has(document.id))
      .map((document) => {
        const ballot = { ...document.data(), id: document.id } as BallotSubmission;
        const round = visibleRoundById.get(ballot.roundId)!;
        const showSpeakerScores = round.teamSpeaksReleased === true;
        return {
          ...pick(ballot, [
            "tournamentId",
            "roundId",
            "debateId",
            "version",
            "confirmed",
            "discarded",
            "timestamp",
          ] as (keyof BallotSubmission)[]),
          id: ballot.id,
          motionId: visibleMotionIds.has(ballot.motionId || "") ? ballot.motionId : undefined,
          motionText: visibleMotionIds.has(ballot.motionId || "") ? ballot.motionText : undefined,
          speakerScores: showSpeakerScores ? ballot.speakerScores : {},
          teamScores: Object.fromEntries(
            Object.entries(ballot.teamScores || {}).map(([side, score]) => [
              side,
              showSpeakerScores
                ? score
                : pick(score, ["side", "teamId", "points", "win", "rank"]),
            ])
          ),
        };
      });

    const publicTeamIds = new Set(
      debates.flatMap((debate) =>
        Object.values(debate.teams || {}).map((slot: { teamId?: string }) => slot.teamId).filter(Boolean)
      )
    );
    const teams = teamsSnapshot.docs
      .filter((document) => publicTeamIds.has(document.id))
      .map((document) => {
        const team = document.data() as Team;
        return {
          ...pick(team, [
            "tournamentId",
            "name",
            "breakStatus",
            "breakCategoryIds",
            "eliminatedInRoundId",
            "codeName",
            "institutionId",
            "institutionName",
            "breakCategories",
            "speakerCategories",
            "seed",
            "emoji",
          ] as (keyof Team)[]),
          id: document.id,
          speakers: Array.isArray(team.speakers)
            ? team.speakers.map((speaker) =>
                pick(speaker, ["id", "name", "categories"])
              )
            : [],
        };
      });

    const revealedAdjudicatorIds = new Set(
      debates.flatMap((debate) => {
        const panel = debate.adjudicators as Debate["adjudicators"];
        return [
          panel.chairId,
          ...(panel.panellistIds || []),
          ...(panel.traineeIds || []),
        ].filter(Boolean);
      })
    );
    const adjudicators = adjudicatorsSnapshot.docs
      .filter((document) => revealedAdjudicatorIds.has(document.id))
      .map((document) => {
        const adjudicator = document.data() as Adjudicator;
        return {
          ...pick(adjudicator, ["tournamentId", "name", "institutionId", "institutionName"]),
          id: document.id,
        };
      });

    const rounds = visibleRounds.map((round) => {
      const publishedResults =
        preferences.publicResults !== false &&
        round.resultsReleased === true &&
        round.silent !== true;
      const publishedDraw =
        preferences.publicDraw !== false &&
        (round.drawStatus === "confirmed" || round.drawStatus === "released");
      return {
        ...pick(round, [
        "id",
        "tournamentId",
        "seq",
        "name",
        "abbreviation",
        "stage",
        "drawType",
        "drawStatus",
        "adjudicatorsRevealed",
        "feedbackWeight",
        "silent",
        "motionsReleased",
        "resultsReleased",
        "teamSpeaksReleased",
        "breakCategoryIds",
        "eliminationAdvanced",
        "cancelled",
        "completed",
        "createdAt",
        ] as (keyof Round)[]),
        adjudicatorsRevealed: publishedDraw && round.adjudicatorsRevealed === true,
        motionsReleased:
          preferences.publicMotions !== false && round.motionsReleased === true,
        resultsReleased: publishedResults,
        teamSpeaksReleased: publishedResults && round.teamSpeaksReleased === true,
      };
    });
    const motions = motionsSnapshot.docs
      .filter((document) => preferences.publicMotions !== false && document.data().released === true)
      .map((document) => ({
        ...pick(document.data(), [
          "tournamentId",
          "text",
          "reference",
          "infoSlide",
          "rounds",
          "seq",
          "released",
        ] as (keyof Motion)[]),
        id: document.id,
      }));
    const breakCategories = breakCategoriesSnapshot.docs.map((document) => ({
      ...pick(document.data() as BreakCategory, [
        "tournamentId",
        "name",
        "slug",
        "seq",
        "breakSize",
        "reserveSize",
        "isGeneral",
        "priority",
      ] as (keyof BreakCategory)[]),
      id: document.id,
    }));
    const institutions = institutionsSnapshot.docs.map((document) => ({
      ...pick(document.data() as Institution, ["tournamentId", "name", "code", "region"]),
      id: document.id,
    }));
    const venues = venuesSnapshot.docs.map((document) => ({
      ...pick(document.data() as Venue, [
        "tournamentId",
        "name",
        "category",
        "capacity",
        "accessible",
        "online",
        "available",
      ]),
      id: document.id,
    }));

    return NextResponse.json({
      tournament,
      collections: {
        rounds,
        teams,
        adjudicators,
        venues,
        motions,
        breakCategories,
        debates,
        ballots,
        feedback: [],
        institutions,
      },
    });
  } catch (error) {
    console.error("Could not load public tournament projection:", error);
    return NextResponse.json(
      { error: "Could not load public tournament data. Try again later." },
      { status: 503 }
    );
  }
}

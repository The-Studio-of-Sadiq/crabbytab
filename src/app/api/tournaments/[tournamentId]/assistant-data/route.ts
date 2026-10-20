import { NextRequest, NextResponse } from "next/server";
import { redactAssistantDebate } from "@/lib/dataEntrySync";
import { authorizeDataEntryStaff } from "@/lib/staffAccessServer";
import { hasStaffPermission } from "@/lib/staffPermissions";

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
  const authorization = await authorizeDataEntryStaff(request, tournamentId);
  if ("error" in authorization) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }
  const { tournamentRef, permissions } = authorization;
  const source = authorization.tournament as unknown as Record<string, unknown>;

  try {
    const names = [
      "rounds", "teams", "adjudicators", "venues", "motions", "breakCategories",
      "debates", "ballots", "feedback", "institutions", "ballotIntake",
    ] as const;
    const snapshots = await Promise.all(names.map((name) => tournamentRef.collection(name).get()));
    const records = Object.fromEntries(names.map((name, index) => [
      name,
      snapshots[index].docs
        .filter((document) => typeof document.data().deletedAt !== "string")
        .map((document) => ({ ...document.data(), id: document.id })),
    ])) as unknown as Record<(typeof names)[number], Array<Record<string, unknown>>>;

    const tournament = {
      ...pickFields(source, ["name", "nameLower", "shortName", "slug", "format", "seq", "active", "preferences", "createdAt", "updatedAt", "migratedAt"]),
      id: tournamentRef.id,
      ownerId: "",
      admins: {},
    };
    const roundsById = new Map(records.rounds.map((round) => [
      String(round.id),
      round as { adjudicatorsRevealed?: boolean; motionsReleased?: boolean; drawStatus?: unknown },
    ]));
    // Staff access (docs/staff-access.md): without "draw.display" only confirmed or released draws
    // are sent; with "motions.display" a round's motions are sent before they are released.
    const drawVisible = (roundId: unknown) => {
      const status = roundsById.get(String(roundId))?.drawStatus;
      return status === "confirmed" || status === "released" ||
        (hasStaffPermission(permissions, "draw.display") && status === "draft");
    };
    const showUnreleasedMotions = hasStaffPermission(permissions, "motions.display");
    const motionVisible = (motion: Record<string, unknown>) =>
      motion.released === true ||
      (showUnreleasedMotions && Array.isArray(motion.rounds) &&
        motion.rounds.some((roundId) => drawVisible(roundId)));
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
          "seed", "emoji", "checkedIn", "roundAvailability", "roundAvailabilityAt", "checkInHistory",
        ]),
        speakers: Array.isArray(team.speakers)
          ? team.speakers.map((speaker: Record<string, unknown>) =>
              pickFields(speaker, ["id", "name", "categories", "roundAvailability", "checkInHistory"]))
          : [],
      })),
      adjudicators: records.adjudicators.map((adjudicator) => pickFields(adjudicator, [
        "id", "tournamentId", "name", "institutionId", "institutionName",
        "trainee", "independent", "checkedIn", "roundAvailability", "roundAvailabilityAt", "checkInHistory", "gender",
      ])),
      venues: records.venues.map((venue) => pickFields(venue, [
        "id", "tournamentId", "name", "priority", "category", "capacity", "accessible", "online", "available",
        "checkedIn", "checkInHistory",
      ])),
      motions: records.motions.filter(motionVisible).map((motion) => pickFields(motion, [
        "id", "tournamentId", "text", "reference", "infoSlide", "rounds", "seq", "released",
      ])),
      breakCategories: records.breakCategories.map((category) => pickFields(category, [
        "id", "tournamentId", "name", "slug", "seq", "breakSize", "reserveSize", "isGeneral", "priority",
      ])),
      debates: records.debates.filter((debate) => drawVisible(debate.roundId)).map((debate) => redactAssistantDebate(
        pickFields(debate, [
          "id", "tournamentId", "roundId", "roundSeq", "byeTeamId", "byeResult", "breakCategoryId",
          "venueId", "venueName", "bracket", "roomRank", "importance", "resultStatus", "sidesConfirmed",
          "flags", "teams", "adjudicators", "motionId", "motionText",
        ]),
        roundsById.get(String(debate.roundId)),
        { showUnreleasedMotions }
      )),
      ballots: records.ballots.map((ballot) => pickFields(ballot, [
        "id", "tournamentId", "roundId", "debateId", "version", "confirmed", "discarded", "submitterType", "submitterId",
        "submitterName", "motionId", "motionText", "speakerScores", "teamScores", "chairId", "timestamp",
        "confirmedBy", "confirmedTimestamp", "sheets", "vetoes", "forfeitSide", "checksVersion",
        "singleAdjudicator", "mergedFromIds",
      ])),
      feedback: records.feedback.map((submission) => pickFields(submission, [
        "id", "tournamentId", "roundId", "debateId", "targetType", "targetAdjudicatorId",
        "targetAdjudicatorName", "targetTeamId", "targetTeamName", "sourceType", "sourceId", "sourceName",
        "confirmed", "timestamp",
      ])),
      institutions: records.institutions.map((institution) => pickFields(institution, [
        "id", "tournamentId", "name", "code", "region",
      ])),
      auditEvents: [],
      ballotIntake: records.ballotIntake.map((receipt) => pickFields(receipt, [
        "id", "tournamentId", "roundId", "debateId", "sheetCode", "adjudicatorId", "receivedAt", "receivedBy", "receivedByName",
      ])),
    };

    return NextResponse.json({ tournament, collections, permissions }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load assistant tournament data." }, { status: 503 });
  }
}
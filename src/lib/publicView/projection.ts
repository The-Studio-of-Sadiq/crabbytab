import type {
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

/** Collections the public projection is derived from. */
export const PUBLIC_SOURCE_COLLECTIONS = [
  "rounds",
  "teams",
  "adjudicators",
  "debates",
  "ballots",
  "motions",
  "breakCategories",
  "institutions",
  "venues",
] as const;

export type PublicSourceCollection = (typeof PUBLIC_SOURCE_COLLECTIONS)[number];
export type SourceRecord = Record<string, unknown> & { id: string };
export type PublicSourceData = Record<PublicSourceCollection, SourceRecord[]>;

export const PUBLIC_COLLECTION_NAMES = [
  "rounds",
  "teams",
  "adjudicators",
  "venues",
  "motions",
  "breakCategories",
  "debates",
  "ballots",
  "institutions",
] as const;

export type PublicCollectionName = (typeof PUBLIC_COLLECTION_NAMES)[number];

export interface PublicProjection {
  tournament: Tournament;
  collections: Record<PublicCollectionName, Record<string, unknown>[]> & { feedback: [] };
}

export interface AvailabilityRecord {
  checkedIn?: boolean;
  checkedInAt?: string;
  roundAvailability?: Record<string, boolean>;
  roundAvailabilityAt?: Record<string, string>;
}

/**
 * Anonymous availability data for the public check-in status page. It holds no names or ids; the
 * route only ever returns aggregate counts computed from it.
 */
export interface PublicCheckinsSource {
  enabled: boolean;
  tournamentName: string;
  expiresAfterHours?: number;
  rounds: Array<{ id: string; name: string; seq: number }>;
  teams: AvailabilityRecord[];
  adjudicators: AvailabilityRecord[];
}

function pick<T extends object, K extends keyof T>(value: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(
    keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]])
  ) as Pick<T, K>;
}

function active(records: SourceRecord[] | undefined): SourceRecord[] {
  return (records || []).filter((record) => typeof record.deletedAt !== "string");
}

/**
 * Builds the sanitized, publicly visible view of a tournament from its raw records. Pure: the same
 * input always yields the same output, so it runs both on the server (to publish) and in the admin's
 * browser (to detect whether anything public has changed).
 */
export function buildPublicProjection(
  tournamentRecord: SourceRecord,
  source: PublicSourceData
): PublicProjection {
  const tournamentData = tournamentRecord as Partial<Tournament> & SourceRecord;
  const preferences = (tournamentData.preferences || {}) as Partial<Tournament["preferences"]>;
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
    ]),
    id: tournamentRecord.id,
    ownerId: "",
    admins: {},
  } as Tournament;

  const allRounds = active(source.rounds) as unknown as Round[];
  const isDrawPublished = (round: Round) =>
    preferences.publicDraw !== false &&
    (round.drawStatus === "confirmed" || round.drawStatus === "released");
  const areResultsPublished = (round: Round) =>
    preferences.publicResults !== false && round.resultsReleased === true && round.silent !== true;

  const visibleRounds = allRounds.filter(
    (round) => !round.cancelled && (isDrawPublished(round) || areResultsPublished(round))
  );
  const visibleRoundById = new Map(visibleRounds.map((round) => [round.id, round]));
  const motionRecords = active(source.motions) as unknown as Motion[];
  const visibleMotionIds = new Set(
    preferences.publicMotions !== false
      ? motionRecords.filter((motion) => motion.released === true).map((motion) => motion.id)
      : []
  );

  const debates = (active(source.debates) as unknown as Debate[])
    .filter((debate) => visibleRoundById.has(debate.roundId))
    .map((debate) => {
      const round = visibleRoundById.get(debate.roundId)!;
      const revealAdjudicators = preferences.publicDraw !== false && round.adjudicatorsRevealed === true;
      const resultsPublished = areResultsPublished(round);
      const motionVisible = Boolean(debate.motionId && visibleMotionIds.has(debate.motionId));
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
        ]),
        id: debate.id,
        byeResult: resultsPublished ? debate.byeResult : undefined,
        resultStatus: resultsPublished ? debate.resultStatus : "none",
        motionId: motionVisible ? debate.motionId : undefined,
        motionText: motionVisible ? debate.motionText : undefined,
        adjudicators: revealAdjudicators && debate.adjudicators
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

  const ballots = (active(source.ballots) as unknown as BallotSubmission[])
    .filter((ballot) => {
      const round = visibleRoundById.get(ballot.roundId);
      return Boolean(round && areResultsPublished(round) && ballot.confirmed === true && ballot.discarded !== true);
    })
    .map((ballot) => {
      const round = visibleRoundById.get(ballot.roundId)!;
      const showSpeakerScores = round.teamSpeaksReleased === true;
      const motionVisible = visibleMotionIds.has(ballot.motionId || "");
      return {
        ...pick(ballot, ["tournamentId", "roundId", "debateId", "version", "confirmed", "discarded", "timestamp"]),
        id: ballot.id,
        motionId: motionVisible ? ballot.motionId : undefined,
        motionText: motionVisible ? ballot.motionText : undefined,
        speakerScores: showSpeakerScores ? ballot.speakerScores : {},
        teamScores: Object.fromEntries(
          Object.entries(ballot.teamScores || {}).map(([side, score]) => [
            side,
            showSpeakerScores ? score : pick(score, ["side", "teamId", "points", "win", "rank"]),
          ])
        ),
      };
    });

  const publicTeamIds = new Set(
    debates.flatMap((debate) =>
      Object.values(debate.teams || {})
        .map((slot) => (slot as { teamId?: string } | undefined)?.teamId)
        .filter(Boolean)
    )
  );
  const teams = (active(source.teams) as unknown as Team[])
    .filter((team) => publicTeamIds.has(team.id))
    .map((team) => ({
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
      ]),
      id: team.id,
      speakers: Array.isArray(team.speakers)
        ? team.speakers.map((speaker) => pick(speaker, ["id", "name", "categories"]))
        : [],
    }));

  const revealedAdjudicatorIds = new Set(
    debates.flatMap((debate) => {
      const panel = debate.adjudicators as Partial<Debate["adjudicators"]>;
      return [panel.chairId, ...(panel.panellistIds || []), ...(panel.traineeIds || [])].filter(Boolean);
    })
  );
  const adjudicators = (active(source.adjudicators) as unknown as Adjudicator[])
    .filter((adjudicator) => revealedAdjudicatorIds.has(adjudicator.id))
    .map((adjudicator) => ({
      ...pick(adjudicator, ["tournamentId", "name", "institutionId", "institutionName"]),
      id: adjudicator.id,
    }));

  const rounds = visibleRounds.map((round) => {
    const publishedResults = areResultsPublished(round);
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
      ]),
      adjudicatorsRevealed: isDrawPublished(round) && round.adjudicatorsRevealed === true,
      motionsReleased: preferences.publicMotions !== false && round.motionsReleased === true,
      resultsReleased: publishedResults,
      teamSpeaksReleased: publishedResults && round.teamSpeaksReleased === true,
    };
  });

  const motions = motionRecords
    .filter((motion) => visibleMotionIds.has(motion.id))
    .map((motion) => ({
      ...pick(motion, ["tournamentId", "text", "reference", "infoSlide", "rounds", "seq", "released"]),
      id: motion.id,
    }));
  const breakCategories = (active(source.breakCategories) as unknown as BreakCategory[]).map((category) => ({
    ...pick(category, ["tournamentId", "name", "slug", "seq", "breakSize", "reserveSize", "isGeneral", "priority"]),
    id: category.id,
  }));
  const institutions = (active(source.institutions) as unknown as Institution[]).map((institution) => ({
    ...pick(institution, ["tournamentId", "name", "code", "region"]),
    id: institution.id,
  }));
  const venues = (active(source.venues) as unknown as Venue[]).map((venue) => ({
    ...pick(venue, ["tournamentId", "name", "category", "capacity", "accessible", "online", "available"]),
    id: venue.id,
  }));

  return {
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
  };
}

function availability(record: SourceRecord): AvailabilityRecord {
  return pick(record as AvailabilityRecord, ["checkedIn", "checkedInAt", "roundAvailability", "roundAvailabilityAt"]);
}

export function buildPublicCheckinsSource(
  tournamentRecord: SourceRecord,
  source: Pick<PublicSourceData, "rounds" | "teams" | "adjudicators">
): PublicCheckinsSource {
  const tournament = tournamentRecord as Partial<Tournament> & SourceRecord;
  const enabled = tournament.preferences?.publicCheckInStatus === true;
  const expiresAfterHours = tournament.preferences?.checkInExpiresAfterHours;
  return {
    enabled,
    tournamentName: tournament.shortName || tournament.name || "Tournament",
    ...(typeof expiresAfterHours === "number" ? { expiresAfterHours } : {}),
    // Availability details are only stored when the organiser has opted in to public counts.
    rounds: enabled
      ? (active(source.rounds) as unknown as Round[])
          .filter((round) => !round.cancelled)
          .sort((left, right) => left.seq - right.seq)
          .map((round) => ({ id: round.id, name: round.name, seq: round.seq }))
      : [],
    teams: enabled ? active(source.teams).map(availability) : [],
    adjudicators: enabled ? active(source.adjudicators).map(availability) : [],
  };
}

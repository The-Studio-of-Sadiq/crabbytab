import { MANUAL_SIDES_FLAG } from "@/lib/draw/manualSides";
import { safeVenueUrl } from "@/lib/venues/venues";
import type {
  Adjudicator,
  BallotSubmission,
  BreakCategory,
  Debate,
  FeedbackSubmission,
  Institution,
  Motion,
  Round,
  Team,
  Tournament,
  Venue,
} from "@/types";
import {
  getPublicRelease,
  isAnyTabReleased,
  isInReleasedBreak,
  isTabRound,
  redactUnreleasedBreak,
} from "@/lib/publicRelease";
import { resolveSpeakerCategoryIds } from "@/lib/speakerCategories";
import { motionsStatusOf } from "@/features/tournament/application/motionRelease";
import { publicScheduleEvents } from "@/lib/schedule/events";
import { currentDrawRoundId, getPublicSiteSettings, isRoundDrawPublic, type PublicSiteSettings } from "@/lib/publicFeatures";
import { sheetOutcome } from "@/lib/ballots/result";
import { createPublicNamer, renamePanel, type PublicNamer } from "@/lib/publicView/names";
import { hasCodeName } from "@/lib/codeNames";
import { buildPublicDerived, type PublicDerived, type PublicTabs } from "@/lib/publicView/derived";

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
/**
 * Feedback is read only when a public feature aggregates it (`needsPublicFeedback`), so ordinary
 * publishes do not pay for a full read of the feedback collection.
 */
export type PublicSourceData = Record<PublicSourceCollection, SourceRecord[]> & { feedback?: SourceRecord[] };

/** Whether the public view aggregates feedback (adjudicator tab scores, diversity, feedback progress). */
export function needsPublicFeedback(preferences: Partial<Tournament["preferences"]> | null | undefined): boolean {
  const settings = getPublicSiteSettings(preferences);
  return settings.diversity || settings.feedbackProgress || (settings.adjudicatorTab && settings.adjudicatorTabShows !== "test");
}

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
  /** Tabs computed at publish time (top-N limits applied); absent when no tab is released. */
  tabs?: PublicTabs;
  /** Other publish-time aggregates (adjudicator tab, diversity, ...); see derived.ts. */
  derived: PublicDerived;
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

const SIDES = new Set(["OG", "OO", "CG", "CO", "AFF", "NEG"]);

/** Numbers, booleans and nested arrays / records of them: score data, never free text. */
function isScoreShaped(value: unknown, depth = 0): boolean {
  if (typeof value === "number" || typeof value === "boolean" || value === null) return true;
  if (depth > 3 || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).every((item) => isScoreShaped(item, depth + 1));
}

/**
 * Copies a scoresheet entry or sheet: the known fields, names through the public namer, plus any
 * other score-shaped field (criteria scores, ranks, ...) and side-valued strings (a declared
 * winner), so ballots gaining such fields render without changing this allowlist. Free text never
 * passes.
 */
function copyScoreFields(record: Record<string, unknown>, known: Set<string>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([key, value]) => !known.has(key) && (isScoreShaped(value) || (typeof value === "string" && SIDES.has(value)))
    )
  );
}

const ENTRY_KEYS = new Set(["speakerId", "speakerName", "position", "score", "ghost"]);
const SHEET_KEYS = new Set(["adjudicatorId", "adjudicatorName", "speakerScores"]);

function publicSpeakerEntries(scores: unknown, namer: PublicNamer): Record<string, unknown[]> {
  if (!scores || typeof scores !== "object") return {};
  return Object.fromEntries(
    Object.entries(scores as Record<string, unknown>).map(([side, entries]) => [
      side,
      (Array.isArray(entries) ? entries : []).filter((entry) => entry && typeof entry === "object").map((value) => {
        const entry = value as Record<string, unknown>;
        const speakerId = typeof entry.speakerId === "string" ? entry.speakerId : undefined;
        return {
          ...copyScoreFields(entry, ENTRY_KEYS),
          ...pick(entry, ["speakerId", "position", "score", "ghost"]),
          ...(entry.speakerName !== undefined || speakerId
            ? { speakerName: namer.speaker(speakerId, typeof entry.speakerName === "string" ? entry.speakerName : "") }
            : {}),
          ...(namer.isSpeakerAnonymous(speakerId) ? { anonymous: true } : {}),
        };
      }),
    ])
  );
}

function publicSheets(sheets: unknown, namer: PublicNamer): Record<string, unknown>[] {
  return (Array.isArray(sheets) ? sheets : []).filter((sheet) => sheet && typeof sheet === "object").map((value) => {
    const sheet = value as Record<string, unknown>;
    const adjudicatorId = typeof sheet.adjudicatorId === "string" ? sheet.adjudicatorId : undefined;
    return {
      ...copyScoreFields(sheet, SHEET_KEYS),
      ...(adjudicatorId ? { adjudicatorId } : {}),
      adjudicatorName: namer.adjudicator(adjudicatorId, typeof sheet.adjudicatorName === "string" ? sheet.adjudicatorName : ""),
      speakerScores: publicSpeakerEntries(sheet.speakerScores, namer),
    };
  });
}

/** Voting adjudicators whose own sheet picked the losing team (Tabbycat "splitting adjudicators"). */
function splittingAdjudicatorIds(ballot: BallotSubmission, tournament: Pick<Tournament, "format" | "preferences">): string[] {
  const winner = Object.values(ballot.teamScores || {}).find((score) => score?.win === true)?.side;
  if (!winner || !Array.isArray(ballot.sheets) || ballot.sheets.length < 2) return [];
  const rules = { format: tournament.format, preferences: tournament.preferences };
  return ballot.sheets
    .filter((sheet) => {
      const declared = (sheet as unknown as { winner?: unknown }).winner;
      const sheetWinner = typeof declared === "string" && SIDES.has(declared) ? declared : sheetOutcome(sheet, rules).winner;
      return sheetWinner !== undefined && sheetWinner !== winner;
    })
    .map((sheet) => sheet.adjudicatorId);
}

/** Institution fields kept only when the setting shows them. */
function institutionFields<T extends { institutionId?: string; institutionName?: string }>(record: T, show: boolean) {
  return show ? pick(record, ["institutionId", "institutionName"]) : {};
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
  const settings: PublicSiteSettings = getPublicSiteSettings(preferences);
  // Only public speaker categories leave the server, and only as ids: who is in a private
  // category (e.g. novice) stays private.
  const publicSpeakerCategories = (Array.isArray(preferences.speakerCategories) ? preferences.speakerCategories : [])
    .filter((category) => category.public === true);
  const publicCategoryIds = (refs: unknown): string[] =>
    Array.isArray(refs) ? resolveSpeakerCategoryIds(refs.filter((ref): ref is string => typeof ref === "string"), publicSpeakerCategories) : [];
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
  if (tournament.preferences) {
    // The schedule is public only once released, with titles resolved (it may name rounds whose
    // draw is not out yet, which the projection does not carry).
    const { scheduleEvents: _scheduleEvents, ...publicPreferences } = tournament.preferences;
    void _scheduleEvents;
    tournament.preferences = {
      ...publicPreferences,
      speakerCategories: publicSpeakerCategories,
      // Room category descriptions leave the server only when marked for the public tooltip.
      ...(Array.isArray(preferences.venueCategories)
        ? {
            venueCategories: preferences.venueCategories.map(({ description, publicTooltip, ...category }) =>
              publicTooltip ? { ...category, description, publicTooltip } : category
            ),
          }
        : {}),
      ...(preferences.publicSchedule === true
        ? { scheduleEvents: publicScheduleEvents(preferences.scheduleEvents, allRounds.filter((round) => !round.cancelled)) }
        : {}),
    } as Tournament["preferences"];
  }

  const currentRoundId = currentDrawRoundId(allRounds);
  const isDrawPublished = (round: Round) => isRoundDrawPublic(round, settings.drawMode, currentRoundId);
  const areResultsPublished = (round: Round) =>
    preferences.publicResults !== false && round.resultsReleased === true && round.silent !== true;

  // Tournament-level releases: a released tab exposes every completed preliminary round's
  // confirmed results (silent rounds included); an unreleased break category exposes nothing about
  // who broke. With a top-N limit the tabs are computed here instead (see derived.ts) and rounds
  // seen only through the tab publish no results, so ranks below the cutoff cannot be rebuilt.
  const release = getPublicRelease(preferences);
  const tabReleased = isAnyTabReleased(release);
  const tabLimited = settings.teamTabLimit > 0 || settings.speakerTabLimit > 0 || settings.repliesTabLimit > 0;
  const inReleasedTab = (round: Round) => tabReleased && !tabLimited && isTabRound(round);
  const resultsVisible = (round: Round) => areResultsPublished(round) || inReleasedTab(round);

  const visibleRounds = allRounds.filter(
    (round) =>
      !round.cancelled && (inReleasedTab(round) || isDrawPublished(round) || areResultsPublished(round))
  );
  const visibleRoundById = new Map(visibleRounds.map((round) => [round.id, round]));
  const motionRecords = active(source.motions) as unknown as Motion[];
  const visibleMotionIds = new Set(
    preferences.publicMotions !== false
      ? motionRecords.filter((motion) => motion.released === true).map((motion) => motion.id)
      : []
  );
  // Info slides of rounds whose info slides (but not motions) are released: the slide only, never
  // the motion text (Tabbycat's "info slides released").
  const infoSlideRoundIds = new Set(
    preferences.publicMotions !== false
      ? allRounds.filter((round) => !round.cancelled && motionsStatusOf(round) === "info_slides_released").map((round) => round.id)
      : []
  );

  const teamRecords = active(source.teams) as unknown as Team[];
  const adjudicatorRecords = active(source.adjudicators) as unknown as Adjudicator[];
  const namer = createPublicNamer(teamRecords, adjudicatorRecords, settings);
  const revealsPanel = (round: Round) => settings.drawMode !== "off" && round.adjudicatorsRevealed === true;
  const speakerScoresVisible = (round: Round) =>
    resultsVisible(round) && (round.teamSpeaksReleased === true || inReleasedTab(round));

  const debates = (active(source.debates) as unknown as Debate[])
    .filter((debate) => visibleRoundById.has(debate.roundId))
    .map((debate) => {
      const round = visibleRoundById.get(debate.roundId)!;
      const resultsPublished = resultsVisible(round);
      const speakerScoresPublished = speakerScoresVisible(round);
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
        ]),
        // Only the marker for sides chosen at the debate is public, so pages can say so.
        ...(debate.flags?.includes(MANUAL_SIDES_FLAG) ? { flags: [MANUAL_SIDES_FLAG] } : {}),
        // Confirming a ballot copies its points and speaker total onto the team slots, so they are
        // released on the same terms as the ballot itself.
        teams: Object.fromEntries(
          Object.entries(debate.teams || {}).map(([side, slot]) => {
            if (!slot) return [side, slot];
            const { points, speakerScoreTotal, teamName, ...rest } = slot;
            return [side, {
              ...pick(rest, ["teamId", "side", "pulledUp", "bracketPosition"]),
              ...(teamName !== undefined ? { teamName: namer.team(rest.teamId, teamName) } : {}),
              ...(resultsPublished && points !== undefined ? { points } : {}),
              ...(speakerScoresPublished && speakerScoreTotal !== undefined ? { speakerScoreTotal } : {}),
            }];
          })
        ),
        id: debate.id,
        byeResult: resultsPublished ? debate.byeResult : undefined,
        resultStatus: resultsPublished ? debate.resultStatus : "none",
        motionId: motionVisible ? debate.motionId : undefined,
        motionText: motionVisible ? debate.motionText : undefined,
        adjudicators: revealsPanel(round) && debate.adjudicators
          ? renamePanel(pick(debate.adjudicators, [
              "chairId",
              "chairName",
              "panellistIds",
              "panellistNames",
              "traineeIds",
              "traineeNames",
            ]), namer)
          : { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
      };
    });

  const ballotRecords = active(source.ballots) as unknown as BallotSubmission[];
  const ballots = ballotRecords
    .filter((ballot) => {
      const round = visibleRoundById.get(ballot.roundId);
      return Boolean(round && resultsVisible(round) && ballot.confirmed === true && ballot.discarded !== true);
    })
    .map((ballot) => {
      const round = visibleRoundById.get(ballot.roundId)!;
      const showSpeakerScores = speakerScoresVisible(round);
      const motionVisible = visibleMotionIds.has(ballot.motionId || "");
      // Splits are part of the result, but naming who split needs the panel to be public.
      const splits = settings.showSplittingAdjudicators && revealsPanel(round)
        ? splittingAdjudicatorIds(ballot, tournament)
        : [];
      return {
        ...pick(ballot, [
          "tournamentId",
          "roundId",
          "debateId",
          "version",
          "confirmed",
          "discarded",
          "timestamp",
          "forfeitSide",
          "noSpeakerScores",
        ]),
        id: ballot.id,
        motionId: motionVisible ? ballot.motionId : undefined,
        motionText: motionVisible ? ballot.motionText : undefined,
        speakerScores: showSpeakerScores ? publicSpeakerEntries(ballot.speakerScores, namer) : {},
        teamScores: Object.fromEntries(
          Object.entries(ballot.teamScores || {}).map(([side, score]) => [
            side,
            showSpeakerScores ? score : pick(score, ["side", "teamId", "points", "win", "rank"]),
          ])
        ),
        // Tabbycat `ballots_released`: every adjudicator's scoresheet, released with the round's
        // speaker scores and panel.
        ...(settings.ballots && showSpeakerScores && revealsPanel(round) && Array.isArray(ballot.sheets)
          ? { sheets: publicSheets(ballot.sheets, namer) }
          : {}),
        ...(splits.length > 0 ? { splitAdjudicatorIds: splits } : {}),
      };
    });

  const breakCategoryRecords = active(source.breakCategories) as unknown as BreakCategory[];
  const releasedBreakTeamIds = new Set([
    ...breakCategoryRecords
      .filter((category) => release.breakCategoryIds.has(category.id))
      .flatMap((category) => category.generatedBreak?.breakingTeamIds ?? []),
    ...teamRecords.filter((team) => isInReleasedBreak(team, release)).map((team) => team.id),
  ]);
  const sideAllocationTeamIds = settings.sideAllocations
    ? allRounds
        .filter((round) => round.cancelled !== true && round.stage === "preliminary")
        .flatMap((round) => Object.keys(round.preallocatedSides ?? {}))
    : [];
  const publicTeamIds = new Set([
    ...debates.flatMap((debate) =>
      Object.values(debate.teams || {})
        .map((slot) => (slot as { teamId?: string } | undefined)?.teamId)
        .filter((teamId): teamId is string => Boolean(teamId))
    ),
    ...releasedBreakTeamIds,
    // A released participants list names every registered team.
    ...(release.participants ? teamRecords.map((team) => team.id) : []),
    ...sideAllocationTeamIds,
  ]);
  const showEligibility = settings.breakCategoriesOnParticipants || settings.breakCategoryTabs;
  const teams = teamRecords
    .filter((team) => publicTeamIds.has(team.id))
    .map((team) => ({
      ...redactUnreleasedBreak(pick(team, [
        "tournamentId",
        "breakStatus",
        "breakCategoryIds",
        "eliminatedInRoundId",
        "seed",
      ]), release),
      name: namer.team(team.id, team.name),
      // "all-tooltips" shows real names with the code name as a tooltip; other modes publish one name.
      ...(settings.teamCodeNames === "all-tooltips" && hasCodeName(team) ? { codeName: team.codeName!.trim() } : {}),
      ...institutionFields(team, settings.showTeamInstitutions),
      ...(settings.showEmoji && team.emoji ? { emoji: team.emoji } : {}),
      // Break eligibility (not the break itself) is public only on request (Tabbycat `public_break_categories`).
      ...(showEligibility && Array.isArray(team.breakCategories) ? { breakCategories: team.breakCategories } : {}),
      id: team.id,
      speakerCategories: publicCategoryIds(team.speakerCategories),
      speakers: Array.isArray(team.speakers)
        ? team.speakers.map((speaker) => ({
            id: speaker.id,
            name: namer.speaker(speaker.id, speaker.name),
            ...(speaker.anonymous === true ? { anonymous: true } : {}),
            // Kept absent when absent, so the team-wide fallback still applies.
            ...(speaker.categories !== undefined ? { categories: publicCategoryIds(speaker.categories) } : {}),
          }))
        : [],
    }));

  const revealedAdjudicatorIds = new Set(
    debates.flatMap((debate) => {
      const panel = debate.adjudicators as Partial<Debate["adjudicators"]>;
      return [panel.chairId, ...(panel.panellistIds || []), ...(panel.traineeIds || [])].filter(Boolean);
    })
  );
  // Adjudicators are public when they sit on a revealed panel or appear on a released list. The
  // core / breaking flags are only sent once their list is released, so an unreleased breaking-adjudicator
  // decision cannot be read from the projection.
  const isListedAdjudicator = (adjudicator: Adjudicator) =>
    release.participants ||
    (release.adjudicatorCore && adjudicator.adjCore === true) ||
    (release.breakingAdjudicators && adjudicator.breaking === true);
  const adjudicators = adjudicatorRecords
    .filter((adjudicator) => revealedAdjudicatorIds.has(adjudicator.id) || isListedAdjudicator(adjudicator))
    .map((adjudicator) => ({
      ...pick(adjudicator, ["tournamentId"]),
      name: namer.adjudicator(adjudicator.id, adjudicator.name),
      ...(adjudicator.anonymous === true ? { anonymous: true } : {}),
      ...institutionFields(adjudicator, settings.showAdjudicatorInstitutions),
      ...(release.adjudicatorCore && adjudicator.adjCore === true ? { adjCore: true } : {}),
      ...(release.breakingAdjudicators && adjudicator.breaking === true ? { breaking: true } : {}),
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
        "weight",
        "motionsReleased",
        "scheduleGroup",
        "startsAt",
        "resultsReleased",
        "teamSpeaksReleased",
        "breakCategoryIds",
        "eliminationAdvanced",
        "cancelled",
        "completed",
        "createdAt",
      ]),
      // Whether this round's draw is on the public draw page (the draw mode decides).
      drawPublic: isDrawPublished(round),
      adjudicatorsRevealed: revealsPanel(round),
      motionsReleased: preferences.publicMotions !== false && round.motionsReleased === true,
      motionsStatus: preferences.publicMotions !== false ? motionsStatusOf(round) : "not_released",
      resultsReleased: publishedResults,
      teamSpeaksReleased: publishedResults && round.teamSpeaksReleased === true,
    };
  });

  const motions = [
    ...motionRecords
      .filter((motion) => visibleMotionIds.has(motion.id))
      .map((motion) => ({
        ...pick(motion, ["tournamentId", "text", "reference", "infoSlide", "rounds", "seq", "roundSeq", "released"]),
        id: motion.id,
      })),
    ...motionRecords
      .filter((motion) =>
        !visibleMotionIds.has(motion.id) &&
        Boolean(motion.infoSlide?.trim()) &&
        (motion.rounds || []).some((roundId) => infoSlideRoundIds.has(roundId))
      )
      .map((motion) => {
        const rounds = (motion.rounds || []).filter((roundId) => infoSlideRoundIds.has(roundId));
        const roundSeq = Object.fromEntries(
          Object.entries(motion.roundSeq || {}).filter(([roundId]) => infoSlideRoundIds.has(roundId))
        );
        return {
          ...pick(motion, ["tournamentId", "infoSlide", "seq"]),
          ...(Object.keys(roundSeq).length > 0 ? { roundSeq } : {}),
          id: motion.id,
          text: "",
          rounds,
          released: false,
        };
      }),
  ];
  const breakCategories = breakCategoryRecords.map((category) => ({
    ...(release.breakCategoryIds.has(category.id) ? pick(category, ["generatedBreak"]) : {}),
    ...pick(category, ["tournamentId", "name", "slug", "seq", "breakSize", "reserveSize", "isGeneral", "priority"]),
    id: category.id,
  }));
  const institutionRecords = active(source.institutions) as unknown as Institution[];
  const institutions = institutionRecords.map((institution) => ({
    ...pick(institution, ["tournamentId", "name", "code", "region"]),
    id: institution.id,
  }));
  const venues = (active(source.venues) as unknown as Venue[]).map((venue) => ({
    ...pick(venue, ["tournamentId", "name", "category", "capacity", "accessible", "online", "available"]),
    // Room links appear with the public draw, as in Tabbycat; only http(s) links are published.
    ...(safeVenueUrl(venue.url) ? { url: safeVenueUrl(venue.url) } : {}),
    id: venue.id,
  }));

  const { tabs, derived } = buildPublicDerived(
    {
      tournament: {
        id: tournamentRecord.id,
        format: tournament.format,
        preferences: (tournament.preferences ?? {}) as Tournament["preferences"],
      },
      settings,
      release,
      rounds: allRounds,
      teams: teamRecords,
      adjudicators: adjudicatorRecords,
      debates: active(source.debates) as unknown as Debate[],
      ballots: ballotRecords,
      motions: motionRecords,
      institutions: institutionRecords,
      breakCategories: breakCategoryRecords,
      feedback: active(source.feedback) as unknown as FeedbackSubmission[],
      namer,
      speakerScoreRoundIds: new Set(visibleRounds.filter(speakerScoresVisible).map((round) => round.id)),
      resultRoundIds: new Set(visibleRounds.filter(resultsVisible).map((round) => round.id)),
      revealedRoundIds: new Set(visibleRounds.filter(revealsPanel).map((round) => round.id)),
      visibleMotionIds,
      publicTeamIds,
      publicAdjudicatorIds: new Set(adjudicators.map((adjudicator) => adjudicator.id)),
    },
    releasedBreakTeamIds
  );

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
    ...(tabs ? { tabs } : {}),
    derived,
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

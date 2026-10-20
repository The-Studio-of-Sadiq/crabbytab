import type {
  Adjudicator,
  BallotSubmission,
  BreakCategory,
  Debate,
  FeedbackSubmission,
  Institution,
  Motion,
  Round,
  Speaker,
  Team,
  Tournament,
  Venue,
} from "@/types";
import { s, type JsonSchema, type Schema } from "./schema";
import type { StoredRecord } from "./store";

/**
 * Record -> API representation. Serializers copy an explicit allow-list of fields, so a field
 * added to a stored record is never exposed by accident. Private portal credentials
 * (`privateUrlKey`, `privatePasscode`) and participant email addresses are never returned.
 *
 * Public-view records (lib/publicView/projection.ts) are already stripped of unreleased data;
 * the same serializers run on them, and fields the projection left out are simply absent.
 */

type Json = Record<string, unknown>;

function pick<T extends object>(value: T, keys: Array<keyof T>): Json {
  const result: Json = {};
  for (const key of keys) {
    const item = value[key];
    if (item !== undefined) result[key as string] = item;
  }
  return result;
}

export function asType<T>(record: StoredRecord): T {
  return record as unknown as T;
}

/* ------------------------------------------------------------------------ */
/* Serializers                                                               */
/* ------------------------------------------------------------------------ */

export function serializeTournament(tournament: Tournament, view: "admin" | "public"): Json {
  return {
    ...pick(tournament, ["id", "name", "shortName", "slug", "format", "active", "createdAt", "updatedAt"]),
    ...(view === "admin" ? pick(tournament, ["syncVersion"]) : {}),
  };
}

export function serializeRound(round: Round): Json {
  return pick(round, [
    "id",
    "seq",
    "name",
    "abbreviation",
    "stage",
    "drawType",
    "drawStatus",
    "adjudicatorsRevealed",
    "feedbackWeight",
    "feedbackEnabled",
    "silent",
    "motionsReleased",
    "resultsReleased",
    "teamSpeaksReleased",
    "breakCategoryIds",
    "eliminationAdvanced",
    "cancelled",
    "completed",
    "drawSeed",
    "createdAt",
    "syncVersion" as keyof Round,
  ]);
}

export function serializeMotion(motion: Motion): Json {
  return pick(motion, ["id", "text", "reference", "infoSlide", "rounds", "seq", "released", "syncVersion" as keyof Motion]);
}

export function serializeInstitution(institution: Institution): Json {
  return pick(institution, ["id", "name", "code", "region", "venueRequirements", "syncVersion" as keyof Institution]);
}

export function serializeSpeaker(speaker: Speaker, team: Pick<Team, "id" | "name">): Json {
  return {
    ...pick(speaker, ["id", "name", "lastName", "pronoun", "gender", "region", "categories", "swingSourceSpeakerId"]),
    teamId: team.id,
    teamName: team.name,
  };
}

export function serializeTeam(team: Team): Json {
  return {
    ...pick(team, [
      "id",
      "name",
      "codeName",
      "emoji",
      "seed",
      "institutionId",
      "institutionName",
      "divisionId",
      "breakCategories",
      "breakCategoryIds",
      "breakStatus",
      "eliminatedInRoundId",
      "speakerCategories",
      "institutionConflictIds",
      "checkedIn",
      "checkedInAt",
      "roundAvailability",
      "venueRequirements",
      "isSwing",
      "swingRoundIds",
      "syncVersion" as keyof Team,
    ]),
    speakers: (team.speakers ?? []).map((speaker) =>
      pick(speaker, ["id", "name", "gender", "region", "categories", "swingSourceSpeakerId"])
    ),
  };
}

export function serializeAdjudicator(adjudicator: Adjudicator): Json {
  return pick(adjudicator, [
    "id",
    "name",
    "institutionId",
    "institutionName",
    "baseScore",
    "testScore",
    "trainee",
    "independent",
    "adjCore",
    "breaking",
    "isTester",
    "lastName",
    "pronoun",
    "gender",
    "region",
    "conflicts",
    "checkedIn",
    "checkedInAt",
    "roundAvailability",
    "preformedPanelId",
    "venueRequirements",
    "syncVersion" as keyof Adjudicator,
  ]);
}

export function serializeVenue(venue: Venue): Json {
  return pick(venue, [
    "id",
    "name",
    "priority",
    "category",
    "categories",
    "capacity",
    "accessible",
    "online",
    "nearTabRoom",
    "available",
    "checkedIn",
    "syncVersion" as keyof Venue,
  ]);
}

export function serializeBreakCategory(category: BreakCategory): Json {
  return pick(category, [
    "id",
    "name",
    "slug",
    "seq",
    "breakSize",
    "reserveSize",
    "isGeneral",
    "priority",
    "maxPerInstitution",
    "limit",
    "qualificationRule",
    "teamOverrides",
    "speakerCategoryRule",
    "generatedBreak",
    "syncVersion" as keyof BreakCategory,
  ]);
}

/** A pairing (debate): teams by side, adjudicators and venue. */
export function serializeDebate(debate: Debate): Json {
  return {
    ...pick(debate, [
      "id",
      "roundId",
      "roundSeq",
      "roomRank",
      "bracket",
      "importance",
      "venueId",
      "venueName",
      "byeTeamId",
      "byeResult",
      "breakCategoryId",
      "resultStatus",
      "sidesConfirmed",
      "flags",
      "motionId",
      "motionText",
      "postponed",
      "postponedReason",
      "syncVersion" as keyof Debate,
    ]),
    teams: Object.fromEntries(
      Object.entries(debate.teams ?? {}).filter(([, slot]) => Boolean(slot)).map(([side, slot]) => [
        side,
        pick(slot, ["teamId", "teamName", "side", "points", "speakerScoreTotal", "pulledUp", "bracketPosition"]),
      ])
    ),
    adjudicators: debate.adjudicators
      ? pick(debate.adjudicators, ["chairId", "chairName", "panellistIds", "panellistNames", "traineeIds", "traineeNames"])
      : null,
  };
}

/**
 * Ballots are serialised generically: the score maps are passed through as stored, so ballot
 * shapes added by the results work (criteria, speaker ranks) appear without an API change.
 */
export function serializeBallot(ballot: BallotSubmission): Json {
  return pick(ballot, [
    "id",
    "roundId",
    "debateId",
    "version",
    "confirmed",
    "discarded",
    "submitterType",
    "submitterName",
    "motionId",
    "motionText",
    "speakerScores",
    "teamScores",
    "sheets",
    "vetoes",
    "forfeitSide",
    "selfSplit",
    "chairId",
    "timestamp",
    "confirmedTimestamp",
    "checksVersion",
    "discardedTimestamp",
    "syncVersion" as keyof BallotSubmission,
  ]);
}

export function serializeFeedback(feedback: FeedbackSubmission): Json {
  return pick(feedback, [
    "id",
    "roundId",
    "debateId",
    "targetType",
    "targetAdjudicatorId",
    "targetAdjudicatorName",
    "targetTeamId",
    "targetTeamName",
    "sourceType",
    "sourceId",
    "sourceName",
    "score",
    "agreeWithDecision",
    "comments",
    "answers",
    "confirmed",
    "ignored",
    "timestamp",
    "syncVersion" as keyof FeedbackSubmission,
  ]);
}

/* ------------------------------------------------------------------------ */
/* Response schemas (OpenAPI components)                                     */
/* ------------------------------------------------------------------------ */

const str = (description?: string) => s.optional(s.string({ description }));
const int = (description?: string) => s.optional(s.integer({ description }));
const num = (description?: string) => s.optional(s.number({ description }));
const bool = (description?: string) => s.optional(s.boolean(description));
const strList = (description?: string) => s.optional(s.array(s.string(), { description }));
const anything = (description?: string) => s.optional(s.unknown(description));
const version = int("Increments on every write; send it back as `expectedVersion` to detect concurrent edits.");

const responseObject = (shape: Record<string, Schema<unknown>>, description: string) =>
  s.object(shape, { description, strict: false });

export const COMPONENT_SCHEMAS: Record<string, Schema<unknown>> = {
  Tournament: responseObject({
    id: s.string(), name: s.string(), shortName: str(), slug: s.string(), format: s.string(),
    active: bool(), createdAt: str(), updatedAt: str(), syncVersion: version,
  }, "A tournament."),
  Round: responseObject({
    id: s.string(), seq: s.integer(), name: s.string(), abbreviation: str(),
    stage: s.enum(["preliminary", "elimination"] as const),
    drawType: str(), drawStatus: s.enum(["none", "draft", "locked", "teams_released", "confirmed", "released"] as const, "`confirmed` (or `released`) is the public release of the draw; `locked` is confirmed but unreleased; `teams_released` is visible to teams on their private URLs only."),
    adjudicatorsRevealed: bool(), feedbackWeight: num(), feedbackEnabled: bool(), silent: bool(),
    motionsReleased: bool(), resultsReleased: bool(), teamSpeaksReleased: bool(), breakCategoryIds: strList(),
    eliminationAdvanced: bool(), cancelled: bool(), completed: bool(), drawSeed: int(), createdAt: str(), syncVersion: version,
  }, "A round. Rounds are addressed by `seq` in paths."),
  Motion: responseObject({
    id: s.string(), text: s.string(), reference: str(), infoSlide: str(), rounds: strList("Round ids."),
    seq: int(), released: bool(), syncVersion: version,
  }, "A motion."),
  Institution: responseObject({ id: s.string(), name: s.string(), code: s.string(), region: str(), venueRequirements: anything(), syncVersion: version }, "An institution."),
  Speaker: responseObject({
    id: s.string(), name: s.string(), lastName: str(), pronoun: str(), gender: str(), region: str(), categories: strList("Speaker category ids (older data may hold names)."),
    swingSourceSpeakerId: str(), teamId: str(), teamName: str(),
  }, "A speaker. Email addresses are never returned."),
  Team: responseObject({
    id: s.string(), name: s.string(), codeName: str(), emoji: str(), seed: num(), institutionId: str(), institutionName: str(),
    speakers: s.array(s.ref("Speaker")), breakCategories: strList("Break categories the team is eligible for."),
    breakCategoryIds: strList("Break categories the team broke in."), breakStatus: str(), speakerCategories: strList(),
    institutionConflictIds: strList(), checkedIn: bool(), checkedInAt: str(), roundAvailability: anything("Round id -> available."),
    venueRequirements: anything(), isSwing: bool(), swingRoundIds: strList(), syncVersion: version,
  }, "A team. Private URL keys and passcodes are never returned."),
  Adjudicator: responseObject({
    id: s.string(), name: s.string(), institutionId: str(), institutionName: str(), baseScore: num(), testScore: num(),
    trainee: bool(), independent: bool(), adjCore: bool(), breaking: bool(), isTester: bool(), lastName: str(), pronoun: str(), gender: str(), region: str(),
    conflicts: anything("Conflicts with teams, adjudicators and institutions."), checkedIn: bool(), checkedInAt: str(),
    roundAvailability: anything(), preformedPanelId: str(), venueRequirements: anything(), syncVersion: version,
  }, "An adjudicator. Private URL keys, passcodes and email addresses are never returned."),
  Venue: responseObject({
    id: s.string(), name: s.string(), priority: num(), category: str(), categories: strList("Every room category, including `category`."), capacity: int(), accessible: bool(), online: bool(),
    nearTabRoom: bool(), available: bool(), checkedIn: bool(), syncVersion: version,
  }, "A venue (room)."),
  BreakCategory: responseObject({
    id: s.string(), name: s.string(), slug: s.string(), seq: int(), breakSize: s.integer(), reserveSize: int(),
    isGeneral: bool(), priority: num(), maxPerInstitution: int(), limit: int(), qualificationRule: str(), teamOverrides: anything(),
    speakerCategoryRule: anything(), generatedBreak: anything(), syncVersion: version,
  }, "A break category."),
  Pairing: responseObject({
    id: s.string(), roundId: s.string(), roundSeq: s.integer(), roomRank: num(), bracket: num(), importance: num(),
    venueId: str(), venueName: str(), byeTeamId: str(), byeResult: str(), breakCategoryId: str(), resultStatus: str(),
    sidesConfirmed: bool(), flags: strList(), motionId: str(), motionText: str(), postponed: bool(), postponedReason: str(),
    teams: anything("Side (OG/OO/CG/CO or AFF/NEG) -> team slot."), adjudicators: anything("Chair, panellists and trainees, or null when not revealed."),
    syncVersion: version,
  }, "A debate in a round's draw."),
  Ballot: responseObject({
    id: s.string(), roundId: s.string(), debateId: s.string(), version: s.integer(), confirmed: s.boolean(), discarded: s.boolean(),
    submitterType: str(), submitterName: str(), motionId: str(), motionText: str(),
    speakerScores: anything("Side -> speeches."), teamScores: anything("Side -> team result."), sheets: anything("Voting ballots: one sheet per adjudicator."),
    vetoes: anything(), forfeitSide: str(), selfSplit: bool("A solo adjudicator's 2:1 split decision."), chairId: str(), timestamp: str(), confirmedTimestamp: str(), checksVersion: int(),
    discardedTimestamp: str(), syncVersion: version,
  }, "A ballot submission (one version of a debate's result)."),
  Feedback: responseObject({
    id: s.string(), roundId: s.string(), debateId: s.string(), targetType: str(), targetAdjudicatorId: str(), targetAdjudicatorName: str(),
    targetTeamId: str(), targetTeamName: str(), sourceType: s.string(), sourceId: s.string(), sourceName: str(), score: s.number(),
    agreeWithDecision: bool(), comments: str(), answers: anything("Question id -> answer."), confirmed: s.boolean(), ignored: bool(),
    timestamp: str(), syncVersion: version,
  }, "Feedback on an adjudicator (or, where enabled, a team)."),
  CheckinStatus: responseObject({
    id: s.string(),
    checkedIn: s.boolean("Checked in, and not expired under the tournament's check-in expiry."),
    checkedInAt: s.nullable(s.string()),
    expiresAfterHours: s.nullable(s.number()),
    teamId: str("For a speaker: the team whose check-in this is."),
  }, "Check-in status."),
  Error: responseObject({
    error: s.object({
      code: s.string(),
      message: s.string(),
      issues: s.optional(s.array(s.object({ path: s.string(), message: s.string() }))),
      violations: s.optional(s.array(s.object({
        rule: s.string(), message: s.string(), overridable: s.boolean(), roundId: str(), debateId: str(),
      }, { strict: false }))),
    }, { strict: false }),
  }, "Error response."),
};

export function componentSchemasJson(): Record<string, JsonSchema> {
  return Object.fromEntries(Object.entries(COMPONENT_SCHEMAS).map(([name, schema]) => [name, schema.json()]));
}

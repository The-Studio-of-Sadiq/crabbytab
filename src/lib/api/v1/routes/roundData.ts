import { getPublicSiteSettings } from "@/lib/publicFeatures";
import { isAvailableForRound } from "@/lib/roundAvailability";
import { isVenueAvailableForRound, isVenueCheckedIn } from "@/lib/venues/venues";
import type {
  Adjudicator,
  BallotIntakeRecord,
  BallotSubmission,
  Debate,
  FeedbackSubmission,
  PreformedPanel,
  Team,
  Venue,
} from "@/types";
import { ApiError, notFound } from "../errors";
import { defineRoute, listOf, pageOf, pageQueryShape, pageRequest, slugParam } from "../router";
import { s } from "../schema";
import { asType, serializeBallot, serializeDebate, serializeFeedback } from "../serializers";
import type { QueryFilter } from "../store";
import { debateInRound, findSpeaker, idSchema, roundBySeq, roundSeqSchema, type AnyContext } from "./shared";

const roundParams = s.object({ slug: slugParam, roundSeq: roundSeqSchema });
const debateParams = s.object({ slug: slugParam, roundSeq: roundSeqSchema, debateId: idSchema("Debate (pairing) id.") });

const byRoom = (left: Debate, right: Debate) =>
  (left.roomRank ?? 0) - (right.roomRank ?? 0) || left.id.localeCompare(right.id);

/* ------------------------------------------------------------------------ */
/* Pairings and preformed panels                                             */
/* ------------------------------------------------------------------------ */

const pairingRoutes = [
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/rounds/{roundSeq}/pairings",
    operationId: "listPairings",
    summary: "List a round's pairings (draw)",
    description:
      "Every debate in the round in room order. Public tokens see a draw only once it is released, " +
      "and its panels only once adjudicators are revealed.",
    tag: "pairings",
    auth: { kind: "token", resource: "draws", access: "read", public: true },
    params: roundParams,
    response: listOf(s.ref("Pairing")),
    async handler(context) {
      const round = await roundBySeq(context, context.params.roundSeq);
      const debates = (await context.data.all("debates", [{ field: "roundId", op: "==", value: round.id }]))
        .map((record) => asType<Debate>(record))
        .sort(byRoom);
      return { data: debates.map(serializeDebate) };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/rounds/{roundSeq}/pairings/{debateId}",
    operationId: "getPairing",
    summary: "Get one pairing",
    tag: "pairings",
    auth: { kind: "token", resource: "draws", access: "read", public: true },
    params: debateParams,
    response: s.ref("Pairing"),
    async handler(context) {
      const round = await roundBySeq(context, context.params.roundSeq);
      return serializeDebate(await debateInRound(context, round, context.params.debateId));
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/rounds/{roundSeq}/preformed-panels",
    operationId: "listPreformedPanels",
    summary: "List a round's preformed panels",
    tag: "preformed-panels",
    auth: { kind: "token", resource: "draws", access: "read" },
    params: roundParams,
    response: listOf(s.object({
      id: s.string(),
      chairId: s.optional(s.string()),
      panellistIds: s.array(s.string()),
      traineeIds: s.array(s.string()),
      importance: s.number(),
    })),
    async handler(context) {
      const round = await roundBySeq(context, context.params.roundSeq);
      return { data: (round.preformedPanels ?? []).map((panel: PreformedPanel) => ({ ...panel })) };
    },
  }),
];

/* ------------------------------------------------------------------------ */
/* Ballots                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Public tokens and anonymous clients read ballots only once the tab director releases them
 * (Tabbycat `ballots_released`), and then only what the public view publishes: confirmed ballots
 * of rounds whose results are public, with speaker scores and scoresheets on the same terms as the
 * public results pages (lib/publicView/projection.ts).
 */
function requirePublicBallots(context: AnyContext): void {
  if (context.data.view === "public" && !getPublicSiteSettings(context.tournament.preferences).ballots) {
    throw new ApiError(403, "forbidden", "Ballots have not been released to the public.");
  }
}

const publicBallotNote =
  " Public tokens and anonymous clients: once ballots are released, the confirmed ballots of rounds " +
  "whose results are public, as the public site shows them.";

const ballotRoutes = [
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/rounds/{roundSeq}/ballots",
    operationId: "listRoundBallots",
    summary: "List a round's ballots",
    description: "Paginated; every version, including unconfirmed and discarded ones." + publicBallotNote,
    tag: "ballots",
    auth: { kind: "token", resource: "results", access: "read", public: true },
    params: roundParams,
    query: s.object({ ...pageQueryShape, confirmed: s.optional(s.boolean("Only confirmed (true) or unconfirmed (false) ballots.")) }),
    paginated: true,
    response: pageOf(s.ref("Ballot")),
    async handler(context) {
      requirePublicBallots(context);
      const round = await roundBySeq(context, context.params.roundSeq);
      const filters: QueryFilter[] = [{ field: "roundId", op: "==", value: round.id }];
      if (context.query.confirmed !== undefined) filters.push({ field: "confirmed", op: "==", value: context.query.confirmed });
      const page = await context.data.page("ballots", pageRequest(context.query), filters);
      return { ...page, data: page.data.map((record) => serializeBallot(asType<BallotSubmission>(record))) };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/rounds/{roundSeq}/pairings/{debateId}/ballots",
    operationId: "listDebateBallots",
    summary: "List a debate's ballots",
    description: "Every version, oldest first." + publicBallotNote,
    tag: "ballots",
    auth: { kind: "token", resource: "results", access: "read", public: true },
    params: debateParams,
    response: listOf(s.ref("Ballot")),
    async handler(context) {
      requirePublicBallots(context);
      const round = await roundBySeq(context, context.params.roundSeq);
      const debate = await debateInRound(context, round, context.params.debateId);
      const ballots = (await context.data.all("ballots", [{ field: "debateId", op: "==", value: debate.id }]))
        .map((record) => asType<BallotSubmission>(record))
        .sort((left, right) => left.version - right.version || left.id.localeCompare(right.id));
      return { data: ballots.map(serializeBallot) };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/rounds/{roundSeq}/pairings/{debateId}/ballots/{ballotId}",
    operationId: "getBallot",
    summary: "Get a ballot",
    description: publicBallotNote.trim(),
    tag: "ballots",
    auth: { kind: "token", resource: "results", access: "read", public: true },
    params: s.object({ slug: slugParam, roundSeq: roundSeqSchema, debateId: idSchema("Debate id."), ballotId: idSchema("Ballot id.") }),
    response: s.ref("Ballot"),
    async handler(context) {
      requirePublicBallots(context);
      const round = await roundBySeq(context, context.params.roundSeq);
      const debate = await debateInRound(context, round, context.params.debateId);
      const record = await context.data.get("ballots", context.params.ballotId);
      if (!record || record.debateId !== debate.id) throw notFound("Ballot");
      return serializeBallot(asType<BallotSubmission>(record));
    },
  }),
];

/* ------------------------------------------------------------------------ */
/* Feedback                                                                  */
/* ------------------------------------------------------------------------ */

const feedbackRoutes = [
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/feedback",
    operationId: "listFeedback",
    summary: "List feedback",
    description:
      "Paginated. Filters combine (Tabbycat's round[], source, source_type and target): `roundId` " +
      "takes one id or several separated by commas. One filter is applied by the query and the others " +
      "to its page, so a page may hold fewer than `limit` items while `nextCursor` is still set.",
    tag: "feedback",
    auth: { kind: "token", resource: "feedback", access: "read" },
    params: s.object({ slug: slugParam }),
    query: s.object({
      ...pageQueryShape,
      roundId: s.optional(s.string({ min: 1, max: 1000, pattern: /^[A-Za-z0-9_.:-]+(,[A-Za-z0-9_.:-]+)*$/, description: "Round id(s), comma-separated." })),
      targetAdjudicatorId: s.optional(idSchema("Only feedback on this adjudicator.")),
      sourceId: s.optional(idSchema("Only feedback given by this team or adjudicator.")),
      sourceType: s.optional(s.enum(["team", "adjudicator"] as const, "Only feedback from teams or from adjudicators.")),
    }),
    paginated: true,
    response: pageOf(s.ref("Feedback")),
    async handler(context) {
      const { targetAdjudicatorId, sourceId, sourceType } = context.query;
      const roundIds = context.query.roundId ? [...new Set(context.query.roundId.split(","))] : [];
      const all: QueryFilter[] = [
        ...(targetAdjudicatorId ? [{ field: "targetAdjudicatorId", op: "==" as const, value: targetAdjudicatorId }] : []),
        ...(sourceId ? [{ field: "sourceId", op: "==" as const, value: sourceId }] : []),
        ...(roundIds.length === 1 ? [{ field: "roundId", op: "==" as const, value: roundIds[0] }] : []),
        ...(sourceType ? [{ field: "sourceType", op: "==" as const, value: sourceType }] : []),
      ];
      // Firestore needs a composite index for every combination of equality filters, so only the
      // most selective one goes to the query; the rest filter the page it returns.
      const [primary, ...rest] = all;
      const page = await context.data.page("feedback", pageRequest(context.query), primary ? [primary] : []);
      const matches = (record: Record<string, unknown>) =>
        rest.every((filter) => record[filter.field] === filter.value) &&
        (roundIds.length <= 1 || roundIds.includes(String(record.roundId)));
      return {
        ...page,
        data: page.data.filter(matches).map((record) => serializeFeedback(asType<FeedbackSubmission>(record))),
      };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/feedback/{feedbackId}",
    operationId: "getFeedback",
    summary: "Get one feedback submission",
    tag: "feedback",
    auth: { kind: "token", resource: "feedback", access: "read" },
    params: s.object({ slug: slugParam, feedbackId: idSchema("Feedback id.") }),
    response: s.ref("Feedback"),
    async handler(context) {
      const record = await context.data.get("feedback", context.params.feedbackId);
      if (!record) throw notFound("Feedback");
      return serializeFeedback(asType<FeedbackSubmission>(record));
    },
  }),
];

/* ------------------------------------------------------------------------ */
/* Availability and check-ins                                                */
/* ------------------------------------------------------------------------ */

const availabilityEntry = s.object({ id: s.string(), name: s.string(), available: s.boolean() });

export interface CheckinStatus {
  id: string;
  checkedIn: boolean;
  checkedInAt: string | null;
  expiresAfterHours: number | null;
}

export function personCheckinStatus(
  record: Pick<Team | Adjudicator, "id" | "checkedIn" | "checkedInAt" | "roundAvailability" | "roundAvailabilityAt">,
  expiresAfterHours: number | undefined,
  now: Date
): CheckinStatus {
  const expiry = typeof expiresAfterHours === "number" && expiresAfterHours > 0 ? expiresAfterHours : null;
  return {
    id: record.id,
    // Tournament-wide check-in (not a round's availability), with the configured expiry applied.
    checkedIn: record.checkedIn === true && isAvailableForRound({ checkedIn: true, checkedInAt: record.checkedInAt }, null, expiry ?? undefined, now.getTime()),
    checkedInAt: record.checkedInAt ?? null,
    expiresAfterHours: expiry,
  };
}

/** A room's check-in, with the venue check-in expiry applied (rooms are present unless checked out). */
export function venueCheckinStatus(
  venue: Pick<Venue, "id" | "checkedIn" | "checkedInAt">,
  expiresAfterHours: number | undefined,
  now: Date
): CheckinStatus {
  const expiry = typeof expiresAfterHours === "number" && expiresAfterHours > 0 ? expiresAfterHours : null;
  return {
    id: venue.id,
    checkedIn: venue.checkedIn === true && isVenueCheckedIn(venue, expiry ?? undefined, now.getTime()),
    checkedInAt: venue.checkedInAt ?? null,
    expiresAfterHours: expiry,
  };
}

const checkinRoutes = [
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/rounds/{roundSeq}/availabilities",
    operationId: "getAvailabilities",
    summary: "Get a round's availability",
    description:
      "Whether each team, adjudicator and venue is available for the round (round availability, " +
      "else check-in, with the check-in expiry applied; venues: the round's entry, else their default). " +
      "`?teams=true`, `?adjudicators=true` and `?venues=true` limit the response to those kinds.",
    tag: "availabilities",
    auth: { kind: "token", resource: "checkins", access: "read" },
    params: roundParams,
    query: s.object({ teams: s.optional(s.boolean()), adjudicators: s.optional(s.boolean()), venues: s.optional(s.boolean()) }),
    response: s.object({
      roundId: s.string(),
      teams: s.array(availabilityEntry),
      adjudicators: s.array(availabilityEntry),
      venues: s.array(availabilityEntry),
    }),
    async handler(context) {
      const round = await roundBySeq(context, context.params.roundSeq);
      const expiry = context.tournament.preferences?.checkInExpiresAfterHours;
      // Tabbycat's kind filters: with none given, every kind is listed.
      const only = (["teams", "adjudicators", "venues"] as const).filter((kind) => context.query[kind] === true);
      const wanted = (kind: "teams" | "adjudicators" | "venues") => only.length === 0 || only.includes(kind);
      const [teams, adjudicators, venues] = await Promise.all([
        wanted("teams") ? context.data.all("teams") : [],
        wanted("adjudicators") ? context.data.all("adjudicators") : [],
        wanted("venues") ? context.data.all("venues") : [],
      ]);
      const person = (record: Team | Adjudicator) => ({
        id: record.id,
        name: record.name,
        available: isAvailableForRound(record, round, expiry, context.now.getTime()),
      });
      return {
        roundId: round.id,
        teams: teams.map((record) => person(asType<Team>(record))),
        adjudicators: adjudicators.map((record) => person(asType<Adjudicator>(record))),
        venues: venues.map((record) => {
          const venue = asType<Venue>(record);
          return { id: venue.id, name: venue.name, available: isVenueAvailableForRound(venue, round.id) };
        }),
      };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/teams/{teamId}/checkin",
    operationId: "getTeamCheckin",
    summary: "Get a team's check-in status",
    tag: "checkins",
    auth: { kind: "token", resource: "checkins", access: "read" },
    params: s.object({ slug: slugParam, teamId: idSchema("Team id.") }),
    response: s.ref("CheckinStatus"),
    async handler(context) {
      const record = await context.data.get("teams", context.params.teamId);
      if (!record) throw notFound("Team");
      return personCheckinStatus(asType<Team>(record), context.tournament.preferences?.checkInExpiresAfterHours, context.now);
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/speakers/{speakerId}/checkin",
    operationId: "getSpeakerCheckin",
    summary: "Get a speaker's check-in status",
    description: "CrabbyTab checks in teams, so a speaker's status is their team's.",
    tag: "checkins",
    auth: { kind: "token", resource: "checkins", access: "read" },
    params: s.object({ slug: slugParam, speakerId: idSchema("Speaker id.") }),
    response: s.ref("CheckinStatus"),
    async handler(context) {
      const { team } = await findSpeaker(context, context.params.speakerId);
      return {
        ...personCheckinStatus(team, context.tournament.preferences?.checkInExpiresAfterHours, context.now),
        id: context.params.speakerId,
        teamId: team.id,
      };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/adjudicators/{adjudicatorId}/checkin",
    operationId: "getAdjudicatorCheckin",
    summary: "Get an adjudicator's check-in status",
    tag: "checkins",
    auth: { kind: "token", resource: "checkins", access: "read" },
    params: s.object({ slug: slugParam, adjudicatorId: idSchema("Adjudicator id.") }),
    response: s.ref("CheckinStatus"),
    async handler(context) {
      const record = await context.data.get("adjudicators", context.params.adjudicatorId);
      if (!record) throw notFound("Adjudicator");
      return personCheckinStatus(asType<Adjudicator>(record), context.tournament.preferences?.checkInExpiresAfterHours, context.now);
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/venues/{venueId}/checkin",
    operationId: "getVenueCheckin",
    summary: "Get a venue's check-in status",
    tag: "checkins",
    auth: { kind: "token", resource: "checkins", access: "read" },
    params: s.object({ slug: slugParam, venueId: idSchema("Venue id.") }),
    response: s.ref("CheckinStatus"),
    async handler(context) {
      const record = await context.data.get("venues", context.params.venueId);
      if (!record) throw notFound("Venue");
      return venueCheckinStatus(asType<Venue>(record), context.tournament.preferences?.venueCheckInExpiresAfterHours, context.now);
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/rounds/{roundSeq}/pairings/{debateId}/checkin",
    operationId: "getDebateCheckin",
    summary: "Get a debate's ballot check-in (paper ballots received)",
    description: "Tabbycat's debate check-in records that a debate's ballot was handed in; CrabbyTab records each received sheet.",
    tag: "checkins",
    auth: { kind: "token", resource: "checkins", access: "read" },
    params: debateParams,
    response: s.object({
      id: s.string(),
      checkedIn: s.boolean(),
      receipts: s.array(s.object({
        id: s.string(),
        sheetCode: s.string(),
        adjudicatorId: s.optional(s.string()),
        receivedAt: s.string(),
        receivedByName: s.optional(s.string()),
      }, { strict: false })),
    }),
    async handler(context) {
      const round = await roundBySeq(context, context.params.roundSeq);
      const debate = await debateInRound(context, round, context.params.debateId);
      const receipts = (await context.data.all("ballotIntake", [{ field: "debateId", op: "==", value: debate.id }]))
        .map((record) => asType<BallotIntakeRecord>(record))
        .map(({ id, sheetCode, adjudicatorId, receivedAt, receivedByName }) => ({
          id,
          sheetCode,
          ...(adjudicatorId ? { adjudicatorId } : {}),
          receivedAt,
          ...(receivedByName ? { receivedByName } : {}),
        }));
      return { id: debate.id, checkedIn: receipts.length > 0, receipts };
    },
  }),
];

export const roundDataReadRoutes = [...pairingRoutes, ...ballotRoutes, ...feedbackRoutes, ...checkinRoutes];

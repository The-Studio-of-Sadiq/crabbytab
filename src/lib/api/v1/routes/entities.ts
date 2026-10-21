import { getPublicSiteSettings } from "@/lib/publicFeatures";
import { buildPublicBreak, getPublicRelease } from "@/lib/publicRelease";
import type { Adjudicator, BreakCategory, Institution, Motion, Round, Team, Venue } from "@/types";
import { normaliseCategory } from "@/lib/venues/venues";
import { categoryNames, categoryView, venueCategoryResponse } from "./write/settingsItems";
import { ApiError, notFound } from "../errors";
import { defineRoute, listOf, pageOf, pageQueryShape, pageRequest, slugParam } from "../router";
import { s } from "../schema";
import {
  asType,
  serializeAdjudicator,
  serializeBreakCategory,
  serializeInstitution,
  serializeMotion,
  serializeRound,
  serializeSpeaker,
  serializeTeam,
  serializeVenue,
} from "../serializers";
import type { QueryFilter } from "../store";
import { findSpeaker, idSchema, requirePublicRelease, roundBySeq, roundSeqSchema } from "./shared";

const slugOnly = s.object({ slug: slugParam });
const withId = (name: string, description: string) => s.object({ slug: slugParam, [name]: idSchema(description) });

const bySeq = (left: { seq?: number; id: string }, right: { seq?: number; id: string }) =>
  (left.seq ?? 0) - (right.seq ?? 0) || left.id.localeCompare(right.id);

/* ------------------------------------------------------------------------ */
/* Rounds and motions                                                        */
/* ------------------------------------------------------------------------ */

const roundRoutes = [
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/rounds",
    operationId: "listRounds",
    summary: "List rounds",
    description: "Every round in sequence order. Public tokens see the rounds the public site shows.",
    tag: "rounds",
    auth: { kind: "token", resource: "rounds", access: "read", public: true },
    params: slugOnly,
    response: listOf(s.ref("Round")),
    async handler(context) {
      const rounds = (await context.data.all("rounds")).map((record) => asType<Round>(record)).sort(bySeq);
      return { data: rounds.map(serializeRound) };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/rounds/{roundSeq}",
    operationId: "getRound",
    summary: "Get a round",
    tag: "rounds",
    auth: { kind: "token", resource: "rounds", access: "read", public: true },
    params: s.object({ slug: slugParam, roundSeq: roundSeqSchema }),
    response: s.ref("Round"),
    async handler(context) {
      return serializeRound(await roundBySeq(context, context.params.roundSeq));
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/motions",
    operationId: "listMotions",
    summary: "List motions",
    description: "Public tokens see released motions only (when public motions are enabled).",
    tag: "motions",
    auth: { kind: "token", resource: "rounds", access: "read", public: true },
    params: slugOnly,
    query: s.object({ roundId: s.optional(idSchema("Only motions allocated to this round.")) }),
    response: listOf(s.ref("Motion")),
    async handler(context) {
      const filters: QueryFilter[] = context.query.roundId
        ? [{ field: "rounds", op: "array-contains", value: context.query.roundId }]
        : [];
      const motions = (await context.data.all("motions", filters)).map((record) => asType<Motion>(record)).sort(bySeq);
      return { data: motions.map(serializeMotion) };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/motions/{motionId}",
    operationId: "getMotion",
    summary: "Get a motion",
    tag: "motions",
    auth: { kind: "token", resource: "rounds", access: "read", public: true },
    params: withId("motionId", "Motion id."),
    response: s.ref("Motion"),
    async handler(context) {
      const record = await context.data.get("motions", (context.params as { motionId: string }).motionId);
      if (!record) throw notFound("Motion");
      return serializeMotion(asType<Motion>(record));
    },
  }),
];

/* ------------------------------------------------------------------------ */
/* Institutions, teams, speakers, adjudicators                               */
/* ------------------------------------------------------------------------ */

const participantRoutes = [
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/institutions",
    operationId: "listInstitutions",
    summary: "List institutions",
    description: "Paginated; `region` lists only that region's institutions (Tabbycat's `region` filter). Public tokens need the public institutions list to be released.",
    tag: "institutions",
    auth: { kind: "token", resource: "participants", access: "read", public: true },
    params: slugOnly,
    query: s.object({ ...pageQueryShape, region: s.optional(s.string({ min: 1, max: 120, description: "Region name, exactly as stored." })) }),
    paginated: true,
    response: pageOf(s.ref("Institution")),
    async handler(context) {
      requirePublicRelease(context, "institutions", "The institutions list");
      const filters = context.query.region !== undefined ? [{ field: "region", op: "==" as const, value: context.query.region }] : undefined;
      const page = await context.data.page("institutions", pageRequest(context.query), filters);
      return { ...page, data: page.data.map((record) => serializeInstitution(asType<Institution>(record))) };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/institutions/{institutionId}",
    operationId: "getInstitution",
    summary: "Get an institution",
    tag: "institutions",
    auth: { kind: "token", resource: "participants", access: "read", public: true },
    params: withId("institutionId", "Institution id."),
    response: s.ref("Institution"),
    async handler(context) {
      requirePublicRelease(context, "institutions", "The institutions list");
      const record = await context.data.get("institutions", (context.params as { institutionId: string }).institutionId);
      if (!record) throw notFound("Institution");
      return serializeInstitution(asType<Institution>(record));
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/teams",
    operationId: "listTeams",
    summary: "List teams",
    description: "Paginated. Public tokens need the participants list to be released.",
    tag: "teams",
    auth: { kind: "token", resource: "participants", access: "read", public: true },
    params: slugOnly,
    query: s.object({ ...pageQueryShape, institutionId: s.optional(idSchema("Only teams from this institution.")) }),
    paginated: true,
    response: pageOf(s.ref("Team")),
    async handler(context) {
      requirePublicRelease(context, "participants", "The participants list");
      const filters: QueryFilter[] = context.query.institutionId
        ? [{ field: "institutionId", op: "==", value: context.query.institutionId }]
        : [];
      const page = await context.data.page("teams", pageRequest(context.query), filters);
      return { ...page, data: page.data.map((record) => serializeTeam(asType<Team>(record))) };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/teams/{teamId}",
    operationId: "getTeam",
    summary: "Get a team",
    tag: "teams",
    auth: { kind: "token", resource: "participants", access: "read", public: true },
    params: withId("teamId", "Team id."),
    response: s.ref("Team"),
    async handler(context) {
      requirePublicRelease(context, "participants", "The participants list");
      const record = await context.data.get("teams", (context.params as { teamId: string }).teamId);
      if (!record) throw notFound("Team");
      return serializeTeam(asType<Team>(record));
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/speakers",
    operationId: "listSpeakers",
    summary: "List speakers",
    description:
      "Paginated by team: each page holds the speakers of up to `limit` teams. Public tokens need " +
      "the participants list to be released.",
    tag: "speakers",
    auth: { kind: "token", resource: "participants", access: "read", public: true },
    params: slugOnly,
    query: s.object(pageQueryShape),
    paginated: true,
    response: pageOf(s.ref("Speaker")),
    async handler(context) {
      requirePublicRelease(context, "participants", "The participants list");
      const page = await context.data.page("teams", pageRequest(context.query));
      return {
        ...page,
        data: page.data.flatMap((record) => {
          const team = asType<Team>(record);
          return (team.speakers ?? []).map((speaker) => serializeSpeaker(speaker, team));
        }),
      };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/speakers/{speakerId}",
    operationId: "getSpeaker",
    summary: "Get a speaker",
    tag: "speakers",
    auth: { kind: "token", resource: "participants", access: "read", public: true },
    params: withId("speakerId", "Speaker id."),
    response: s.ref("Speaker"),
    async handler(context) {
      requirePublicRelease(context, "participants", "The participants list");
      const { team, index } = await findSpeaker(context, (context.params as { speakerId: string }).speakerId);
      return serializeSpeaker(team.speakers[index], team);
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/adjudicators",
    operationId: "listAdjudicators",
    summary: "List adjudicators",
    description:
      "Paginated. Public tokens need the participants list to be released and see names and " +
      "institutions only; scores and conflicts are for administrator tokens.",
    tag: "adjudicators",
    auth: { kind: "token", resource: "participants", access: "read", public: true },
    params: slugOnly,
    query: s.object({
      ...pageQueryShape,
      institutionId: s.optional(idSchema("Only adjudicators from this institution.")),
      break: s.optional(s.boolean("Only breaking adjudicators (Tabbycat's ?break). Public tokens: once breaking adjudicators are released.")),
    }),
    paginated: true,
    response: pageOf(s.ref("Adjudicator")),
    async handler(context) {
      const breaking = context.query.break === true;
      if (breaking) requirePublicRelease(context, "breakingAdjudicators", "The breaking adjudicators");
      else requirePublicRelease(context, "participants", "The participants list");
      const filters: QueryFilter[] = [
        ...(breaking ? [{ field: "breaking", op: "==" as const, value: true }] : []),
        ...(context.query.institutionId ? [{ field: "institutionId", op: "==" as const, value: context.query.institutionId }] : []),
      ];
      // One equality filter goes to the query (Firestore composite indexes); the other filters its page.
      const [primary, ...rest] = filters;
      const page = await context.data.page("adjudicators", pageRequest(context.query), primary ? [primary] : []);
      return {
        ...page,
        data: page.data
          .filter((record) => rest.every((filter) => record[filter.field] === filter.value))
          .map((record) => serializeAdjudicator(asType<Adjudicator>(record))),
      };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/adjudicators/{adjudicatorId}",
    operationId: "getAdjudicator",
    summary: "Get an adjudicator",
    tag: "adjudicators",
    auth: { kind: "token", resource: "participants", access: "read", public: true },
    params: withId("adjudicatorId", "Adjudicator id."),
    response: s.ref("Adjudicator"),
    async handler(context) {
      requirePublicRelease(context, "participants", "The participants list");
      const record = await context.data.get("adjudicators", (context.params as { adjudicatorId: string }).adjudicatorId);
      if (!record) throw notFound("Adjudicator");
      return serializeAdjudicator(asType<Adjudicator>(record));
    },
  }),
];

/* ------------------------------------------------------------------------ */
/* Venues                                                                    */
/* ------------------------------------------------------------------------ */


const venueRoutes = [
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/venues",
    operationId: "listVenues",
    summary: "List venues",
    tag: "venues",
    auth: { kind: "token", resource: "venues", access: "read", public: true },
    params: slugOnly,
    query: s.object({ ...pageQueryShape, category: s.optional(s.string({ min: 1, max: 80, description: "Only venues in this category." })) }),
    paginated: true,
    response: pageOf(s.ref("Venue")),
    async handler(context) {
      const filters: QueryFilter[] = context.query.category
        ? [{ field: "category", op: "==", value: context.query.category }]
        : [];
      const page = await context.data.page("venues", pageRequest(context.query), filters);
      return { ...page, data: page.data.map((record) => serializeVenue(asType<Venue>(record))) };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/venues/{venueId}",
    operationId: "getVenue",
    summary: "Get a venue",
    tag: "venues",
    auth: { kind: "token", resource: "venues", access: "read", public: true },
    params: withId("venueId", "Venue id."),
    response: s.ref("Venue"),
    async handler(context) {
      const record = await context.data.get("venues", (context.params as { venueId: string }).venueId);
      if (!record) throw notFound("Venue");
      return serializeVenue(asType<Venue>(record));
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/venue-categories",
    operationId: "listVenueCategories",
    summary: "List venue categories",
    description:
      "Every category used by a venue or described in the settings, with its venues and display " +
      "settings (public tokens see a description only when it is shown in public tooltips).",
    tag: "venues",
    auth: { kind: "token", resource: "venues", access: "read", public: true },
    params: slugOnly,
    response: listOf(venueCategoryResponse),
    async handler(context) {
      const venues = (await context.data.all("venues")).map((record) => asType<Venue>(record));
      const infos = context.tournament.preferences?.venueCategories;
      return {
        data: [...categoryNames(venues, infos).values()]
          .sort((left, right) => left.localeCompare(right))
          .map((name) => categoryView(venues, infos, name)),
      };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/venue-categories/{name}",
    operationId: "getVenueCategory",
    summary: "Get a venue category",
    tag: "venues",
    auth: { kind: "token", resource: "venues", access: "read", public: true },
    params: s.object({ slug: slugParam, name: s.string({ min: 1, max: 80, pattern: /^[^/]+$/, description: "Category name (URL-encoded)." }) }),
    response: venueCategoryResponse,
    async handler(context) {
      const venues = (await context.data.all("venues")).map((record) => asType<Venue>(record));
      const infos = context.tournament.preferences?.venueCategories;
      const name = categoryNames(venues, infos).get(normaliseCategory(context.params.name));
      if (!name) throw notFound("Venue category");
      return categoryView(venues, infos, name);
    },
  }),
];

/* ------------------------------------------------------------------------ */
/* Break categories                                                          */
/* ------------------------------------------------------------------------ */

const breakingTeamSchema = s.object({ seed: s.integer(), teamId: s.string(), teamName: s.string() });

const breakRoutes = [
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/break-categories",
    operationId: "listBreakCategories",
    summary: "List break categories",
    description: "Public tokens see a category's generated break only once it is released.",
    tag: "break-categories",
    auth: { kind: "token", resource: "breaks", access: "read", public: true },
    params: slugOnly,
    response: listOf(s.ref("BreakCategory")),
    async handler(context) {
      const categories = (await context.data.all("breakCategories")).map((record) => asType<BreakCategory>(record)).sort(bySeq);
      return { data: categories.map(serializeBreakCategory) };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/break-categories/{categoryId}",
    operationId: "getBreakCategory",
    summary: "Get a break category",
    tag: "break-categories",
    auth: { kind: "token", resource: "breaks", access: "read", public: true },
    params: withId("categoryId", "Break category id."),
    response: s.ref("BreakCategory"),
    async handler(context) {
      const record = await context.data.get("breakCategories", (context.params as { categoryId: string }).categoryId);
      if (!record) throw notFound("Break category");
      return serializeBreakCategory(asType<BreakCategory>(record));
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/break-categories/{categoryId}/eligibility",
    operationId: "getBreakEligibility",
    summary: "List the teams eligible for a break category",
    description:
      "Public tokens and anonymous clients: once the participants list is released with break " +
      "eligibility shown on it (Tabbycat `public_break_categories`).",
    tag: "break-categories",
    auth: { kind: "token", resource: "breaks", access: "read", public: true },
    params: withId("categoryId", "Break category id."),
    query: s.object(pageQueryShape),
    paginated: true,
    response: s.object({
      categoryId: s.string(),
      teamIds: s.array(s.string()),
      nextCursor: s.nullable(s.string()),
    }),
    async handler(context) {
      const categoryId = (context.params as { categoryId: string }).categoryId;
      if (context.data.view === "public") {
        requirePublicRelease(context, "participants", "The participants list");
        if (!getPublicSiteSettings(context.tournament.preferences).breakCategoriesOnParticipants) {
          throw new ApiError(403, "forbidden", "Break eligibility has not been released to the public.");
        }
      }
      if (!(await context.data.get("breakCategories", categoryId))) throw notFound("Break category");
      const page = await context.data.page("teams", pageRequest(context.query), [
        { field: "breakCategories", op: "array-contains", value: categoryId },
      ]);
      return { categoryId, teamIds: page.data.map((record) => record.id), nextCursor: page.nextCursor };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/break-categories/{categoryId}/break",
    operationId: "getBreak",
    summary: "Get the generated break of a category",
    description: "Breaking teams in seed order, and reserves. Public tokens need the category's break to be released.",
    tag: "break-categories",
    auth: { kind: "token", resource: "breaks", access: "read", public: true },
    params: withId("categoryId", "Break category id."),
    response: s.object({
      categoryId: s.string(),
      generatedAt: s.nullable(s.string()),
      breaking: s.array(breakingTeamSchema),
      reserves: s.array(breakingTeamSchema),
    }),
    async handler(context) {
      const categoryId = (context.params as { categoryId: string }).categoryId;
      const record = await context.data.get("breakCategories", categoryId);
      if (!record) throw notFound("Break category");
      const category = asType<BreakCategory>(record);
      if (context.data.view === "public") {
        const release = getPublicRelease(context.tournament.preferences);
        if (!release.breakCategoryIds.has(categoryId)) throw notFound("Released break");
        const teams = (await context.data.all("teams")).map((item) => asType<Team>(item));
        const released = buildPublicBreak([category], teams, release)[0];
        return {
          categoryId,
          generatedAt: category.generatedBreak?.generatedAt ?? null,
          breaking: (released?.teams ?? []).map(({ seed, team }) => ({ seed, teamId: team.id, teamName: team.name })),
          reserves: [],
        };
      }
      const generated = category.generatedBreak;
      const teamIds = [...(generated?.breakingTeamIds ?? []), ...(generated?.reserveTeamIds ?? [])];
      const names = new Map((await context.data.getMany("teams", teamIds)).map((team) => [team.id, String(team.name ?? "")]));
      const entry = (teamId: string, index: number) => ({ seed: index + 1, teamId, teamName: names.get(teamId) ?? "" });
      return {
        categoryId,
        generatedAt: generated?.generatedAt ?? null,
        breaking: (generated?.breakingTeamIds ?? []).map(entry),
        reserves: (generated?.reserveTeamIds ?? []).map((teamId, index) =>
          entry(teamId, (generated?.breakingTeamIds.length ?? 0) + index)
        ),
      };
    },
  }),
];

export const entityReadRoutes = [...roundRoutes, ...participantRoutes, ...venueRoutes, ...breakRoutes];

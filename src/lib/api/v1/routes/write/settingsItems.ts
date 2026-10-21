import { scoreCriteriaFor, validateScoreCriteria } from "@/lib/ballots/ballotRules";
import { normaliseCategory, venueCategoryInfo, venueCategoryNames, withVenueCategories } from "@/lib/venues/venues";
import type { ScoreCriterion, Venue, VenueCategoryInfo } from "@/types";
import { ApiError, conflict, notFound } from "../../errors";
import { defineRoute, slugParam } from "../../router";
import { s } from "../../schema";
import type { SessionTabRoom } from "../../tabRoom";
import { idSchema } from "../shared";
import { questionsWithSources } from "../tournament";
import { overrideSchema, runWrite } from "./shared";
import { questionSchema, saveFeedbackQuestions } from "./tournament";

/**
 * One-at-a-time endpoints for settings CrabbyTab stores as lists (Tabbycat models them as rows):
 * feedback questions, score criteria and venue categories. Each change rewrites the list through
 * the same command and validation as the settings pages.
 */

const slugOnly = s.object({ slug: slugParam });

/* ------------------------------------------------------------------------ */
/* Feedback questions                                                        */
/* ------------------------------------------------------------------------ */

const questionParams = s.object({ slug: slugParam, questionId: idSchema("Question id.") });

const feedbackQuestionRoutes = [
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/feedback-questions",
    operationId: "createFeedbackQuestion",
    summary: "Add a feedback question",
    tag: "feedback",
    auth: { kind: "token", resource: "tournament", access: "write" },
    params: slugOnly,
    body: questionSchema,
    response: s.unknown("The question with its sources."),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const questions = questionsWithSources(session.tournament.preferences);
        if (questions.some((question) => question.id === context.body.id)) throw conflict(`A question with id ${context.body.id} already exists.`);
        await saveFeedbackQuestions(tabRoom, [...questions, context.body]);
        return context.body;
      });
    },
  }),
  defineRoute({
    method: "PATCH",
    path: "/tournaments/{slug}/feedback-questions/{questionId}",
    operationId: "updateFeedbackQuestion",
    summary: "Change a feedback question",
    description: "The id cannot change (answers already given refer to it).",
    tag: "feedback",
    auth: { kind: "token", resource: "tournament", access: "write" },
    params: questionParams,
    body: s.object(s.partial({
      label: s.string({ min: 1, max: 500 }),
      type: s.enum(["text", "textarea", "scale", "yes_no", "select_one", "select_many", "integer", "float", "checkbox", "integer_scale"] as const),
      required: s.boolean(),
      options: s.array(s.string({ min: 1, max: 200 }), { max: 50 }),
      min: s.number(),
      max: s.number(),
      sources: s.array(s.enum(["team", "adjudicator"] as const), { min: 1, unique: true }),
    }), { minProperties: 1 }),
    successStatus: 200,
    response: s.unknown("The question with its sources."),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const questions = questionsWithSources(session.tournament.preferences);
        const previous = questions.find((question) => question.id === context.params.questionId);
        if (!previous) throw notFound("Feedback question");
        const next = { ...previous, ...context.body };
        await saveFeedbackQuestions(tabRoom, questions.map((question) => (question.id === previous.id ? next : question)));
        return next;
      });
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/tournaments/{slug}/feedback-questions/{questionId}",
    operationId: "deleteFeedbackQuestion",
    summary: "Delete a feedback question",
    description: "Answers already given keep their values on the feedback records.",
    tag: "feedback",
    auth: { kind: "token", resource: "tournament", access: "write" },
    params: questionParams,
    successStatus: 204,
    response: s.unknown(),
    async handler(context) {
      await runWrite(context, async (tabRoom, session) => {
        const questions = questionsWithSources(session.tournament.preferences);
        if (!questions.some((question) => question.id === context.params.questionId)) throw notFound("Feedback question");
        await saveFeedbackQuestions(tabRoom, questions.filter((question) => question.id !== context.params.questionId));
      });
      return { status: 204, body: null };
    },
  }),
];

/* ------------------------------------------------------------------------ */
/* Score criteria                                                            */
/* ------------------------------------------------------------------------ */

const criterionFields = {
  name: s.string({ min: 1, max: 80 }),
  seq: s.integer({ min: 0, max: 1000 }),
  speechType: s.enum(["all", "substantive", "reply"] as const),
  weight: s.number({ min: 0, max: 100 }),
  minScore: s.number({ min: -1000, max: 1000 }),
  maxScore: s.number({ min: -1000, max: 1000 }),
  step: s.number({ min: 0, max: 100 }),
  required: s.boolean(),
};
const criterionSchema = s.object(criterionSchemaShape());
const criterionParams = s.object({ slug: slugParam, criterionId: s.string({ min: 1, max: 80, pattern: /^[A-Za-z0-9_-]+$/, description: "Criterion id." }) });

/**
 * Saves the criteria as the scoring settings do: validated, then through saveTournament, whose
 * rules lock scoring settings once ballots are entered (409 rule_violation; `override.reason`).
 */
async function saveCriteria(tabRoom: SessionTabRoom, criteria: ScoreCriterion[], override?: { reason: string }): Promise<void> {
  const ids = new Set<string>();
  for (const criterion of criteria) {
    if (ids.has(criterion.id)) throw new ApiError(422, "validation_failed", `Criterion id ${criterion.id} is used twice.`);
    ids.add(criterion.id);
  }
  const errors = validateScoreCriteria(criteria);
  if (errors.length) throw new ApiError(422, "validation_failed", errors.join(" "));
  const tournament = tabRoom.session.tournament;
  await tabRoom.saveTournament({ ...tournament, preferences: { ...tournament.preferences, scoreCriteria: criteria } }, override);
}

const scoreCriteriaRoutes = [
  defineRoute({
    method: "PUT",
    path: "/tournaments/{slug}/score-criteria",
    operationId: "replaceScoreCriteria",
    summary: "Replace the speaker score criteria",
    description: "The full list (empty: one score per speech). Locked once ballots are entered, as in the tab room.",
    tag: "tournaments",
    auth: { kind: "token", resource: "tournament", access: "write" },
    params: slugOnly,
    body: s.object({ criteria: s.array(criterionSchema, { max: 20 }), override: overrideSchema }),
    successStatus: 200,
    response: s.object({ data: s.array(s.unknown()) }),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        await saveCriteria(tabRoom, context.body.criteria, context.body.override);
        return { data: scoreCriteriaFor(session.tournament.preferences) };
      });
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/score-criteria/{criterionId}",
    operationId: "getScoreCriterion",
    summary: "Get one score criterion",
    tag: "tournaments",
    auth: { kind: "token", resource: "tournament", access: "read" },
    params: criterionParams,
    response: s.unknown("ScoreCriterion"),
    async handler(context) {
      const criterion = scoreCriteriaFor(context.tournament.preferences).find((item) => item.id === context.params.criterionId);
      if (!criterion) throw notFound("Score criterion");
      return criterion;
    },
  }),
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/score-criteria",
    operationId: "createScoreCriterion",
    summary: "Add a score criterion",
    tag: "tournaments",
    auth: { kind: "token", resource: "tournament", access: "write" },
    params: slugOnly,
    body: s.object({ ...criterionSchemaShape(), override: overrideSchema }),
    response: s.unknown("ScoreCriterion"),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const { override, ...criterion } = context.body;
        const criteria = scoreCriteriaFor(session.tournament.preferences);
        if (criteria.some((item) => item.id === criterion.id)) throw conflict(`A criterion with id ${criterion.id} already exists.`);
        await saveCriteria(tabRoom, [...criteria, criterion], override);
        return criterion;
      });
    },
  }),
  defineRoute({
    method: "PATCH",
    path: "/tournaments/{slug}/score-criteria/{criterionId}",
    operationId: "updateScoreCriterion",
    summary: "Change a score criterion",
    tag: "tournaments",
    auth: { kind: "token", resource: "tournament", access: "write" },
    params: criterionParams,
    body: s.object({ ...s.partial(criterionFields), override: overrideSchema }, { minProperties: 1 }),
    successStatus: 200,
    response: s.unknown("ScoreCriterion"),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const { override, ...changes } = context.body;
        const criteria = scoreCriteriaFor(session.tournament.preferences);
        const previous = criteria.find((item) => item.id === context.params.criterionId);
        if (!previous) throw notFound("Score criterion");
        const next = { ...previous, ...changes };
        await saveCriteria(tabRoom, criteria.map((item) => (item.id === previous.id ? next : item)), override);
        return next;
      });
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/tournaments/{slug}/score-criteria/{criterionId}",
    operationId: "deleteScoreCriterion",
    summary: "Delete a score criterion",
    tag: "tournaments",
    auth: { kind: "token", resource: "tournament", access: "write" },
    params: criterionParams,
    body: s.object({ override: overrideSchema }),
    successStatus: 204,
    response: s.unknown(),
    async handler(context) {
      await runWrite(context, async (tabRoom, session) => {
        const criteria = scoreCriteriaFor(session.tournament.preferences);
        if (!criteria.some((item) => item.id === context.params.criterionId)) throw notFound("Score criterion");
        await saveCriteria(tabRoom, criteria.filter((item) => item.id !== context.params.criterionId), context.body?.override);
      });
      return { status: 204, body: null };
    },
  }),
];

function criterionSchemaShape() {
  return { id: s.string({ min: 1, max: 80, pattern: /^[A-Za-z0-9_-]+$/ }), ...criterionFields };
}

/* ------------------------------------------------------------------------ */
/* Venue categories                                                          */
/* ------------------------------------------------------------------------ */

const categoryNameSchema = s.string({ min: 1, max: 80, pattern: /^[^/,;]+$/, description: "Category name (no / , or ;)." });
const categoryParams = s.object({ slug: slugParam, name: s.string({ min: 1, max: 80, pattern: /^[^/]+$/, description: "Category name (URL-encoded)." }) });
const categoryInfoFields = {
  description: s.optional(s.string({ max: 300, description: "Predicate after \"This room\", e.g. \"has step-free access\"." })),
  displayInName: s.optional(s.enum(["none", "prefix", "suffix"] as const)),
  publicTooltip: s.optional(s.boolean("Show the description in the room's public tooltip.")),
};
const venueIdsSchema = s.optional(s.array(idSchema("Venue id."), { max: 2000, unique: true, description: "The venues in the category (the full list)." }));

export const venueCategoryResponse = s.object({
  name: s.string(),
  venueIds: s.array(s.string()),
  description: s.optional(s.string()),
  displayInName: s.optional(s.string()),
  publicTooltip: s.optional(s.boolean()),
});

/** Category info and membership, as the venue import page's category editor saves them. */
async function saveVenueCategory(
  tabRoom: SessionTabRoom,
  previousName: string | null,
  next: { name: string; info: Omit<VenueCategoryInfo, "name">; venueIds?: string[] } | null
) {
  const session = tabRoom.session;
  const venues = await session.all<Venue>("venues");
  const previousKey = previousName === null ? null : normaliseCategory(previousName);
  const nextKey = next ? normaliseCategory(next.name) : null;
  if (next?.venueIds) {
    const missing = next.venueIds.find((id) => !venues.some((venue) => venue.id === id));
    if (missing) throw new ApiError(422, "validation_failed", `Venue ${missing} does not exist.`);
  }
  for (const venue of venues) {
    const names = venueCategoryNames(venue);
    const was = previousKey !== null && names.some((name) => normaliseCategory(name) === previousKey);
    const others = names.filter((name) => normaliseCategory(name) !== previousKey && normaliseCategory(name) !== nextKey);
    const member = next === null ? false : next.venueIds ? next.venueIds.includes(venue.id) : was || names.some((name) => normaliseCategory(name) === nextKey);
    const updated = member ? [...others, next!.name] : others;
    if (updated.join("\u0000") === names.join("\u0000")) continue;
    await tabRoom.entities().updateVenue(withVenueCategories(venue, updated));
  }
  const tournament = session.tournament;
  const infos = (tournament.preferences.venueCategories ?? [])
    .filter((info) => normaliseCategory(info.name) !== previousKey && normaliseCategory(info.name) !== nextKey);
  const venueCategories = next ? [...infos, { name: next.name, ...next.info }] : infos;
  await tabRoom.saveTournament({ ...tournament, preferences: { ...tournament.preferences, venueCategories } });
}

export function categoryView(venues: Venue[], infos: VenueCategoryInfo[] | undefined, name: string) {
  const key = normaliseCategory(name);
  const info = venueCategoryInfo(infos, name);
  return {
    name,
    venueIds: venues.filter((venue) => venueCategoryNames(venue).some((item) => normaliseCategory(item) === key)).map((venue) => venue.id),
    ...(info?.description ? { description: info.description } : {}),
    ...(info?.displayInName ? { displayInName: info.displayInName } : {}),
    ...(info?.publicTooltip !== undefined ? { publicTooltip: info.publicTooltip } : {}),
  };
}

/** Every category name in use or described, with its stored spelling. */
export function categoryNames(venues: Venue[], infos: VenueCategoryInfo[] | undefined): Map<string, string> {
  const names = new Map<string, string>();
  for (const venue of venues) for (const name of venueCategoryNames(venue)) if (!names.has(normaliseCategory(name))) names.set(normaliseCategory(name), name);
  for (const info of infos ?? []) if (!names.has(normaliseCategory(info.name))) names.set(normaliseCategory(info.name), info.name);
  return names;
}

const venueCategoryWriteRoutes = [
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/venue-categories",
    operationId: "createVenueCategory",
    summary: "Create a venue category",
    description: "Its description and display settings, and optionally the venues in it (`venueIds`).",
    tag: "venues",
    auth: { kind: "token", resource: "venues", access: "write" },
    params: slugOnly,
    body: s.object({ name: categoryNameSchema, ...categoryInfoFields, venueIds: venueIdsSchema }),
    response: venueCategoryResponse,
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const { name, venueIds, ...info } = context.body;
        const trimmed = name.trim();
        if (categoryNames(await session.all<Venue>("venues"), session.tournament.preferences.venueCategories).has(normaliseCategory(trimmed))) {
          throw conflict(`The venue category ${trimmed} already exists.`);
        }
        await saveVenueCategory(tabRoom, null, { name: trimmed, info, venueIds: venueIds ?? [] });
        return () => categoryView(session.view<Venue>("venues"), session.tournament.preferences.venueCategories, trimmed);
      });
    },
  }),
  defineRoute({
    method: "PATCH",
    path: "/tournaments/{slug}/venue-categories/{name}",
    operationId: "updateVenueCategory",
    summary: "Rename or change a venue category",
    description: "A new `name` renames it on every venue; `venueIds` replaces its members.",
    tag: "venues",
    auth: { kind: "token", resource: "venues", access: "write" },
    params: categoryParams,
    body: s.object({ name: s.optional(categoryNameSchema), ...categoryInfoFields, venueIds: venueIdsSchema }, { minProperties: 1 }),
    successStatus: 200,
    response: venueCategoryResponse,
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const infos = session.tournament.preferences.venueCategories;
        const names = categoryNames(await session.all<Venue>("venues"), infos);
        const current = names.get(normaliseCategory(context.params.name));
        if (!current) throw notFound("Venue category");
        const { name, venueIds, ...changes } = context.body;
        const nextName = name?.trim() ?? current;
        if (normaliseCategory(nextName) !== normaliseCategory(current) && names.has(normaliseCategory(nextName))) {
          throw conflict(`The venue category ${nextName} already exists.`);
        }
        const previousInfo = venueCategoryInfo(infos, current);
        const info = {
          ...(previousInfo ? { description: previousInfo.description, displayInName: previousInfo.displayInName, publicTooltip: previousInfo.publicTooltip } : {}),
          ...changes,
        };
        await saveVenueCategory(tabRoom, current, { name: nextName, info, venueIds });
        return () => categoryView(session.view<Venue>("venues"), session.tournament.preferences.venueCategories, nextName);
      });
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/tournaments/{slug}/venue-categories/{name}",
    operationId: "deleteVenueCategory",
    summary: "Delete a venue category",
    description: "Removes it from every venue and drops its description. Venue constraints that name it are kept but no longer match any room.",
    tag: "venues",
    auth: { kind: "token", resource: "venues", access: "write" },
    params: categoryParams,
    successStatus: 204,
    response: s.unknown(),
    async handler(context) {
      await runWrite(context, async (tabRoom, session) => {
        const current = categoryNames(await session.all<Venue>("venues"), session.tournament.preferences.venueCategories)
          .get(normaliseCategory(context.params.name));
        if (!current) throw notFound("Venue category");
        await saveVenueCategory(tabRoom, current, null);
      });
      return { status: 204, body: null };
    },
  }),
];

export const settingsItemWriteRoutes = [...feedbackQuestionRoutes, ...scoreCriteriaRoutes, ...venueCategoryWriteRoutes];

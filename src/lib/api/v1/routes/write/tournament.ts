import { validateFeedbackQuestions } from "@/lib/feedback/questions";
import {
  resolveSpeakerCategoryIds,
  slugifyCategory,
  sortSpeakerCategories,
  speakerCategoryRefs,
  validateSpeakerCategories,
} from "@/lib/speakerCategories";
import type { BreakCategory, FeedbackQuestion, SpeakerCategory, Team, Tournament, TournamentPreferences } from "@/types";
import { ApiError, conflict, notFound } from "../../errors";
import { defineRoute, slugParam } from "../../router";
import { s } from "../../schema";
import { ApiCommandSession } from "../../session";
import { serializeTournament } from "../../serializers";
import type { SessionTabRoom } from "../../tabRoom";
import { idSchema } from "../shared";
import { expectedVersionSchema, overrideSchema, requireFound, runWrite } from "./shared";

const slugOnly = s.object({ slug: slugParam });

/**
 * Preferences that have their own endpoint (and validation) and cannot be patched here, plus
 * fields owned by other features' configuration pages.
 */
const MANAGED_PREFERENCES = new Set<string>([
  "feedbackQuestions",
  "teamFeedbackQuestions",
  "adjudicatorFeedbackQuestions",
  "speakerCategories",
]);

type JsonKind = "string" | "number" | "boolean" | "array" | "object" | "null";
function kindOf(value: unknown): JsonKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value as JsonKind;
}

/**
 * Checks a preferences patch: known shape only (a key that already has a value keeps its JSON
 * type; new keys must be simple values), score ranges stay ordered. The tournament rules
 * (settings locked once ballots exist) are checked by saveTournamentCommand.
 */
export function mergePreferences(current: TournamentPreferences, patch: Record<string, unknown>): TournamentPreferences {
  const issues: Array<{ path: string; message: string }> = [];
  for (const [key, value] of Object.entries(patch)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,60}$/.test(key)) {
      issues.push({ path: key, message: "is not a preference name" });
      continue;
    }
    if (MANAGED_PREFERENCES.has(key)) {
      issues.push({ path: key, message: "is changed through its own endpoint" });
      continue;
    }
    const existing = (current as unknown as Record<string, unknown>)[key];
    if (value === null) continue;
    if (existing !== undefined && kindOf(existing) !== kindOf(value)) {
      issues.push({ path: key, message: `must be a ${kindOf(existing)}` });
    } else if (existing === undefined && !["string", "number", "boolean"].includes(kindOf(value))) {
      issues.push({ path: key, message: "is not a known preference; only simple values may be added" });
    } else if (typeof value === "number" && !Number.isFinite(value)) {
      issues.push({ path: key, message: "must be a finite number" });
    }
  }
  if (issues.length) throw new ApiError(422, "validation_failed", "The preferences are not valid.", { issues });
  const next = { ...current } as unknown as Record<string, unknown>;
  // `null` removes an optional preference so its default applies again.
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  const merged = next as unknown as TournamentPreferences;
  const ordered: Array<[keyof TournamentPreferences, keyof TournamentPreferences]> = [
    ["minSpeakerScore", "maxSpeakerScore"],
    ["minReplyScore", "maxReplyScore"],
    ["feedbackMinScore", "feedbackMaxScore"],
  ];
  for (const [low, high] of ordered) {
    if (Number(merged[low]) >= Number(merged[high])) {
      throw new ApiError(422, "validation_failed", `${String(low)} must be below ${String(high)}.`);
    }
  }
  if (!(Number(merged.stepSpeakerScore) > 0)) throw new ApiError(422, "validation_failed", "stepSpeakerScore must be above 0.");
  return merged;
}

const questionSchema = s.object({
  id: s.string({ min: 1, max: 80, pattern: /^[A-Za-z0-9_-]+$/ }),
  label: s.string({ min: 1, max: 500 }),
  type: s.enum(["text", "textarea", "scale", "yes_no", "select_one", "select_many", "integer", "float", "checkbox", "integer_scale"] as const),
  required: s.boolean(),
  options: s.optional(s.array(s.string({ min: 1, max: 200 }), { max: 50 })),
  min: s.optional(s.number()),
  max: s.optional(s.number()),
  sources: s.array(s.enum(["team", "adjudicator"] as const), { min: 1, unique: true, description: "Who is asked the question." }),
});

const speakerCategoryInput = {
  name: s.string({ min: 1, max: 80 }),
  slug: s.optional(s.string({ min: 1, max: 80, pattern: /^[a-z0-9-]+$/ })),
  seq: s.optional(s.integer({ min: 0, max: 10_000 })),
  public: s.optional(s.boolean("Shown as its own public speaker tab once the speaker tab is released.")),
  limit: s.optional(s.integer({ min: 0, max: 10_000, description: "Public tab length; 0 = no limit." })),
};

async function saveSpeakerCategories(tabRoom: SessionTabRoom, categories: SpeakerCategory[], override?: { reason: string }) {
  const errors = validateSpeakerCategories(categories);
  if (errors.length) throw new ApiError(422, "validation_failed", errors.join(" "));
  const tournament = tabRoom.session.tournament;
  await tabRoom.saveTournament({ ...tournament, preferences: { ...tournament.preferences, speakerCategories: sortSpeakerCategories(categories) } }, override);
}

const speakerCategoryParams = s.object({ slug: slugParam, categoryId: idSchema("Speaker category id.") });

export const tournamentWriteRoutes = [
  defineRoute({
    method: "PATCH",
    path: "/tournaments/{slug}",
    operationId: "updateTournament",
    summary: "Rename or (de)activate the tournament",
    description: "The slug and format cannot be changed through the API.",
    tag: "tournaments",
    auth: { kind: "token", resource: "tournament", access: "write" },
    params: slugOnly,
    body: s.object({
      name: s.optional(s.string({ min: 1, max: 120 })),
      shortName: s.optional(s.string({ min: 1, max: 40 })),
      active: s.optional(s.boolean()),
      expectedVersion: expectedVersionSchema,
    }, { minProperties: 1 }),
    response: s.ref("Tournament"),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const { expectedVersion, ...changes } = context.body;
        ApiCommandSession.assertVersion(session.tournament, expectedVersion);
        const next: Tournament = {
          ...session.tournament,
          ...changes,
          ...(changes.name ? { nameLower: changes.name.toLocaleLowerCase() } : {}),
        };
        await tabRoom.saveTournament(next);
        return () => serializeTournament(session.tournament, "admin");
      });
    },
  }),
  defineRoute({
    method: "PATCH",
    path: "/tournaments/{slug}/preferences",
    operationId: "updateTournamentPreferences",
    summary: "Change preferences",
    description:
      "A partial update: send only the preferences to change (`null` restores a default). Settings " +
      "that shape or score ballots are locked once ballots are entered (409 rule_violation; some " +
      "can be overridden with a reason). Feedback questions and speaker categories have their own endpoints.",
    tag: "tournaments",
    auth: { kind: "token", resource: "tournament", access: "write" },
    params: slugOnly,
    body: s.object({
      preferences: s.record(s.unknown(), { maxKeys: 200, description: "Preference name -> new value." }),
      override: overrideSchema,
      expectedVersion: expectedVersionSchema,
    }),
    response: s.unknown("The tournament's preferences after the change."),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        ApiCommandSession.assertVersion(session.tournament, context.body.expectedVersion);
        const preferences = mergePreferences(session.tournament.preferences, context.body.preferences);
        await tabRoom.saveTournament({ ...session.tournament, preferences }, context.body.override);
        return session.tournament.preferences;
      });
    },
  }),
  defineRoute({
    method: "PUT",
    path: "/tournaments/{slug}/feedback-questions",
    operationId: "replaceFeedbackQuestions",
    summary: "Replace the feedback questions",
    description: "The full list, each with who is asked it. Answers already given keep their question ids.",
    tag: "feedback",
    auth: { kind: "token", resource: "tournament", access: "write" },
    params: slugOnly,
    body: s.object({ questions: s.array(questionSchema, { max: 100 }) }),
    response: s.object({ data: s.array(s.unknown()) }),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const toQuestion = ({ sources: _sources, ...question }: (typeof context.body.questions)[number]): FeedbackQuestion => question;
        const all = context.body.questions.map(toQuestion);
        const team = context.body.questions.filter((question) => question.sources.includes("team")).map(toQuestion);
        const adjudicator = context.body.questions.filter((question) => question.sources.includes("adjudicator")).map(toQuestion);
        for (const list of [all, team, adjudicator]) {
          const error = validateFeedbackQuestions(list);
          if (error) throw new ApiError(422, "validation_failed", error);
        }
        await tabRoom.saveTournament({
          ...session.tournament,
          preferences: {
            ...session.tournament.preferences,
            feedbackQuestions: all,
            teamFeedbackQuestions: team,
            adjudicatorFeedbackQuestions: adjudicator,
          },
        });
        return { data: context.body.questions };
      });
    },
  }),
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/speaker-categories",
    operationId: "createSpeakerCategory",
    summary: "Create a speaker category",
    tag: "speaker-categories",
    auth: { kind: "token", resource: "tournament", access: "write" },
    params: slugOnly,
    body: s.object(speakerCategoryInput),
    response: s.unknown(),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const existing = session.tournament.preferences.speakerCategories ?? [];
        const slug = context.body.slug ?? slugifyCategory(context.body.name);
        const created: SpeakerCategory = {
          id: tabRoom.createId("spkcat"),
          name: context.body.name,
          slug,
          seq: context.body.seq ?? Math.max(0, ...existing.map((category) => category.seq)) + 1,
          public: context.body.public ?? false,
          ...(context.body.limit !== undefined ? { limit: context.body.limit } : {}),
        };
        await saveSpeakerCategories(tabRoom, [...existing, created]);
        return created;
      });
    },
  }),
  defineRoute({
    method: "PATCH",
    path: "/tournaments/{slug}/speaker-categories/{categoryId}",
    operationId: "updateSpeakerCategory",
    summary: "Update a speaker category",
    tag: "speaker-categories",
    auth: { kind: "token", resource: "tournament", access: "write" },
    params: speakerCategoryParams,
    body: s.object(s.partial(speakerCategoryInput), { minProperties: 1 }),
    response: s.unknown(),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const existing = session.tournament.preferences.speakerCategories ?? [];
        const previous = requireFound(existing.find((category) => category.id === context.params.categoryId), "Speaker category");
        const next = { ...previous, ...context.body } as SpeakerCategory;
        await saveSpeakerCategories(tabRoom, existing.map((category) => (category.id === previous.id ? next : category)));
        return next;
      });
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/tournaments/{slug}/speaker-categories/{categoryId}",
    operationId: "deleteSpeakerCategory",
    summary: "Delete a speaker category",
    description: "Refused while a break category's eligibility rule uses it. Speakers keep no reference to it.",
    tag: "speaker-categories",
    auth: { kind: "token", resource: "tournament", access: "write" },
    params: speakerCategoryParams,
    successStatus: 204,
    response: s.unknown(),
    async handler(context) {
      await runWrite(context, async (tabRoom, session) => {
        const existing = session.tournament.preferences.speakerCategories ?? [];
        requireFound(existing.find((category) => category.id === context.params.categoryId), "Speaker category");
        const breakCategories = await session.all<BreakCategory>("breakCategories");
        const user = breakCategories.find((category) => category.speakerCategoryRule?.speakerCategoryId === context.params.categoryId);
        if (user) throw conflict(`The ${user.name} break category's eligibility rule uses this speaker category.`);
        const teams = await session.all<Team>("teams");
        const updated = teams.flatMap((team) => {
          const speakers = team.speakers.map((speaker) =>
            speaker.categories?.includes(context.params.categoryId)
              ? { ...speaker, categories: speaker.categories.filter((id) => id !== context.params.categoryId) }
              : speaker
          );
          return speakers.some((speaker, index) => speaker !== team.speakers[index]) ? [{ ...team, speakers }] : [];
        });
        if (updated.length) await tabRoom.entities().saveEntityBatch({ teamsUpdated: updated }, "API speaker category deleted");
        await saveSpeakerCategories(tabRoom, existing.filter((category) => category.id !== context.params.categoryId));
      });
      return { status: 204, body: null };
    },
  }),
  defineRoute({
    method: "PUT",
    path: "/tournaments/{slug}/speaker-categories/{categoryId}/eligibility",
    operationId: "replaceSpeakerCategoryEligibility",
    summary: "Set which speakers are in a speaker category",
    description: "The full list of speakers in the category: listed speakers are added, every other speaker is removed.",
    tag: "speaker-categories",
    auth: { kind: "token", resource: "participants", access: "write" },
    params: speakerCategoryParams,
    body: s.object({ speakerIds: s.array(idSchema("Speaker id."), { max: 5000, unique: true }) }),
    response: s.object({ categoryId: s.string(), speakerIds: s.array(s.string()) }),
    async handler(context) {
      const categoryId = context.params.categoryId;
      return runWrite(context, async (tabRoom, session) => {
        const categories = session.tournament.preferences.speakerCategories ?? [];
        if (!categories.some((category) => category.id === categoryId)) throw notFound("Speaker category");
        const teams = await session.all<Team>("teams");
        const wanted = new Set(context.body.speakerIds);
        const known = new Set(teams.flatMap((team) => team.speakers.map((speaker) => speaker.id)));
        const unknown = context.body.speakerIds.find((id) => !known.has(id));
        if (unknown) throw new ApiError(422, "validation_failed", `Speaker ${unknown} does not exist.`);
        const updated = teams.flatMap((team) => {
          let changed = false;
          const speakers = team.speakers.map((speaker) => {
            // Resolve labels (older data) to ids, then add or remove this category.
            const ids = resolveSpeakerCategoryIds(speakerCategoryRefs(speaker, team), categories);
            const inCategory = ids.includes(categoryId);
            if (inCategory === wanted.has(speaker.id)) return speaker;
            changed = true;
            return { ...speaker, categories: inCategory ? ids.filter((id) => id !== categoryId) : [...ids, categoryId] };
          });
          return changed ? [{ ...team, speakers }] : [];
        });
        if (updated.length) await tabRoom.entities().saveEntityBatch({ teamsUpdated: updated }, "API speaker category eligibility");
        return { categoryId, speakerIds: [...wanted] };
      });
    },
  }),
];

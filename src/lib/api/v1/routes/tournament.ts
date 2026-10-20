import { questionsForFeedbackSource } from "@/lib/feedback/questions";
import { sortSpeakerCategories, speakerCategoryRefs, resolveSpeakerCategoryIds } from "@/lib/speakerCategories";
import type { FeedbackQuestion, Team, TournamentPreferences } from "@/types";
import { notFound } from "../errors";
import { defineRoute, listOf, slugParam } from "../router";
import { s } from "../schema";
import { asType, serializeTournament } from "../serializers";
import { idSchema } from "./shared";

const slugOnly = s.object({ slug: slugParam });

const speakerCategorySchema = s.object({
  id: s.string(),
  name: s.string(),
  slug: s.string(),
  seq: s.integer(),
  public: s.boolean(),
  limit: s.optional(s.integer()),
}, { strict: false });

const feedbackQuestionSchema = s.object({
  id: s.string(),
  label: s.string(),
  type: s.string(),
  required: s.boolean(),
  options: s.optional(s.array(s.string())),
  min: s.optional(s.number()),
  max: s.optional(s.number()),
  sources: s.array(s.enum(["team", "adjudicator"] as const), { description: "Who is asked this question." }),
}, { strict: false });

export type FeedbackQuestionSource = "team" | "adjudicator";
export type SourcedFeedbackQuestion = FeedbackQuestion & { sources: FeedbackQuestionSource[] };

/** The feedback questions with who is asked each (team and adjudicator lists merged by id, in order). */
export function questionsWithSources(preferences: TournamentPreferences | undefined): SourcedFeedbackQuestion[] {
  const byId = new Map<string, SourcedFeedbackQuestion>();
  for (const source of ["team", "adjudicator"] as const) {
    for (const question of questionsForFeedbackSource(source, preferences)) {
      const entry = byId.get(question.id) ?? { ...question, sources: [] };
      entry.sources.push(source);
      byId.set(question.id, entry);
    }
  }
  return [...byId.values()];
}

export const tournamentReadRoutes = [
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}",
    operationId: "getTournament",
    summary: "Get the tournament",
    tag: "tournaments",
    auth: { kind: "token", resource: "tournament", access: "read", public: true },
    params: slugOnly,
    response: s.ref("Tournament"),
    async handler(context) {
      return serializeTournament(context.tournament, context.data.view);
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/preferences",
    operationId: "getTournamentPreferences",
    summary: "Get the tournament's preferences (configuration)",
    description: "Every configured preference, as stored. Administrator tokens only.",
    tag: "tournaments",
    auth: { kind: "token", resource: "tournament", access: "read" },
    params: slugOnly,
    response: s.unknown("TournamentPreferences, see src/types/index.ts."),
    async handler(context) {
      return context.tournament.preferences ?? {};
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/feedback-questions",
    operationId: "listFeedbackQuestions",
    summary: "List feedback questions",
    description:
      "Custom feedback questions with who is asked each one (teams, adjudicators or both). " +
      "`fromTeams=true` / `fromAdjudicators=true` (Tabbycat's from_team / from_adj) list only the questions those sources are asked.",
    tag: "feedback",
    auth: { kind: "token", resource: "tournament", access: "read" },
    params: slugOnly,
    query: s.object({ fromTeams: s.optional(s.boolean()), fromAdjudicators: s.optional(s.boolean()) }),
    response: listOf(feedbackQuestionSchema),
    async handler(context) {
      const wanted: FeedbackQuestionSource[] = [
        ...(context.query.fromTeams ? ["team" as const] : []),
        ...(context.query.fromAdjudicators ? ["adjudicator" as const] : []),
      ];
      return {
        data: questionsWithSources(context.tournament.preferences)
          .filter((question) => wanted.length === 0 || wanted.some((source) => question.sources.includes(source))),
      };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/feedback-questions/{questionId}",
    operationId: "getFeedbackQuestion",
    summary: "Get one feedback question",
    tag: "feedback",
    auth: { kind: "token", resource: "tournament", access: "read" },
    params: s.object({ slug: slugParam, questionId: idSchema("Question id.") }),
    response: feedbackQuestionSchema,
    async handler(context) {
      const question = questionsWithSources(context.tournament.preferences).find((item) => item.id === context.params.questionId);
      if (!question) throw notFound("Feedback question");
      return question;
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/score-criteria",
    operationId: "listScoreCriteria",
    summary: "List speaker score criteria and scales",
    description:
      "The speaker and reply score scales. CrabbyTab scores each speech with one number; when " +
      "per-criterion scoring is configured, its criteria are listed under `criteria`.",
    tag: "tournaments",
    auth: { kind: "token", resource: "tournament", access: "read" },
    params: slugOnly,
    response: s.object({
      speakerScore: s.object({ min: s.number(), max: s.number(), step: s.number() }),
      replyScore: s.nullable(s.object({ min: s.number(), max: s.number() })),
      criteria: s.array(s.unknown()),
    }),
    async handler(context) {
      const preferences = context.tournament.preferences;
      const configured = (preferences as unknown as { scoreCriteria?: unknown }).scoreCriteria;
      return {
        speakerScore: {
          min: preferences.minSpeakerScore,
          max: preferences.maxSpeakerScore,
          step: preferences.stepSpeakerScore,
        },
        replyScore: preferences.replyScoresEnabled
          ? { min: preferences.minReplyScore, max: preferences.maxReplyScore }
          : null,
        criteria: Array.isArray(configured) ? configured : [],
      };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/speaker-categories",
    operationId: "listSpeakerCategories",
    summary: "List speaker categories",
    description: "Public tokens see only categories marked public.",
    tag: "speaker-categories",
    auth: { kind: "token", resource: "tournament", access: "read", public: true },
    params: slugOnly,
    response: listOf(speakerCategorySchema),
    async handler(context) {
      return { data: sortSpeakerCategories(context.tournament.preferences?.speakerCategories ?? []) };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/speaker-categories/{categoryId}",
    operationId: "getSpeakerCategory",
    summary: "Get a speaker category",
    tag: "speaker-categories",
    auth: { kind: "token", resource: "tournament", access: "read", public: true },
    params: s.object({ slug: slugParam, categoryId: idSchema("Speaker category id.") }),
    response: speakerCategorySchema,
    async handler(context) {
      const category = (context.tournament.preferences?.speakerCategories ?? [])
        .find((item) => item.id === context.params.categoryId);
      if (!category) throw notFound("Speaker category");
      return category;
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/speaker-categories/{categoryId}/eligibility",
    operationId: "getSpeakerCategoryEligibility",
    summary: "List the speakers in a speaker category",
    tag: "speaker-categories",
    auth: { kind: "token", resource: "participants", access: "read" },
    params: s.object({ slug: slugParam, categoryId: idSchema("Speaker category id.") }),
    response: s.object({ categoryId: s.string(), speakerIds: s.array(s.string()) }),
    async handler(context) {
      const categories = context.tournament.preferences?.speakerCategories ?? [];
      if (!categories.some((item) => item.id === context.params.categoryId)) throw notFound("Speaker category");
      const teams = (await context.data.all("teams")).map((record) => asType<Team>(record));
      const speakerIds = teams.flatMap((team) => (team.speakers ?? [])
        .filter((speaker) =>
          resolveSpeakerCategoryIds(speakerCategoryRefs(speaker, team), categories).includes(context.params.categoryId)
        )
        .map((speaker) => speaker.id));
      return { categoryId: context.params.categoryId, speakerIds };
    },
  }),
];

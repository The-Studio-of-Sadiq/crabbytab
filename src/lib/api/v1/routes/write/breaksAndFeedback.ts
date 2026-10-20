import { withTeamOverride } from "@/features/tournament/application/breaks";
import { resolveSpeakerCategoryIds, speakerCategoryRefs } from "@/lib/speakerCategories";
import type { BreakCategory, BreakTeamOverride, Team } from "@/types";
import { ApiError, notFound } from "../../errors";
import { defineRoute, slugParam } from "../../router";
import { s } from "../../schema";
import { serializeBreakCategory } from "../../serializers";
import { idSchema } from "../shared";
import { overrideSchema, requireFound, runWrite } from "./shared";

/**
 * Tabbycat endpoints with no tab-room screen of their own, built from the tab room's commands:
 * feedback DELETE, the break's DELETE and remark PATCH, and add-only eligibility PATCHes.
 */

const breakCategoryParams = s.object({ slug: slugParam, categoryId: idSchema("Break category id.") });
const remarks = ["include", "ineligible", "withdrawn", "different_break", "disqualified", "lost_coin_toss"] as const satisfies readonly BreakTeamOverride[];

export const breakAndFeedbackWriteRoutes = [
  defineRoute({
    method: "DELETE",
    path: "/tournaments/{slug}/feedback/{feedbackId}",
    operationId: "deleteFeedback",
    summary: "Delete a feedback submission",
    description: "Soft-deleted and archived (recoverable), and recorded in the audit log. To keep it on record but not count it, PATCH `ignored: true` instead.",
    tag: "feedback",
    auth: { kind: "token", resource: "feedback", access: "write" },
    params: s.object({ slug: slugParam, feedbackId: idSchema("Feedback id.") }),
    successStatus: 204,
    response: s.unknown(),
    async handler(context) {
      await runWrite(context, async (tabRoom, session) => {
        requireFound(await session.one("feedback", context.params.feedbackId), "Feedback");
        await tabRoom.deleteFeedback(context.params.feedbackId);
      });
      return { status: 204, body: null };
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/tournaments/{slug}/break-categories/{categoryId}/break",
    operationId: "deleteBreak",
    summary: "Clear a category's generated break",
    description:
      "The category forgets its break, its teams stop breaking in it and the elimination rounds stop " +
      "hosting it. Refused (409 rule_violation) once one of those rounds has a draw.",
    tag: "break-categories",
    auth: { kind: "token", resource: "breaks", access: "write" },
    params: breakCategoryParams,
    successStatus: 204,
    response: s.unknown(),
    async handler(context) {
      await runWrite(context, async (tabRoom, session) => {
        const category = requireFound(await session.one<BreakCategory>("breakCategories", context.params.categoryId), "Break category");
        if (!category.generatedBreak) throw notFound("Generated break");
        await tabRoom.clearBreak(category.id);
      });
      return { status: 204, body: null };
    },
  }),
  defineRoute({
    method: "PATCH",
    path: "/tournaments/{slug}/break-categories/{categoryId}/break",
    operationId: "updateBreakRemarks",
    summary: "Set remarks on teams and regenerate the break",
    description:
      "Tabbycat's breaking-teams PATCH: each team's remark (`include` forces it in; any other remark " +
      "excludes it; `null` removes the remark) is saved on the category, then the break is generated " +
      "again under the same rules as POST .../break (409 rule_violation; `override.reason` for " +
      "overridable ones).",
    tag: "break-categories",
    auth: { kind: "token", resource: "breaks", access: "write" },
    params: breakCategoryParams,
    body: s.object({
      remarks: s.record(s.nullable(s.enum(remarks)), { maxKeys: 2000, description: "Team id -> remark (null removes it)." }),
      override: overrideSchema,
    }),
    successStatus: 200,
    response: s.ref("BreakCategory"),
    async handler(context) {
      const categoryId = context.params.categoryId;
      return runWrite(context, async (tabRoom, session) => {
        let categories = await session.all<BreakCategory>("breakCategories");
        requireFound(categories.find((category) => category.id === categoryId), "Break category");
        const teamIds = Object.keys(context.body.remarks);
        const known = new Set((await session.byIds<Team>("teams", teamIds)).map((team) => team.id));
        const unknown = teamIds.find((id) => !known.has(id));
        if (unknown) throw new ApiError(422, "validation_failed", `Team ${unknown} does not exist.`);
        for (const [teamId, remark] of Object.entries(context.body.remarks)) {
          categories = withTeamOverride(categories, categoryId, teamId, remark);
        }
        await tabRoom.saveBreakCategories(categories);
        await tabRoom.generateBreak(categoryId, context.body.override);
        return () => serializeBreakCategory(requireFound(session.latest<BreakCategory>("breakCategories", categoryId), "Break category"));
      });
    },
  }),
  defineRoute({
    method: "PATCH",
    path: "/tournaments/{slug}/break-categories/{categoryId}/eligibility",
    operationId: "addBreakEligibility",
    summary: "Make more teams eligible for a break category",
    description: "Add-only (Tabbycat's eligibility PATCH): listed teams become eligible; nobody is removed.",
    tag: "break-categories",
    auth: { kind: "token", resource: "breaks", access: "write" },
    params: breakCategoryParams,
    body: s.object({ teamIds: s.array(idSchema("Team id."), { min: 1, max: 5000, unique: true }) }),
    successStatus: 200,
    response: s.object({ categoryId: s.string(), added: s.array(s.string()) }),
    async handler(context) {
      const categoryId = context.params.categoryId;
      return runWrite(context, async (tabRoom, session) => {
        requireFound(await session.one<BreakCategory>("breakCategories", categoryId), "Break category");
        const teams = await session.byIds<Team>("teams", context.body.teamIds);
        const unknown = context.body.teamIds.find((id) => !teams.some((team) => team.id === id));
        if (unknown) throw new ApiError(422, "validation_failed", `Team ${unknown} does not exist.`);
        const updated = teams
          .filter((team) => !(team.breakCategories ?? []).includes(categoryId))
          .map((team) => ({ ...team, breakCategories: [...(team.breakCategories ?? []), categoryId] }));
        if (updated.length) await tabRoom.entities().saveEntityBatch({ teamsUpdated: updated }, "API break eligibility");
        return { categoryId, added: updated.map((team) => team.id) };
      });
    },
  }),
  defineRoute({
    method: "PATCH",
    path: "/tournaments/{slug}/speaker-categories/{categoryId}/eligibility",
    operationId: "addSpeakerCategoryEligibility",
    summary: "Add speakers to a speaker category",
    description: "Add-only (Tabbycat's eligibility PATCH): listed speakers join the category; nobody is removed.",
    tag: "speaker-categories",
    auth: { kind: "token", resource: "participants", access: "write" },
    params: s.object({ slug: slugParam, categoryId: idSchema("Speaker category id.") }),
    body: s.object({ speakerIds: s.array(idSchema("Speaker id."), { min: 1, max: 5000, unique: true }) }),
    successStatus: 200,
    response: s.object({ categoryId: s.string(), added: s.array(s.string()) }),
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
        const added: string[] = [];
        const updated = teams.flatMap((team) => {
          let changed = false;
          const speakers = team.speakers.map((speaker) => {
            if (!wanted.has(speaker.id)) return speaker;
            // Labels from older data resolve to ids, as in the replace-all PUT.
            const ids = resolveSpeakerCategoryIds(speakerCategoryRefs(speaker, team), categories);
            if (ids.includes(categoryId)) return speaker;
            changed = true;
            added.push(speaker.id);
            return { ...speaker, categories: [...ids, categoryId] };
          });
          return changed ? [{ ...team, speakers }] : [];
        });
        if (updated.length) await tabRoom.entities().saveEntityBatch({ teamsUpdated: updated }, "API speaker category eligibility");
        return { categoryId, added };
      });
    },
  }),
];

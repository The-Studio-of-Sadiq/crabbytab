import type { Debate, Round } from "@/types";
import { ApiError, notFound } from "../errors";
import { defineRoute, slugParam, type ApiRoute } from "../router";
import { s } from "../schema";
import { asType } from "../serializers";
import { entityReadRoutes } from "./entities";
import { meRoutes } from "./me";
import { roundDataReadRoutes } from "./roundData";
import { standingsReadRoutes } from "./standings";
import { tournamentReadRoutes } from "./tournament";
import { entityWriteRoutes } from "./write/entities";
import { roundWriteRoutes } from "./write/rounds";
import { tournamentWriteRoutes } from "./write/tournament";
import { currentDrawRoundId, getPublicSiteSettings, isRoundDrawPublic } from "@/lib/publicFeatures";

const rootRoute = defineRoute({
  method: "GET",
  path: "/",
  operationId: "getApiRoot",
  summary: "API root",
  tag: "meta",
  auth: { kind: "none" },
  response: s.object({ name: s.string(), version: s.string(), openapi: s.string(), docs: s.string() }),
  async handler() {
    return { name: "CrabbyTab Tournament API", version: "1", openapi: "/api/openapi.json", docs: "/tournaments/api" };
  },
});

const publishRoute = defineRoute({
  method: "POST",
  path: "/tournaments/{slug}/publish",
  operationId: "publishPublicView",
  summary: "Publish the public site",
  description:
    "Rebuilds the public view from the cloud data, as the tab room's Publish does. API writes " +
    "change the cloud data at once but reach the public site (and read:public tokens) only when " +
    "it is published.",
  tag: "tournaments",
  auth: { kind: "token", resource: "tournament", access: "write" },
  params: s.object({ slug: slugParam }),
  successStatus: 200,
  response: s.unknown("{ status: published | unchanged, version, changedSections }"),
  async handler(context) {
    if (!context.publishPublicView) throw new ApiError(503, "unavailable", "Publishing is not available here.");
    return context.publishPublicView();
  },
});

/**
 * The original v1 endpoint (before per-resource routes), kept with its response shape. Public
 * tokens now read it from the published public view instead of the live collections.
 */
const legacyDrawsRoute = defineRoute({
  method: "GET",
  path: "/tournaments/{slug}/draws",
  operationId: "getTournamentDraws",
  summary: "List visible draws (legacy shape)",
  description:
    "Every round's draw in one response. Kept for clients written against the first v1 API; new " +
    "clients should use `/rounds/{roundSeq}/pairings`.",
  tag: "pairings",
  auth: { kind: "token", resource: "draws", access: "read", public: true },
  params: s.object({ slug: slugParam }),
  query: s.object({ roundSeq: s.optional(s.integer({ min: 1, description: "Limit the response to one round." })) }),
  response: s.object({
    tournament: s.unknown(),
    rounds: s.array(s.unknown()),
    debates: s.array(s.unknown()),
  }),
  async handler(context) {
    const allRounds = (await context.data.all("rounds"))
      .map((record) => asType<Round>(record))
      .filter((round) => !round.cancelled)
      .sort((left, right) => left.seq - right.seq);
    const rounds = allRounds.filter((round) =>
      context.query.roundSeq === undefined || round.seq === context.query.roundSeq
    );
    if (context.query.roundSeq !== undefined && rounds.length === 0) throw notFound("Round");
    const publicView = context.data.view === "public";
    // Public access sees only the rounds on the public draw page (the draw mode decides).
    const drawMode = getPublicSiteSettings(context.tournament.preferences).drawMode;
    const currentRoundId = currentDrawRoundId(allRounds);
    const visibleRounds = rounds.filter((round) =>
      !publicView || isRoundDrawPublic(round, drawMode, currentRoundId)
    );
    const debatesByRound = await Promise.all(visibleRounds.map((round) =>
      context.data.all("debates", [{ field: "roundId", op: "==", value: round.id }])
    ));
    const revealPanels = new Set(visibleRounds
      .filter((round) => !publicView || round.adjudicatorsRevealed === true)
      .map((round) => round.id));
    const debates = debatesByRound.flat()
      .map((record) => asType<Debate>(record))
      .filter((debate) => !debate.postponed)
      .sort((left, right) => left.roundSeq - right.roundSeq || left.roomRank - right.roomRank || left.id.localeCompare(right.id));
    const tournament = context.tournament;
    return {
      tournament: { id: tournament.id, name: tournament.name, shortName: tournament.shortName, slug: tournament.slug, format: tournament.format },
      rounds: visibleRounds.map(({ id, seq, name, stage, drawStatus }) => ({ id, seq, name, stage, drawStatus })),
      debates: debates.map((debate) => ({
        id: debate.id,
        roundId: debate.roundId,
        roundSeq: debate.roundSeq,
        roomRank: debate.roomRank,
        bracket: debate.bracket,
        venue: debate.venueName,
        teams: Object.fromEntries(Object.entries(debate.teams || {}).map(([side, slot]) => [
          side,
          slot?.teamId ? { id: slot.teamId, name: slot.teamName, side } : null,
        ])),
        adjudicators: revealPanels.has(debate.roundId) && debate.adjudicators ? {
          chair: debate.adjudicators.chairId
            ? { id: debate.adjudicators.chairId, name: debate.adjudicators.chairName ?? "" }
            : null,
          panellists: (debate.adjudicators.panellistIds || []).map((id, index) => ({
            id,
            name: debate.adjudicators.panellistNames?.[index] ?? "",
          })),
          trainees: (debate.adjudicators.traineeIds || []).map((id, index) => ({
            id,
            name: debate.adjudicators.traineeNames?.[index] ?? "",
          })),
        } : null,
      })),
    };
  },
});

export const READ_ROUTES: readonly ApiRoute[] = [
  rootRoute,
  ...tournamentReadRoutes,
  ...entityReadRoutes,
  ...roundDataReadRoutes,
  ...standingsReadRoutes,
  ...meRoutes,
  legacyDrawsRoute,
];

export const WRITE_ROUTES: readonly ApiRoute[] = [
  ...tournamentWriteRoutes,
  publishRoute,
  ...entityWriteRoutes,
  ...roundWriteRoutes,
];

export const API_ROUTES: readonly ApiRoute[] = [...READ_ROUTES, ...WRITE_ROUTES];

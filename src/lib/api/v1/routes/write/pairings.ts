import { randomUUID } from "node:crypto";
import { getEligibleTeamsForRound } from "@/lib/draw/generator";
import { MANUAL_SIDES_FLAG } from "@/lib/draw/manualSides";
import { getVenueIncompatibilities } from "@/lib/draw/venueAllocator";
import { isVenueAvailableForRound } from "@/lib/venues/venues";
import { anticipateRound, panelsFromAnticipatedDraw, prioritisePanels } from "@/features/tournament/application/preformedPanels";
import type {
  BallotSubmission,
  BreakCategory,
  Debate,
  DebateSide,
  DebateTeamSlot,
  PreformedPanel,
  Round,
  Team,
  Tournament,
  Venue,
} from "@/types";
import { ApiError, conflict, notFound } from "../../errors";
import { defineRoute, slugParam } from "../../router";
import { s } from "../../schema";
import { serializeDebate, serializeRound } from "../../serializers";
import type { SessionTabRoom } from "../../tabRoom";
import { idSchema, roundSeqSchema } from "../shared";
import { sessionDebate, sessionRound } from "./rounds";
import { overrideSchema, requireFound, runWrite } from "./shared";

/**
 * Hand edits of a draw (Tabbycat's pairing POST / PATCH teams / DELETE and "delete all pairings").
 * They go through the draw editor's command (updateDebatesCommand), so the same rules apply as in
 * the tab room: a debate with ballots cannot lose its teams or be deleted, and edits to a released
 * or completed round's matchups need an audited override.
 */

const roundParams = s.object({ slug: slugParam, roundSeq: roundSeqSchema });
const debateParams = s.object({ slug: slugParam, roundSeq: roundSeqSchema, debateId: idSchema("Debate (pairing) id.") });

export function formatSides(tournament: Tournament): DebateSide[] {
  return tournament.format === "bp" ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"];
}

const teamsSchema = s.record(idSchema("Team id."), {
  maxKeys: 4,
  keyPattern: /^(OG|OO|CG|CO|AFF|NEG)$/,
  description: "Side -> team id: every side of the format (AFF/NEG, or OG/OO/CG/CO for BP).",
});

/**
 * Checks a debate's new teams: every side of the format, distinct, existing teams, eligible for an
 * elimination round, and not already drawn elsewhere in the round (a team debates once per round).
 */
export function resolveDebateTeams(
  tabRoom: SessionTabRoom,
  round: Round,
  teamsBySide: Record<string, string>,
  exceptDebateId?: string
): Record<DebateSide, DebateTeamSlot> {
  const tournament = tabRoom.session.tournament;
  const sides = formatSides(tournament);
  const given = Object.keys(teamsBySide);
  if (given.length !== sides.length || !sides.every((side) => given.includes(side))) {
    throw new ApiError(422, "validation_failed", `teams must name exactly the sides ${sides.join(", ")}.`);
  }
  const ids = sides.map((side) => teamsBySide[side]);
  if (new Set(ids).size !== ids.length) throw new ApiError(422, "validation_failed", "A team appears twice in the debate.");
  const teams = new Map(tabRoom.session.view<Team>("teams").map((team) => [team.id, team]));
  const missing = ids.find((id) => !teams.has(id));
  if (missing) throw new ApiError(422, "validation_failed", `Team ${missing} does not exist.`);
  if (round.stage === "elimination") {
    const eligible = new Set(getEligibleTeamsForRound([...teams.values()], round).map((team) => team.id));
    const ineligible = ids.find((id) => !eligible.has(id));
    if (ineligible) throw new ApiError(422, "validation_failed", `${teams.get(ineligible)!.name} has not qualified for ${round.name}.`);
  }
  for (const other of tabRoom.session.view<Debate>("debates")) {
    if (other.roundId !== round.id || other.id === exceptDebateId) continue;
    const taken = ids.find((id) => other.byeTeamId === id || Object.values(other.teams ?? {}).some((slot) => slot?.teamId === id));
    if (taken) {
      throw conflict(`${teams.get(taken)!.name} is already drawn in another debate of ${round.name}; move or delete that debate first.`);
    }
  }
  return Object.fromEntries(sides.map((side) => {
    const team = teams.get(teamsBySide[side])!;
    return [side, { teamId: team.id, teamName: team.name, side }];
  })) as Record<DebateSide, DebateTeamSlot>;
}

/** A room for a debate: it exists, is available in the round, is free, and suits the debate. */
export function resolveDebateVenue(tabRoom: SessionTabRoom, round: Round, debate: Debate, venueId: string): Venue {
  const venue = tabRoom.session.view<Venue>("venues").find((item) => item.id === venueId);
  if (!venue) throw new ApiError(422, "validation_failed", `Venue ${venueId} does not exist.`);
  if (!isVenueAvailableForRound(venue, round.id)) throw conflict(`${venue.name} is not available in ${round.name}.`);
  const occupiedBy = tabRoom.session.view<Debate>("debates")
    .find((other) => other.roundId === round.id && other.id !== debate.id && other.venueId === venue.id);
  if (occupiedBy) throw conflict(`${venue.name} is already used by another debate in ${round.name}.`);
  const reasons = getVenueIncompatibilities(debate, venue);
  if (reasons.length > 0) throw new ApiError(422, "validation_failed", `${venue.name} does not suit this debate: ${reasons.join("; ")}.`);
  return venue;
}

async function loadDraw(tabRoom: SessionTabRoom, roundSeq: string): Promise<Round> {
  const round = await sessionRound(tabRoom, roundSeq);
  await tabRoom.loadAll("rounds", "debates", "ballots", "teams", "adjudicators", "venues");
  return round;
}

export const pairingWriteRoutes = [
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/rounds/{roundSeq}/pairings",
    operationId: "createPairing",
    summary: "Add a debate to a round's draw by hand",
    description:
      "As the draw editor's \"add room\": the debate gets the next room number. Every side needs a " +
      "team that is not already drawn in the round (409 otherwise); elimination rounds take only " +
      "qualified teams. A venue must be available in the round and free. Adding to a released or " +
      "completed round needs `override.reason`.",
    tag: "pairings",
    auth: { kind: "token", resource: "draws", access: "write" },
    params: roundParams,
    body: s.object({
      teams: teamsSchema,
      venueId: s.optional(idSchema("Venue id.")),
      importance: s.optional(s.integer({ min: -2, max: 10 })),
      override: overrideSchema,
    }),
    response: s.ref("Pairing"),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const round = await loadDraw(tabRoom, context.params.roundSeq);
        if (round.cancelled) throw conflict(`${round.name} is cancelled.`);
        const tournament = session.tournament;
        const roundDebates = session.view<Debate>("debates").filter((debate) => debate.roundId === round.id);
        const sidesOnBallot = tournament.format !== "bp" && tournament.preferences?.sideAllocationRule === "manual_ballot";
        let debate: Debate = {
          id: `debate-${round.id}-${randomUUID()}`,
          tournamentId: tournament.id,
          roundId: round.id,
          roundSeq: round.seq,
          bracket: 0,
          roomRank: Math.max(0, ...roundDebates.map((item) => item.roomRank ?? 0)) + 1,
          importance: context.body.importance ?? 0,
          resultStatus: "none",
          sidesConfirmed: false,
          flags: sidesOnBallot ? [MANUAL_SIDES_FLAG] : [],
          teams: resolveDebateTeams(tabRoom, round, context.body.teams),
          adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
        };
        if (context.body.venueId) {
          const venue = resolveDebateVenue(tabRoom, round, debate, context.body.venueId);
          debate = { ...debate, venueId: venue.id, venueName: venue.name };
        }
        await tabRoom.updateDebates([...session.view<Debate>("debates"), debate], context.body.override);
        const id = debate.id;
        return () => serializeDebate(requireFound(session.latest<Debate>("debates", id), "Pairing"));
      });
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/tournaments/{slug}/rounds/{roundSeq}/pairings/{debateId}",
    operationId: "deletePairing",
    summary: "Delete one debate from a round's draw",
    description: "Refused while the debate has ballots (discard them first). Deleting from a released draw needs `override.reason`.",
    tag: "pairings",
    auth: { kind: "token", resource: "draws", access: "write" },
    params: debateParams,
    body: s.object({ override: overrideSchema }),
    successStatus: 204,
    response: s.unknown(),
    async handler(context) {
      await runWrite(context, async (tabRoom, session) => {
        const round = await loadDraw(tabRoom, context.params.roundSeq);
        const debate = await sessionDebate(tabRoom, round, context.params.debateId);
        await tabRoom.updateDebates(session.view<Debate>("debates").filter((item) => item.id !== debate.id), context.body?.override);
      });
      return { status: 204, body: null };
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/tournaments/{slug}/rounds/{roundSeq}/pairings",
    operationId: "deleteRoundDraw",
    summary: "Delete a round's whole draw",
    description:
      "Removes every debate of the round and sets its draw status back to `none` (panels hidden). " +
      "Refused while any debate has ballots; a released draw needs `override.reason`.",
    tag: "pairings",
    auth: { kind: "token", resource: "draws", access: "write" },
    params: roundParams,
    body: s.object({ override: overrideSchema }),
    successStatus: 200,
    response: s.object({ round: s.ref("Round"), deleted: s.integer() }),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const round = await loadDraw(tabRoom, context.params.roundSeq);
        const all = session.view<Debate>("debates");
        const removed = all.filter((debate) => debate.roundId === round.id);
        if (removed.length > 0) {
          await tabRoom.updateDebates(all.filter((debate) => debate.roundId !== round.id), context.body?.override);
        }
        const current = requireFound(session.latest<Round>("rounds", round.id), "Round");
        if (current.drawStatus !== "none" || current.adjudicatorsRevealed) {
          await tabRoom.updateRound({ ...current, drawStatus: "none", adjudicatorsRevealed: false }, context.body?.override);
        }
        await session.recordAuditEvent({
          action: "draw.deleted",
          category: "draw",
          summary: `Deleted the ${round.name} draw`,
          roundId: round.id,
          details: { debateCount: removed.length },
        });
        return () => ({
          round: serializeRound(requireFound(session.latest<Round>("rounds", round.id), "Round")),
          deleted: removed.length,
        });
      });
    },
  }),
];

/* ------------------------------------------------------------------------ */
/* Preformed panels, one at a time                                           */
/* ------------------------------------------------------------------------ */

const panelParams = s.object({ slug: slugParam, roundSeq: roundSeqSchema, panelId: idSchema("Preformed panel id.") });
const panelFields = {
  chairId: s.optional(s.nullable(idSchema("Chair adjudicator id; null clears it."))),
  panellistIds: s.array(idSchema("Adjudicator id."), { max: 20, unique: true }),
  traineeIds: s.array(idSchema("Adjudicator id."), { max: 20, unique: true }),
  importance: s.integer({ min: 0, max: 10 }),
};
const panelResponse = s.object({
  id: s.string(),
  chairId: s.optional(s.string()),
  panellistIds: s.array(s.string()),
  traineeIds: s.array(s.string()),
  importance: s.number(),
  roomRank: s.optional(s.integer()),
  bracketMin: s.optional(s.number()),
  bracketMax: s.optional(s.number()),
  liveness: s.optional(s.integer()),
});

function toPanel(
  id: string,
  input: { chairId?: string | null; panellistIds: string[]; traineeIds: string[]; importance: number },
  annotations: Pick<PreformedPanel, "roomRank" | "bracketMin" | "bracketMax" | "liveness"> = {}
): PreformedPanel {
  return {
    ...annotations,
    id,
    ...(input.chairId ? { chairId: input.chairId } : {}),
    panellistIds: input.panellistIds,
    traineeIds: input.traineeIds,
    importance: input.importance,
  };
}

/** Saves the round's panels through the preformed-panel command (which validates members). */
async function savePanels(tabRoom: SessionTabRoom, round: Round, panels: PreformedPanel[]): Promise<void> {
  await tabRoom.savePreformedPanels(round.id, panels);
}

export const preformedPanelWriteRoutes = [
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/rounds/{roundSeq}/preformed-panels",
    operationId: "createPreformedPanel",
    summary: "Add one preformed panel",
    tag: "preformed-panels",
    auth: { kind: "token", resource: "draws", access: "write" },
    params: roundParams,
    body: s.object(panelFields),
    response: panelResponse,
    async handler(context) {
      return runWrite(context, async (tabRoom) => {
        const round = await sessionRound(tabRoom, context.params.roundSeq);
        const panel = toPanel(tabRoom.createId("panel"), context.body);
        await savePanels(tabRoom, round, [...(round.preformedPanels ?? []), panel]);
        return panel;
      });
    },
  }),
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/rounds/{roundSeq}/preformed-panels/from-anticipated-draw",
    operationId: "createPreformedPanelsFromAnticipatedDraw",
    summary: "Add blank panels for the anticipated draw (bracket range and liveness)",
    description:
      "Tabbycat's \"create preformed panels\": one panel per anticipated room, annotated with its bracket " +
      "range and liveness for the open break. Panels already at a room rank keep their members; other " +
      "panels are kept. `prioritise` then sets importance by bracket or by liveness, as on the panels page.",
    tag: "preformed-panels",
    auth: { kind: "token", resource: "draws", access: "write" },
    params: roundParams,
    body: s.object({ prioritise: s.optional(s.enum(["bracket", "liveness"] as const)) }),
    successStatus: 200,
    response: s.object({ data: s.array(panelResponse), notice: s.optional(s.string()) }),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const round = await sessionRound(tabRoom, context.params.roundSeq);
        await tabRoom.loadAll("rounds", "teams", "debates", "ballots", "breakCategories");
        const anticipation = anticipateRound(round, {
          tournament: session.tournament,
          rounds: session.view<Round>("rounds"),
          teams: session.view<Team>("teams"),
          debates: session.view<Debate>("debates"),
          ballots: session.view<BallotSubmission>("ballots"),
          breakCategories: session.view<BreakCategory>("breakCategories"),
        });
        let panels = panelsFromAnticipatedDraw(round.preformedPanels ?? [], anticipation.rooms, () => tabRoom.createId("panel"));
        if (context.body?.prioritise) panels = prioritisePanels(panels, context.body.prioritise, anticipation.thresholds);
        await savePanels(tabRoom, round, panels);
        return { data: panels, ...(anticipation.notice ? { notice: anticipation.notice } : {}) };
      });
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/rounds/{roundSeq}/preformed-panels/{panelId}",
    operationId: "getPreformedPanel",
    summary: "Get one preformed panel",
    tag: "preformed-panels",
    auth: { kind: "token", resource: "draws", access: "read" },
    params: panelParams,
    response: panelResponse,
    async handler(context) {
      const records = await context.data.all("rounds", [{ field: "seq", op: "==", value: Number(context.params.roundSeq) }]);
      const round = records[0] as unknown as Round | undefined;
      if (!round) throw notFound("Round");
      const panel = (round.preformedPanels ?? []).find((item) => item.id === context.params.panelId);
      if (!panel) throw notFound("Preformed panel");
      return { ...panel };
    },
  }),
  defineRoute({
    method: "PATCH",
    path: "/tournaments/{slug}/rounds/{roundSeq}/preformed-panels/{panelId}",
    operationId: "updatePreformedPanel",
    summary: "Change one preformed panel",
    tag: "preformed-panels",
    auth: { kind: "token", resource: "draws", access: "write" },
    params: panelParams,
    body: s.object(s.partial(panelFields), { minProperties: 1 }),
    response: panelResponse,
    successStatus: 200,
    async handler(context) {
      return runWrite(context, async (tabRoom) => {
        const round = await sessionRound(tabRoom, context.params.roundSeq);
        const panels = round.preformedPanels ?? [];
        const previous = requireFound(panels.find((item) => item.id === context.params.panelId), "Preformed panel");
        const { roomRank, bracketMin, bracketMax, liveness } = previous;
        const next = toPanel(previous.id, {
          chairId: context.body.chairId === undefined ? previous.chairId : context.body.chairId,
          panellistIds: context.body.panellistIds ?? previous.panellistIds,
          traineeIds: context.body.traineeIds ?? previous.traineeIds,
          importance: context.body.importance ?? previous.importance,
        }, { roomRank, bracketMin, bracketMax, liveness });
        await savePanels(tabRoom, round, panels.map((item) => (item.id === previous.id ? next : item)));
        return next;
      });
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/tournaments/{slug}/rounds/{roundSeq}/preformed-panels/{panelId}",
    operationId: "deletePreformedPanel",
    summary: "Delete one preformed panel",
    tag: "preformed-panels",
    auth: { kind: "token", resource: "draws", access: "write" },
    params: panelParams,
    successStatus: 204,
    response: s.unknown(),
    async handler(context) {
      await runWrite(context, async (tabRoom) => {
        const round = await sessionRound(tabRoom, context.params.roundSeq);
        const panels = round.preformedPanels ?? [];
        requireFound(panels.find((item) => item.id === context.params.panelId), "Preformed panel");
        await savePanels(tabRoom, round, panels.filter((item) => item.id !== context.params.panelId));
      });
      return { status: 204, body: null };
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/tournaments/{slug}/rounds/{roundSeq}/preformed-panels",
    operationId: "deletePreformedPanels",
    summary: "Delete all of a round's preformed panels",
    tag: "preformed-panels",
    auth: { kind: "token", resource: "draws", access: "write" },
    params: roundParams,
    successStatus: 204,
    response: s.unknown(),
    async handler(context) {
      await runWrite(context, async (tabRoom) => {
        const round = await sessionRound(tabRoom, context.params.roundSeq);
        if ((round.preformedPanels ?? []).length > 0) await savePanels(tabRoom, round, []);
      });
      return { status: 204, body: null };
    },
  }),
];

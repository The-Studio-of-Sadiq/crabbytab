import { adminFeedbackLinkError } from "@/features/tournament/application/feedback";
import { upsertBreakCategory, validateBreakCategoryDraft, type BreakCategoryDraft } from "@/features/tournament/application/breaks";
import { checkBallotIntake } from "@/features/tournament/application/stateGuards";
import { ballotSheetCode, intakeRecordId } from "@/features/tournament/application/ballotIntake";
import type {
  Adjudicator,
  BallotIntakeRecord,
  BallotSubmission,
  BreakCategory,
  Debate,
  DebateSide,
  FeedbackSubmission,
  Motion,
  Round,
  Team,
  Venue,
} from "@/types";
import { buildApiBallot } from "../../ballotInput";
import { ApiError, conflict, notFound } from "../../errors";
import { defineRoute, slugParam } from "../../router";
import { s } from "../../schema";
import { ApiCommandSession } from "../../session";
import {
  serializeBallot,
  serializeBreakCategory,
  serializeDebate,
  serializeFeedback,
  serializeRound,
} from "../../serializers";
import type { SessionTabRoom } from "../../tabRoom";
import { personCheckinStatus } from "../roundData";
import { idSchema, roundSeqSchema } from "../shared";
import { apiActorId, apiActorName, expectedVersionSchema, overrideSchema, requireFound, runWrite, type WriteContext } from "./shared";

const roundParams = s.object({ slug: slugParam, roundSeq: roundSeqSchema });
const debateParams = s.object({ slug: slugParam, roundSeq: roundSeqSchema, debateId: idSchema("Debate (pairing) id.") });

async function sessionRound(tabRoom: SessionTabRoom, seqText: string): Promise<Round> {
  const seq = Number(seqText);
  const rounds = await tabRoom.session.all<Round>("rounds");
  return requireFound(rounds.find((round) => round.seq === seq), "Round");
}

async function sessionDebate(tabRoom: SessionTabRoom, round: Round, debateId: string): Promise<Debate> {
  const debate = await tabRoom.session.one<Debate>("debates", debateId);
  if (!debate || debate.roundId !== round.id) throw notFound("Pairing");
  return debate;
}

/* ------------------------------------------------------------------------ */
/* Rounds                                                                    */
/* ------------------------------------------------------------------------ */

const drawTypes = ["random", "power_paired", "round_robin", "elimination", "manual", "seeded"] as const;

const roundPatchSchema = s.object({
  name: s.optional(s.string({ min: 1, max: 80 })),
  abbreviation: s.optional(s.string({ min: 1, max: 12 })),
  drawType: s.optional(s.enum(drawTypes)),
  drawStatus: s.optional(s.enum(["none", "draft", "confirmed"] as const, "`confirmed` releases the draw to the public (the draw is checked first).")),
  adjudicatorsRevealed: s.optional(s.boolean()),
  resultsReleased: s.optional(s.boolean()),
  teamSpeaksReleased: s.optional(s.boolean()),
  silent: s.optional(s.boolean()),
  feedbackWeight: s.optional(s.number({ min: 0, max: 1 })),
  feedbackEnabled: s.optional(s.boolean()),
  completed: s.optional(s.boolean("Completing a round needs every debate resulted.")),
  cancelled: s.optional(s.boolean()),
  breakCategoryIds: s.optional(s.array(idSchema("Break category id."), { max: 20, unique: true })),
  preallocatedSides: s.optional(s.record(s.enum(["AFF", "NEG"] as const), { maxKeys: 2000, description: "Team id -> side (preallocated side rule)." })),
  override: overrideSchema,
  expectedVersion: expectedVersionSchema,
}, { minProperties: 1 });

const roundRoutes = [
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/rounds",
    operationId: "createRound",
    summary: "Create a round",
    description: "The round gets the next sequence number.",
    tag: "rounds",
    auth: { kind: "token", resource: "rounds", access: "write" },
    params: s.object({ slug: slugParam }),
    body: s.object({
      name: s.string({ min: 1, max: 80 }),
      abbreviation: s.string({ min: 1, max: 12 }),
      stage: s.enum(["preliminary", "elimination"] as const),
      drawType: s.optional(s.enum(drawTypes, "Defaults to the tournament's draw rule.")),
    }),
    response: s.ref("Round"),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const round = await tabRoom.createRound({
          name: context.body.name,
          abbr: context.body.abbreviation,
          stage: context.body.stage,
          customDrawType: context.body.drawType,
        });
        return () => serializeRound(requireFound(session.latest<Round>("rounds", round.id), "Round"));
      });
    },
  }),
  defineRoute({
    method: "PATCH",
    path: "/tournaments/{slug}/rounds/{roundSeq}",
    operationId: "updateRound",
    summary: "Update a round: release the draw, reveal panels, release results, complete, ...",
    description:
      "Status changes run the tab room's rules: a draw is checked before release, results need every " +
      "ballot confirmed, a completed round is locked, and so on (409 rule_violation; overridable " +
      "ones accept `override.reason`). Motion release follows the motions themselves.",
    tag: "rounds",
    auth: { kind: "token", resource: "rounds", access: "write" },
    params: roundParams,
    body: roundPatchSchema,
    response: s.ref("Round"),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const round = await sessionRound(tabRoom, context.params.roundSeq);
        const { override, expectedVersion, ...changes } = context.body;
        ApiCommandSession.assertVersion(round as { syncVersion?: number }, expectedVersion);
        if (changes.breakCategoryIds) {
          const categories = new Set((await session.all<BreakCategory>("breakCategories")).map((category) => category.id));
          const unknown = changes.breakCategoryIds.find((id) => !categories.has(id));
          if (unknown) throw new ApiError(422, "validation_failed", `Break category ${unknown} does not exist.`);
        }
        const next = { ...round, ...changes } as Round;
        await tabRoom.updateRound(next, override);
        return () => serializeRound(requireFound(session.latest<Round>("rounds", round.id), "Round"));
      });
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/tournaments/{slug}/rounds/{roundSeq}",
    operationId: "deleteRound",
    summary: "Delete a round",
    description: "Refused once the round has results; later rounds are renumbered as in the tab room.",
    tag: "rounds",
    auth: { kind: "token", resource: "rounds", access: "write" },
    params: roundParams,
    body: s.object({ override: overrideSchema }),
    successStatus: 204,
    response: s.unknown(),
    async handler(context) {
      await runWrite(context, async (tabRoom) => {
        const round = await sessionRound(tabRoom, context.params.roundSeq);
        await tabRoom.deleteRound(round.id, context.body?.override);
      });
      return { status: 204, body: null };
    },
  }),
];

/* ------------------------------------------------------------------------ */
/* Draws, allocation, pairings, preformed panels                             */
/* ------------------------------------------------------------------------ */

const panelSchema = s.object({
  chairId: s.optional(s.nullable(idSchema("Chair adjudicator id."))),
  panellistIds: s.array(idSchema("Adjudicator id."), { max: 20, unique: true }),
  traineeIds: s.array(idSchema("Adjudicator id."), { max: 20, unique: true }),
});

function listedPairings(tabRoom: SessionTabRoom, roundId: string) {
  return tabRoom.session.view<Debate>("debates")
    .filter((debate) => debate.roundId === roundId)
    .sort((left, right) => left.roomRank - right.roomRank || left.id.localeCompare(right.id))
    .map(serializeDebate);
}

const drawRoutes = [
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/rounds/{roundSeq}/pairings/generate-draw",
    operationId: "generateDraw",
    summary: "Generate (or regenerate) a round's draw",
    description:
      "Runs the tab room's draw generator with the tournament's draw rules and records the seed on " +
      "the round. The draw is a draft until released (PATCH the round's drawStatus). Regenerating a " +
      "draw with results needs `discardExistingResults: true` (the ballots are kept as discarded versions).",
    tag: "pairings",
    auth: { kind: "token", resource: "draws", access: "write" },
    params: roundParams,
    body: s.object({
      discardExistingResults: s.optional(s.boolean()),
      override: overrideSchema,
    }),
    successStatus: 200,
    response: s.object({ round: s.ref("Round"), pairings: s.array(s.ref("Pairing")) }),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const round = await sessionRound(tabRoom, context.params.roundSeq);
        await tabRoom.generateDraw(round.id, {
          discardExistingResults: context.body?.discardExistingResults,
          override: context.body?.override,
        });
        return () => ({
          round: serializeRound(requireFound(session.latest<Round>("rounds", round.id), "Round")),
          pairings: listedPairings(tabRoom, round.id),
        });
      });
    },
  }),
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/rounds/{roundSeq}/pairings/allocate-adjudicators",
    operationId: "allocateAdjudicators",
    summary: "Auto-allocate adjudicators to a round's debates",
    description: "The tab room's allocator (conflicts, history, panel strength, preformed panels when enabled).",
    tag: "pairings",
    auth: { kind: "token", resource: "draws", access: "write" },
    params: roundParams,
    body: s.object({
      panelSize: s.integer({ min: 1, max: 9, description: "Voting adjudicators per debate." }),
      override: overrideSchema,
    }),
    successStatus: 200,
    response: s.object({ pairings: s.array(s.ref("Pairing")) }),
    async handler(context) {
      return runWrite(context, async (tabRoom) => {
        const round = await sessionRound(tabRoom, context.params.roundSeq);
        await tabRoom.autoAllocate(round.id, context.body.panelSize, context.body.override);
        return () => ({ pairings: listedPairings(tabRoom, round.id) });
      });
    },
  }),
  defineRoute({
    method: "PATCH",
    path: "/tournaments/{slug}/rounds/{roundSeq}/pairings/{debateId}",
    operationId: "updatePairing",
    summary: "Change a pairing's venue, panel or priority",
    description:
      "Edits after results or release follow the tab room's rules. Changing a panel hides revealed " +
      "panels of the round again, as in the allocation editor.",
    tag: "pairings",
    auth: { kind: "token", resource: "draws", access: "write" },
    params: debateParams,
    body: s.object({
      venueId: s.optional(s.nullable(idSchema("Venue id; null to clear."))),
      adjudicators: s.optional(panelSchema),
      importance: s.optional(s.integer({ min: -2, max: 10 })),
      override: overrideSchema,
      expectedVersion: expectedVersionSchema,
    }, { minProperties: 1 }),
    response: s.ref("Pairing"),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const round = await sessionRound(tabRoom, context.params.roundSeq);
        await tabRoom.loadAll("debates", "adjudicators", "venues");
        const debate = await sessionDebate(tabRoom, round, context.params.debateId);
        const { override, expectedVersion, venueId, adjudicators, importance } = context.body;
        ApiCommandSession.assertVersion(debate as { syncVersion?: number }, expectedVersion);
        const next: Debate = { ...debate };
        if (venueId !== undefined) {
          const venue = venueId ? session.view<Venue>("venues").find((item) => item.id === venueId) : undefined;
          if (venueId && !venue) throw new ApiError(422, "validation_failed", `Venue ${venueId} does not exist.`);
          next.venueId = venue?.id;
          next.venueName = venue?.name;
        }
        if (adjudicators) {
          const byId = new Map(session.view<Adjudicator>("adjudicators").map((item) => [item.id, item]));
          const all = [adjudicators.chairId, ...adjudicators.panellistIds, ...adjudicators.traineeIds].filter((id): id is string => Boolean(id));
          const missing = all.find((id) => !byId.has(id));
          if (missing) throw new ApiError(422, "validation_failed", `Adjudicator ${missing} does not exist.`);
          if (new Set(all).size !== all.length) throw new ApiError(422, "validation_failed", "An adjudicator appears twice on the panel.");
          // An adjudicator sits on one panel per round.
          const elsewhere = session.view<Debate>("debates").find((other) =>
            other.roundId === round.id && other.id !== debate.id &&
            [other.adjudicators?.chairId, ...(other.adjudicators?.panellistIds ?? []), ...(other.adjudicators?.traineeIds ?? [])].some((id) => id && all.includes(id))
          );
          if (elsewhere) throw conflict("An adjudicator on this panel already sits on another debate in the round; move them off it first.");
          next.adjudicators = {
            ...(adjudicators.chairId ? { chairId: adjudicators.chairId, chairName: byId.get(adjudicators.chairId)!.name } : {}),
            panellistIds: adjudicators.panellistIds,
            panellistNames: adjudicators.panellistIds.map((id) => byId.get(id)!.name),
            traineeIds: adjudicators.traineeIds,
            traineeNames: adjudicators.traineeIds.map((id) => byId.get(id)!.name),
          };
        }
        if (importance !== undefined) next.importance = importance;
        await tabRoom.updateDebate(next, override);
        return () => serializeDebate(requireFound(session.latest<Debate>("debates", debate.id), "Pairing"));
      });
    },
  }),
  defineRoute({
    method: "PUT",
    path: "/tournaments/{slug}/rounds/{roundSeq}/preformed-panels",
    operationId: "replacePreformedPanels",
    summary: "Replace a round's preformed panels",
    tag: "preformed-panels",
    auth: { kind: "token", resource: "draws", access: "write" },
    params: roundParams,
    body: s.object({
      panels: s.array(s.object({
        id: s.optional(idSchema("Panel id (kept when given).")),
        chairId: s.optional(idSchema("Chair adjudicator id.")),
        panellistIds: s.array(idSchema("Adjudicator id."), { max: 20, unique: true }),
        traineeIds: s.array(idSchema("Adjudicator id."), { max: 20, unique: true }),
        importance: s.integer({ min: 0, max: 10 }),
      }), { max: 500 }),
    }),
    successStatus: 200,
    response: s.object({ data: s.array(s.unknown()) }),
    async handler(context) {
      return runWrite(context, async (tabRoom) => {
        const round = await sessionRound(tabRoom, context.params.roundSeq);
        const panels = context.body.panels.map((panel) => ({ ...panel, id: panel.id ?? tabRoom.createId("panel") }));
        await tabRoom.savePreformedPanels(round.id, panels);
        return { data: panels };
      });
    },
  }),
];

/* ------------------------------------------------------------------------ */
/* Ballots                                                                   */
/* ------------------------------------------------------------------------ */

const sides = ["OG", "OO", "CG", "CO", "AFF", "NEG"] as const;
const speechSchema = s.object({
  speakerId: idSchema("Speaker id (from the team's roster)."),
  speakerName: s.optional(s.string({ max: 120 })),
  position: s.integer({ min: 1, max: 4, description: "Speaking position; the reply is the last position." }),
  score: s.number({ min: 0, max: 1000 }),
  ghost: s.optional(s.boolean("An iron-person (duplicate) speech.")),
}, { strict: false });

const ballotEntrySchema = s.object({
  speakerScores: s.object(Object.fromEntries(sides.map((side) => [side, s.optional(s.array(speechSchema, { max: 8 }))])), {
    description: "Consensus ballots: speeches by side. Voting ballots: leave sides empty and send `sheets`.",
  }),
  ranks: s.optional(s.record(s.integer({ min: 1, max: 4 }), {
    maxKeys: 4,
    keyPattern: /^(OG|OO|CG|CO|AFF|NEG)$/,
    description: "Consensus ballots: rank by side (BP 1-4; two-team 1 = winner, 2 = loser). Voting ballots: omit.",
  })),
  sheets: s.optional(s.array(s.object({
    adjudicatorId: idSchema("Voting adjudicator id."),
    adjudicatorName: s.optional(s.string({ max: 120 })),
    speakerScores: s.object(Object.fromEntries(sides.map((side) => [side, s.optional(s.array(speechSchema, { max: 8 }))]))),
  }, { strict: false }), { max: 9 })),
  forfeitSide: s.optional(s.enum(sides)),
  motionId: s.optional(idSchema("Motion debated.")),
  vetoes: s.optional(s.record(idSchema("Motion id."), { maxKeys: 4, keyPattern: /^(OG|OO|CG|CO|AFF|NEG)$/ })),
}, { strict: false, description: "The ballot as the tab-room form records it; results are computed from it." });

const ballotParams = s.object({ slug: slugParam, roundSeq: roundSeqSchema, debateId: idSchema("Debate id."), ballotId: idSchema("Ballot id.") });

async function loadBallotContext(tabRoom: SessionTabRoom, context: WriteContext & { params: { roundSeq: string; debateId: string } }) {
  const round = await sessionRound(tabRoom, context.params.roundSeq);
  await tabRoom.loadAll("rounds", "debates", "ballots", "teams", "motions", "adjudicators", "venues");
  const debate = await sessionDebate(tabRoom, round, context.params.debateId);
  return { round, debate };
}

const ballotRoutes = [
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/rounds/{roundSeq}/pairings/{debateId}/ballots",
    operationId: "submitBallot",
    summary: "Submit a ballot",
    description:
      "Validated like the tab-room ballot form; points, wins, margins and voting majorities are " +
      "computed. `confirmed: true` also confirms it (with double entry on, the token counts as one " +
      "person: it cannot confirm its own entry without an override). Confirming withdraws a round's " +
      "released results, as in the tab room.",
    tag: "ballots",
    auth: { kind: "token", resource: "results", access: "write" },
    params: debateParams,
    body: s.object({
      entry: ballotEntrySchema,
      sides: s.optional(s.record(idSchema("Team id."), { maxKeys: 4, keyPattern: /^(AFF|NEG|OG|OO|CG|CO)$/, description: "Manual-ballot sides only." })),
      confirmed: s.optional(s.boolean()),
      checksVersion: s.optional(s.integer({ min: 1, description: "Blind double entry: the version this entry checks." })),
      override: overrideSchema,
    }),
    response: s.ref("Ballot"),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const { round, debate } = await loadBallotContext(tabRoom, context as never);
        const ballot = buildApiBallot({
          entry: context.body.entry as never,
          sides: context.body.sides as Partial<Record<DebateSide, string>> | undefined,
          confirmed: context.body.confirmed ?? false,
          checksVersion: context.body.checksVersion,
        }, {
          tournament: session.tournament,
          round,
          debate,
          teams: session.view<Team>("teams"),
          motions: session.view<Motion>("motions"),
          existingBallots: session.view<BallotSubmission>("ballots"),
          submitter: { id: apiActorId(context), name: apiActorName(context) },
          now: context.now,
          createId: (prefix) => tabRoom.createId(prefix),
        });
        await tabRoom.submitBallot(ballot, context.body.override);
        return () => serializeBallot(requireFound(session.latest<BallotSubmission>("ballots", ballot.id), "Ballot"));
      });
    },
  }),
  defineRoute({
    method: "PATCH",
    path: "/tournaments/{slug}/rounds/{roundSeq}/pairings/{debateId}/ballots/{ballotId}",
    operationId: "reviewBallot",
    summary: "Confirm or discard a ballot version",
    tag: "ballots",
    auth: { kind: "token", resource: "results", access: "write" },
    params: ballotParams,
    body: s.object({
      action: s.enum(["confirm", "discard"] as const),
      override: overrideSchema,
      expectedVersion: expectedVersionSchema,
    }),
    successStatus: 200,
    response: s.ref("Ballot"),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const { debate } = await loadBallotContext(tabRoom, context as never);
        const ballot = session.view<BallotSubmission>("ballots").find((item) => item.id === context.params.ballotId);
        if (!ballot || ballot.debateId !== debate.id) throw notFound("Ballot");
        ApiCommandSession.assertVersion(ballot as { syncVersion?: number }, context.body.expectedVersion);
        if (context.body.action === "confirm") await tabRoom.confirmBallot(ballot.id, debate.id, context.body.override);
        else await tabRoom.discardBallot(ballot.id, apiActorName(context), context.body.override);
        return () => serializeBallot(requireFound(session.latest<BallotSubmission>("ballots", ballot.id), "Ballot"));
      });
    },
  }),
];

/* ------------------------------------------------------------------------ */
/* Break categories and breaks                                               */
/* ------------------------------------------------------------------------ */

const breakDraftShape = {
  name: s.string({ min: 1, max: 80 }),
  breakSize: s.integer({ min: 0, max: 1024 }),
  reserveSize: s.optional(s.integer({ min: 0, max: 1024 })),
  priority: s.optional(s.integer({ min: -1000, max: 1000 })),
  isGeneral: s.optional(s.boolean()),
  maxPerInstitution: s.optional(s.integer({ min: 0, max: 1024, description: "0 = no limit." })),
  qualificationRule: s.optional(s.enum(["standard", "aida_1996", "aida_2016_australs", "aida_2016_easters"] as const)),
};

const breakCategoryParams = s.object({ slug: slugParam, categoryId: idSchema("Break category id.") });

async function saveBreakDraft(tabRoom: SessionTabRoom, input: Partial<BreakCategoryDraft>, editingId?: string): Promise<BreakCategory> {
  const categories = await tabRoom.session.all<BreakCategory>("breakCategories");
  const previous = editingId ? requireFound(categories.find((category) => category.id === editingId), "Break category") : undefined;
  const draft: BreakCategoryDraft = {
    name: input.name ?? previous?.name ?? "",
    breakSize: input.breakSize ?? previous?.breakSize ?? 0,
    reserveSize: input.reserveSize ?? previous?.reserveSize ?? 0,
    priority: input.priority ?? previous?.priority ?? 0,
    isGeneral: input.isGeneral ?? previous?.isGeneral ?? false,
    maxPerInstitution: input.maxPerInstitution ?? previous?.maxPerInstitution ?? 0,
    qualificationRule: input.qualificationRule ?? previous?.qualificationRule ?? "standard",
  };
  const tournament = tabRoom.session.tournament;
  const teamsInDebate = tournament.preferences?.teamsInDebate || (tournament.format === "bp" ? 4 : 2);
  const error = validateBreakCategoryDraft(draft, categories, teamsInDebate, editingId);
  if (error) throw new ApiError(422, "validation_failed", error);
  const createdId = tabRoom.createId("bc");
  const next = upsertBreakCategory(categories, draft, tournament.id, editingId, () => createdId);
  await tabRoom.saveBreakCategories(next);
  return requireFound(tabRoom.session.view<BreakCategory>("breakCategories").find((category) => category.id === (editingId ?? createdId)), "Break category");
}

const breakRoutes = [
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/break-categories",
    operationId: "createBreakCategory",
    summary: "Create a break category",
    tag: "break-categories",
    auth: { kind: "token", resource: "breaks", access: "write" },
    params: s.object({ slug: slugParam }),
    body: s.object(breakDraftShape),
    response: s.ref("BreakCategory"),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const saved = await saveBreakDraft(tabRoom, context.body);
        return () => serializeBreakCategory(requireFound(session.latest<BreakCategory>("breakCategories", saved.id), "Break category"));
      });
    },
  }),
  defineRoute({
    method: "PATCH",
    path: "/tournaments/{slug}/break-categories/{categoryId}",
    operationId: "updateBreakCategory",
    summary: "Update a break category",
    description: "`teamOverrides` sets manual break decisions (team id -> include / ineligible / withdrawn / ...; null removes one).",
    tag: "break-categories",
    auth: { kind: "token", resource: "breaks", access: "write" },
    params: breakCategoryParams,
    body: s.object({
      ...s.partial(breakDraftShape),
      teamOverrides: s.optional(s.record(
        s.nullable(s.enum(["include", "ineligible", "withdrawn", "different_break", "disqualified", "lost_coin_toss"] as const)),
        { maxKeys: 2000 }
      )),
      expectedVersion: expectedVersionSchema,
    }, { minProperties: 1 }),
    response: s.ref("BreakCategory"),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const categories = await session.all<BreakCategory>("breakCategories");
        const previous = requireFound(categories.find((category) => category.id === context.params.categoryId), "Break category");
        const { teamOverrides, expectedVersion, ...draft } = context.body;
        ApiCommandSession.assertVersion(previous as { syncVersion?: number }, expectedVersion);
        let saved = Object.keys(draft).length > 0 ? await saveBreakDraft(tabRoom, draft, previous.id) : previous;
        if (teamOverrides) {
          const teams = new Set((await session.byIds<Team>("teams", Object.keys(teamOverrides))).map((team) => team.id));
          const unknown = Object.keys(teamOverrides).find((id) => !teams.has(id));
          if (unknown) throw new ApiError(422, "validation_failed", `Team ${unknown} does not exist.`);
          const overrides = { ...(saved.teamOverrides ?? {}) };
          for (const [teamId, value] of Object.entries(teamOverrides)) {
            if (value === null) delete overrides[teamId];
            else overrides[teamId] = value;
          }
          saved = { ...saved, teamOverrides: overrides };
          await tabRoom.saveBreakCategories(session.view<BreakCategory>("breakCategories").map((category) => (category.id === saved.id ? saved : category)));
        }
        const savedId = saved.id;
        return () => serializeBreakCategory(requireFound(session.latest<BreakCategory>("breakCategories", savedId), "Break category"));
      });
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/tournaments/{slug}/break-categories/{categoryId}",
    operationId: "deleteBreakCategory",
    summary: "Delete a break category",
    description: "Refused once teams broke in it or a drawn elimination round uses it.",
    tag: "break-categories",
    auth: { kind: "token", resource: "breaks", access: "write" },
    params: breakCategoryParams,
    successStatus: 204,
    response: s.unknown(),
    async handler(context) {
      await runWrite(context, async (tabRoom, session) => {
        const categories = await session.all<BreakCategory>("breakCategories");
        requireFound(categories.find((category) => category.id === context.params.categoryId), "Break category");
        await tabRoom.saveBreakCategories(categories.filter((category) => category.id !== context.params.categoryId));
      });
      return { status: 204, body: null };
    },
  }),
  defineRoute({
    method: "PUT",
    path: "/tournaments/{slug}/break-categories/{categoryId}/eligibility",
    operationId: "replaceBreakEligibility",
    summary: "Set which teams are eligible for a break category",
    description: "The full list: listed teams become eligible, every other team ineligible.",
    tag: "break-categories",
    auth: { kind: "token", resource: "breaks", access: "write" },
    params: breakCategoryParams,
    body: s.object({ teamIds: s.array(idSchema("Team id."), { max: 5000, unique: true }) }),
    successStatus: 200,
    response: s.object({ categoryId: s.string(), teamIds: s.array(s.string()) }),
    async handler(context) {
      const categoryId = context.params.categoryId;
      return runWrite(context, async (tabRoom, session) => {
        requireFound(await session.one<BreakCategory>("breakCategories", categoryId), "Break category");
        const teams = await session.all<Team>("teams");
        const wanted = new Set(context.body.teamIds);
        const unknown = context.body.teamIds.find((id) => !teams.some((team) => team.id === id));
        if (unknown) throw new ApiError(422, "validation_failed", `Team ${unknown} does not exist.`);
        const updated = teams.flatMap((team) => {
          const eligible = (team.breakCategories ?? []).includes(categoryId);
          if (eligible === wanted.has(team.id)) return [];
          return [{
            ...team,
            breakCategories: eligible
              ? team.breakCategories.filter((id) => id !== categoryId)
              : [...(team.breakCategories ?? []), categoryId],
          }];
        });
        if (updated.length) await tabRoom.entities().saveEntityBatch({ teamsUpdated: updated }, "API break eligibility");
        return { categoryId, teamIds: [...wanted] };
      });
    },
  }),
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/break-categories/{categoryId}/break",
    operationId: "generateBreak",
    summary: "Generate a category's break",
    description:
      "Applies the category's qualification rule, institution cap and overrides to the current team " +
      "standings and schedules the elimination rounds. A tie at the cutoff is never broken " +
      "arbitrarily: it blocks generation until resolved with overrides (409 rule_violation).",
    tag: "break-categories",
    auth: { kind: "token", resource: "breaks", access: "write" },
    params: breakCategoryParams,
    body: s.object({ override: overrideSchema }),
    successStatus: 200,
    response: s.ref("BreakCategory"),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        requireFound(await session.one<BreakCategory>("breakCategories", context.params.categoryId), "Break category");
        await tabRoom.generateBreak(context.params.categoryId, context.body?.override);
        return () => serializeBreakCategory(requireFound(session.latest<BreakCategory>("breakCategories", context.params.categoryId), "Break category"));
      });
    },
  }),
];

/* ------------------------------------------------------------------------ */
/* Availability and check-ins                                                */
/* ------------------------------------------------------------------------ */

const availabilityMap = s.optional(s.record(s.boolean(), { maxKeys: 5000, keyPattern: /^[A-Za-z0-9_.:-]{1,128}$/ }));

async function setCheckIn(context: WriteContext, collection: "teams" | "adjudicators", id: string, checkedIn: boolean) {
  return runWrite(context, async (tabRoom) => {
    const record = requireFound(await tabRoom.session.one<Team | Adjudicator>(collection, id), collection === "teams" ? "Team" : "Adjudicator");
    const next = { ...record, checkedIn, checkedInAt: checkedIn ? context.now.toISOString() : undefined };
    if (collection === "teams") await tabRoom.entities().updateTeam(next as Team);
    else await tabRoom.entities().updateAdjudicator(next as Adjudicator);
    return personCheckinStatus(next, tabRoom.session.tournament.preferences?.checkInExpiresAfterHours, context.now);
  });
}

function checkinRoutesFor(path: string, collection: "teams" | "adjudicators", param: "teamId" | "adjudicatorId", tag: string) {
  const params = s.object({ slug: slugParam, [param]: idSchema(`${tag} id.`) });
  return [true, false].map((checkedIn) => defineRoute({
    method: checkedIn ? "PUT" : "DELETE",
    path,
    operationId: `${checkedIn ? "checkIn" : "checkOut"}${tag}`,
    summary: `${checkedIn ? "Check in" : "Check out"} a ${tag.toLowerCase()}`,
    tag: "checkins",
    auth: { kind: "token", resource: "checkins", access: "write" },
    params,
    successStatus: 200,
    response: s.ref("CheckinStatus"),
    async handler(context) {
      return setCheckIn(context, collection, (context.params as Record<string, string>)[param], checkedIn);
    },
  }));
}

const checkinRoutes = [
  defineRoute({
    method: "PUT",
    path: "/tournaments/{slug}/rounds/{roundSeq}/availabilities",
    operationId: "setAvailabilities",
    summary: "Set availability for a round",
    description: "Id -> available, for any teams, adjudicators and venues (venues: tournament-wide flag). Unlisted records are unchanged.",
    tag: "availabilities",
    auth: { kind: "token", resource: "checkins", access: "write" },
    params: roundParams,
    body: s.object({ teams: availabilityMap, adjudicators: availabilityMap, venues: availabilityMap }, { minProperties: 1 }),
    successStatus: 200,
    response: s.object({ updated: s.integer() }),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const round = await sessionRound(tabRoom, context.params.roundSeq);
        const at = context.now.toISOString();
        const people = async <T extends Team | Adjudicator>(collection: "teams" | "adjudicators", values: Record<string, boolean> | undefined) => {
          if (!values) return [] as T[];
          const records = await session.byIds<T>(collection, Object.keys(values));
          const missing = Object.keys(values).find((id) => !records.some((record) => record.id === id));
          if (missing) throw new ApiError(422, "validation_failed", `${collection === "teams" ? "Team" : "Adjudicator"} ${missing} does not exist.`);
          return records.map((record) => ({
            ...record,
            roundAvailability: { ...record.roundAvailability, [round.id]: values[record.id] },
            roundAvailabilityAt: { ...record.roundAvailabilityAt, [round.id]: at },
          }));
        };
        const teams = await people<Team>("teams", context.body.teams);
        const adjudicators = await people<Adjudicator>("adjudicators", context.body.adjudicators);
        await tabRoom.entities().saveEntityBatch({ teamsUpdated: teams, adjudicatorsUpdated: adjudicators }, `API availability for ${round.name}`);
        let venues = 0;
        if (context.body.venues) {
          const records = await session.byIds<Venue>("venues", Object.keys(context.body.venues));
          const missing = Object.keys(context.body.venues).find((id) => !records.some((record) => record.id === id));
          if (missing) throw new ApiError(422, "validation_failed", `Venue ${missing} does not exist.`);
          for (const venue of records) {
            if ((venue.available !== false) === context.body.venues[venue.id]) continue;
            await tabRoom.entities().updateVenue({ ...venue, available: context.body.venues[venue.id] });
            venues += 1;
          }
        }
        return { updated: teams.length + adjudicators.length + venues };
      });
    },
  }),
  ...checkinRoutesFor("/tournaments/{slug}/teams/{teamId}/checkin", "teams", "teamId", "Team"),
  ...checkinRoutesFor("/tournaments/{slug}/adjudicators/{adjudicatorId}/checkin", "adjudicators", "adjudicatorId", "Adjudicator"),
  ...[true, false].map((checkedIn) => defineRoute({
    method: checkedIn ? "PUT" : "DELETE",
    path: "/tournaments/{slug}/speakers/{speakerId}/checkin",
    operationId: checkedIn ? "checkInSpeaker" : "checkOutSpeaker",
    summary: checkedIn ? "Check in a speaker (their team)" : "Check out a speaker (their team)",
    description: "CrabbyTab checks teams in, so this checks in the speaker's team.",
    tag: "checkins",
    auth: { kind: "token", resource: "checkins", access: "write" },
    params: s.object({ slug: slugParam, speakerId: idSchema("Speaker id.") }),
    successStatus: 200,
    response: s.ref("CheckinStatus"),
    async handler(context) {
      const teams = await context.data.all("teams");
      const team = teams.find((record) => (record.speakers as Array<{ id: string }> | undefined)?.some((speaker) => speaker.id === context.params.speakerId));
      if (!team) throw notFound("Speaker");
      return { ...(await setCheckIn(context, "teams", team.id, checkedIn)), id: context.params.speakerId, teamId: team.id };
    },
  })),
  ...[true, false].map((checkedIn) => defineRoute({
    method: checkedIn ? "PUT" : "DELETE",
    path: "/tournaments/{slug}/venues/{venueId}/checkin",
    operationId: checkedIn ? "checkInVenue" : "checkOutVenue",
    summary: checkedIn ? "Check in a venue" : "Check out a venue",
    tag: "checkins",
    auth: { kind: "token", resource: "checkins", access: "write" },
    params: s.object({ slug: slugParam, venueId: idSchema("Venue id.") }),
    successStatus: 200,
    response: s.ref("CheckinStatus"),
    async handler(context) {
      return runWrite(context, async (tabRoom) => {
        const venue = requireFound(await tabRoom.session.one<Venue>("venues", context.params.venueId), "Venue");
        await tabRoom.entities().updateVenue({ ...venue, checkedIn });
        return { id: venue.id, checkedIn, checkedInAt: null, expiresAfterHours: null };
      });
    },
  })),
  defineRoute({
    method: "PUT",
    path: "/tournaments/{slug}/rounds/{roundSeq}/pairings/{debateId}/checkin",
    operationId: "checkInDebateBallot",
    summary: "Record a debate's paper ballot as received",
    description: "Voting ballots: send `adjudicatorId` for each adjudicator's sheet. Receiving the same sheet twice changes nothing.",
    tag: "checkins",
    auth: { kind: "token", resource: "checkins", access: "write" },
    params: debateParams,
    body: s.object({ adjudicatorId: s.optional(idSchema("Voting adjudicator whose sheet this is.")) }),
    successStatus: 200,
    response: s.object({ id: s.string(), checkedIn: s.boolean(), receiptId: s.string() }),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const round = await sessionRound(tabRoom, context.params.roundSeq);
        const debate = await sessionDebate(tabRoom, round, context.params.debateId);
        const blockers = checkBallotIntake(round, debate.id);
        if (blockers.length) throw new ApiError(409, "rule_violation", blockers.map((item) => item.message).join(" "), { violations: blockers });
        const adjudicatorId = context.body?.adjudicatorId;
        if (adjudicatorId) {
          const panel = [debate.adjudicators?.chairId, ...(debate.adjudicators?.panellistIds ?? [])];
          if (!panel.includes(adjudicatorId)) throw new ApiError(422, "validation_failed", "That adjudicator does not vote in this debate.");
        }
        // Same code and id as a scanned sheet, so a scan and an API receipt are one record.
        const sheetCode = ballotSheetCode(debate.id, adjudicatorId);
        const id = intakeRecordId(sheetCode);
        if (!(await session.one<BallotIntakeRecord>("ballotIntake", id))) {
          session.put<BallotIntakeRecord>("ballotIntake", [{
            id,
            tournamentId: session.tournament.id,
            roundId: round.id,
            debateId: debate.id,
            sheetCode,
            ...(adjudicatorId ? { adjudicatorId } : {}),
            receivedAt: context.now.toISOString(),
            receivedBy: apiActorId(context),
            receivedByName: apiActorName(context),
          }]);
          await session.recordAuditEvent({
            action: "ballot.received",
            category: "ballot",
            summary: `Paper ballot received for ${debate.venueName ?? debate.id}`,
            roundId: round.id,
            debateId: debate.id,
            details: { sheetCode, adjudicatorId },
          });
        }
        return { id: debate.id, checkedIn: true, receiptId: id };
      });
    },
  }),
];

/* ------------------------------------------------------------------------ */
/* Feedback                                                                  */
/* ------------------------------------------------------------------------ */

const answerSchema = s.unknown("string, number, boolean, string[] or null, by question type.");

const feedbackRoutes = [
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/feedback",
    operationId: "createFeedback",
    summary: "Record feedback on an adjudicator",
    description:
      "As tab-room feedback entry: the debate must be in the round, the target must have sat on it " +
      "and the source must have taken part. Answers are validated against the questions this kind " +
      "of source is asked.",
    tag: "feedback",
    auth: { kind: "token", resource: "feedback", access: "write" },
    params: s.object({ slug: slugParam }),
    body: s.object({
      debateId: idSchema("Debate id."),
      sourceType: s.enum(["team", "adjudicator"] as const),
      sourceId: idSchema("Team or adjudicator giving feedback."),
      targetAdjudicatorId: idSchema("Adjudicator the feedback is about."),
      score: s.number(),
      agreeWithDecision: s.optional(s.boolean()),
      comments: s.optional(s.string({ max: 5000 })),
      answers: s.optional(s.record(answerSchema, { maxKeys: 100 })),
      confirmed: s.optional(s.boolean("Default true (tab-room entry).")),
    }),
    response: s.ref("Feedback"),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const debate = requireFound(await session.one<Debate>("debates", context.body.debateId), "Debate");
        const preferences = session.tournament.preferences;
        const { feedbackMinScore = 1, feedbackMaxScore = 5 } = preferences;
        if (context.body.score < feedbackMinScore || context.body.score > feedbackMaxScore) {
          throw new ApiError(422, "validation_failed", `score must be between ${feedbackMinScore} and ${feedbackMaxScore}.`);
        }
        const linkError = adminFeedbackLinkError({ ...context.body, roundId: debate.roundId }, [debate]);
        if (linkError) throw new ApiError(422, "validation_failed", linkError);
        const [source] = await session.byIds<{ id: string; name: string }>(context.body.sourceType === "team" ? "teams" : "adjudicators", [context.body.sourceId]);
        const target = await session.one<Adjudicator>("adjudicators", context.body.targetAdjudicatorId);
        const id = await tabRoom.addFeedback({
          roundId: debate.roundId,
          debateId: debate.id,
          targetType: "adjudicator",
          targetAdjudicatorId: context.body.targetAdjudicatorId,
          targetAdjudicatorName: target?.name,
          sourceType: context.body.sourceType,
          sourceId: context.body.sourceId,
          sourceName: source?.name ?? context.body.sourceId,
          score: context.body.score,
          ...(context.body.agreeWithDecision !== undefined ? { agreeWithDecision: context.body.agreeWithDecision } : {}),
          ...(context.body.comments ? { comments: context.body.comments } : {}),
          ...(context.body.answers ? { answers: context.body.answers as FeedbackSubmission["answers"] } : {}),
          confirmed: context.body.confirmed ?? true,
        });
        return () => serializeFeedback(requireFound(session.latest<FeedbackSubmission>("feedback", id), "Feedback"));
      });
    },
  }),
  defineRoute({
    method: "PATCH",
    path: "/tournaments/{slug}/feedback/{feedbackId}",
    operationId: "reviewFeedback",
    summary: "Confirm, unconfirm, ignore or restore feedback",
    description: "Ignored feedback stays on record but does not count towards adjudicator scores.",
    tag: "feedback",
    auth: { kind: "token", resource: "feedback", access: "write" },
    params: s.object({ slug: slugParam, feedbackId: idSchema("Feedback id.") }),
    body: s.object({ confirmed: s.optional(s.boolean()), ignored: s.optional(s.boolean()) }, { minProperties: 1 }),
    response: s.ref("Feedback"),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        requireFound(await session.one<FeedbackSubmission>("feedback", context.params.feedbackId), "Feedback");
        await tabRoom.reviewFeedback(context.params.feedbackId, context.body);
        return () => serializeFeedback(requireFound(session.latest<FeedbackSubmission>("feedback", context.params.feedbackId), "Feedback"));
      });
    },
  }),
];

export const roundWriteRoutes = [
  ...roundRoutes,
  ...drawRoutes,
  ...ballotRoutes,
  ...breakRoutes,
  ...checkinRoutes,
  ...feedbackRoutes,
];

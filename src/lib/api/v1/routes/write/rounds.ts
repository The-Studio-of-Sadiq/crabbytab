import { adminFeedbackLinkError } from "@/features/tournament/application/feedback";
import { upsertBreakCategory, validateBreakCategoryDraft, type BreakCategoryDraft } from "@/features/tournament/application/breaks";
import { checkBallotIntake } from "@/features/tournament/application/stateGuards";
import { ballotSheetCode, intakeRecordId } from "@/features/tournament/application/ballotIntake";
import type {
  Adjudicator,
  BallotIntakeRecord,
  BPAssignmentMethod,
  BPPositionCost,
  BPPullupDistribution,
  ConflictAvoidance,
  OddBracketMethod,
  PairingMethod,
  PullupRestriction,
  Tournament,
  TournamentPreferences,
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
import { appendCheckInEvent, checkInEvent, setParticipantAvailability, setVenueCheckIn } from "@/lib/checkins/history";
import { isAvailableForRound } from "@/lib/roundAvailability";
import { isVenueAvailableForRound, isVenueCheckedIn, setVenueRoundAvailability } from "@/lib/venues/venues";
import { buildApiBallot } from "../../ballotInput";
import { ApiError, badRequest, conflict, notFound } from "../../errors";
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
import { personCheckinStatus, venueCheckinStatus } from "../roundData";
import { resolveDebateTeams, resolveDebateVenue } from "./pairings";
import { debateInRound, findSpeaker, idSchema, roundBySeq, roundSeqSchema } from "../shared";
import { apiActorId, apiActorName, expectedVersionSchema, overrideSchema, requireFound, runWrite, type WriteContext } from "./shared";

const roundParams = s.object({ slug: slugParam, roundSeq: roundSeqSchema });
const debateParams = s.object({ slug: slugParam, roundSeq: roundSeqSchema, debateId: idSchema("Debate (pairing) id.") });

export async function sessionRound(tabRoom: SessionTabRoom, seqText: string): Promise<Round> {
  const seq = Number(seqText);
  const rounds = await tabRoom.session.all<Round>("rounds");
  return requireFound(rounds.find((round) => round.seq === seq), "Round");
}

export async function sessionDebate(tabRoom: SessionTabRoom, round: Round, debateId: string): Promise<Debate> {
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
  drawStatus: s.optional(s.enum(
    ["none", "draft", "locked", "teams_released", "confirmed"] as const,
    "`locked` confirms the draw without releasing it; `teams_released` shows each team its pairing on its private URL " +
      "only; `confirmed` releases the draw to the public and adjudicators (the draw is checked first)."
  )),
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

export function listedPairings(tabRoom: SessionTabRoom, roundId: string) {
  return tabRoom.session.view<Debate>("debates")
    .filter((debate) => debate.roundId === roundId)
    .sort((left, right) => left.roomRank - right.roomRank || left.id.localeCompare(right.id))
    .map(serializeDebate);
}


/* Per-request draw options (Tabbycat's DrawGenerationSerializer.options), by CrabbyTab preference name. */
const pairingMethods = ["slide", "fold", "adjacent", "random", "fold_top_adjacent_rest"] as const satisfies readonly PairingMethod[];
const oddBracketMethods = [
  "pullup_top", "pullup_bottom", "pullup_middle", "pullup_random", "intermediate", "intermediate_bubble",
  "intermediate1", "intermediate2", "pullup_lowest_ds_rank", "pullup_lowest_ds_rank_npulls",
] as const satisfies readonly OddBracketMethod[];
const conflictAvoidances = ["off", "one_up_one_down", "min_cost", "min_cost_with_pullups"] as const satisfies readonly ConflictAvoidance[];
const pullupRestrictions = ["none", "least_pulled", "lowest_draw_strength_speaks", "lowest_draw_strength_wins"] as const satisfies readonly PullupRestriction[];
const penalty = (description: string) => s.optional(s.integer({ min: 0, max: 1_000_000, description }));

export const drawOptionsSchema = s.object({
  pairingMethod: s.optional(s.enum(pairingMethods)),
  oddBracketMethod: s.optional(s.enum(oddBracketMethods)),
  conflictAvoidance: s.optional(s.enum(conflictAvoidances, "Tabbycat's avoid_conflicts.")),
  pullupRestriction: s.optional(s.enum(pullupRestrictions)),
  sideAllocationRule: s.optional(s.enum(["balanced", "random"] as const, "Only between balanced and random, and only when the tournament uses one of them.")),
  avoidSameInstitution: s.optional(s.boolean()),
  avoidTeamHistory: s.optional(s.boolean()),
  teamHistoryPenalty: penalty("Tabbycat's history_penalty."),
  teamInstitutionPenalty: penalty("Tabbycat's institution_penalty."),
  sideBalancePenalty: penalty("Tabbycat's side_penalty."),
  pairingDeviationPenalty: penalty("Tabbycat's pairing_penalty."),
  previouslySawPullupPenalty: penalty("Tabbycat's pullup_debates_penalty."),
  pullupPenalty: penalty("Tabbycat's pullup_penalty."),
  maxTimesPerSide: s.optional(s.integer({ min: 0, max: 100 })),
  maxAllowedSideImbalance: s.optional(s.integer({ min: 0, max: 100 })),
  bpPullupDistribution: s.optional(s.enum(["anywhere", "top", "bottom"] as const satisfies readonly BPPullupDistribution[], "BP: Tabbycat's pullup.")),
  bpPositionCost: s.optional(s.enum(["simple", "renyi_entropy", "sum_squared_deviations"] as const satisfies readonly BPPositionCost[], "BP: Tabbycat's position_cost.")),
  bpAssignmentMethod: s.optional(s.enum(["hungarian", "hungarian_unshuffled", "random"] as const satisfies readonly BPAssignmentMethod[], "BP: Tabbycat's assignment_method.")),
  renyiOrder: s.optional(s.number({ min: 0, max: 100 })),
  bpPositionCostExponent: s.optional(s.number({ min: 0, max: 100, description: "BP: Tabbycat's exponent." })),
}, { description: "Draw preferences for this generation only; unset ones come from the tournament." });

/**
 * Side allocation decides how ballots record sides, so a per-draw override may only switch between
 * the two rules that produce ordinary sided debates.
 */
export function validateDrawOptions(
  tournament: Tournament,
  options: Partial<TournamentPreferences> | undefined
): Partial<TournamentPreferences> | undefined {
  if (!options) return undefined;
  const current = tournament.preferences?.sideAllocationRule || "balanced";
  if (options.sideAllocationRule && options.sideAllocationRule !== current && !["balanced", "random"].includes(current)) {
    throw new ApiError(422, "validation_failed", `This tournament allocates sides by "${current}"; it cannot be changed for one draw.`);
  }
  return options;
}

const drawRoutes = [
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/rounds/{roundSeq}/pairings/generate-draw",
    operationId: "generateDraw",
    summary: "Generate a round's draw",
    description:
      "Runs the tab room's draw generator and records the seed on the round. As in Tabbycat, a round " +
      "that already has a draw is refused with 409 conflict unless `replaceExistingDraw: true` is sent " +
      "(the tab room's regenerate). `drawType` sets the round's draw type before generating (it is " +
      "saved on the round). `options` override the tournament's draw preferences for this generation " +
      "only (not saved; recorded in the audit log). The draw is a draft until released (PATCH the " +
      "round's drawStatus). Replacing a draw with results also needs `discardExistingResults: true` " +
      "(the ballots are kept as discarded versions).",
    tag: "pairings",
    auth: { kind: "token", resource: "draws", access: "write" },
    params: roundParams,
    body: s.object({
      drawType: s.optional(s.enum(drawTypes, "Draw type for this round (saved on the round).")),
      options: s.optional(drawOptionsSchema),
      replaceExistingDraw: s.optional(s.boolean("Replace the round's existing draw (otherwise 409).")),
      discardExistingResults: s.optional(s.boolean()),
      override: overrideSchema,
    }),
    successStatus: 200,
    response: s.object({ round: s.ref("Round"), pairings: s.array(s.ref("Pairing")) }),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const round = await sessionRound(tabRoom, context.params.roundSeq);
        const body = context.body ?? {};
        const debates = await session.where<Debate>("debates", [{ field: "roundId", op: "==", value: round.id }]);
        if ((debates.length > 0 || round.drawStatus !== "none") && body.replaceExistingDraw !== true) {
          throw conflict(`${round.name} already has a draw. Send replaceExistingDraw: true to regenerate it.`);
        }
        const drawOptions = validateDrawOptions(session.tournament, body.options);
        await tabRoom.generateDraw(round.id, {
          discardExistingResults: body.discardExistingResults,
          override: body.override,
          drawType: body.drawType,
          drawOptions,
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
      teams: s.optional(s.record(idSchema("Team id."), {
        maxKeys: 4,
        keyPattern: /^(OG|OO|CG|CO|AFF|NEG)$/,
        description: "Side -> team id for every side: changes the matchup or swaps sides (refused while the debate has ballots).",
      })),
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
        const { override, expectedVersion, venueId, adjudicators, importance, teams } = context.body;
        ApiCommandSession.assertVersion(debate as { syncVersion?: number }, expectedVersion);
        const next: Debate = { ...debate };
        if (teams) {
          await tabRoom.loadAll("teams");
          next.teams = resolveDebateTeams(tabRoom, round, teams, debate.id);
        }
        if (venueId !== undefined) {
          // The same checks as the draw page: available in the round, free, suitable.
          const venue = venueId && venueId !== debate.venueId ? resolveDebateVenue(tabRoom, round, next, venueId) : undefined;
          if (venueId === null) {
            next.venueId = undefined;
            next.venueName = undefined;
          } else if (venue) {
            next.venueId = venue.id;
            next.venueName = venue.name;
          }
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
  selfSplit: s.optional(s.boolean("Voting ballots of a solo adjudicator: a 2:1 split decision (needs allowSelfSplitBallots).")),
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
  limit: s.optional(s.integer({ min: 0, max: 100000, description: "Public break category tab limit; 0 = no limit." })),
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
    limit: input.limit ?? previous?.limit ?? 0,
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
const idList = s.optional(s.array(idSchema("Id."), { max: 5000, unique: true }));
type AvailabilityKind = "teams" | "adjudicators" | "venues";
const KIND_LABEL: Record<AvailabilityKind, string> = { teams: "Team", adjudicators: "Adjudicator", venues: "Venue" };

/**
 * Sets round availability as the check-ins page does: teams and adjudicators through
 * setParticipantAvailability, rooms through their per-round entry, each with a check-in event.
 * `decide` gives the new value for a record (undefined leaves it unchanged).
 */
async function applyAvailability(
  context: WriteContext,
  tabRoom: SessionTabRoom,
  round: Round,
  ids: Partial<Record<AvailabilityKind, string[]>>,
  decide: (kind: AvailabilityKind, record: Team | Adjudicator | Venue) => boolean | undefined,
  label: string
): Promise<number> {
  const session = tabRoom.session;
  const at = context.now.toISOString();
  const by = apiActorName(context);
  const load = async <T extends { id: string }>(kind: AvailabilityKind): Promise<T[]> => {
    const wanted = ids[kind];
    if (!wanted) return [];
    const records = await session.byIds<T>(kind, wanted);
    const missing = wanted.find((id) => !records.some((record) => record.id === id));
    if (missing) throw new ApiError(422, "validation_failed", `${KIND_LABEL[kind]} ${missing} does not exist.`);
    return records;
  };
  const people = <T extends Team | Adjudicator>(kind: "teams" | "adjudicators", records: T[]) => records.flatMap((record) => {
    const available = decide(kind, record);
    // An explicit entry that already says so changes nothing; otherwise the value is recorded.
    if (available === undefined || record.roundAvailability?.[round.id] === available) return [];
    return [setParticipantAvailability(record, round, available, { source: "tab", by, at })];
  });
  const teams = people("teams", await load<Team>("teams"));
  const adjudicators = people("adjudicators", await load<Adjudicator>("adjudicators"));
  if (teams.length || adjudicators.length) {
    await tabRoom.entities().saveEntityBatch({ teamsUpdated: teams, adjudicatorsUpdated: adjudicators }, label);
  }
  let venues = 0;
  for (const venue of await load<Venue>("venues")) {
    const available = decide("venues", venue);
    if (available === undefined || isVenueAvailableForRound(venue, round.id) === available) continue;
    const next = appendCheckInEvent(setVenueRoundAvailability(venue, round.id, available), checkInEvent({ available, source: "tab", roundId: round.id, at, by }));
    await tabRoom.entities().updateVenue(next);
    venues += 1;
  }
  return teams.length + adjudicators.length + venues;
}

/** Every id of the given kinds (for "everyone of this kind"). */
async function allIds(tabRoom: SessionTabRoom, kinds: AvailabilityKind[]): Promise<Partial<Record<AvailabilityKind, string[]>>> {
  const entries = await Promise.all(kinds.map(async (kind) => [kind, (await tabRoom.session.all<{ id: string }>(kind)).map((record) => record.id)] as const));
  return Object.fromEntries(entries);
}

async function setCheckIn(context: WriteContext, collection: "teams" | "adjudicators", id: string, checkedIn: boolean | "toggle") {
  return runWrite(context, async (tabRoom) => {
    const record = requireFound(await tabRoom.session.one<Team | Adjudicator>(collection, id), collection === "teams" ? "Team" : "Adjudicator");
    const expiry = tabRoom.session.tournament.preferences?.checkInExpiresAfterHours;
    const value = checkedIn === "toggle" ? !personCheckinStatus(record, expiry, context.now).checkedIn : checkedIn;
    const at = context.now.toISOString();
    const next = appendCheckInEvent(
      { ...record, checkedIn: value, checkedInAt: value ? at : undefined },
      checkInEvent({ available: value, source: "tab", at, by: apiActorName(context) })
    );
    if (collection === "teams") await tabRoom.entities().updateTeam(next as Team);
    else await tabRoom.entities().updateAdjudicator(next as Adjudicator);
    return personCheckinStatus(next, expiry, context.now);
  });
}

async function setVenueCheckInState(context: WriteContext, venueId: string, checkedIn: boolean | "toggle") {
  return runWrite(context, async (tabRoom) => {
    const venue = requireFound(await tabRoom.session.one<Venue>("venues", venueId), "Venue");
    const expiry = tabRoom.session.tournament.preferences?.venueCheckInExpiresAfterHours;
    const value = checkedIn === "toggle" ? !isVenueCheckedIn(venue, expiry, context.now.getTime()) : checkedIn;
    const at = context.now.toISOString();
    // As the check-ins page: the event, plus the time that starts the check-in expiry.
    const next = { ...setVenueCheckIn(venue, value, { source: "tab", by: apiActorName(context), at }), checkedInAt: value ? at : venue.checkedInAt };
    await tabRoom.entities().updateVenue(next);
    return venueCheckinStatus(next, expiry, context.now);
  });
}

/**
 * Tabbycat's POST on a check-in creates the barcode identifier. CrabbyTab's check-in barcodes
 * encode the record id itself (Code 39 on the check-ins page), so the identifier always exists.
 */
function identifierRoute(path: string, operationId: string, what: string, collection: "teams" | "adjudicators" | "venues", param: string) {
  return defineRoute({
    method: "POST",
    path,
    operationId,
    summary: `Get ${what}'s check-in identifier`,
    description: "CrabbyTab's check-in barcodes encode the record id, so the identifier already exists; this returns it (200).",
    tag: "checkins",
    auth: { kind: "token", resource: "checkins", access: "write" },
    params: s.object({ slug: slugParam, [param]: idSchema(`${what} id.`) }),
    successStatus: 200,
    response: s.object({ id: s.string(), identifier: s.string(), barcode: s.string() }),
    async handler(context) {
      const id = (context.params as Record<string, string>)[param];
      if (collection === "teams" && param === "speakerId") {
        await findSpeaker(context, id);
      } else if (!(await context.data.get(collection, id))) {
        throw notFound(what);
      }
      return { id, identifier: id, barcode: "code39" };
    },
  });
}

function checkinRoutesFor(path: string, collection: "teams" | "adjudicators", param: "teamId" | "adjudicatorId", tag: string) {
  const params = s.object({ slug: slugParam, [param]: idSchema(`${tag} id.`) });
  const modes: Array<{ method: "PUT" | "DELETE" | "PATCH"; value: boolean | "toggle"; verb: string }> = [
    { method: "PUT", value: true, verb: "checkIn" },
    { method: "DELETE", value: false, verb: "checkOut" },
    { method: "PATCH", value: "toggle", verb: "toggleCheckIn" },
  ];
  return [
    ...modes.map(({ method, value, verb }) => defineRoute({
      method,
      path,
      operationId: `${verb}${tag}`,
      summary: value === "toggle" ? `Toggle a ${tag.toLowerCase()}'s check-in` : `${value ? "Check in" : "Check out"} a ${tag.toLowerCase()}`,
      tag: "checkins",
      auth: { kind: "token", resource: "checkins", access: "write" },
      params,
      successStatus: 200,
      response: s.ref("CheckinStatus"),
      async handler(context) {
        return setCheckIn(context, collection, (context.params as Record<string, string>)[param], value);
      },
    })),
    identifierRoute(path, `create${tag}CheckinIdentifier`, tag, collection, param),
  ];
}

const checkinRoutes = [
  defineRoute({
    method: "PUT",
    path: "/tournaments/{slug}/rounds/{roundSeq}/availabilities",
    operationId: "setAvailabilities",
    summary: "Set availability for a round",
    description:
      "Id -> available, for any teams, adjudicators and venues, in this round only (rooms too: their " +
      "per-round entry). Unlisted records are unchanged. Each change is a check-in event, as on the check-ins page.",
    tag: "availabilities",
    auth: { kind: "token", resource: "checkins", access: "write" },
    params: roundParams,
    body: s.object({ teams: availabilityMap, adjudicators: availabilityMap, venues: availabilityMap }, { minProperties: 1 }),
    successStatus: 200,
    response: s.object({ updated: s.integer() }),
    async handler(context) {
      return runWrite(context, async (tabRoom) => {
        const round = await sessionRound(tabRoom, context.params.roundSeq);
        const values = context.body;
        const updated = await applyAvailability(context, tabRoom, round, {
          teams: values.teams ? Object.keys(values.teams) : undefined,
          adjudicators: values.adjudicators ? Object.keys(values.adjudicators) : undefined,
          venues: values.venues ? Object.keys(values.venues) : undefined,
        }, (kind, record) => values[kind]?.[record.id], `API availability for ${round.name}`);
        return { updated };
      });
    },
  }),
  defineRoute({
    method: "PATCH",
    path: "/tournaments/{slug}/rounds/{roundSeq}/availabilities",
    operationId: "toggleAvailabilities",
    summary: "Toggle availability for a round",
    description: "Each listed team, adjudicator or venue switches between available and unavailable in this round.",
    tag: "availabilities",
    auth: { kind: "token", resource: "checkins", access: "write" },
    params: roundParams,
    body: s.object({ teams: idList, adjudicators: idList, venues: idList }, { minProperties: 1 }),
    successStatus: 200,
    response: s.object({ updated: s.integer() }),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const round = await sessionRound(tabRoom, context.params.roundSeq);
        const expiry = session.tournament.preferences?.checkInExpiresAfterHours;
        const updated = await applyAvailability(context, tabRoom, round, context.body, (kind, record) =>
          kind === "venues"
            ? !isVenueAvailableForRound(record as Venue, round.id)
            : !isAvailableForRound(record as Team, round, expiry, context.now.getTime()),
        `API availability toggled for ${round.name}`);
        return { updated };
      });
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/tournaments/{slug}/rounds/{roundSeq}/availabilities",
    operationId: "clearAvailabilities",
    summary: "Mark everyone of some kinds unavailable for a round",
    description:
      "Tabbycat's DELETE of a class of availabilities: every team (`?teams=true`), adjudicator " +
      "(`?adjudicators=true`) and/or venue (`?venues=true`) becomes unavailable in this round. At least one kind is required.",
    tag: "availabilities",
    auth: { kind: "token", resource: "checkins", access: "write" },
    params: roundParams,
    query: s.object({ teams: s.optional(s.boolean()), adjudicators: s.optional(s.boolean()), venues: s.optional(s.boolean()) }),
    successStatus: 200,
    response: s.object({ updated: s.integer() }),
    async handler(context) {
      const kinds = (["teams", "adjudicators", "venues"] as const).filter((kind) => context.query[kind] === true);
      if (kinds.length === 0) throw badRequest("Name at least one of teams, adjudicators or venues (e.g. ?teams=true).");
      return runWrite(context, async (tabRoom) => {
        const round = await sessionRound(tabRoom, context.params.roundSeq);
        const updated = await applyAvailability(context, tabRoom, round, await allIds(tabRoom, [...kinds]), () => false, `API availability cleared for ${round.name}`);
        return { updated };
      });
    },
  }),
  ...checkinRoutesFor("/tournaments/{slug}/teams/{teamId}/checkin", "teams", "teamId", "Team"),
  ...checkinRoutesFor("/tournaments/{slug}/adjudicators/{adjudicatorId}/checkin", "adjudicators", "adjudicatorId", "Adjudicator"),
  ...([
    { method: "PUT", value: true, id: "checkInSpeaker", summary: "Check in a speaker (their team)" },
    { method: "DELETE", value: false, id: "checkOutSpeaker", summary: "Check out a speaker (their team)" },
    { method: "PATCH", value: "toggle", id: "toggleCheckInSpeaker", summary: "Toggle a speaker's (team's) check-in" },
  ] as const).map(({ method, value, id, summary }) => defineRoute({
    method,
    path: "/tournaments/{slug}/speakers/{speakerId}/checkin",
    operationId: id,
    summary,
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
      return { ...(await setCheckIn(context, "teams", team.id, value)), id: context.params.speakerId, teamId: team.id };
    },
  })),
  identifierRoute("/tournaments/{slug}/speakers/{speakerId}/checkin", "createSpeakerCheckinIdentifier", "Speaker", "teams", "speakerId"),
  ...([
    { method: "PUT", value: true, id: "checkInVenue", summary: "Check in a venue" },
    { method: "DELETE", value: false, id: "checkOutVenue", summary: "Check out a venue" },
    { method: "PATCH", value: "toggle", id: "toggleCheckInVenue", summary: "Toggle a venue's check-in" },
  ] as const).map(({ method, value, id, summary }) => defineRoute({
    method,
    path: "/tournaments/{slug}/venues/{venueId}/checkin",
    operationId: id,
    summary,
    description: "As the check-ins page: the time is recorded (it starts the venue check-in expiry) with a check-in event.",
    tag: "checkins",
    auth: { kind: "token", resource: "checkins", access: "write" },
    params: s.object({ slug: slugParam, venueId: idSchema("Venue id.") }),
    successStatus: 200,
    response: s.ref("CheckinStatus"),
    async handler(context) {
      return setVenueCheckInState(context, context.params.venueId, value);
    },
  })),
  identifierRoute("/tournaments/{slug}/venues/{venueId}/checkin", "createVenueCheckinIdentifier", "Venue", "venues", "venueId"),
  ...([
    { method: "PUT", mode: "in", id: "checkInDebateBallot", summary: "Record a debate's paper ballot as received" },
    { method: "DELETE", mode: "out", id: "checkOutDebateBallot", summary: "Withdraw a debate's paper-ballot receipt" },
    { method: "PATCH", mode: "toggle", id: "toggleDebateBallotCheckin", summary: "Toggle a debate's paper-ballot receipt" },
  ] as const).map(({ method, mode, id: operationId, summary }) => defineRoute({
    method,
    path: "/tournaments/{slug}/rounds/{roundSeq}/pairings/{debateId}/checkin",
    operationId,
    summary,
    description:
      "Voting ballots: send `adjudicatorId` for each adjudicator's sheet. Receiving the same sheet " +
      "twice changes nothing. A withdrawn receipt is soft-deleted and audited.",
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
        const existing = await session.one<BallotIntakeRecord>("ballotIntake", id);
        const receive = mode === "in" || (mode === "toggle" && !existing);
        if (receive && !existing) {
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
        } else if (!receive && existing) {
          session.save("ballotIntake", session.view<BallotIntakeRecord>("ballotIntake").filter((record) => record.id !== id));
          await session.recordAuditEvent({
            action: "ballot.receipt_withdrawn",
            category: "ballot",
            summary: `Paper ballot receipt withdrawn for ${debate.venueName ?? debate.id}`,
            roundId: round.id,
            debateId: debate.id,
            details: { sheetCode, adjudicatorId },
          });
        }
        return { id: debate.id, checkedIn: receive, receiptId: id };
      });
    },
  })),
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/rounds/{roundSeq}/pairings/{debateId}/checkin",
    operationId: "createDebateCheckinIdentifier",
    summary: "Get a debate's ballot-sheet identifier",
    description: "The code printed on the debate's ballot sheet (per voting adjudicator with `adjudicatorId`), which scanning records as received.",
    tag: "checkins",
    auth: { kind: "token", resource: "checkins", access: "write" },
    params: debateParams,
    body: s.object({ adjudicatorId: s.optional(idSchema("Voting adjudicator whose sheet this is.")) }),
    successStatus: 200,
    response: s.object({ id: s.string(), identifier: s.string(), barcode: s.string() }),
    async handler(context) {
      const round = await roundBySeq(context, context.params.roundSeq);
      const debate = await debateInRound(context, round, context.params.debateId);
      return { id: debate.id, identifier: ballotSheetCode(debate.id, context.body?.adjudicatorId), barcode: "code39" };
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

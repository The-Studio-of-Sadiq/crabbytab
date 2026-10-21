import { randomUUID } from "node:crypto";
import { setParticipantAvailability } from "@/lib/checkins/history";
import { participantRoundMotions } from "@/lib/ballots/participantMotion";
import {
  checkParticipantFeedback,
  planParticipantBallotWrites,
  supersededFeedbackUpdate,
  supersededParticipantFeedbackIds,
} from "@/lib/participantSubmissions";
import { buildPrivateBallot, privateUrlBallotsEnabled } from "@/lib/privateBallot";
import { applyPrivateBallotConfirmation } from "@/lib/privateIndividualBallots";
import { filterParticipantVisibleDebates } from "@/lib/privatePortalBallots";
import { selectAssignedDebates } from "@/lib/privateSync";
import { currentCheckInRound, selfCheckInError, selfCheckInStatus } from "@/lib/selfCheckIn";
import type { Adjudicator, BallotSubmission, Debate, FeedbackSubmission, Motion, Round, Team } from "@/types";
import { ApiError, notFound } from "../../errors";
import { defineRoute, slugParam } from "../../router";
import { s } from "../../schema";
import { serializeBallot, serializeFeedback } from "../../serializers";
import type { ApiCommandSession } from "../../session";
import { idSchema } from "../shared";
import { runParticipantWrite, type WriteContext } from "./shared";

/**
 * Tabbycat lets participants submit ballots and feedback with their private URL key. Here a
 * participant authenticates exactly as for `/me` (`Authorization: Key <key>` + `X-Passcode`), and
 * the submission is checked with the private portal's own rules (lib/privateBallot.ts,
 * lib/participantSubmissions.ts): only their own visible debates, the tournament's ballot and
 * feedback switches, the same confirmation policy and the same superseding of earlier versions.
 */

const slugOnly = s.object({ slug: slugParam });

/** The participant's debate, if it is theirs and its draw has been released to them; else 404. */
async function participantDebate(context: WriteContext, session: ApiCommandSession, debateId: string): Promise<{ debate: Debate; round: Round | undefined; rounds: Map<string, Round> }> {
  const participant = context.participant!;
  const record = await session.one<Debate>("debates", debateId);
  const rounds = new Map((await session.all<Round>("rounds")).map((round) => [round.id, round]));
  const assigned = record ? selectAssignedDebates(new Map([[record.id, record]]), participant.type, participant.id) : new Map<string, Debate>();
  const visible = filterParticipantVisibleDebates(assigned.values(), rounds, participant.type);
  // Someone else's debate, or one whose draw is not released, looks the same as a missing one.
  if (!record || visible.length === 0) throw notFound("Debate");
  return { debate: record, round: rounds.get(record.roundId), rounds };
}

async function debateTeams(session: ApiCommandSession, debate: Debate): Promise<Map<string, Team>> {
  const ids = Object.values(debate.teams ?? {}).flatMap((slot) => (slot?.teamId ? [slot.teamId] : []));
  return new Map((await session.byIds<Team>("teams", ids)).map((team) => [team.id, team]));
}

const speechInput = s.object({
  speakerId: idSchema("Speaker id from the team's roster."),
  position: s.integer({ min: 1, max: 4 }),
  score: s.number({ min: 0, max: 1000 }),
  ghost: s.optional(s.boolean()),
  rank: s.optional(s.integer({ min: 1, max: 512 })),
  criteria: s.optional(s.record(s.number(), { maxKeys: 20 })),
});
/** Two-team, BP and poly (P1 … PN, N teams per room) side codes. */
const sideKeys = /^(OG|OO|CG|CO|AFF|NEG|P[1-9][0-9]*)$/;

export const participantWriteRoutes = [
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/me/ballots",
    operationId: "submitParticipantBallot",
    summary: "Submit a ballot as an adjudicator (private URL key)",
    description:
      "The private portal's ballot submission: a voting adjudicator's ballot for a debate of a " +
      "released draw, when the tournament takes ballots through private URLs. `speakerScores` lists " +
      "every speech by side in speaking order; `teamScores` gives each side's `rank` (and, when sides " +
      "are chosen on the ballot, its `teamId`). A chair's ballot is confirmed unless the tab room " +
      "confirms private ballots; panellists' and individual sheets wait for review. A round that is " +
      "completed or published keeps its result: the ballot is stored for the tab room. Ballot " +
      "receipts are not emailed for API submissions.",
    tag: "participants",
    auth: { kind: "participant" },
    params: slugOnly,
    body: s.object({
      debateId: idSchema("Debate id (from the participant's draw)."),
      speakerScores: s.record(s.array(speechInput, { max: 8 }), { maxKeys: 64, keyPattern: sideKeys }),
      teamScores: s.record(s.object({
        rank: s.optional(s.integer({ min: 1, max: 64, description: "Required except with N teams per debate on score-only or results-only ballots." })),
        win: s.optional(s.boolean("N teams per debate, results-only ballots: this side advances.")),
        teamId: s.optional(idSchema("Team on this side (sides chosen on the ballot).")),
      }), { maxKeys: 64, keyPattern: sideKeys }),
      selfSplit: s.optional(s.boolean("A solo adjudicator declares a split decision, where allowed.")),
      motionId: s.optional(idSchema("The motion debated; required when the round has several motions and motions are enabled.")),
      vetoes: s.optional(s.record(idSchema("Vetoed motion id."), { maxKeys: 64, keyPattern: sideKeys })),
    }),
    response: s.ref("Ballot"),
    async handler(context) {
      const participant = context.participant!;
      if (participant.type !== "adjudicator") throw new ApiError(403, "forbidden", "Teams cannot submit ballots.");
      return runParticipantWrite(context, async (session) => {
        const tournament = session.tournament;
        if (!privateUrlBallotsEnabled(tournament)) {
          throw new ApiError(403, "forbidden", "Ballot submission through private URLs is turned off for this tournament.");
        }
        const { debate, round, rounds } = await participantDebate(context, session, context.body.debateId);
        const adjudicator = await session.one<Adjudicator>("adjudicators", participant.id);
        if (!adjudicator) throw notFound("Adjudicator");
        // The round's motions, so a ballot in a round with several motions names the one debated
        // (validated like the private portal's; see participantMotion.ts).
        const motions = await session.where<Motion>("motions", [{ field: "rounds", op: "array-contains", value: debate.roundId }]);
        let ballot: BallotSubmission;
        try {
          ballot = buildPrivateBallot({
            ...context.body,
            id: `ballot-${debate.id}-adj-${participant.id}-${randomUUID().slice(0, 8)}`,
            submitterType: "judge",
            submitterId: participant.id,
          }, {
            tournament,
            adjudicator,
            debate,
            teams: await debateTeams(session, debate),
            tournamentId: tournament.id,
            round,
            rounds: [...rounds.values()],
            roundMotions: participantRoundMotions(motions, debate.roundId),
          });
        } catch (error) {
          throw new ApiError(422, "validation_failed", error instanceof Error ? error.message : "The ballot is invalid.");
        }
        ballot = applyPrivateBallotConfirmation(ballot, tournament, round);
        const existing = await session.where<BallotSubmission>("ballots", [{ field: "debateId", op: "==", value: debate.id }]);
        const plan = planParticipantBallotWrites({
          submissions: [ballot],
          existingByDebate: new Map([[debate.id, existing.map((record) => ({ id: record.id, data: record }))]]),
          debates: new Map([[debate.id, debate]]),
          roundById: rounds,
          tournament,
          timestamp: context.now.toISOString(),
        });
        const superseded = existing
          .filter((record) => plan.discardExistingIds.includes(record.id))
          .map((record) => ({ ...record, confirmed: false, discarded: true }));
        session.put("ballots", [...superseded, ...plan.writes]);
        await session.recordAuditEvent({
          action: "ballot.submitted",
          category: "ballot",
          summary: `Ballot submitted by ${participant.name} through the API`,
          roundId: debate.roundId,
          debateId: debate.id,
          details: { source: "private-url", ballotIds: plan.writes.map((item) => item.id), superseded: plan.discardExistingIds },
        });
        const own = plan.writes.find((item) => item.submitterId === participant.id && !item.discarded) ?? plan.writes[0];
        return () => serializeBallot(session.latest<BallotSubmission>("ballots", own.id) ?? own);
      });
    },
  }),
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/me/feedback",
    operationId: "submitParticipantFeedback",
    summary: "Submit feedback as a participant (private URL key)",
    description:
      "The private portal's feedback form: on an adjudicator (or, where the feedback paths allow, a " +
      "team) from a debate of a released draw the participant took part in, under the tournament's " +
      "feedback paths and questions.",
    tag: "participants",
    auth: { kind: "participant" },
    params: slugOnly,
    body: s.object({
      debateId: idSchema("Debate id."),
      targetType: s.optional(s.enum(["adjudicator", "team"] as const, "Default adjudicator.")),
      targetAdjudicatorId: s.optional(idSchema("Adjudicator the feedback is about.")),
      targetTeamId: s.optional(idSchema("Team the feedback is about.")),
      score: s.number(),
      agreeWithDecision: s.optional(s.boolean()),
      comments: s.optional(s.string({ max: 5000 })),
      answers: s.optional(s.record(s.unknown("string, number, boolean, string[] or null, by question type."), { maxKeys: 100 })),
    }),
    response: s.ref("Feedback"),
    async handler(context) {
      const participant = context.participant!;
      return runParticipantWrite(context, async (session) => {
        const { debate, round, rounds } = await participantDebate(context, session, context.body.debateId);
        const checked = checkParticipantFeedback({ ...context.body, sourceType: participant.type, sourceId: participant.id }, {
          tournament: session.tournament,
          tournamentId: session.tournament.id,
          participant,
          debate,
          round,
          teams: await debateTeams(session, debate),
          id: `fb-${randomUUID()}`,
          timestamp: context.now.toISOString(),
        });
        if (!checked.ok) {
          throw checked.status === 403
            ? new ApiError(403, "forbidden", checked.error)
            : new ApiError(422, "validation_failed", checked.error);
        }
        // As the private portal: the source's earlier confirmed feedback on the same target in this
        // debate is kept but unconfirmed, so it is not counted twice.
        const earlier = (await session.where<FeedbackSubmission>("feedback", [{ field: "debateId", op: "==", value: debate.id }]))
          .filter((item) => item.sourceType === participant.type && item.sourceId === participant.id);
        const superseded = new Set(supersededParticipantFeedbackIds([checked.feedback], earlier, session.tournament, rounds));
        session.put<FeedbackSubmission>("feedback", [
          ...earlier.filter((item) => superseded.has(item.id)).map((item) => ({ ...item, ...supersededFeedbackUpdate(item) })),
          checked.feedback,
        ]);
        await session.recordAuditEvent({
          action: "feedback.submitted",
          category: "feedback",
          summary: `Feedback submitted by ${participant.name} through the API`,
          roundId: debate.roundId,
          debateId: debate.id,
          details: { source: "private-url", feedbackId: checked.feedback.id },
        });
        const id = checked.feedback.id;
        return () => serializeFeedback(session.latest<FeedbackSubmission>("feedback", id) ?? checked.feedback);
      });
    },
  }),
  defineRoute({
    method: "PUT",
    path: "/tournaments/{slug}/me/checkin",
    operationId: "participantSelfCheckIn",
    summary: "Self check-in (private URL key)",
    description:
      "Marks the participant available (`available: true`) or not for the current round (the " +
      "earliest round neither cancelled nor completed), when the tournament allows self check-in.",
    tag: "participants",
    auth: { kind: "participant" },
    params: slugOnly,
    body: s.object({ available: s.boolean() }),
    successStatus: 200,
    response: s.object({ roundId: s.string(), roundName: s.string(), available: s.boolean() }),
    async handler(context) {
      const participant = context.participant!;
      return runParticipantWrite(context, async (session) => {
        const rounds = await session.all<Round>("rounds");
        const round = currentCheckInRound(rounds);
        const request = { roundId: round?.id ?? "", available: context.body.available };
        const refusal = selfCheckInError(session.tournament.preferences, rounds, request);
        if (refusal || !round) throw new ApiError(403, "forbidden", refusal ?? "There is no round to check in for.");
        const collection = participant.type === "team" ? "teams" : "adjudicators";
        const record = await session.one<Team | Adjudicator>(collection, participant.id);
        if (!record) throw notFound("Participant");
        const next = setParticipantAvailability(record, round, context.body.available, { source: "self", at: context.now.toISOString() });
        session.put(collection, [next]);
        await session.recordAuditEvent({
          action: "checkin.self",
          category: "tournament",
          summary: `${participant.name} checked ${context.body.available ? "in" : "out"} for ${round.name} through the API`,
          roundId: round.id,
        });
        const status = selfCheckInStatus(session.tournament.preferences, rounds, next, context.now.getTime());
        return status ?? { roundId: round.id, roundName: round.name, available: context.body.available };
      });
    },
  }),
];

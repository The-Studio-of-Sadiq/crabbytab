import { getPublicSiteSettings } from "@/lib/publicFeatures";
import { filterParticipantVisibleDebates, getPrivatePortalBallots } from "@/lib/privatePortalBallots";
import { selectAssignedDebates } from "@/lib/privateSync";
import type { Adjudicator, BallotSubmission, Debate, FeedbackSubmission, Round, Team } from "@/types";
import { notFound } from "../errors";
import { defineRoute, listOf, slugParam, type ParticipantIdentity } from "../router";
import { s } from "../schema";
import { asType, serializeBallot, serializeFeedback } from "../serializers";
import type { AnyContext } from "./shared";

function requireParticipant(context: AnyContext): ParticipantIdentity {
  if (!context.participant) throw notFound("Participant");
  return context.participant;
}

const participantAuthDescription =
  "Authenticate with the private URL key (`Authorization: Key <key>`) and passcode " +
  "(`X-Passcode: <passcode>`) from the participant's private URL slip: a team's key, one of its " +
  "speakers' own keys, or an adjudicator's key. Attempts are rate-limited per client address.";

export const meRoutes = [
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/me",
    operationId: "getMe",
    summary: "Identify the participant holding a private URL",
    description: participantAuthDescription + " A speaker's key identifies their team, with `speakerId` set.",
    tag: "participants",
    auth: { kind: "participant" },
    params: s.object({ slug: slugParam }),
    response: s.object({
      type: s.enum(["team", "adjudicator"] as const),
      id: s.string(),
      name: s.string(),
      speakerId: s.optional(s.string({ description: "The speaker whose own private URL key was used." })),
      institutionId: s.optional(s.string()),
      institutionName: s.optional(s.string()),
      speakers: s.optional(s.array(s.object({ id: s.string(), name: s.string() }))),
      trainee: s.optional(s.boolean()),
      checkedIn: s.boolean(),
    }),
    async handler(context) {
      const participant = requireParticipant(context);
      const collection = participant.type === "team" ? "teams" : "adjudicators";
      const record = await context.data.get(collection, participant.id);
      if (!record) throw notFound("Participant");
      if (participant.type === "team") {
        const team = asType<Team>(record);
        return {
          type: "team",
          id: team.id,
          name: team.name,
          ...(participant.speakerId ? { speakerId: participant.speakerId } : {}),
          ...(team.institutionId ? { institutionId: team.institutionId } : {}),
          ...(team.institutionName ? { institutionName: team.institutionName } : {}),
          speakers: (team.speakers ?? []).map((speaker) => ({ id: speaker.id, name: speaker.name })),
          checkedIn: team.checkedIn === true,
        };
      }
      const adjudicator = asType<Adjudicator>(record);
      return {
        type: "adjudicator",
        id: adjudicator.id,
        name: adjudicator.name,
        ...(adjudicator.institutionId ? { institutionId: adjudicator.institutionId } : {}),
        ...(adjudicator.institutionName ? { institutionName: adjudicator.institutionName } : {}),
        trainee: adjudicator.trainee === true,
        checkedIn: adjudicator.checkedIn === true,
      };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/me/ballots",
    operationId: "listParticipantBallots",
    summary: "The participant's ballots (private URL key)",
    description:
      participantAuthDescription + " Exactly what the private portal shows (lib/privatePortalBallots.ts): " +
      "an adjudicator sees the ballots of their debates in released draws; a team sees the confirmed " +
      "results of its debates once the round's results are released (scoresheets and speaker scores " +
      "once team speaks or private ballots are released).",
    tag: "participants",
    auth: { kind: "participant" },
    params: s.object({ slug: slugParam }),
    response: listOf(s.ref("Ballot")),
    async handler(context) {
      const participant = requireParticipant(context);
      const [debateRecords, roundRecords] = await Promise.all([context.data.all("debates"), context.data.all("rounds")]);
      const rounds = roundRecords.map((record) => asType<Round>(record));
      const roundsById = new Map(rounds.map((round) => [round.id, round]));
      const debates = new Map(debateRecords.map((record) => [record.id, asType<Debate>(record)]));
      const assigned = selectAssignedDebates(debates, participant.type, participant.id);
      const visible = filterParticipantVisibleDebates(assigned.values(), roundsById, participant.type);
      const ballots = (await Promise.all(visible.map((debate) =>
        context.data.all("ballots", [{ field: "debateId", op: "==", value: debate.id }])
      ))).flat().map((record) => asType<BallotSubmission>(record));
      const shown = getPrivatePortalBallots(
        ballots,
        rounds,
        participant.type,
        context.tournament.preferences?.publicResults !== false,
        getPublicSiteSettings(context.tournament.preferences).privateBallots
      );
      return {
        data: shown
          .map((ballot) => serializeBallot(ballot as unknown as BallotSubmission))
          .sort((left, right) =>
            String(left.debateId).localeCompare(String(right.debateId)) || Number(left.version) - Number(right.version)
          ),
      };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/me/feedback",
    operationId: "listParticipantFeedback",
    summary: "The feedback the participant submitted (private URL key)",
    description: participantAuthDescription + " Feedback the team or adjudicator gave, as the private portal lists it.",
    tag: "participants",
    auth: { kind: "participant" },
    params: s.object({ slug: slugParam }),
    response: listOf(s.ref("Feedback")),
    async handler(context) {
      const participant = requireParticipant(context);
      const feedback = (await context.data.all("feedback", [{ field: "sourceId", op: "==", value: participant.id }]))
        .map((record) => asType<FeedbackSubmission>(record))
        .filter((item) => item.sourceType === participant.type)
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id));
      return { data: feedback.map(serializeFeedback) };
    },
  }),
];

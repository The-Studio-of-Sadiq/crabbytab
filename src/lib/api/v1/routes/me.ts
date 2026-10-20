import type { Adjudicator, Team } from "@/types";
import { notFound } from "../errors";
import { defineRoute, slugParam } from "../router";
import { s } from "../schema";
import { asType } from "../serializers";

export const meRoutes = [
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/me",
    operationId: "getMe",
    summary: "Identify the participant holding a private URL",
    description:
      "Authenticate with the private URL key (`Authorization: Key <key>`) and passcode " +
      "(`X-Passcode: <passcode>`) from the participant's private URL slip. Attempts are " +
      "rate-limited per client address.",
    tag: "participants",
    auth: { kind: "participant" },
    params: s.object({ slug: slugParam }),
    response: s.object({
      type: s.enum(["team", "adjudicator"] as const),
      id: s.string(),
      name: s.string(),
      institutionId: s.optional(s.string()),
      institutionName: s.optional(s.string()),
      speakers: s.optional(s.array(s.object({ id: s.string(), name: s.string() }))),
      trainee: s.optional(s.boolean()),
      checkedIn: s.boolean(),
    }),
    async handler(context) {
      const participant = context.participant;
      if (!participant) throw notFound("Participant");
      const collection = participant.type === "team" ? "teams" : "adjudicators";
      const record = await context.data.get(collection, participant.id);
      if (!record) throw notFound("Participant");
      if (participant.type === "team") {
        const team = asType<Team>(record);
        return {
          type: "team",
          id: team.id,
          name: team.name,
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
];

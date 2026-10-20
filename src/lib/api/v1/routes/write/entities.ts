import type { Adjudicator, AdjudicatorConflict, BallotSubmission, Institution, Motion, Speaker, Team, Venue } from "@/types";
import { ApiError, conflict } from "../../errors";
import { defineRoute, slugParam } from "../../router";
import { s, type ObjectOf, type Schema } from "../../schema";
import { ApiCommandSession } from "../../session";
import {
  serializeAdjudicator,
  serializeInstitution,
  serializeMotion,
  serializeSpeaker,
  serializeTeam,
  serializeVenue,
} from "../../serializers";
import type { SessionTabRoom } from "../../tabRoom";
import { idSchema } from "../shared";
import { expectedVersionSchema, requireFound, runWrite } from "./shared";

/* ------------------------------------------------------------------------ */
/* Schemas                                                                   */
/* ------------------------------------------------------------------------ */

const text = (max: number, description?: string) => s.string({ min: 1, max, description });
const optionalText = (max: number, description?: string) => s.optional(s.string({ max, description }));
const ids = (description: string) => s.optional(s.array(idSchema("Id."), { max: 100, unique: true, description }));

const venueRequirementsSchema = s.optional(s.object({
  category: s.optional(s.string({ max: 80 })),
  minimumCapacity: s.optional(s.integer({ min: 0, max: 100_000 })),
  accessible: s.optional(s.boolean()),
  online: s.optional(s.boolean()),
  nearTabRoom: s.optional(s.boolean()),
}, { description: "Venue constraints for this participant." }));

const speakerShape = {
  id: s.optional(idSchema("Existing speaker id, to keep the speaker (and their results) when replacing the list.")),
  name: text(120),
  email: s.optional(s.string({ max: 254, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, format: "email", description: "Stored, never returned by the API." })),
  gender: optionalText(40),
  region: optionalText(80),
  categories: ids("Speaker category ids."),
};
const speakerSchema = s.object(speakerShape);

const teamShape = {
  name: text(120),
  codeName: optionalText(120),
  emoji: optionalText(16),
  seed: s.optional(s.number({ min: 0, max: 1_000_000 })),
  institutionId: s.optional(s.nullable(idSchema("Institution id; null for none."))),
  speakers: s.array(speakerSchema, { max: 12 }),
  breakCategories: ids("Break categories the team is eligible for."),
  speakerCategories: s.optional(s.array(s.string({ min: 1, max: 80 }), { max: 20, description: "Legacy team-wide speaker category labels." })),
  institutionConflictIds: ids("Institutions whose adjudicators must not judge this team."),
  venueRequirements: venueRequirementsSchema,
};

const conflictSchema = s.object({
  type: s.enum(["institution", "personal", "history"] as const),
  teamId: s.optional(idSchema("Team id.")),
  institutionId: s.optional(idSchema("Institution id.")),
  adjudicatorId: s.optional(idSchema("Adjudicator id.")),
});

const adjudicatorShape = {
  name: text(120),
  institutionId: s.optional(s.nullable(idSchema("Institution id; null for none."))),
  baseScore: s.number({ min: 0, max: 100 }),
  testScore: s.optional(s.nullable(s.number({ min: 0, max: 100 }))),
  trainee: s.optional(s.boolean()),
  independent: s.optional(s.boolean()),
  adjCore: s.optional(s.boolean()),
  breaking: s.optional(s.boolean()),
  email: s.optional(s.string({ max: 254, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, format: "email", description: "Stored, never returned by the API." })),
  gender: optionalText(40),
  region: optionalText(80),
  conflicts: s.optional(s.array(conflictSchema, { max: 500 })),
  venueRequirements: venueRequirementsSchema,
};

const institutionShape = { name: text(160), code: text(20), region: optionalText(80), venueRequirements: venueRequirementsSchema };

const venueShape = {
  name: text(120),
  priority: s.number({ min: -1_000_000, max: 1_000_000, description: "Higher is a better room." }),
  category: optionalText(80),
  capacity: s.optional(s.integer({ min: 0, max: 100_000 })),
  accessible: s.optional(s.boolean()),
  online: s.optional(s.boolean()),
  nearTabRoom: s.optional(s.boolean()),
  available: s.optional(s.boolean()),
};

const motionShape = {
  text: text(2000),
  reference: optionalText(200),
  infoSlide: optionalText(5000),
  rounds: s.array(idSchema("Round id."), { max: 50, unique: true, description: "Rounds the motion is used in." }),
  seq: s.optional(s.integer({ min: 0, max: 10_000 })),
  released: s.optional(s.boolean("Release the motion (public once public motions are enabled).")),
};

/** PATCH bodies: every field optional, at least one present, plus `expectedVersion`. */
function patchOf<S extends Record<string, Schema<unknown>>>(shape: S) {
  return s.object({ ...s.partial(shape), expectedVersion: expectedVersionSchema }, { minProperties: 1 });
}

/* ------------------------------------------------------------------------ */
/* Reference checks                                                          */
/* ------------------------------------------------------------------------ */

const normalized = (value: string) => value.trim().toLocaleLowerCase();

async function institutionFor(tabRoom: SessionTabRoom, institutionId: string | null | undefined): Promise<Institution | undefined> {
  if (!institutionId) return undefined;
  const institution = await tabRoom.session.one<Institution>("institutions", institutionId);
  if (!institution) throw new ApiError(422, "validation_failed", `Institution ${institutionId} does not exist.`);
  return institution;
}

async function requireExisting(tabRoom: SessionTabRoom, collection: "institutions" | "teams" | "adjudicators" | "breakCategories" | "rounds", values: string[] | undefined, noun: string) {
  if (!values?.length) return;
  const found = new Set((await tabRoom.session.byIds<{ id: string }>(collection, values)).map((record) => record.id));
  const missing = values.find((value) => !found.has(value));
  if (missing) throw new ApiError(422, "validation_failed", `${noun} ${missing} does not exist.`);
}

function requireSpeakerCategories(tabRoom: SessionTabRoom, speakers: Array<{ categories?: string[] }>) {
  const known = new Set((tabRoom.session.tournament.preferences?.speakerCategories ?? []).map((category) => category.id));
  const unknown = speakers.flatMap((speaker) => speaker.categories ?? []).find((id) => !known.has(id));
  if (unknown) throw new ApiError(422, "validation_failed", `Speaker category ${unknown} does not exist.`);
}

async function assertUniqueName<T extends { id: string; name: string }>(
  tabRoom: SessionTabRoom,
  collection: "teams" | "venues" | "institutions",
  name: string,
  exceptId?: string
) {
  const existing = await tabRoom.session.all<T>(collection);
  if (existing.some((record) => record.id !== exceptId && normalized(record.name) === normalized(name))) {
    throw conflict(`Another ${collection.slice(0, -1)} is already called “${name}”.`);
  }
}

function buildSpeakers(tabRoom: SessionTabRoom, input: ObjectOf<typeof speakerShape>[], previous: Speaker[] = []): Speaker[] {
  const previousById = new Map(previous.map((speaker) => [speaker.id, speaker]));
  const unknownId = input.find((speaker) => speaker.id && !previousById.has(speaker.id));
  if (unknownId) throw new ApiError(422, "validation_failed", `Speaker ${unknownId.id} is not on this team.`);
  return input.map((speaker) => {
    const { id, ...fields } = speaker;
    const base = id ? previousById.get(id)! : { id: tabRoom.createId("spk"), name: fields.name };
    return { ...base, ...fields, id: base.id };
  });
}

/** Removing a speaker who has spoken would orphan their scores: refuse, like deleting a team. */
async function assertSpeakersRemovable(tabRoom: SessionTabRoom, removedIds: string[]) {
  if (removedIds.length === 0) return;
  const ballots = await tabRoom.session.all<BallotSubmission>("ballots");
  const spoken = new Set(ballots.filter((ballot) => !ballot.discarded).flatMap((ballot) =>
    Object.values(ballot.speakerScores ?? {}).flat().map((entry) => entry?.speakerId)
  ));
  const used = removedIds.find((id) => spoken.has(id));
  if (used) throw conflict(`Speaker ${used} has recorded speeches and cannot be removed.`);
}

function validateConflicts(conflicts: AdjudicatorConflict[] | undefined, selfId?: string) {
  for (const item of conflicts ?? []) {
    const targets = [item.teamId, item.institutionId, item.adjudicatorId].filter(Boolean);
    if (targets.length !== 1) throw new ApiError(422, "validation_failed", "Each conflict names exactly one team, institution or adjudicator.");
    if (selfId && item.adjudicatorId === selfId) throw new ApiError(422, "validation_failed", "An adjudicator cannot conflict with themselves.");
  }
}

async function assertConflictTargets(tabRoom: SessionTabRoom, conflicts: AdjudicatorConflict[] | undefined) {
  await requireExisting(tabRoom, "teams", conflicts?.flatMap((item) => (item.teamId ? [item.teamId] : [])), "Team");
  await requireExisting(tabRoom, "institutions", conflicts?.flatMap((item) => (item.institutionId ? [item.institutionId] : [])), "Institution");
  await requireExisting(tabRoom, "adjudicators", conflicts?.flatMap((item) => (item.adjudicatorId ? [item.adjudicatorId] : [])), "Adjudicator");
}

/** Last newly added record of a collection (entity commands append created records). */
function lastCreated<T extends { id: string }>(session: ApiCommandSession, collection: "institutions" | "teams" | "adjudicators" | "venues" | "motions", before: Set<string>): T {
  const created = session.view<T>(collection).filter((record) => !before.has(record.id));
  return requireFound(created[created.length - 1], "Created record");
}

const withId = (name: string, description: string) => s.object({ slug: slugParam, [name]: idSchema(description) });
const slugOnly = s.object({ slug: slugParam });

/* ------------------------------------------------------------------------ */
/* Institutions                                                              */
/* ------------------------------------------------------------------------ */

const institutionRoutes = [
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/institutions",
    operationId: "createInstitution",
    summary: "Create an institution",
    description: "Names and codes are unique (case-insensitive).",
    tag: "institutions",
    auth: { kind: "token", resource: "participants", access: "write" },
    params: slugOnly,
    body: s.object(institutionShape),
    response: s.ref("Institution"),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const institutions = await session.all<Institution>("institutions");
        await assertUniqueName(tabRoom, "institutions", context.body.name);
        if (institutions.some((item) => normalized(item.code) === normalized(context.body.code))) {
          throw conflict(`Institution code ${context.body.code} is already used.`);
        }
        const [created] = await tabRoom.entities().addInstitutions([context.body]);
        return () => serializeInstitution(requireFound(session.latest<Institution>("institutions", created.id), "Institution"));
      });
    },
  }),
  defineRoute({
    method: "PATCH",
    path: "/tournaments/{slug}/institutions/{institutionId}",
    operationId: "updateInstitution",
    summary: "Update an institution",
    tag: "institutions",
    auth: { kind: "token", resource: "participants", access: "write" },
    params: withId("institutionId", "Institution id."),
    body: patchOf(institutionShape),
    response: s.ref("Institution"),
    async handler(context) {
      const id = (context.params as { institutionId: string }).institutionId;
      return runWrite(context, async (tabRoom, session) => {
        const institutions = await session.all<Institution>("institutions");
        const previous = requireFound(institutions.find((item) => item.id === id), "Institution");
        const { expectedVersion, ...changes } = context.body;
        ApiCommandSession.assertVersion(previous as { syncVersion?: number }, expectedVersion);
        if (changes.name) await assertUniqueName(tabRoom, "institutions", changes.name, id);
        if (changes.code && institutions.some((item) => item.id !== id && normalized(item.code) === normalized(changes.code!))) {
          throw conflict(`Institution code ${changes.code} is already used.`);
        }
        const next = { ...previous, ...changes } as Institution;
        await tabRoom.entities().updateInstitution(next);
        return () => serializeInstitution(requireFound(session.latest<Institution>("institutions", id), "Institution"));
      });
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/tournaments/{slug}/institutions/{institutionId}",
    operationId: "deleteInstitution",
    summary: "Delete an institution",
    description: "Refused (409 rule_violation) while teams or adjudicators belong to it.",
    tag: "institutions",
    auth: { kind: "token", resource: "participants", access: "write" },
    params: withId("institutionId", "Institution id."),
    successStatus: 204,
    response: s.unknown(),
    async handler(context) {
      const id = (context.params as { institutionId: string }).institutionId;
      await runWrite(context, async (tabRoom, session) => {
        await tabRoom.loadReferences();
        requireFound(await session.one("institutions", id), "Institution");
        await tabRoom.entities().deleteInstitution(id);
      });
      return { status: 204, body: null };
    },
  }),
];

/* ------------------------------------------------------------------------ */
/* Teams and speakers                                                        */
/* ------------------------------------------------------------------------ */

async function prepareTeam(tabRoom: SessionTabRoom, input: Partial<ObjectOf<typeof teamShape>>, previous?: Team): Promise<Team> {
  const institution = input.institutionId === undefined
    ? undefined
    : await institutionFor(tabRoom, input.institutionId);
  await requireExisting(tabRoom, "breakCategories", input.breakCategories, "Break category");
  await requireExisting(tabRoom, "institutions", input.institutionConflictIds, "Institution");
  if (input.speakers) requireSpeakerCategories(tabRoom, input.speakers);
  const { speakers, institutionId, ...fields } = input;
  const team = {
    ...(previous ?? { breakCategories: [], speakerCategories: [] }),
    ...fields,
    speakers: speakers ? buildSpeakers(tabRoom, speakers, previous?.speakers) : previous?.speakers ?? [],
  } as Team;
  if (institutionId !== undefined) {
    team.institutionId = institution?.id;
    team.institutionName = institution?.name;
  }
  return team;
}

const teamRoutes = [
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/teams",
    operationId: "createTeam",
    summary: "Create a team with its speakers",
    description: "Team names are unique (case-insensitive). Private URL keys and passcodes are generated.",
    tag: "teams",
    auth: { kind: "token", resource: "participants", access: "write" },
    params: slugOnly,
    body: s.object(teamShape),
    response: s.ref("Team"),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        await assertUniqueName(tabRoom, "teams", context.body.name);
        const { id: _id, tournamentId: _tournamentId, ...team } = await prepareTeam(tabRoom, context.body);
        const before = new Set(session.view<Team>("teams").map((item) => item.id));
        await tabRoom.entities().addTeams([team]);
        const created = lastCreated<Team>(session, "teams", before);
        return () => serializeTeam(requireFound(session.latest<Team>("teams", created.id), "Team"));
      });
    },
  }),
  defineRoute({
    method: "PATCH",
    path: "/tournaments/{slug}/teams/{teamId}",
    operationId: "updateTeam",
    summary: "Update a team",
    description: "`speakers` replaces the list; keep a speaker by sending their `id`. Speakers with recorded speeches cannot be removed.",
    tag: "teams",
    auth: { kind: "token", resource: "participants", access: "write" },
    params: withId("teamId", "Team id."),
    body: patchOf(teamShape),
    response: s.ref("Team"),
    async handler(context) {
      const id = (context.params as { teamId: string }).teamId;
      return runWrite(context, async (tabRoom, session) => {
        const previous = requireFound(await session.one<Team>("teams", id), "Team");
        const { expectedVersion, ...changes } = context.body;
        ApiCommandSession.assertVersion(previous as { syncVersion?: number }, expectedVersion);
        if (changes.name) await assertUniqueName(tabRoom, "teams", changes.name, id);
        const next = await prepareTeam(tabRoom, changes, previous);
        const kept = new Set(next.speakers.map((speaker) => speaker.id));
        await assertSpeakersRemovable(tabRoom, previous.speakers.filter((speaker) => !kept.has(speaker.id)).map((speaker) => speaker.id));
        await tabRoom.entities().updateTeam(next);
        return () => serializeTeam(requireFound(session.latest<Team>("teams", id), "Team"));
      });
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/tournaments/{slug}/teams/{teamId}",
    operationId: "deleteTeam",
    summary: "Delete a team",
    description: "Refused (409 rule_violation) once the team is in a debate, ballot or feedback; mark it unavailable instead.",
    tag: "teams",
    auth: { kind: "token", resource: "participants", access: "write" },
    params: withId("teamId", "Team id."),
    successStatus: 204,
    response: s.unknown(),
    async handler(context) {
      const id = (context.params as { teamId: string }).teamId;
      await runWrite(context, async (tabRoom, session) => {
        await tabRoom.loadReferences();
        requireFound(await session.one("teams", id), "Team");
        await tabRoom.entities().deleteTeam(id);
      });
      return { status: 204, body: null };
    },
  }),
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/speakers",
    operationId: "createSpeaker",
    summary: "Add a speaker to a team",
    tag: "speakers",
    auth: { kind: "token", resource: "participants", access: "write" },
    params: slugOnly,
    body: s.object({
      name: speakerShape.name,
      email: speakerShape.email,
      gender: speakerShape.gender,
      region: speakerShape.region,
      categories: speakerShape.categories,
      teamId: idSchema("Team the speaker joins."),
    }),
    response: s.ref("Speaker"),
    async handler(context) {
      const { teamId, ...speaker } = context.body;
      return runWrite(context, async (tabRoom, session) => {
        const team = requireFound(await session.one<Team>("teams", teamId), "Team");
        requireSpeakerCategories(tabRoom, [speaker]);
        const created: Speaker = { ...speaker, id: tabRoom.createId("spk") };
        const next = { ...team, speakers: [...team.speakers, created] };
        await tabRoom.entities().updateTeam(next);
        return () => {
          const saved = requireFound(session.latest<Team>("teams", teamId), "Team");
          return serializeSpeaker(requireFound(saved.speakers.find((item) => item.id === created.id), "Speaker"), saved);
        };
      });
    },
  }),
  defineRoute({
    method: "PATCH",
    path: "/tournaments/{slug}/speakers/{speakerId}",
    operationId: "updateSpeaker",
    summary: "Update a speaker",
    tag: "speakers",
    auth: { kind: "token", resource: "participants", access: "write" },
    params: withId("speakerId", "Speaker id."),
    body: s.object({
      name: s.optional(speakerShape.name),
      email: speakerShape.email,
      gender: speakerShape.gender,
      region: speakerShape.region,
      categories: speakerShape.categories,
      expectedVersion: expectedVersionSchema,
    }, { minProperties: 1, description: "`expectedVersion` is the team's syncVersion (speakers are stored in their team)." }),
    response: s.ref("Speaker"),
    async handler(context) {
      const speakerId = (context.params as { speakerId: string }).speakerId;
      return runWrite(context, async (tabRoom, session) => {
        const team = requireFound((await session.all<Team>("teams")).find((item) => item.speakers.some((speaker) => speaker.id === speakerId)), "Speaker");
        const { expectedVersion, ...changes } = context.body;
        ApiCommandSession.assertVersion(team as { syncVersion?: number }, expectedVersion);
        requireSpeakerCategories(tabRoom, [changes]);
        const next = { ...team, speakers: team.speakers.map((speaker) => (speaker.id === speakerId ? { ...speaker, ...changes } : speaker)) };
        await tabRoom.entities().updateTeam(next);
        return () => {
          const saved = requireFound(session.latest<Team>("teams", team.id), "Team");
          return serializeSpeaker(requireFound(saved.speakers.find((speaker) => speaker.id === speakerId), "Speaker"), saved);
        };
      });
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/tournaments/{slug}/speakers/{speakerId}",
    operationId: "deleteSpeaker",
    summary: "Remove a speaker from their team",
    description: "Refused once the speaker has recorded speeches.",
    tag: "speakers",
    auth: { kind: "token", resource: "participants", access: "write" },
    params: withId("speakerId", "Speaker id."),
    successStatus: 204,
    response: s.unknown(),
    async handler(context) {
      const speakerId = (context.params as { speakerId: string }).speakerId;
      await runWrite(context, async (tabRoom, session) => {
        const team = requireFound((await session.all<Team>("teams")).find((item) => item.speakers.some((speaker) => speaker.id === speakerId)), "Speaker");
        await assertSpeakersRemovable(tabRoom, [speakerId]);
        await tabRoom.entities().updateTeam({ ...team, speakers: team.speakers.filter((speaker) => speaker.id !== speakerId) });
      });
      return { status: 204, body: null };
    },
  }),
];

/* ------------------------------------------------------------------------ */
/* Adjudicators                                                              */
/* ------------------------------------------------------------------------ */

async function prepareAdjudicator(tabRoom: SessionTabRoom, input: Partial<ObjectOf<typeof adjudicatorShape>>, previous?: Adjudicator): Promise<Adjudicator> {
  const institution = input.institutionId === undefined ? undefined : await institutionFor(tabRoom, input.institutionId);
  validateConflicts(input.conflicts, previous?.id);
  await assertConflictTargets(tabRoom, input.conflicts);
  const { institutionId, testScore, ...fields } = input;
  const adjudicator = {
    ...(previous ?? { trainee: false, independent: false, conflicts: [] }),
    ...fields,
  } as Adjudicator;
  if (testScore !== undefined) adjudicator.testScore = testScore ?? undefined;
  if (institutionId !== undefined) {
    adjudicator.institutionId = institution?.id;
    adjudicator.institutionName = institution?.name;
  }
  return adjudicator;
}

const adjudicatorRoutes = [
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/adjudicators",
    operationId: "createAdjudicator",
    summary: "Create an adjudicator",
    tag: "adjudicators",
    auth: { kind: "token", resource: "participants", access: "write" },
    params: slugOnly,
    body: s.object(adjudicatorShape),
    response: s.ref("Adjudicator"),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const { id: _id, tournamentId: _tournamentId, ...adjudicator } = await prepareAdjudicator(tabRoom, context.body);
        const before = new Set(session.view<Adjudicator>("adjudicators").map((item) => item.id));
        await tabRoom.entities().addAdjudicators([adjudicator]);
        const created = lastCreated<Adjudicator>(session, "adjudicators", before);
        return () => serializeAdjudicator(requireFound(session.latest<Adjudicator>("adjudicators", created.id), "Adjudicator"));
      });
    },
  }),
  defineRoute({
    method: "PATCH",
    path: "/tournaments/{slug}/adjudicators/{adjudicatorId}",
    operationId: "updateAdjudicator",
    summary: "Update an adjudicator",
    description: "Base/test score changes are added to the adjudicator's score history with `scoreChangeReason`.",
    tag: "adjudicators",
    auth: { kind: "token", resource: "participants", access: "write" },
    params: withId("adjudicatorId", "Adjudicator id."),
    body: patchOf({ ...adjudicatorShape, scoreChangeReason: s.string({ max: 500 }) }),
    response: s.ref("Adjudicator"),
    async handler(context) {
      const id = (context.params as { adjudicatorId: string }).adjudicatorId;
      return runWrite(context, async (tabRoom, session) => {
        const previous = requireFound(await session.one<Adjudicator>("adjudicators", id), "Adjudicator");
        const { expectedVersion, scoreChangeReason, ...changes } = context.body;
        ApiCommandSession.assertVersion(previous as { syncVersion?: number }, expectedVersion);
        await session.all("adjudicators");
        const next = await prepareAdjudicator(tabRoom, changes, previous);
        await tabRoom.entities().updateAdjudicator(next, { scoreChangeReason });
        return () => serializeAdjudicator(requireFound(session.latest<Adjudicator>("adjudicators", id), "Adjudicator"));
      });
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/tournaments/{slug}/adjudicators/{adjudicatorId}",
    operationId: "deleteAdjudicator",
    summary: "Delete an adjudicator",
    description: "Refused (409 rule_violation) once they sat on a panel, signed a ballot or appear in feedback.",
    tag: "adjudicators",
    auth: { kind: "token", resource: "participants", access: "write" },
    params: withId("adjudicatorId", "Adjudicator id."),
    successStatus: 204,
    response: s.unknown(),
    async handler(context) {
      const id = (context.params as { adjudicatorId: string }).adjudicatorId;
      await runWrite(context, async (tabRoom, session) => {
        await tabRoom.loadReferences();
        requireFound(await session.one("adjudicators", id), "Adjudicator");
        await tabRoom.entities().deleteAdjudicator(id);
      });
      return { status: 204, body: null };
    },
  }),
];

/* ------------------------------------------------------------------------ */
/* Venues                                                                    */
/* ------------------------------------------------------------------------ */

const venueRoutes = [
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/venues",
    operationId: "createVenue",
    summary: "Create a venue",
    tag: "venues",
    auth: { kind: "token", resource: "venues", access: "write" },
    params: slugOnly,
    body: s.object(venueShape),
    response: s.ref("Venue"),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        await assertUniqueName(tabRoom, "venues", context.body.name);
        const before = new Set(session.view<Venue>("venues").map((item) => item.id));
        await tabRoom.entities().addVenues([{ ...context.body, available: context.body.available ?? true }]);
        const created = lastCreated<Venue>(session, "venues", before);
        return () => serializeVenue(requireFound(session.latest<Venue>("venues", created.id), "Venue"));
      });
    },
  }),
  defineRoute({
    method: "PATCH",
    path: "/tournaments/{slug}/venues/{venueId}",
    operationId: "updateVenue",
    summary: "Update a venue",
    tag: "venues",
    auth: { kind: "token", resource: "venues", access: "write" },
    params: withId("venueId", "Venue id."),
    body: patchOf(venueShape),
    response: s.ref("Venue"),
    async handler(context) {
      const id = (context.params as { venueId: string }).venueId;
      return runWrite(context, async (tabRoom, session) => {
        const previous = requireFound(await session.one<Venue>("venues", id), "Venue");
        const { expectedVersion, ...changes } = context.body;
        ApiCommandSession.assertVersion(previous as { syncVersion?: number }, expectedVersion);
        if (changes.name) await assertUniqueName(tabRoom, "venues", changes.name, id);
        const next = { ...previous, ...changes } as Venue;
        await tabRoom.entities().updateVenue(next);
        return () => serializeVenue(requireFound(session.latest<Venue>("venues", id), "Venue"));
      });
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/tournaments/{slug}/venues/{venueId}",
    operationId: "deleteVenue",
    summary: "Delete a venue",
    description: "Refused (409 rule_violation) once a debate uses it; mark it unavailable instead.",
    tag: "venues",
    auth: { kind: "token", resource: "venues", access: "write" },
    params: withId("venueId", "Venue id."),
    successStatus: 204,
    response: s.unknown(),
    async handler(context) {
      const id = (context.params as { venueId: string }).venueId;
      await runWrite(context, async (tabRoom, session) => {
        await tabRoom.loadAll("debates", "ballots");
        requireFound(await session.one("venues", id), "Venue");
        await tabRoom.entities().deleteVenue(id);
      });
      return { status: 204, body: null };
    },
  }),
];

/* ------------------------------------------------------------------------ */
/* Motions                                                                   */
/* ------------------------------------------------------------------------ */

const motionRoutes = [
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/motions",
    operationId: "createMotion",
    summary: "Create a motion",
    description: "Releasing a motion also marks its rounds' motions as released, as in the tab room.",
    tag: "motions",
    auth: { kind: "token", resource: "rounds", access: "write" },
    params: slugOnly,
    body: s.object(motionShape),
    response: s.ref("Motion"),
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        await requireExisting(tabRoom, "rounds", context.body.rounds, "Round");
        await session.all("motions");
        const before = new Set(session.view<Motion>("motions").map((item) => item.id));
        await tabRoom.entities().addMotions([{ ...context.body, released: context.body.released ?? false }]);
        const created = lastCreated<Motion>(session, "motions", before);
        await tabRoom.syncMotionRelease();
        return () => serializeMotion(requireFound(session.latest<Motion>("motions", created.id), "Motion"));
      });
    },
  }),
  defineRoute({
    method: "PATCH",
    path: "/tournaments/{slug}/motions/{motionId}",
    operationId: "updateMotion",
    summary: "Update or release a motion",
    tag: "motions",
    auth: { kind: "token", resource: "rounds", access: "write" },
    params: withId("motionId", "Motion id."),
    body: patchOf(motionShape),
    response: s.ref("Motion"),
    async handler(context) {
      const id = (context.params as { motionId: string }).motionId;
      return runWrite(context, async (tabRoom, session) => {
        await session.all("motions");
        const previous = requireFound(session.view<Motion>("motions").find((item) => item.id === id), "Motion");
        const { expectedVersion, ...changes } = context.body;
        ApiCommandSession.assertVersion(previous as { syncVersion?: number }, expectedVersion);
        await requireExisting(tabRoom, "rounds", changes.rounds, "Round");
        const next = { ...previous, ...changes } as Motion;
        await tabRoom.entities().updateMotion(next);
        await tabRoom.syncMotionRelease();
        return () => serializeMotion(requireFound(session.latest<Motion>("motions", id), "Motion"));
      });
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/tournaments/{slug}/motions/{motionId}",
    operationId: "deleteMotion",
    summary: "Delete a motion",
    description: "Refused once a ballot records the motion.",
    tag: "motions",
    auth: { kind: "token", resource: "rounds", access: "write" },
    params: withId("motionId", "Motion id."),
    successStatus: 204,
    response: s.unknown(),
    async handler(context) {
      const id = (context.params as { motionId: string }).motionId;
      await runWrite(context, async (tabRoom, session) => {
        await session.all("motions");
        requireFound(session.view<Motion>("motions").find((item) => item.id === id), "Motion");
        const ballots = await session.all<BallotSubmission>("ballots");
        if (ballots.some((ballot) => !ballot.discarded && (ballot.motionId === id || Object.values(ballot.vetoes ?? {}).includes(id)))) {
          throw conflict("A ballot records this motion, so it cannot be deleted.");
        }
        await tabRoom.entities().deleteMotion(id);
        await tabRoom.syncMotionRelease();
      });
      return { status: 204, body: null };
    },
  }),
];

export const entityWriteRoutes = [
  ...institutionRoutes,
  ...teamRoutes,
  ...adjudicatorRoutes,
  ...venueRoutes,
  ...motionRoutes,
];

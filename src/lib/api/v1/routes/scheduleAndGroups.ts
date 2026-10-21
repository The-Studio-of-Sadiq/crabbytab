import { randomUUID } from "node:crypto";
import { SCHEDULE_EVENT_TYPES, scheduleEventTitle, sortScheduleEvents, validateScheduleEvents } from "@/lib/schedule/events";
import { publicScheduleFromTournament } from "@/lib/schedule/publicSchedule";
import { normalizeCustomGroups, PERMISSION_GROUP_IDS, PERMISSION_GROUPS } from "@/lib/staffPermissions";
import type { Round, ScheduleEvent, ScheduleEventType } from "@/types";
import { ApiError, notFound } from "../errors";
import { defineRoute, listOf, slugParam } from "../router";
import { s } from "../schema";
import { asType } from "../serializers";
import type { SessionTabRoom } from "../tabRoom";
import { idSchema, type AnyContext } from "./shared";
import { runWrite } from "./write/shared";

/**
 * Tabbycat's schedule events and user groups. Schedule events are stored in the tournament's
 * preferences (`scheduleEvents`) and saved through saveTournament with the schedule page's
 * validation. User groups are read only: staff access is granted by a signed-in administrator,
 * never by an API token.
 */

const slugOnly = s.object({ slug: slugParam });
const eventParams = s.object({ slug: slugParam, eventId: idSchema("Schedule event id.") });
const eventTypes = SCHEDULE_EVENT_TYPES.map((item) => item.type) as [ScheduleEventType, ...ScheduleEventType[]];
const isoDateTime = (description: string) => s.string({ min: 10, max: 40, pattern: /^\d{4}-\d{2}-\d{2}T[0-9:.]+(Z|[+-]\d{2}:\d{2})$/, description });

const eventSchema = s.object({
  id: s.string(),
  type: s.string(),
  title: s.string({ description: "The custom title, else \"<round> — <type>\"." }),
  startTime: s.string(),
  endTime: s.optional(s.string()),
  roundId: s.optional(s.string()),
});

async function listEvents(context: AnyContext): Promise<Array<ScheduleEvent & { title: string }>> {
  if (context.data.view === "public") {
    // The published schedule (titles resolved at publish time), only when it is public.
    const schedule = publicScheduleFromTournament(context.tournament, context.tournament.slug);
    if (!schedule.enabled) throw new ApiError(403, "forbidden", "This tournament's schedule is not public.");
    return schedule.events.map((event) => ({ ...event, title: event.title ?? "" }));
  }
  const rounds = (await context.data.all("rounds")).map((record) => asType<Round>(record));
  return sortScheduleEvents(context.tournament.preferences?.scheduleEvents ?? [])
    .map((event) => ({ ...event, title: scheduleEventTitle(event, rounds) }));
}

/** Saves the schedule as the schedule page does: validated, then through saveTournament. */
async function saveEvents(tabRoom: SessionTabRoom, events: ScheduleEvent[]): Promise<void> {
  const rounds = await tabRoom.session.all<Round>("rounds");
  const problems = validateScheduleEvents(events, rounds);
  if (problems.length) {
    throw new ApiError(422, "validation_failed", "The schedule is not valid.", {
      issues: problems.map((problem) => ({ path: problem.eventId || "events", message: problem.message })),
    });
  }
  const tournament = tabRoom.session.tournament;
  await tabRoom.saveTournament({ ...tournament, preferences: { ...tournament.preferences, scheduleEvents: sortScheduleEvents(events) } });
}

const eventFields = {
  type: s.enum(eventTypes),
  title: s.optional(s.string({ max: 100 })),
  startTime: isoDateTime("Start, ISO date-time with a zone."),
  endTime: s.optional(s.nullable(isoDateTime("End, ISO date-time with a zone; null clears it."))),
  roundId: s.optional(s.nullable(idSchema("Round id; null clears it."))),
};

function toEvent(id: string, input: { type: ScheduleEventType; title?: string; startTime: string; endTime?: string | null; roundId?: string | null }): ScheduleEvent {
  return {
    id,
    type: input.type,
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    startTime: input.startTime,
    ...(input.endTime ? { endTime: input.endTime } : {}),
    ...(input.roundId ? { roundId: input.roundId } : {}),
  };
}

export const scheduleRoutes = [
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/schedule-events",
    operationId: "listScheduleEvents",
    summary: "List schedule events",
    description: "In start-time order. Public tokens see the schedule once it is public (`publicSchedule`).",
    tag: "schedule",
    auth: { kind: "token", resource: "tournament", access: "read", public: true },
    params: slugOnly,
    response: listOf(eventSchema),
    async handler(context) {
      return { data: await listEvents(context) };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/schedule-events/{eventId}",
    operationId: "getScheduleEvent",
    summary: "Get a schedule event",
    tag: "schedule",
    auth: { kind: "token", resource: "tournament", access: "read", public: true },
    params: eventParams,
    response: eventSchema,
    async handler(context) {
      const event = (await listEvents(context)).find((item) => item.id === context.params.eventId);
      if (!event) throw notFound("Schedule event");
      return event;
    },
  }),
  defineRoute({
    method: "POST",
    path: "/tournaments/{slug}/schedule-events",
    operationId: "createScheduleEvent",
    summary: "Add a schedule event",
    tag: "schedule",
    auth: { kind: "token", resource: "tournament", access: "write" },
    params: slugOnly,
    body: s.object(eventFields),
    response: eventSchema,
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const event = toEvent(`event-${randomUUID()}`, context.body);
        await saveEvents(tabRoom, [...(session.tournament.preferences.scheduleEvents ?? []), event]);
        return { ...event, title: scheduleEventTitle(event, session.view<Round>("rounds")) };
      });
    },
  }),
  defineRoute({
    method: "PATCH",
    path: "/tournaments/{slug}/schedule-events/{eventId}",
    operationId: "updateScheduleEvent",
    summary: "Change a schedule event",
    tag: "schedule",
    auth: { kind: "token", resource: "tournament", access: "write" },
    params: eventParams,
    body: s.object(s.partial(eventFields), { minProperties: 1 }),
    successStatus: 200,
    response: eventSchema,
    async handler(context) {
      return runWrite(context, async (tabRoom, session) => {
        const events = session.tournament.preferences.scheduleEvents ?? [];
        const previous = events.find((event) => event.id === context.params.eventId);
        if (!previous) throw notFound("Schedule event");
        const body = context.body;
        const next = toEvent(previous.id, {
          type: body.type ?? previous.type,
          title: body.title ?? previous.title,
          startTime: body.startTime ?? previous.startTime,
          endTime: body.endTime === undefined ? previous.endTime : body.endTime,
          roundId: body.roundId === undefined ? previous.roundId : body.roundId,
        });
        await saveEvents(tabRoom, events.map((event) => (event.id === previous.id ? next : event)));
        return { ...next, title: scheduleEventTitle(next, session.view<Round>("rounds")) };
      });
    },
  }),
  defineRoute({
    method: "DELETE",
    path: "/tournaments/{slug}/schedule-events/{eventId}",
    operationId: "deleteScheduleEvent",
    summary: "Delete a schedule event",
    tag: "schedule",
    auth: { kind: "token", resource: "tournament", access: "write" },
    params: eventParams,
    successStatus: 204,
    response: s.unknown(),
    async handler(context) {
      await runWrite(context, async (tabRoom, session) => {
        const events = session.tournament.preferences.scheduleEvents ?? [];
        if (!events.some((event) => event.id === context.params.eventId)) throw notFound("Schedule event");
        await saveEvents(tabRoom, events.filter((event) => event.id !== context.params.eventId));
      });
      return { status: 204, body: null };
    },
  }),
];

/* ------------------------------------------------------------------------ */
/* User groups (staff permission groups), read only                          */
/* ------------------------------------------------------------------------ */

const groupSchema = s.object({
  id: s.string(),
  name: s.string(),
  description: s.optional(s.string()),
  builtIn: s.boolean(),
  permissions: s.array(s.string()),
});

async function permissionGroups(context: AnyContext) {
  if (!context.store) throw new ApiError(403, "forbidden", "User groups need an administrator token.");
  const builtIn = PERMISSION_GROUP_IDS.map((id) => ({
    id,
    name: PERMISSION_GROUPS[id].label,
    description: PERMISSION_GROUPS[id].description,
    builtIn: true,
    permissions: [...PERMISSION_GROUPS[id].permissions],
  }));
  const custom = normalizeCustomGroups(await context.store.getCustomPermissionGroups())
    .map((group) => ({ id: group.id, name: group.name, builtIn: false, permissions: group.permissions }));
  return [...builtIn, ...custom];
}

export const userGroupRoutes = [
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/user-groups",
    operationId: "listUserGroups",
    summary: "List staff permission groups",
    description:
      "Tabbycat's user groups: the built-in groups and the tournament's custom groups, with their " +
      "permissions. Read only; staff members and their access are managed by signed-in administrators " +
      "on the Staff page (a token cannot grant anyone access).",
    tag: "staff",
    auth: { kind: "token", resource: "staff", access: "read" },
    params: slugOnly,
    response: listOf(groupSchema),
    async handler(context) {
      return { data: await permissionGroups(context) };
    },
  }),
  defineRoute({
    method: "GET",
    path: "/tournaments/{slug}/user-groups/{groupId}",
    operationId: "getUserGroup",
    summary: "Get a staff permission group",
    tag: "staff",
    auth: { kind: "token", resource: "staff", access: "read" },
    params: s.object({ slug: slugParam, groupId: idSchema("Group id.") }),
    response: groupSchema,
    async handler(context) {
      const group = (await permissionGroups(context)).find((item) => item.id === context.params.groupId);
      if (!group) throw notFound("User group");
      return group;
    },
  }),
];

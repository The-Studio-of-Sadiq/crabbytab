import type { Round, ScheduleEvent, ScheduleEventType } from "@/types";

/** Tabbycat's ScheduleEvent.Types, in its order, with their English labels. */
export const SCHEDULE_EVENT_TYPES: ReadonlyArray<{ type: ScheduleEventType; label: string }> = [
  { type: "check_in", label: "Check-in" },
  { type: "briefing", label: "Briefing" },
  { type: "draw", label: "Draw/motion announcement" },
  { type: "preparation", label: "Preparation time" },
  { type: "debate", label: "Debate" },
  { type: "adjudication", label: "Adjudication" },
  { type: "rest", label: "Meal/break" },
  { type: "break_announcement", label: "Break announcement" },
  { type: "awards", label: "Award ceremony" },
  { type: "other", label: "Other" },
];

const TYPE_LABELS = new Map(SCHEDULE_EVENT_TYPES.map((item) => [item.type, item.label]));

export function scheduleEventTypeLabel(type: ScheduleEventType): string {
  return TYPE_LABELS.get(type) ?? "Other";
}

export const MAX_SCHEDULE_EVENTS = 200;
export const MAX_SCHEDULE_TITLE_LENGTH = 100;

/** Tabbycat's display_title: the custom title, else "<round> — <type>". */
export function scheduleEventTitle(event: ScheduleEvent, rounds: Pick<Round, "id" | "name">[]): string {
  const title = event.title?.trim();
  if (title) return title;
  const round = event.roundId ? rounds.find((item) => item.id === event.roundId) : undefined;
  return [round?.name, scheduleEventTypeLabel(event.type)].filter(Boolean).join(" — ");
}

function time(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Events in start-time order (then end time, then id), as Tabbycat orders them. */
export function sortScheduleEvents<T extends ScheduleEvent>(events: readonly T[]): T[] {
  return [...events].sort((left, right) =>
    (time(left.startTime) ?? 0) - (time(right.startTime) ?? 0) ||
    (time(left.endTime) ?? Number.MAX_SAFE_INTEGER) - (time(right.endTime) ?? Number.MAX_SAFE_INTEGER) ||
    left.id.localeCompare(right.id)
  );
}

export interface ScheduleEventProblem {
  eventId: string;
  message: string;
}

/** Checks events before they are saved. Every event needs a valid start; an end must not precede it. */
export function validateScheduleEvents(
  events: readonly ScheduleEvent[],
  rounds: Pick<Round, "id">[]
): ScheduleEventProblem[] {
  const problems: ScheduleEventProblem[] = [];
  if (events.length > MAX_SCHEDULE_EVENTS) {
    problems.push({ eventId: "", message: `A schedule can hold at most ${MAX_SCHEDULE_EVENTS} events.` });
  }
  const roundIds = new Set(rounds.map((round) => round.id));
  const ids = new Set<string>();
  for (const event of events) {
    if (!event.id || ids.has(event.id)) problems.push({ eventId: event.id, message: "Every event needs its own id." });
    ids.add(event.id);
    if (!TYPE_LABELS.has(event.type)) problems.push({ eventId: event.id, message: "Choose an event type." });
    const start = time(event.startTime);
    if (start === undefined) problems.push({ eventId: event.id, message: "Give the event a valid start time." });
    if (event.endTime) {
      const end = time(event.endTime);
      if (end === undefined) problems.push({ eventId: event.id, message: "The end time is not a valid time." });
      else if (start !== undefined && end < start) problems.push({ eventId: event.id, message: "The event ends before it starts." });
    }
    if ((event.title?.length ?? 0) > MAX_SCHEDULE_TITLE_LENGTH) {
      problems.push({ eventId: event.id, message: `Titles are at most ${MAX_SCHEDULE_TITLE_LENGTH} characters.` });
    }
    if (event.roundId && !roundIds.has(event.roundId)) {
      problems.push({ eventId: event.id, message: "The event's round no longer exists." });
    }
  }
  return problems;
}

/**
 * The schedule as published: sorted, with titles resolved (round names are not secret, but the
 * public projection only carries rounds whose draw is out) and nothing but the event fields.
 */
export function publicScheduleEvents(
  events: readonly ScheduleEvent[] | undefined,
  rounds: Pick<Round, "id" | "name">[]
): ScheduleEvent[] {
  return sortScheduleEvents((events || []).filter((event) => time(event.startTime) !== undefined)).map((event) => ({
    id: event.id,
    type: TYPE_LABELS.has(event.type) ? event.type : "other",
    title: scheduleEventTitle(event, rounds),
    startTime: event.startTime,
    ...(time(event.endTime) !== undefined ? { endTime: event.endTime } : {}),
    ...(event.roundId ? { roundId: event.roundId } : {}),
  }));
}

/** The calendar date (YYYY-MM-DD) of an instant in a time zone; the viewer's zone when absent. */
export function dayKey(value: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Events grouped by calendar day, days in order (Tabbycat's public schedule tables). */
export function groupScheduleByDay<T extends ScheduleEvent>(
  events: readonly T[],
  timeZone?: string
): Array<{ day: string; events: T[] }> {
  const days = new Map<string, T[]>();
  for (const event of sortScheduleEvents(events)) {
    if (time(event.startTime) === undefined) continue;
    const key = dayKey(event.startTime, timeZone);
    days.set(key, [...(days.get(key) || []), event]);
  }
  return [...days.entries()].map(([day, items]) => ({ day, events: items }));
}

/** The event happening at `now`, else the next one to start. */
export function nextScheduleEvent<T extends ScheduleEvent>(events: readonly T[], now: Date): T | undefined {
  const at = now.getTime();
  const sorted = sortScheduleEvents(events);
  return (
    sorted.find((event) => {
      const start = time(event.startTime);
      const end = time(event.endTime);
      return start !== undefined && end !== undefined && start <= at && at < end;
    }) ?? sorted.find((event) => (time(event.startTime) ?? -Infinity) >= at)
  );
}

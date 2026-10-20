import type { ScheduleEvent, Tournament } from "@/types";
import { buildICalendar } from "@/lib/schedule/ical";
import { publicScheduleEvents } from "@/lib/schedule/events";

export interface PublicSchedule {
  tournamentName: string;
  slug: string;
  /** False when the tab room has not released the schedule. */
  enabled: boolean;
  events: ScheduleEvent[];
}

/**
 * The public schedule from the published tournament section (see projection.ts, which keeps
 * `scheduleEvents` only when `publicSchedule` is on and resolves their titles). Pure, so both
 * routes and tests share it.
 */
export function publicScheduleFromTournament(section: unknown, slug: string): PublicSchedule {
  const tournament = (section && typeof section === "object" ? section : {}) as Partial<Tournament>;
  const preferences = (tournament.preferences || {}) as Partial<Tournament["preferences"]>;
  const enabled = preferences.publicSchedule === true;
  return {
    tournamentName: typeof tournament.name === "string" ? tournament.name : slug,
    slug,
    enabled,
    // Titles were resolved at publish time; resolving again only normalises the records.
    events: enabled ? publicScheduleEvents(Array.isArray(preferences.scheduleEvents) ? preferences.scheduleEvents : [], []) : [],
  };
}

export function publicScheduleICalendar(schedule: PublicSchedule, origin: string, stamp?: Date): string {
  const host = new URL(origin).host;
  const url = `${origin}/${encodeURIComponent(schedule.slug)}/schedule/public`;
  return buildICalendar({
    name: `${schedule.tournamentName} Schedule`,
    stamp,
    events: schedule.events.map((event) => ({
      uid: `schedule-event-${event.id}-${schedule.slug}@${host}`,
      start: new Date(event.startTime),
      end: event.endTime ? new Date(event.endTime) : undefined,
      summary: event.title || "",
      url,
    })),
  });
}

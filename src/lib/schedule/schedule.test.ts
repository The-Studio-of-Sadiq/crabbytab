import { describe, expect, it } from "vitest";
import type { ScheduleEvent } from "@/types";
import {
  groupScheduleByDay,
  nextScheduleEvent,
  publicScheduleEvents,
  scheduleEventTitle,
  sortScheduleEvents,
  validateScheduleEvents,
} from "./events";
import { buildICalendar, escapeICalText, foldICalLine, formatICalDate } from "./ical";
import { publicScheduleFromTournament, publicScheduleICalendar } from "./publicSchedule";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "./time";

const event = (id: string, startTime: string, extra: Partial<ScheduleEvent> = {}): ScheduleEvent => ({ id, type: "debate", startTime, ...extra });
const rounds = [{ id: "r1", name: "Round 1" }];

describe("schedule events", () => {
  it("titles events as Tabbycat does", () => {
    expect(scheduleEventTitle(event("e", "2026-10-21T09:00:00Z", { roundId: "r1" }), rounds)).toBe("Round 1 — Debate");
    expect(scheduleEventTitle(event("e", "2026-10-21T09:00:00Z", { type: "awards" }), rounds)).toBe("Award ceremony");
    expect(scheduleEventTitle(event("e", "2026-10-21T09:00:00Z", { title: " Lunch " }), rounds)).toBe("Lunch");
  });

  it("sorts by start time and validates before saving", () => {
    const events = [event("b", "2026-10-21T10:00:00Z"), event("a", "2026-10-21T09:00:00Z")];
    expect(sortScheduleEvents(events).map((item) => item.id)).toEqual(["a", "b"]);
    const problems = validateScheduleEvents([
      event("ok", "2026-10-21T09:00:00Z", { endTime: "2026-10-21T10:00:00Z" }),
      event("backwards", "2026-10-21T09:00:00Z", { endTime: "2026-10-21T08:00:00Z" }),
      event("ok", "bad"),
      event("gone", "2026-10-21T09:00:00Z", { roundId: "deleted" }),
    ], rounds);
    expect(problems.map((problem) => problem.eventId)).toEqual(["backwards", "ok", "ok", "gone"]);
  });

  it("publishes sorted events with resolved titles and no invalid times", () => {
    const published = publicScheduleEvents([
      event("late", "2026-10-21T12:00:00Z", { roundId: "r1" }),
      event("bad", "nope"),
      event("early", "2026-10-21T08:00:00Z", { type: "check_in", endTime: "invalid" }),
    ], rounds);
    expect(published).toEqual([
      { id: "early", type: "check_in", title: "Check-in", startTime: "2026-10-21T08:00:00Z" },
      { id: "late", type: "debate", title: "Round 1 — Debate", startTime: "2026-10-21T12:00:00Z", roundId: "r1" },
    ]);
  });

  it("groups by day in a time zone and finds the current or next event", () => {
    const events = [event("a", "2026-10-21T23:30:00Z"), event("b", "2026-10-22T01:00:00Z", { endTime: "2026-10-22T02:00:00Z" })];
    expect(groupScheduleByDay(events, "UTC").map((day) => day.day)).toEqual(["2026-10-21", "2026-10-22"]);
    expect(groupScheduleByDay(events, "Asia/Dhaka").map((day) => [day.day, day.events.length])).toEqual([["2026-10-22", 2]]);
    expect(nextScheduleEvent(events, new Date("2026-10-22T01:30:00Z"))?.id).toBe("b");
    expect(nextScheduleEvent(events, new Date("2026-10-21T20:00:00Z"))?.id).toBe("a");
    expect(nextScheduleEvent(events, new Date("2026-10-23T00:00:00Z"))).toBeUndefined();
  });
});

describe("iCalendar", () => {
  it("escapes text, folds long lines and writes UTC times", () => {
    expect(escapeICalText("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
    const line = `SUMMARY:${"é".repeat(60)}`;
    const folded = foldICalLine(line);
    for (const part of folded.split("\r\n")) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(line);
    expect(formatICalDate(new Date("2026-10-21T09:05:00.000Z"))).toBe("20261021T090500Z");
  });

  it("builds a calendar with one VEVENT per valid event", () => {
    const text = buildICalendar({
      name: "Cup, 2026",
      stamp: new Date("2026-10-01T00:00:00Z"),
      events: [
        { uid: "e1@x", start: new Date("2026-10-21T09:00:00Z"), end: new Date("2026-10-21T10:00:00Z"), summary: "Round 1 — Debate", url: "https://x/s" },
        { uid: "bad", start: new Date("nope"), summary: "Bad" },
        { uid: "e2@x", start: new Date("2026-10-21T11:00:00Z"), end: new Date("2026-10-21T10:00:00Z"), summary: "No end" },
      ],
    });
    expect(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(text).toContain("X-WR-CALNAME:Cup\\, 2026");
    expect(text).toContain("DTSTART:20261021T090000Z\r\nDTEND:20261021T100000Z");
    expect(text).toContain("DTSTART:20261021T110000Z\r\nSUMMARY:No end");
  });

  it("serves the schedule only when the published tournament releases it", () => {
    const scheduleEvents = [event("e1", "2026-10-21T09:00:00Z", { title: "Round 1 — Debate" })];
    const schedule = publicScheduleFromTournament({ name: "Cup", preferences: { publicSchedule: true, scheduleEvents } }, "cup");
    expect(schedule).toMatchObject({ enabled: true, tournamentName: "Cup", events: [{ id: "e1", title: "Round 1 — Debate" }] });
    expect(publicScheduleFromTournament({ name: "Cup", preferences: { scheduleEvents } }, "cup")).toMatchObject({ enabled: false, events: [] });
    const ics = publicScheduleICalendar(schedule, "https://crabbytab.example", new Date("2026-10-01T00:00:00Z"));
    expect(ics).toContain("UID:schedule-event-e1-cup@crabbytab.example");
    expect(ics).toContain("URL:https://crabbytab.example/cup/schedule/public");
  });
});

describe("datetime-local conversion", () => {
  it("round-trips through the viewer's local time", () => {
    const iso = fromDateTimeLocalValue("2026-10-21T14:30");
    expect(iso).toBeDefined();
    expect(toDateTimeLocalValue(iso)).toBe("2026-10-21T14:30");
    expect(fromDateTimeLocalValue("")).toBeUndefined();
    expect(fromDateTimeLocalValue("21/10/2026")).toBeUndefined();
    expect(toDateTimeLocalValue("nonsense")).toBe("");
  });
});

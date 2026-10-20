/**
 * A minimal iCalendar (RFC 5545) writer for the public schedule feed, like Tabbycat's
 * utils/ical.py. Times are written in UTC, so no VTIMEZONE block is needed and every calendar
 * client shows them in its own zone.
 */

export interface ICalEvent {
  uid: string;
  start: Date;
  end?: Date;
  summary: string;
  url?: string;
  description?: string;
}

export interface ICalendarInput {
  name: string;
  prodId?: string;
  events: ICalEvent[];
  /** DTSTAMP for every event; defaults to now. Fixed in tests and for cache-stable output. */
  stamp?: Date;
}

/** Escapes TEXT values (RFC 5545 §3.3.11). */
export function escapeICalText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Folds a content line to at most 75 octets per line (RFC 5545 §3.1), never splitting a character. */
export function foldICalLine(line: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = "";
  let bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    const limit = lines.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + size > limit) {
      lines.push(current);
      current = "";
      bytes = 0;
    }
    current += character;
    bytes += size;
  }
  lines.push(current);
  return lines.join("\r\n ");
}

export function formatICalDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function buildICalendar(input: ICalendarInput): string {
  const stamp = formatICalDate(input.stamp ?? new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${input.prodId ?? "-//CrabbyTab//Tournament Schedule//EN"}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeICalText(input.name)}`,
  ];
  for (const event of input.events) {
    if (Number.isNaN(event.start.getTime())) continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeICalText(event.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${formatICalDate(event.start)}`,
      ...(event.end && !Number.isNaN(event.end.getTime()) && event.end >= event.start
        ? [`DTEND:${formatICalDate(event.end)}`]
        : []),
      `SUMMARY:${escapeICalText(event.summary)}`,
      ...(event.description ? [`DESCRIPTION:${escapeICalText(event.description)}`] : []),
      ...(event.url ? [`URL:${event.url}`] : []),
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldICalLine).join("\r\n") + "\r\n";
}

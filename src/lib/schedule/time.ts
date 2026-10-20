/**
 * Conversions between stored ISO date-times and `<input type="datetime-local">` values, which are
 * in the viewer's own time zone. Stored times are absolute (UTC ISO strings), so everyone sees
 * them in their own zone and the iCalendar feed needs no time-zone tables.
 */

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** "YYYY-MM-DDTHH:mm" in local time, or "" for a missing or invalid time. */
export function toDateTimeLocalValue(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The ISO time for a datetime-local value, or undefined when it is empty or invalid. */
export function fromDateTimeLocalValue(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** A short local rendering such as "Sat 21 Oct, 14:30"; "" when invalid. */
export function formatScheduleTime(iso: string | undefined, options: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
}, locale?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(locale, options).format(date);
}

export function formatClockTime(iso: string | undefined, locale?: string): string {
  return formatScheduleTime(iso, { hour: "2-digit", minute: "2-digit" }, locale);
}

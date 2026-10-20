/** A plausible E.164 number (leading +, 8–15 digits), after removing spaces, dashes and brackets. Safe in browsers. */
export function normalizePhoneNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
}

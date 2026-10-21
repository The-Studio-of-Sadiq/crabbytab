/**
 * Debate (and preformed panel) importance has one scale in CrabbyTab: 0 to 10, as stored by the
 * allocation page, auto-prioritise and the panel editor. Tabbycat's scale is -2..2; auto-prioritise
 * writes Tabbycat's levels 1, 0, -1, -2 as 10, 7, 3, 0 (see importanceByBracket).
 *
 * Writers (UI, API, imports) must store values in DEBATE_IMPORTANCE_MIN..DEBATE_IMPORTANCE_MAX;
 * readers clamp with clampDebateImportance so an out-of-range legacy value (e.g. a negative
 * Tabbycat-style -2 accepted by an older API) is read as the nearest valid value.
 */
export const DEBATE_IMPORTANCE_MIN = 0;
export const DEBATE_IMPORTANCE_MAX = 10;

export function clampDebateImportance(importance: number | undefined): number {
  if (importance === undefined || !Number.isFinite(importance)) return DEBATE_IMPORTANCE_MIN;
  return Math.max(DEBATE_IMPORTANCE_MIN, Math.min(DEBATE_IMPORTANCE_MAX, importance));
}

/**
 * CrabbyTab's 0-10 importance as Tabbycat's importance level: 0, 3, 7 and 10 are exactly -2, -1, 0
 * and 1 (the levels auto-prioritise writes); values between are interpolated, values outside 0-10
 * are clamped. (Tabbycat's top level, 2, has no CrabbyTab equivalent.)
 */
export function tabbycatImportanceLevel(importance: number | undefined): number {
  const value = clampDebateImportance(importance);
  if (value <= 3) return -2 + value / 3;
  if (value <= 7) return -1 + (value - 3) / 4;
  return (value - 7) / 3;
}

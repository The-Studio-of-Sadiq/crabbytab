import type { Adjudicator, AdjudicatorScoreChange } from "@/types";

export interface ScoreChangeContext {
  timestamp: string;
  /** The tournament's current round, recorded with the change (Tabbycat AdjudicatorBaseScoreHistory.round). */
  roundId?: string;
  actorId?: string;
  actorName?: string;
  reason?: string;
}

const SCORE_FIELDS = ["baseScore", "testScore"] as const;
export const MAX_SCORE_CHANGE_REASON_LENGTH = 500;

function sameScore(left: number | undefined, right: number | undefined): boolean {
  return left === right || (left !== undefined && right !== undefined && Number.isNaN(left) && Number.isNaN(right));
}

/** The base/test score changes between two versions of an adjudicator, base score first. */
export function scoreChangesBetween(
  previous: Pick<Adjudicator, "baseScore" | "testScore"> | undefined,
  next: Pick<Adjudicator, "baseScore" | "testScore">,
  context: ScoreChangeContext
): AdjudicatorScoreChange[] {
  if (!previous) return [];
  const reason = context.reason?.trim().slice(0, MAX_SCORE_CHANGE_REASON_LENGTH);
  return SCORE_FIELDS.filter((field) => !sameScore(previous[field], next[field])).map((field) => ({
    field,
    ...(previous[field] !== undefined ? { previous: previous[field] } : {}),
    ...(next[field] !== undefined ? { value: next[field] } : {}),
    timestamp: context.timestamp,
    ...(context.roundId ? { roundId: context.roundId } : {}),
    ...(context.actorId ? { actorId: context.actorId } : {}),
    ...(context.actorName ? { actorName: context.actorName } : {}),
    ...(reason ? { reason } : {}),
  }));
}

/**
 * `next` with any base/test score change since `previous` appended to its history. The stored
 * history of `previous` wins over the one on `next`, so an edit made from a stale copy of the
 * adjudicator cannot drop entries recorded in the meantime.
 */
export function withScoreHistory(
  previous: Adjudicator | undefined,
  next: Adjudicator,
  context: ScoreChangeContext
): Adjudicator {
  const changes = scoreChangesBetween(previous, next, context);
  const history = previous?.scoreHistory ?? next.scoreHistory;
  if (changes.length === 0) return history === next.scoreHistory ? next : { ...next, scoreHistory: history };
  return { ...next, scoreHistory: [...(history ?? []), ...changes] };
}

export function isAdjudicatorScoreChange(value: unknown): value is AdjudicatorScoreChange {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const optionalNumber = (key: string) => record[key] === undefined ||
    (typeof record[key] === "number" && Number.isFinite(record[key]));
  const optionalString = (key: string) => record[key] === undefined || typeof record[key] === "string";
  return (record.field === "baseScore" || record.field === "testScore") &&
    typeof record.timestamp === "string" &&
    optionalNumber("previous") &&
    optionalNumber("value") &&
    optionalString("roundId") &&
    optionalString("actorId") &&
    optionalString("actorName") &&
    optionalString("reason");
}

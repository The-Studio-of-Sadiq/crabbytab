import type { SpeakerMetricId, TeamMetricId, TournamentFormat, TournamentPreferences } from "@/types";
import {
  ALL_SPEAKER_METRICS,
  ALL_TEAM_METRICS,
  DEFAULT_SPEAKER_PRECEDENCE,
  DEFAULT_TEAM_PRECEDENCE,
} from "./metrics";

const MAX_PRECEDENCE = 8;

function sanitize<M extends string>(ids: M[] | undefined, valid: readonly M[]): M[] {
  if (!ids || ids.length === 0) return [];
  const validSet = new Set(valid);
  const seen = new Set<M>();
  const out: M[] = [];
  for (const id of ids) {
    if (validSet.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out.slice(0, MAX_PRECEDENCE);
}

export function resolveTeamPrecedence(
  format: TournamentFormat | string,
  preferences?: Pick<TournamentPreferences, "teamStandingsPrecedence">
): TeamMetricId[] {
  const custom = sanitize(preferences?.teamStandingsPrecedence, ALL_TEAM_METRICS);
  if (custom.length > 0) return custom;
  return format === "bp" ? DEFAULT_TEAM_PRECEDENCE.bp : DEFAULT_TEAM_PRECEDENCE.two_team;
}

export function resolveTeamExtra(
  preferences?: Pick<TournamentPreferences, "teamStandingsExtra">
): TeamMetricId[] {
  return sanitize(preferences?.teamStandingsExtra, ALL_TEAM_METRICS);
}

export function resolveSpeakerPrecedence(
  preferences?: Pick<TournamentPreferences, "speakerStandingsPrecedence">
): SpeakerMetricId[] {
  const custom = sanitize(preferences?.speakerStandingsPrecedence, ALL_SPEAKER_METRICS);
  return custom.length > 0 ? custom : DEFAULT_SPEAKER_PRECEDENCE;
}

export function resolveSpeakerExtra(
  preferences?: Pick<TournamentPreferences, "speakerStandingsExtra">
): SpeakerMetricId[] {
  return sanitize(preferences?.speakerStandingsExtra, ALL_SPEAKER_METRICS);
}

const EPS = 1e-6;

/**
 * Compares two rows by a precedence chain of metrics, in order, until one
 * differs beyond floating-point noise. Returns <0 if `a` ranks first.
 */
export function compareByPrecedence<M extends string>(
  a: Record<M, number>,
  b: Record<M, number>,
  precedence: M[],
  direction: Record<M, 1 | -1>
): number {
  for (const m of precedence) {
    const diff = ((b[m] ?? 0) - (a[m] ?? 0)) * direction[m];
    if (Math.abs(diff) > EPS) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function isTiedByPrecedence<M extends string>(
  a: Record<M, number>,
  b: Record<M, number>,
  precedence: M[]
): boolean {
  return precedence.every((m) => Math.abs((a[m] ?? 0) - (b[m] ?? 0)) <= EPS);
}

/**
 * Assigns `.rank` on a list already sorted best-first (via `getMetrics` +
 * `compareByPrecedence`), giving tied rows — tied on every precedence metric —
 * the same rank, Olympic-style (1, 1, 3, ...).
 */
export function assignSharedRanks<T, M extends string>(
  sorted: T[],
  getMetrics: (row: T) => Record<M, number>,
  precedence: M[],
  setRank: (row: T, rank: number) => void
): void {
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && !isTiedByPrecedence(getMetrics(sorted[i - 1]), getMetrics(sorted[i]), precedence)) {
      rank = i + 1;
    }
    setRank(sorted[i], rank);
  }
}

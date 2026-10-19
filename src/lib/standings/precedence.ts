import type { SpeakerMetricId, TeamMetricId, TeamStandingRow, TournamentFormat, TournamentPreferences } from "@/types";
import {
  ALL_SPEAKER_METRICS,
  ALL_TEAM_METRICS,
  DEFAULT_SPEAKER_PRECEDENCE,
  DEFAULT_TEAM_PRECEDENCE,
  RANKING_ONLY_TEAM_METRICS,
  REPEATABLE_TEAM_METRICS,
  TEAM_METRIC_DIRECTION,
} from "./metrics";

const MAX_PRECEDENCE = 8;

function sanitize<M extends string>(ids: M[] | undefined, valid: readonly M[], repeatable: readonly M[] = []): M[] {
  if (!ids || ids.length === 0) return [];
  const validSet = new Set(valid);
  const repeatableSet = new Set(repeatable);
  const seen = new Set<M>();
  const out: M[] = [];
  for (const id of ids) {
    if (validSet.has(id) && (!seen.has(id) || repeatableSet.has(id))) {
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
  const custom = sanitize(preferences?.teamStandingsPrecedence, ALL_TEAM_METRICS, REPEATABLE_TEAM_METRICS);
  if (custom.length > 0) return custom;
  return format === "bp" ? DEFAULT_TEAM_PRECEDENCE.bp : DEFAULT_TEAM_PRECEDENCE.two_team;
}

export function resolveTeamExtra(
  preferences?: Pick<TournamentPreferences, "teamStandingsExtra">
): TeamMetricId[] {
  const extraable = ALL_TEAM_METRICS.filter((id) => !RANKING_ONLY_TEAM_METRICS.includes(id));
  return sanitize(preferences?.teamStandingsExtra, extraable);
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

/* -------------------------------------------------------------------------- */
/* Team precedence (with who-beat-whom)                                       */
/* -------------------------------------------------------------------------- */

type TeamRankable = Pick<TeamStandingRow, "metrics" | "whoBeatWhom">;

/**
 * The values a team is ranked on, in precedence order. Each "wbw" reads the next entry of
 * `whoBeatWhom`; null means "n/a" (not exactly two teams tied), which only ever meets another
 * "n/a", because who-beat-whom is compared only between teams tied on every earlier metric.
 */
export function teamPrecedenceValues(row: TeamRankable, precedence: TeamMetricId[]): (number | null)[] {
  let wbwIndex = 0;
  return precedence.map((metric) =>
    metric === "wbw" ? row.whoBeatWhom?.[wbwIndex++] ?? null : row.metrics[metric] ?? 0
  );
}

function compareValues(a: (number | null)[], b: (number | null)[], precedence: TeamMetricId[]): number {
  for (let i = 0; i < precedence.length; i++) {
    const left = a[i];
    const right = b[i];
    if (left === null || right === null) {
      if (left === right) continue;
      return left === null ? 1 : -1;
    }
    const diff = (right - left) * TEAM_METRIC_DIRECTION[precedence[i]];
    if (Math.abs(diff) > EPS) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** As compareByPrecedence, for teams: also understands (repeated) who-beat-whom. */
export function compareTeamsByPrecedence(a: TeamRankable, b: TeamRankable, precedence: TeamMetricId[]): number {
  return compareValues(teamPrecedenceValues(a, precedence), teamPrecedenceValues(b, precedence), precedence);
}

export function teamsTiedByPrecedence(a: TeamRankable, b: TeamRankable, precedence: TeamMetricId[]): boolean {
  return compareTeamsByPrecedence(a, b, precedence) === 0;
}

/**
 * Tabbycat's who-beat-whom (WhoBeatWhomMetricAnnotator). For each "wbw" in the precedence, teams
 * are grouped by every metric before it (earlier who-beat-whoms included); where exactly two teams
 * share a group, each gets the points it earned in preliminary debates against the other, and
 * every other team gets "n/a" (null). `pointsAgainst(team, other)` supplies those points.
 * Writes `row.whoBeatWhom`, and `row.metrics.wbw` (its first value that is not n/a, else 0) for display.
 */
export function annotateWhoBeatWhom(
  rows: TeamStandingRow[],
  precedence: TeamMetricId[],
  pointsAgainst: (teamId: string, otherId: string) => number
): void {
  for (const row of rows) row.whoBeatWhom = [];
  precedence.forEach((metric, index) => {
    if (metric !== "wbw") return;
    const prefix = precedence.slice(0, index);
    const sorted = [...rows].sort((a, b) => compareTeamsByPrecedence(a, b, prefix));
    let start = 0;
    while (start < sorted.length) {
      let end = start + 1;
      while (end < sorted.length && teamsTiedByPrecedence(sorted[start], sorted[end], prefix)) end++;
      const group = sorted.slice(start, end);
      for (const row of group) {
        const other = group.length === 2 ? group.find((candidate) => candidate !== row)! : undefined;
        row.whoBeatWhom!.push(other ? pointsAgainst(row.teamId, other.teamId) : null);
      }
      start = end;
    }
  });
  for (const row of rows) row.metrics.wbw = row.whoBeatWhom?.find((value) => value !== null) ?? 0;
}

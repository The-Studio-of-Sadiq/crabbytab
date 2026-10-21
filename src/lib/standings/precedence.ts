import type { MetricValue, SpeakerMetricId, TeamMetricId, TeamStandingRow, TournamentFormat, TournamentPreferences } from "@/types";
import {
  ALL_SPEAKER_METRICS,
  ALL_TEAM_METRICS,
  DEFAULT_SPEAKER_PRECEDENCE,
  DEFAULT_TEAM_PRECEDENCE,
  EXTRA_ONLY_TEAM_METRICS,
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
  const rankable = ALL_TEAM_METRICS.filter((id) => !EXTRA_ONLY_TEAM_METRICS.includes(id));
  const custom = sanitize(preferences?.teamStandingsPrecedence, rankable, REPEATABLE_TEAM_METRICS);
  if (custom.length > 0) return custom;
  if (format === "poly") return DEFAULT_TEAM_PRECEDENCE.poly;
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

/** A metric as ranked: null (no value) stays null; an absent metric (older rows) counts as 0. */
function rankedValue(value: MetricValue | undefined): number | null {
  return value === undefined ? 0 : value;
}

/**
 * Compares two metric values, <0 if `a` ranks first. A value beats no value (null) whatever the
 * metric's direction, and two nulls tie: Tabbycat ranks with ORDER BY ... NULLS LAST, ascending and
 * descending alike (standings/ranking.py, BaseRankAnnotator._get_ordering), and a window partition
 * groups nulls together.
 */
export function compareMetricValues(a: MetricValue | undefined, b: MetricValue | undefined, direction: 1 | -1): number {
  const left = rankedValue(a);
  const right = rankedValue(b);
  if (left === null || right === null) {
    if (left === right) return 0;
    return left === null ? 1 : -1;
  }
  const diff = (right - left) * direction;
  return Math.abs(diff) > EPS ? (diff > 0 ? 1 : -1) : 0;
}

/**
 * Compares two rows by a precedence chain of metrics, in order, until one
 * differs beyond floating-point noise. Returns <0 if `a` ranks first.
 */
export function compareByPrecedence<M extends string>(
  a: Record<M, MetricValue>,
  b: Record<M, MetricValue>,
  precedence: M[],
  direction: Record<M, 1 | -1>
): number {
  for (const m of precedence) {
    const byMetric = compareMetricValues(a[m], b[m], direction[m]);
    if (byMetric !== 0) return byMetric;
  }
  return 0;
}

export function isTiedByPrecedence<M extends string>(
  a: Record<M, MetricValue>,
  b: Record<M, MetricValue>,
  precedence: M[]
): boolean {
  // Direction does not matter for equality.
  return precedence.every((m) => compareMetricValues(a[m], b[m], 1) === 0);
}

/**
 * Assigns `.rank` on a list already sorted best-first (via `getMetrics` +
 * `compareByPrecedence`), giving tied rows — tied on every precedence metric —
 * the same rank, Olympic-style (1, 1, 3, ...).
 */
export function assignSharedRanks<T, M extends string>(
  sorted: T[],
  getMetrics: (row: T) => Record<M, MetricValue>,
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
 * Any other metric's null is "no value" (no results yet); both rank below every value.
 */
export function teamPrecedenceValues(row: TeamRankable, precedence: TeamMetricId[]): MetricValue[] {
  let wbwIndex = 0;
  return precedence.map((metric) =>
    metric === "wbw" ? row.whoBeatWhom?.[wbwIndex++] ?? null : rankedValue(row.metrics[metric])
  );
}

function compareValues(a: MetricValue[], b: MetricValue[], precedence: TeamMetricId[]): number {
  for (let i = 0; i < precedence.length; i++) {
    const byMetric = compareMetricValues(a[i], b[i], TEAM_METRIC_DIRECTION[precedence[i]]);
    if (byMetric !== 0) return byMetric;
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

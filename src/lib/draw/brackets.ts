import type { TeamMetricId, TeamStandingRow } from "@/types";

/**
 * A team's bracket in a power-paired draw: its value of `metric` (Tabbycat's team.points, the
 * first standings precedence metric; a missing value counts as 0, as Tabbycat's `or 0`). "points"
 * falls back to the row's total points; "wbw" reads the first who-beat-whom value.
 */
export function bracketValue(standing: TeamStandingRow | undefined, metric: TeamMetricId): number {
  if (!standing) return 0;
  if (metric === "wbw") return standing.whoBeatWhom?.[0] ?? 0;
  const value = standing.metrics?.[metric] ?? (metric === "points" ? standing.points : undefined);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

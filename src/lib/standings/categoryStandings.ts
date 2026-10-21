import type { BreakCategory, Team, TeamMetricId, TeamStandingRow } from "@/types";
import { rankTeamSubset } from "./subset";

/**
 * Whether a team belongs to a break category's standings: every team not marked ineligible for a
 * general (open) category, otherwise the teams eligible for it. The same rule as the public break
 * category tabs (lib/publicView/derived.ts).
 */
export function teamInBreakCategory(category: Pick<BreakCategory, "id" | "isGeneral" | "teamOverrides">, team: Pick<Team, "id" | "breakCategories"> | undefined): boolean {
  if (!team) return false;
  if (category.isGeneral) return category.teamOverrides?.[team.id] !== "ineligible";
  return Boolean(team.breakCategories?.includes(category.id));
}

/**
 * The standings of one break category, ranked among its own teams (Tabbycat's standings by break
 * category, standings/views.py): ranks restart at 1 and who-beat-whom is re-evaluated inside the
 * category (lib/standings/subset.ts).
 */
export function breakCategoryStandings(
  rows: TeamStandingRow[],
  category: Pick<BreakCategory, "id" | "isGeneral" | "teamOverrides">,
  teamsById: ReadonlyMap<string, Pick<Team, "id" | "breakCategories">>,
  precedence: TeamMetricId[]
): TeamStandingRow[] {
  return rankTeamSubset(rows.filter((row) => teamInBreakCategory(category, teamsById.get(row.teamId))), precedence);
}

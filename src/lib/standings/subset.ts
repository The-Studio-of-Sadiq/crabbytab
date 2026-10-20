import type { TeamMetricId, TeamStandingRow } from "@/types";
import { annotateWhoBeatWhom, compareTeamsByPrecedence, teamsTiedByPrecedence } from "./precedence";

/**
 * Ranks a subset of the team standings on its own, as Tabbycat does when it generates standings
 * for a queryset of teams (a non-general break category, or a break category's public tab).
 *
 * Every metric is kept as computed for the whole tournament (draw strength still counts opponents
 * outside the subset), but who-beat-whom is re-evaluated: it now compares the two teams tied
 * within the subset, which can differ from the pair tied in the overall standings. Ranks are
 * shared by teams tied on every precedence metric (1, 2, 2, 4); the order inside a tie is by team
 * name, as in the overall standings. The input rows are not modified.
 */
export function rankTeamSubset(rows: TeamStandingRow[], precedence: TeamMetricId[]): TeamStandingRow[] {
  const copies = rows.map((row) => ({
    ...row,
    metrics: { ...row.metrics },
    ...(row.whoBeatWhom ? { whoBeatWhom: [...row.whoBeatWhom] } : {}),
  }));
  if (precedence.includes("wbw")) {
    const byId = new Map(copies.map((row) => [row.teamId, row]));
    // Unweighted points earned in preliminary debates against the other team (as the standings
    // calculator's who-beat-whom): roundResults hold exactly those debates.
    const pointsAgainst = (teamId: string, otherId: string) =>
      (byId.get(teamId)?.roundResults ?? [])
        .filter((round) => round.opponentTeamIds?.includes(otherId))
        .reduce((sum, round) => sum + round.points, 0);
    annotateWhoBeatWhom(copies, precedence, pointsAgainst);
  }
  copies.sort((a, b) => compareTeamsByPrecedence(a, b, precedence) || a.teamName.localeCompare(b.teamName));
  copies.forEach((row, index) => {
    const tied = index > 0 && teamsTiedByPrecedence(copies[index - 1], row, precedence);
    row.rank = tied ? copies[index - 1].rank : index + 1;
  });
  return copies;
}

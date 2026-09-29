import { Team, TeamStandingRow, BreakCategory } from "@/types";

export interface BreakingTeamEntry {
  seed: number;
  rank: number;
  team: Team;
  standing: TeamStandingRow;
  category: BreakCategory;
  isReserve: boolean;
  reserveIndex?: number;
}

export interface BreakCategoryResult {
  category: BreakCategory;
  breakingTeams: BreakingTeamEntry[];
  reserveTeams: BreakingTeamEntry[];
}

export function applyBreakStatuses(
  teams: Team[],
  results: BreakCategoryResult[]
): Team[] {
  const categoryIdsByTeam = new Map<string, string[]>();
  for (const result of results) {
    for (const entry of result.breakingTeams) {
      const categoryIds = categoryIdsByTeam.get(entry.team.id) || [];
      categoryIds.push(result.category.id);
      categoryIdsByTeam.set(entry.team.id, categoryIds);
    }
  }

  return teams.map((team) => {
    const breakCategoryIds = categoryIdsByTeam.get(team.id) || [];
    return {
      ...team,
      breakStatus: breakCategoryIds.length > 0 ? "breaking" : "eliminated",
      breakCategoryIds,
      eliminatedInRoundId: undefined,
    };
  });
}

/**
 * Calculates breaking and reserve teams for each break category according to priority rules.
 */
export function calculateBreaks(
  categories: BreakCategory[],
  teams: Team[],
  standings: TeamStandingRow[]
): BreakCategoryResult[] {
  const teamMap = new Map<string, Team>();
  teams.forEach((t) => teamMap.set(t.id, t));

  // Sort categories by priority (highest priority number or rank first)
  const sortedCategories = [...categories].sort((a, b) => (b.priority || 0) - (a.priority || 0));

  const brokenTeamIds = new Set<string>();
  const results: BreakCategoryResult[] = [];

  for (const cat of sortedCategories) {
    // Filter eligible teams that have not already broken in a higher priority category
    const eligibleStandings = standings.filter((st) => {
      if (brokenTeamIds.has(st.teamId)) return false;
      const team = teamMap.get(st.teamId);
      if (!team) return false;

      // General category (like Open) includes all teams by default
      if (cat.isGeneral) return true;

      // Specific categories (ESL, Novice, etc.) check eligibility
      return team.breakCategories && team.breakCategories.includes(cat.id);
    });

    // Select breaking teams
    const breakingCount = Math.min(cat.breakSize, eligibleStandings.length);
    const breakingSlice = eligibleStandings.slice(0, breakingCount);

    const breakingEntries: BreakingTeamEntry[] = breakingSlice.map((st, idx) => {
      const team = teamMap.get(st.teamId)!;
      brokenTeamIds.add(team.id); // Mark as broken
      return {
        seed: idx + 1,
        rank: st.rank,
        team,
        standing: st,
        category: cat,
        isReserve: false,
      };
    });

    // Select reserve teams
    const reserveCount = Math.min(cat.reserveSize || 0, eligibleStandings.length - breakingCount);
    const reserveSlice = eligibleStandings.slice(breakingCount, breakingCount + reserveCount);

    const reserveEntries: BreakingTeamEntry[] = reserveSlice.map((st, idx) => {
      const team = teamMap.get(st.teamId)!;
      return {
        seed: breakingCount + idx + 1,
        rank: st.rank,
        team,
        standing: st,
        category: cat,
        isReserve: true,
        reserveIndex: idx + 1,
      };
    });

    results.push({
      category: cat,
      breakingTeams: breakingEntries,
      reserveTeams: reserveEntries,
    });
  }

  return results;
}

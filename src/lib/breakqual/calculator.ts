import { Team, TeamStandingRow, BreakCategory, BreakQualificationRule, TournamentFormat } from "@/types";

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

function institutionKey(team: Team): string {
  return team.institutionId?.trim().toLowerCase() ||
    team.institutionName?.trim().toLowerCase() ||
    `team:${team.id}`;
}

function tieKey(standing: TeamStandingRow): string {
  const metrics = Object.entries(standing.metrics)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`)
    .join("|");
  return metrics || `wins:${standing.wins ?? standing.points}|speaks:${standing.totalSpeakerScore}`;
}

function selectAida2016Teams(
  eligible: TeamStandingRow[],
  teamMap: Map<string, Team>,
  breakSize: number,
  rule: Extract<BreakQualificationRule, "aida_2016_australs" | "aida_2016_easters">
): TeamStandingRow[] {
  if (eligible.length <= breakSize) return eligible;

  const winsOf = (standing: TeamStandingRow) => standing.wins ?? standing.points;
  const minimumWins = winsOf(eligible[breakSize - 1]);
  const winEligible = eligible.filter((standing) => winsOf(standing) >= minimumWins);
  const naturalBreakCutoff = winEligible[breakSize - 1]?.rank ?? eligible[breakSize - 1].rank;
  const institutionRanks = new Map<string, number>();
  const institutionRankByTeam = new Map<string, number>();
  const ranks = new Map<string, number>();
  eligible.forEach((standing, index) => {
    ranks.set(standing.teamId, standing.rank || index + 1);
    const team = teamMap.get(standing.teamId);
    if (!team) return;
    const key = institutionKey(team);
    const institutionRank = (institutionRanks.get(key) ?? 0) + 1;
    institutionRanks.set(key, institutionRank);
    institutionRankByTeam.set(standing.teamId, institutionRank);
  });

  const capped = winEligible.filter((standing) => {
    const team = teamMap.get(standing.teamId);
    if (!team) return false;
    const institutionRank = institutionRankByTeam.get(standing.teamId) ?? 1;
    const rank = ranks.get(standing.teamId) ?? standing.rank;
    return (institutionRank > 1 && rank > naturalBreakCutoff) || institutionRank > 3;
  });
  const cappedIds = new Set(capped.map((standing) => standing.teamId));
  const selected = winEligible.filter((standing) => !cappedIds.has(standing.teamId));
  if (selected.length >= breakSize) return selected;

  const reinsertionPasses = rule === "aida_2016_easters"
    ? [
        capped.filter((standing) => {
          const team = teamMap.get(standing.teamId);
          return team && (institutionRankByTeam.get(standing.teamId) ?? 1) <= 3;
        }),
        capped,
      ]
    : [capped];

  for (const pass of reinsertionPasses) {
    const groups = new Map<string, TeamStandingRow[]>();
    for (const standing of pass) {
      const key = tieKey(standing);
      const group = groups.get(key) ?? [];
      group.push(standing);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      for (const standing of group) {
        if (!selected.some((item) => item.teamId === standing.teamId)) selected.push(standing);
      }
      if (selected.length >= breakSize) break;
    }
    if (selected.length >= breakSize) break;
  }

  const selectedIds = new Set(selected.map((standing) => standing.teamId));
  return eligible.filter((standing) => selectedIds.has(standing.teamId));
}

function applyQualificationRule(
  eligible: TeamStandingRow[],
  category: BreakCategory,
  teamMap: Map<string, Team>
): TeamStandingRow[] {
  const rule = category.qualificationRule ?? "standard";
  if (rule === "standard") return eligible;
  if (rule === "aida_1996") {
    const institutionRanks = new Map<string, number>();
    return eligible.filter((standing) => {
      const team = teamMap.get(standing.teamId);
      if (!team) return false;
      const key = institutionKey(team);
      const rank = (institutionRanks.get(key) ?? 0) + 1;
      institutionRanks.set(key, rank);
      return rank <= 3;
    });
  }
  return selectAida2016Teams(eligible, teamMap, category.breakSize, rule);
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
  standings: TeamStandingRow[],
  format?: TournamentFormat
): BreakCategoryResult[] {
  if (
    format === "bp" &&
    categories.some((category) =>
      category.qualificationRule === "aida_2016_australs" ||
      category.qualificationRule === "aida_2016_easters"
    )
  ) {
    throw new Error("AIDA 2016 qualification rules require a two-team tournament format.");
  }
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
    const qualificationRule = cat.qualificationRule ?? "standard";
    const qualificationCandidates = applyQualificationRule(eligibleStandings, cat, teamMap);
    const institutionLimit = qualificationRule !== "standard"
      ? undefined
      :
      Number.isInteger(cat.maxPerInstitution) && (cat.maxPerInstitution ?? 0) > 0
        ? cat.maxPerInstitution
        : undefined;
    const institutionCounts = new Map<string, number>();
    const takeEligible = (
      candidates: TeamStandingRow[],
      count: number
    ): TeamStandingRow[] => {
      const selected: TeamStandingRow[] = [];
      for (const standing of candidates) {
        if (selected.length >= count) break;
        const team = teamMap.get(standing.teamId);
        if (!team) continue;
        const institutionKey = team.institutionId?.trim().toLowerCase() ||
          team.institutionName?.trim().toLowerCase() ||
          `team:${team.id}`;
        const institutionCount = institutionCounts.get(institutionKey) ?? 0;
        if (institutionLimit !== undefined && institutionCount >= institutionLimit) continue;
        selected.push(standing);
        institutionCounts.set(institutionKey, institutionCount + 1);
      }
      return selected;
    };

    const breakingSlice = takeEligible(qualificationCandidates, cat.breakSize);
    const breakingIds = new Set(breakingSlice.map((standing) => standing.teamId));
    const reserveSlice = takeEligible(
      qualificationCandidates.filter((standing) => !breakingIds.has(standing.teamId)),
      cat.reserveSize || 0
    );
    const breakingCount = breakingSlice.length;

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
    const reserveCount = reserveSlice.length;

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

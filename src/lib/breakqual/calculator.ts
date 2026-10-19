import {
  Team,
  TeamStandingRow,
  BreakCategory,
  BreakQualificationRule,
  BreakTeamOverride,
  GeneratedBreak,
  TournamentFormat,
} from "@/types";

export interface BreakingTeamEntry {
  seed: number;
  rank: number;
  team: Team;
  standing: TeamStandingRow;
  category: BreakCategory;
  isReserve: boolean;
  reserveIndex?: number;
  /** Broke because of a manual "include" override. */
  manuallyIncluded?: boolean;
}

export type BreakExclusionReason = Exclude<BreakTeamOverride, "include"> | "capped";

export interface BreakExclusionEntry {
  rank: number;
  team: Team;
  standing: TeamStandingRow;
  reason: BreakExclusionReason;
  /** True when the reason is a manual override rather than a rule outcome. */
  manual: boolean;
}

/**
 * Teams tied on every standings precedence metric (the same tab rank) that straddle the last
 * breaking place or the last reserve place. Tabbycat lets every such team through (the break
 * grows) and leaves it to the tab director to resolve; CrabbyTab instead holds the whole group
 * out of the break (or reserves) and refuses to generate the break until the director resolves
 * it with overrides: "Manually included" for the teams that go through, or a remark such as
 * "Lost coin toss" for those that do not. No arbitrary order (e.g. by name) decides it.
 */
export interface BreakCutoffTie {
  cutoff: "break" | "reserve";
  /** Every team in the tied group, in standings order. */
  teams: { rank: number; team: Team; standing: TeamStandingRow }[];
  /** How many of these teams the cutoff has room for (fewer than `teams.length`). */
  places: number;
}

export interface BreakCategoryResult {
  category: BreakCategory;
  breakingTeams: BreakingTeamEntry[];
  reserveTeams: BreakingTeamEntry[];
  /** Unresolved ties at the break or reserve cutoff; empty when the cutoffs are clear. */
  cutoffTies: BreakCutoffTie[];
  /**
   * Teams left out of this category: every manual exclusion, plus teams that
   * would otherwise have ranked inside the break but broke in a higher-priority
   * category ("different_break") or were removed by an institution cap ("capped").
   */
  excludedTeams: BreakExclusionEntry[];
}

export const BREAK_OVERRIDE_LABELS: Record<BreakTeamOverride, string> = {
  include: "Manually included",
  ineligible: "Ineligible",
  withdrawn: "Withdrawn",
  different_break: "Different break",
  disqualified: "Disqualified",
  lost_coin_toss: "Lost coin toss",
};

export const BREAK_EXCLUSION_LABELS: Record<BreakExclusionReason, string> = {
  ineligible: BREAK_OVERRIDE_LABELS.ineligible,
  withdrawn: BREAK_OVERRIDE_LABELS.withdrawn,
  different_break: BREAK_OVERRIDE_LABELS.different_break,
  disqualified: BREAK_OVERRIDE_LABELS.disqualified,
  lost_coin_toss: BREAK_OVERRIDE_LABELS.lost_coin_toss,
  capped: "Capped (institution limit)",
};

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

/**
 * Teams a qualification rule allows, in the order breaking places (then
 * reserve places) are filled, plus the teams it capped.
 */
interface QualificationOutcome {
  ordered: TeamStandingRow[];
  capped: TeamStandingRow[];
}

function selectAida2016Teams(
  eligible: TeamStandingRow[],
  teamMap: Map<string, Team>,
  breakSize: number,
  rule: Extract<BreakQualificationRule, "aida_2016_australs" | "aida_2016_easters">
): QualificationOutcome {
  if (eligible.length <= breakSize || breakSize <= 0) return { ordered: eligible, capped: [] };

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

  const isCapped = (standing: TeamStandingRow) => {
    const institutionRank = institutionRankByTeam.get(standing.teamId) ?? 1;
    const rank = ranks.get(standing.teamId) ?? standing.rank;
    return (institutionRank > 1 && rank > naturalBreakCutoff) || institutionRank > 3;
  };
  const capped = winEligible.filter((standing) => teamMap.has(standing.teamId) && isCapped(standing));
  const cappedIds = new Set(capped.map((standing) => standing.teamId));
  const selected = winEligible.filter((standing) => !cappedIds.has(standing.teamId));

  if (selected.length < breakSize) {
    const reinsertionPasses = rule === "aida_2016_easters"
      ? [
          capped.filter((standing) => (institutionRankByTeam.get(standing.teamId) ?? 1) <= 3),
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
  }

  const selectedIds = new Set(selected.map((standing) => standing.teamId));
  // Reserves are the next teams in rank order that the cap would not remove.
  const reserves = eligible.filter(
    (standing) => !selectedIds.has(standing.teamId) && teamMap.has(standing.teamId) && !isCapped(standing)
  );
  return {
    ordered: [...eligible.filter((standing) => selectedIds.has(standing.teamId)), ...reserves],
    capped: eligible.filter(
      (standing) => !selectedIds.has(standing.teamId) && teamMap.has(standing.teamId) && isCapped(standing)
    ),
  };
}

function applyQualificationRule(
  eligible: TeamStandingRow[],
  rule: BreakQualificationRule,
  breakSize: number,
  teamMap: Map<string, Team>
): QualificationOutcome {
  if (rule === "standard") return { ordered: eligible, capped: [] };
  if (rule === "aida_1996") {
    const institutionRanks = new Map<string, number>();
    const ordered: TeamStandingRow[] = [];
    const capped: TeamStandingRow[] = [];
    for (const standing of eligible) {
      const team = teamMap.get(standing.teamId);
      if (!team) continue;
      const key = institutionKey(team);
      const rank = (institutionRanks.get(key) ?? 0) + 1;
      institutionRanks.set(key, rank);
      (rank <= 3 ? ordered : capped).push(standing);
    }
    return { ordered, capped };
  }
  return selectAida2016Teams(eligible, teamMap, breakSize, rule);
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
 * Applies one category's break without touching other categories: teams in
 * `result` gain the category, teams that previously had it lose it, and every
 * other category membership is kept. A team with no category left is marked
 * eliminated; elimination-round history is kept for teams this category does
 * not affect.
 */
export function applyCategoryBreakStatus(teams: Team[], result: BreakCategoryResult): Team[] {
  const categoryId = result.category.id;
  const breakingIds = new Set(result.breakingTeams.map((entry) => entry.team.id));
  return teams.map((team) => {
    const breaks = breakingIds.has(team.id);
    const hadCategory = team.breakCategoryIds?.includes(categoryId) ?? false;
    if (team.breakCategoryIds !== undefined && !breaks && !hadCategory) return team;
    const others = (team.breakCategoryIds ?? []).filter((id) => id !== categoryId);
    const breakCategoryIds = breaks ? [...others, categoryId] : others;
    return {
      ...team,
      breakStatus: breakCategoryIds.length > 0 ? "breaking" : "eliminated",
      breakCategoryIds,
      eliminatedInRoundId: breaks || hadCategory ? undefined : team.eliminatedInRoundId,
    };
  });
}

export function snapshotBreak(result: BreakCategoryResult, generatedAt: string): GeneratedBreak {
  return {
    breakingTeamIds: result.breakingTeams.map((entry) => entry.team.id),
    reserveTeamIds: result.reserveTeams.map((entry) => entry.team.id),
    generatedAt,
  };
}

/** True when the stored break no longer matches the current calculation. */
export function isGeneratedBreakStale(result: BreakCategoryResult): boolean {
  const generated = result.category.generatedBreak;
  if (!generated) return false;
  const current = snapshotBreak(result, generated.generatedAt);
  return (
    current.breakingTeamIds.join("|") !== generated.breakingTeamIds.join("|") ||
    current.reserveTeamIds.join("|") !== generated.reserveTeamIds.join("|")
  );
}

/**
 * Calculates breaking and reserve teams for each break category according to priority rules.
 *
 * Categories are processed from highest priority down; a team that breaks in
 * one category is not considered for lower-priority ones. Manual overrides on
 * a category exclude a team (any remark) or force it into the break
 * ("include", which also bypasses category eligibility and institution caps
 * but not the one-category rule). Forced teams take break places first; the
 * remaining places are filled by the qualification rule. Seeds follow
 * standings order.
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
  const standingIndex = new Map(standings.map((standing, index) => [standing.teamId, index]));
  const byStandingOrder = (left: TeamStandingRow, right: TeamStandingRow) =>
    (standingIndex.get(left.teamId) ?? 0) - (standingIndex.get(right.teamId) ?? 0);

  // Sort categories by priority (highest priority number or rank first)
  const sortedCategories = [...categories].sort((a, b) => (b.priority || 0) - (a.priority || 0));

  const brokenTeamIds = new Set<string>();
  const results: BreakCategoryResult[] = [];

  for (const cat of sortedCategories) {
    const overrides = cat.teamOverrides ?? {};
    const inCategory = (team: Team) => cat.isGeneral || Boolean(team.breakCategories?.includes(cat.id));
    const forced: TeamStandingRow[] = [];
    const natural: TeamStandingRow[] = [];
    const manualExclusions: BreakExclusionEntry[] = [];
    const brokeElsewhere: TeamStandingRow[] = [];

    for (const standing of standings) {
      const team = teamMap.get(standing.teamId);
      if (!team) continue;
      const override = overrides[team.id];
      if (brokenTeamIds.has(team.id)) {
        if (inCategory(team) || override === "include") brokeElsewhere.push(standing);
        continue;
      }
      if (override && override !== "include") {
        manualExclusions.push({ rank: standing.rank, team, standing, reason: override, manual: true });
        continue;
      }
      if (override === "include") forced.push(standing);
      else if (inCategory(team)) natural.push(standing);
    }

    const naturalPlaces = Math.max(0, cat.breakSize - forced.length);
    const qualificationRule = cat.qualificationRule ?? "standard";
    const qualification = applyQualificationRule(natural, qualificationRule, naturalPlaces, teamMap);
    const institutionLimit = qualificationRule !== "standard"
      ? undefined
      : Number.isInteger(cat.maxPerInstitution) && (cat.maxPerInstitution ?? 0) > 0
        ? cat.maxPerInstitution
        : undefined;
    const institutionCounts = new Map<string, number>();
    for (const standing of forced) {
      const key = institutionKey(teamMap.get(standing.teamId)!);
      institutionCounts.set(key, (institutionCounts.get(key) ?? 0) + 1);
    }
    const institutionCapped: TeamStandingRow[] = [];
    const takeEligible = (candidates: TeamStandingRow[], count: number): TeamStandingRow[] => {
      const selected: TeamStandingRow[] = [];
      for (const standing of candidates) {
        if (selected.length >= count) break;
        const team = teamMap.get(standing.teamId);
        if (!team) continue;
        const key = institutionKey(team);
        const institutionCount = institutionCounts.get(key) ?? 0;
        if (institutionLimit !== undefined && institutionCount >= institutionLimit) {
          institutionCapped.push(standing);
          continue;
        }
        selected.push(standing);
        institutionCounts.set(key, institutionCount + 1);
      }
      return selected;
    };

    // Every team the rule and the institution cap allow, in the order places are filled: the
    // first `naturalPlaces` break, the next `reserveSize` are reserves, unless a cutoff splits a tie.
    const sequence = takeEligible(qualification.ordered, qualification.ordered.length);
    const cutoffTies: BreakCutoffTie[] = [];
    const takeUpTo = (from: number, cutoff: number, kind: BreakCutoffTie["cutoff"]) => {
      const end = Math.min(cutoff, sequence.length);
      if (end <= from) return { taken: [] as TeamStandingRow[], next: Math.max(from, end) };
      const rank = sequence[end - 1].rank;
      if (end >= sequence.length || !rank || sequence[end].rank !== rank) {
        return { taken: sequence.slice(from, end), next: end };
      }
      let start = end - 1;
      while (start > from && sequence[start - 1].rank === rank) start--;
      let after = end + 1;
      while (after < sequence.length && sequence[after].rank === rank) after++;
      cutoffTies.push({
        cutoff: kind,
        teams: sequence.slice(start, after).map((standing) => ({
          rank: standing.rank,
          team: teamMap.get(standing.teamId)!,
          standing,
        })),
        places: end - start,
      });
      return { taken: sequence.slice(from, start), next: after };
    };
    const breakPart = takeUpTo(0, naturalPlaces, "break");
    const reserveEnd = naturalPlaces + Math.max(0, cat.reserveSize || 0);
    const reservePart = takeUpTo(breakPart.next, reserveEnd, "reserve");

    const naturalBreaking = breakPart.taken;
    const forcedIds = new Set(forced.map((standing) => standing.teamId));
    const breakingSlice = [...forced, ...naturalBreaking].sort(byStandingOrder);
    const breakingIds = new Set(breakingSlice.map((standing) => standing.teamId));
    const reserveSlice = reservePart.taken;
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
        ...(forcedIds.has(team.id) ? { manuallyIncluded: true } : {}),
      };
    });

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

    // Rule-driven exclusions are reported only above the last breaking team.
    const cutoff = breakingSlice.length > 0
      ? Math.max(...breakingSlice.map((standing) => standingIndex.get(standing.teamId) ?? 0))
      : -1;
    const aboveCutoff = (standing: TeamStandingRow) => (standingIndex.get(standing.teamId) ?? 0) < cutoff;
    const selectedIds = new Set([
      ...breakingIds,
      ...reserveSlice.map((standing) => standing.teamId),
      ...cutoffTies.flatMap((tie) => tie.teams.map((entry) => entry.team.id)),
    ]);
    const automaticExclusions = new Map<string, BreakExclusionEntry>();
    const addAutomatic = (standing: TeamStandingRow, reason: BreakExclusionReason) => {
      if (selectedIds.has(standing.teamId) || automaticExclusions.has(standing.teamId) || !aboveCutoff(standing)) return;
      automaticExclusions.set(standing.teamId, {
        rank: standing.rank,
        team: teamMap.get(standing.teamId)!,
        standing,
        reason,
        manual: false,
      });
    };
    brokeElsewhere.forEach((standing) => addAutomatic(standing, "different_break"));
    [...qualification.capped, ...institutionCapped].forEach((standing) => addAutomatic(standing, "capped"));
    const excludedTeams = [...manualExclusions, ...automaticExclusions.values()].sort((left, right) =>
      byStandingOrder(left.standing, right.standing)
    );

    results.push({
      category: cat,
      breakingTeams: breakingEntries,
      reserveTeams: reserveEntries,
      cutoffTies,
      excludedTeams,
    });
  }

  return results;
}

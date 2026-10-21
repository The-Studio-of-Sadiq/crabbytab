import {
  Team,
  TeamStandingRow,
  BreakCategory,
  BreakQualificationRule,
  BreakTeamOverride,
  GeneratedBreak,
  TeamMetricId,
  TournamentFormat,
} from "@/types";
import { resolveTeamPrecedence } from "@/lib/standings/precedence";
import { rankTeamSubset } from "@/lib/standings/subset";

export interface BreakingTeamEntry {
  /** Unique 1-based position in the break; elimination pairing uses it. */
  seed: number;
  /**
   * Break rank as Tabbycat shows it: teams tied on every standings metric share one rank (1, 2, 2,
   * 4). Reserves have none. Elimination positions inside a tie still follow `seed`.
   */
  breakRank?: number;
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
 * breaking place or the last reserve place. Tabbycat 2.12.1 does not resolve such a tie on purpose:
 * its standard generator first appends every tied team to the break, but its reserve step then
 * re-marks the teams beyond the break size as reserves, so in effect the random tiebreak of the
 * standings decides who breaks. CrabbyTab instead holds the whole group out of the break (or
 * reserves) and refuses to generate the break until the director resolves it with overrides:
 * "Manually included" for the teams that go through, or a remark such as "Lost coin toss" for
 * those that do not. No arbitrary order (e.g. by name) decides it.
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
   * Teams that can take a place in this category: forced ("include") teams plus eligible teams
   * that have no exclusion and did not break in a higher-priority category (Tabbycat's
   * `eligible_teams`).
   */
  eligibleCount: number;
  /**
   * Set when fewer teams are eligible than the break size. Tabbycat refuses to generate such a
   * break ("There are too few teams eligible for this break category"); so does CrabbyTab.
   */
  tooFewEligible?: { eligible: number; breakSize: number };
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

type Aida2016Rule = Extract<BreakQualificationRule, "aida_2016_australs" | "aida_2016_easters" | "aida_2019_australs_open">;

/** The AIDA 2016 rules (and 2019 open) that need wins, and so a two-team format. */
const AIDA_2016_RULES: BreakQualificationRule[] = ["aida_2016_australs", "aida_2016_easters", "aida_2019_australs_open"];

/**
 * The institution cap of an AIDA rule. AIDA 2019 Australs (open) raises the base cap of 3 by one
 * for every 8 teams the break exceeds 16 (Tabbycat's Aida2019AustralsBreakGenerator.calculate_cap).
 */
export function aidaInstitutionCap(rule: BreakQualificationRule, breakSize: number): number {
  if (rule !== "aida_2019_australs_open") return 3;
  const additionalTeams = breakSize >= 16 ? breakSize - 16 : 0;
  return 3 + Math.floor(additionalTeams / 8);
}

/**
 * Tabbycat's institution rank (RankFromInstitutionAnnotator): each team's place among the teams of
 * its own institution in the category's standings. It is taken over every team in those standings,
 * including teams that are ineligible, excluded by a remark or broke in another category, and teams
 * tied in the standings share their institution rank (1, 2, 2, 4).
 */
export function institutionRanks(standings: TeamStandingRow[], teamMap: Map<string, Team>): Map<string, number> {
  const byInstitution = new Map<string, { teamId: string; rank: number }[]>();
  standings.forEach((standing, index) => {
    const team = teamMap.get(standing.teamId);
    if (!team) return;
    const key = institutionKey(team);
    const members = byInstitution.get(key) ?? [];
    members.push({ teamId: standing.teamId, rank: standing.rank || index + 1 });
    byInstitution.set(key, members);
  });
  const result = new Map<string, number>();
  for (const members of byInstitution.values()) {
    for (const member of members) {
      result.set(member.teamId, 1 + members.filter((other) => other.rank < member.rank).length);
    }
  }
  return result;
}

function selectAida2016Teams(
  eligible: TeamStandingRow[],
  teamMap: Map<string, Team>,
  breakSize: number,
  rule: Aida2016Rule,
  institutionRankByTeam: Map<string, number>,
  /** The category's full break size, which sets the AIDA 2019 cap (Tabbycat uses break_size). */
  categoryBreakSize: number = breakSize
): QualificationOutcome {
  if (eligible.length <= breakSize || breakSize <= 0) return { ordered: eligible, capped: [] };

  const cap = aidaInstitutionCap(rule, categoryBreakSize);
  const winsOf = (standing: TeamStandingRow) => standing.wins ?? standing.points;
  const minimumWins = winsOf(eligible[breakSize - 1]);
  // Tabbycat drops teams with fewer wins than the nth team from the eligible teams altogether, so
  // they can neither break nor be reserves.
  const winEligible = eligible.filter((standing) => winsOf(standing) >= minimumWins);
  const naturalBreakCutoff = winEligible[breakSize - 1]?.rank ?? eligible[breakSize - 1].rank;
  const ranks = new Map<string, number>();
  eligible.forEach((standing, index) => ranks.set(standing.teamId, standing.rank || index + 1));

  const isCapped = (standing: TeamStandingRow) => {
    const institutionRank = institutionRankByTeam.get(standing.teamId) ?? 1;
    const rank = ranks.get(standing.teamId) ?? standing.rank;
    return (institutionRank > 1 && rank > naturalBreakCutoff) || institutionRank > cap;
  };
  const capped = winEligible.filter((standing) => teamMap.has(standing.teamId) && isCapped(standing));
  const cappedIds = new Set(capped.map((standing) => standing.teamId));
  const selected = winEligible.filter((standing) => !cappedIds.has(standing.teamId));

  if (selected.length < breakSize) {
    const reinsertionPasses = rule === "aida_2016_easters"
      ? [
          capped.filter((standing) => (institutionRankByTeam.get(standing.teamId) ?? 1) <= cap),
          capped,
        ]
      : [capped];

    for (const pass of reinsertionPasses) {
      // Teams tied on every precedence metric (one standings rank) are reinserted together.
      const groups = new Map<string, TeamStandingRow[]>();
      for (const standing of pass) {
        const key = standing.rank ? `rank:${standing.rank}` : tieKey(standing);
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
  // Reserves are the next teams in rank order, among those with enough wins, that the cap would
  // not remove.
  const reserves = winEligible.filter(
    (standing) => !selectedIds.has(standing.teamId) && teamMap.has(standing.teamId) && !isCapped(standing)
  );
  return {
    ordered: [...eligible.filter((standing) => selectedIds.has(standing.teamId)), ...reserves],
    capped: winEligible.filter(
      (standing) => !selectedIds.has(standing.teamId) && teamMap.has(standing.teamId) && isCapped(standing)
    ),
  };
}

function applyQualificationRule(
  eligible: TeamStandingRow[],
  rule: BreakQualificationRule,
  breakSize: number,
  teamMap: Map<string, Team>,
  institutionRankByTeam: Map<string, number>,
  categoryBreakSize: number = breakSize
): QualificationOutcome {
  if (rule === "standard") return { ordered: eligible, capped: [] };
  if (rule === "aida_1996") {
    const ordered: TeamStandingRow[] = [];
    const capped: TeamStandingRow[] = [];
    for (const standing of eligible) {
      if (!teamMap.has(standing.teamId)) continue;
      ((institutionRankByTeam.get(standing.teamId) ?? 1) <= 3 ? ordered : capped).push(standing);
    }
    return { ordered, capped };
  }
  return selectAida2016Teams(eligible, teamMap, breakSize, rule as Aida2016Rule, institutionRankByTeam, categoryBreakSize);
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
 * one category is not considered for lower-priority ones. Categories of equal
 * priority do not exclude each other, so a team may break in several of them
 * (Tabbycat only excludes teams that broke in a strictly higher-priority
 * category, `priority__gt`). Manual overrides on
 * a category exclude a team (any remark) or force it into the break
 * ("include", which also bypasses category eligibility and institution caps
 * but not the one-category rule). Forced teams take break places first; the
 * remaining places are filled by the qualification rule. Seeds follow
 * standings order.
 *
 * Like Tabbycat (`BaseBreakGenerator.set_team_queryset`), a general category ranks every team in
 * the overall standings, while a non-general category ranks only its own teams (eligible teams
 * plus manually included ones) among themselves: ranks restart within the category and
 * who-beat-whom compares the teams tied within it. `teamPrecedence` is the tournament's team
 * standings precedence (defaults to the format's).
 */
export function calculateBreaks(
  categories: BreakCategory[],
  teams: Team[],
  standings: TeamStandingRow[],
  format?: TournamentFormat,
  teamPrecedence: TeamMetricId[] = resolveTeamPrecedence(format ?? "two_team")
): BreakCategoryResult[] {
  if (
    format === "bp" &&
    categories.some((category) => AIDA_2016_RULES.includes(category.qualificationRule as BreakQualificationRule))
  ) {
    throw new Error("AIDA 2016 and 2019 qualification rules require a two-team tournament format.");
  }
  const teamMap = new Map<string, Team>();
  teams.forEach((t) => teamMap.set(t.id, t));

  // Sort categories by priority (highest priority number or rank first)
  const sortedCategories = [...categories].sort((a, b) => (b.priority || 0) - (a.priority || 0));

  // Team id -> the highest priority of a category it broke in so far.
  const brokenPriority = new Map<string, number>();
  const results: BreakCategoryResult[] = [];

  for (const cat of sortedCategories) {
    const brokeInHigherCategory = (teamId: string) =>
      brokenPriority.has(teamId) && (brokenPriority.get(teamId) as number) > (cat.priority || 0);
    const overrides = cat.teamOverrides ?? {};
    const inCategory = (team: Team) => cat.isGeneral || Boolean(team.breakCategories?.includes(cat.id));
    // The category's own standings: everyone for a general category, otherwise the category's
    // teams ranked among themselves.
    const categoryStandings = cat.isGeneral
      ? standings
      : rankTeamSubset(
          standings.filter((standing) => {
            const team = teamMap.get(standing.teamId);
            return Boolean(team && (inCategory(team) || overrides[team.id] === "include"));
          }),
          teamPrecedence
        );
    const standingIndex = new Map(categoryStandings.map((standing, index) => [standing.teamId, index]));
    const byStandingOrder = (left: TeamStandingRow, right: TeamStandingRow) =>
      (standingIndex.get(left.teamId) ?? 0) - (standingIndex.get(right.teamId) ?? 0);
    const forced: TeamStandingRow[] = [];
    const natural: TeamStandingRow[] = [];
    const manualExclusions: BreakExclusionEntry[] = [];
    const brokeElsewhere: TeamStandingRow[] = [];

    for (const standing of categoryStandings) {
      const team = teamMap.get(standing.teamId);
      if (!team) continue;
      const override = overrides[team.id];
      if (brokeInHigherCategory(team.id)) {
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
    const qualification = applyQualificationRule(
      natural,
      qualificationRule,
      naturalPlaces,
      teamMap,
      institutionRanks(categoryStandings, teamMap),
      cat.breakSize
    );
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
      brokenPriority.set(team.id, Math.max(brokenPriority.get(team.id) ?? -Infinity, cat.priority || 0));
      const firstTied = breakingSlice.findIndex((other) => other.rank === st.rank);
      return {
        seed: idx + 1,
        breakRank: (st.rank && firstTied >= 0 ? firstTied : idx) + 1,
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

    const eligibleCount = forced.length + natural.length;
    results.push({
      category: cat,
      breakingTeams: breakingEntries,
      reserveTeams: reserveEntries,
      cutoffTies,
      eligibleCount,
      ...(eligibleCount < cat.breakSize ? { tooFewEligible: { eligible: eligibleCount, breakSize: cat.breakSize } } : {}),
      excludedTeams,
    });
  }

  return results;
}

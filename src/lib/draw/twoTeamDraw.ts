import type { ConflictAvoidance, OddBracketMethod, PairingMethod, PullupRestriction, Team, TeamStandingRow } from "@/types";
import type { MatchupHistory } from "./powerPaired";
import { allocateSidesForDebate } from "./sideAllocator";
import { RankedTeamStats, WinBracket, resolveOddBrackets } from "./oddBrackets";
import { pairTeams, shuffle } from "./pairing";
import { ClashPenalties, DEFAULT_CLASH_PENALTIES, avoidConflicts } from "./conflictAvoidance";
import { PairedDebateDraft } from "./powerPaired";

export interface TwoTeamDrawConfig {
  pairingMethod: PairingMethod;
  oddBracketMethod: OddBracketMethod;
  conflictAvoidance: ConflictAvoidance;
  pullupRestriction: PullupRestriction;
  penalties: ClashPenalties;
  sideRule: "balanced" | "random";
  sideBalancePenalty?: number;
  pairingDeviationPenalty?: number;
  maxTimesPerSide?: number;
  maxAllowedSideImbalance?: number;
  pullupPenalty?: number;
  previouslySawPullupPenalty?: number;
  avoidSameInstitution?: boolean;
  avoidTeamHistory?: boolean;
}

export const DEFAULT_TWO_TEAM_DRAW_CONFIG: TwoTeamDrawConfig = {
  pairingMethod: "fold",
  oddBracketMethod: "pullup_top",
  conflictAvoidance: "one_up_one_down",
  pullupRestriction: "none",
  penalties: DEFAULT_CLASH_PENALTIES,
  sideRule: "balanced",
};

/**
 * Two-team power-paired draw generator (C2): groups teams by wins, resolves
 * odd brackets per `oddBracketMethod` (narrowed first by `pullupRestriction`),
 * pairs each resulting group per `pairingMethod`, then applies the selected
 * conflict strategy. One-up-one-down may change opponents; min_cost preserves them.
 *
 * Order of operations matches the spec exactly: raw brackets -> resolve odd
 * brackets -> pair within brackets -> avoid conflicts -> allocate sides.
 */
export function generateTwoTeamDraw(
  teams: Team[],
  standings: TeamStandingRow[],
  history: MatchupHistory,
  format: string,
  config: Partial<TwoTeamDrawConfig> = {}
): PairedDebateDraft[] {
  if (teams.length % 2 !== 0) {
    throw new Error(`Number of teams (${teams.length}) must be even for a two-team draw.`);
  }
  // Spreading `config` directly would let an explicit `undefined` field (e.g.
  // passed straight from optional tournament preferences) clobber its default.
  const cfg: TwoTeamDrawConfig = {
    pairingMethod: config.pairingMethod ?? DEFAULT_TWO_TEAM_DRAW_CONFIG.pairingMethod,
    oddBracketMethod: config.oddBracketMethod ?? DEFAULT_TWO_TEAM_DRAW_CONFIG.oddBracketMethod,
    conflictAvoidance: config.conflictAvoidance ?? DEFAULT_TWO_TEAM_DRAW_CONFIG.conflictAvoidance,
    pullupRestriction: config.pullupRestriction ?? DEFAULT_TWO_TEAM_DRAW_CONFIG.pullupRestriction,
    penalties: config.penalties ?? DEFAULT_TWO_TEAM_DRAW_CONFIG.penalties,
    sideRule: config.sideRule ?? DEFAULT_TWO_TEAM_DRAW_CONFIG.sideRule,
    sideBalancePenalty: config.sideBalancePenalty,
    pairingDeviationPenalty: config.pairingDeviationPenalty,
    maxTimesPerSide: config.maxTimesPerSide,
    maxAllowedSideImbalance: config.maxAllowedSideImbalance,
    pullupPenalty: config.pullupPenalty,
    previouslySawPullupPenalty: config.previouslySawPullupPenalty,
    avoidSameInstitution: config.avoidSameInstitution,
    avoidTeamHistory: config.avoidTeamHistory,
  };

  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const standingMap = new Map(standings.map((s) => [s.teamId, s]));

  // Rank order: standings first (already best-first); unranked teams shuffled to the bottom.
  const ranked = standings.filter((s) => teamMap.has(s.teamId)).map((s) => teamMap.get(s.teamId)!);
  const rankedIds = new Set(ranked.map((t) => t.id));
  const unranked = shuffle(teams.filter((t) => !rankedIds.has(t.id)));
  const ordered = [...ranked, ...unranked];

  const statsFor = (team: Team): RankedTeamStats => {
    const m = standingMap.get(team.id)?.metrics;
    return {
      team,
      pullups: m?.pullups ?? 0,
      drawStrengthWins: m?.draw_strength_wins ?? 0,
      drawStrengthSpeaks: m?.draw_strength_speaks ?? 0,
    };
  };

  // Group into win-brackets, highest first, keeping rank order inside each.
  const byWins = new Map<number, RankedTeamStats[]>();
  for (const team of ordered) {
    const wins = standingMap.get(team.id)?.metrics?.wins ?? 0;
    if (!byWins.has(wins)) byWins.set(wins, []);
    byWins.get(wins)!.push(statsFor(team));
  }
  const brackets: WinBracket[] = Array.from(byWins.keys())
    .sort((a, b) => b - a)
    .map((wins) => ({ wins, teams: byWins.get(wins)! }));

  const groups = resolveOddBrackets(brackets, cfg.oddBracketMethod, cfg.pullupRestriction);

  const drafts: PairedDebateDraft[] = [];
  for (const group of groups) {
    if (group.teams.length < 2) {
      // A leftover team with nobody to pull up from anywhere (only possible at
      // the very bottom of the tournament with intermediate methods).
      continue;
    }
    const rawRooms = pairTeams(group.teams, cfg.pairingMethod);
    const rooms = avoidConflicts(rawRooms, history, cfg.conflictAvoidance, cfg.penalties);
    const pulledUpSet = new Set(group.pulledUp);

    for (const room of rooms) {
      drafts.push({
        bracket: group.bracket,
        teams: room,
        teamsWithSides: allocateSidesForDebate(room, history.sides, format, cfg.sideRule, cfg),
      });
    }
    void pulledUpSet; // flags/pulledUp surfacing on the Debate itself is C3's concern
  }

  return drafts;
}

import { teamInstitutionIds } from "@/lib/compositeTeams";
import type {
  Adjudicator,
  Debate,
  Team,
  BreakCategory,
  TeamStandingRow,
  FeedbackSubmission,
  TournamentPreferences,
  AdjudicatorPanelStrategy,
  PanelSizingMode,
  PreformedPanel,
  PreformedPanelPlacement,
} from "@/types";
import { solveHungarian } from "./hungarian";
import {
  AdjudicatorAllocationError,
  allocateTabbycatHungarian,
  NO_AVAILABLE_ADJUDICATORS_MESSAGE,
  NO_VOTING_ADJUDICATORS_MESSAGE,
  type TabbycatHungarianMode,
} from "./tabbycatHungarian";
import { clampDebateImportance, tabbycatImportanceLevel } from "./importance";
import { isAvailableForRound } from "@/lib/roundAvailability";
import { blendAdjudicatorScore, isFeedbackCountedForScore } from "@/lib/feedback/scores";

// ─── Types & Interfaces ──────────────────────────────────────────────

export interface AllocationOptions {
  /** Fixed mode: voting panel size for every debate. By-priority mode: the largest panel size. */
  panelSize: number;
  /** Defaults to "fixed". */
  panelSizing?: PanelSizingMode;
  /** Whether to include panel-average balance in the strength-matching objective. */
  balancePanels: boolean;
  /** Defaults to the original CrabbyTab slot-ranking behavior for old tournaments. */
  panelStrengthStrategy?: AdjudicatorPanelStrategy;
  respectInstitutionConflicts: boolean;
  respectPersonalConflicts: boolean;
  respectHistoryConflicts: boolean;
  preferences?: Partial<TournamentPreferences>;
  /** Upper bound on improvement passes of the panel local search. Defaults to 50. */
  maxLocalSearchIterations?: number;
}

export interface AdjudicatorAllocationResult {
  debateId: string;
  chairId?: string;
  chairName?: string;
  panellistIds: string[];
  panellistNames: string[];
  traineeIds: string[];
  traineeNames: string[];
  conflicts: string[];
}

export interface AdjDebateConflictResult {
  penalty: number;
  reasons: string[];
  hasClash: boolean;
  hasInstitutionalClash: boolean;
  hasPersonalClash: boolean;
  hasHistoryClash: boolean;
  /** Conflict with another adjudicator on the same panel. */
  hasAdjudicatorClash: boolean;
}

export interface DebatePriorityInfo {
  debateId: string;
  bracket: number;
  breakLiveness: number;     // 0-1 float: how many teams are "live" for the break
  manualPriority: number;    // user-set override (stored on debate.importance)
  priorityScore: number;     // composite final score (0-10 scale)
}

export interface PanelStrengthInfo {
  adjIds: string[];
  strength: number;          // average score of panel members (0-10)
}

export interface AllocationCostBreakdown {
  priorityStrengthMismatch: number;
  institutionConflict: number;
  personalConflict: number;
  repeatTeamConflict: number;
  repeatPanelConflict: number;
  traineeSuitability: number;
  total: number;
}

// ─── Cost function weights ───────────────────────────────────────────
// Tunable by tournament preferences; higher = more penalty = more avoided in the matching.
// The weights are used as given: conflicts and history are soft penalties traded off
// against strength matching, and any conflict that remains is reported on the result.

export function getAllocationWeights(prefs?: Partial<TournamentPreferences>) {
  const conflictPenalty = prefs?.adjConflictPenalty ?? 1_000_000;
  const historyPenalty = prefs?.adjHistoryPenalty ?? 10_000;
  const mismatchPenalty = prefs?.importanceMismatchPenalty ?? 10_000_000;

  return {
    PRIORITY_STRENGTH_MISMATCH: mismatchPenalty,
    INSTITUTION_CONFLICT: conflictPenalty,
    PERSONAL_CONFLICT: conflictPenalty,
    ADJUDICATOR_CONFLICT: conflictPenalty,
    DECLARED_INSTITUTION_CONFLICT: Math.round(conflictPenalty * 0.8),
    REPEAT_TEAM: historyPenalty,
    REPEAT_PANEL: Math.round(historyPenalty * 0.4),
    TRAINEE_TOP_DEBATE: Math.round(conflictPenalty * 0.3),
    TRAINEE_AS_CHAIR: conflictPenalty * 5,
  };
}

export type AllocationWeights = ReturnType<typeof getAllocationWeights>;

export const WEIGHTS = getAllocationWeights();

/**
 * importanceMismatchPenalty is charged on squared score distance, as a fraction of the
 * full 10-point scale, times this factor. With the default weights a one-point mismatch
 * costs 50,000 (more than one repeat-team history at 10,000) and even a full ten-point
 * mismatch (500,000) costs less than one conflict (1,000,000).
 */
export const STRENGTH_COST_SCALE = 0.05;

export function strengthMismatchCost(scoreDistance: number, weights: AllocationWeights): number {
  const fraction = scoreDistance / 10;
  return weights.PRIORITY_STRENGTH_MISMATCH * STRENGTH_COST_SCALE * fraction * fraction;
}

export { AdjudicatorAllocationError } from "./tabbycatHungarian";

export const DEFAULT_LOCAL_SEARCH_ITERATIONS = 50;
/** Bounds the total move evaluations of one local search, whatever the iteration cap. */
export const LOCAL_SEARCH_EVALUATION_BUDGET = 4_000_000;

// ─── Conflict Detection ─────────────────────────────────────────────

/** True when either adjudicator declared a conflict with the other. */
export function adjudicatorsConflict(first: Adjudicator, second: Adjudicator): boolean {
  if (first.id === second.id) return false;
  return (
    (first.conflicts ?? []).some((conflict) => conflict.adjudicatorId === second.id) ||
    (second.conflicts ?? []).some((conflict) => conflict.adjudicatorId === first.id)
  );
}

function institutionNameKey(name: string | undefined): string | undefined {
  const trimmed = name?.trim().toLowerCase();
  return trimmed ? `name:${trimmed}` : undefined;
}

/**
 * Tabbycat's adjudicator–institution conflicts (AdjudicatorInstitutionConflict): the adjudicator's
 * own institution, which CrabbyTab always treats as conflicted unless the adjudicator is
 * independent (Tabbycat's importer adds that conflict by default), and every institution the
 * adjudicator declared a conflict with. Institutions are keyed by id, plus by name for the own
 * institution and for legacy records that name the institution instead of giving its id.
 */
export function adjudicatorConflictInstitutions(adj: Adjudicator): Set<string> {
  const keys = new Set<string>();
  if (!adj.independent) {
    if (adj.institutionId) keys.add(adj.institutionId);
    const own = institutionNameKey(adj.institutionName);
    if (own) keys.add(own);
  }
  for (const conflict of adj.conflicts ?? []) {
    if (!conflict.institutionId) continue;
    keys.add(conflict.institutionId);
    keys.add(institutionNameKey(conflict.institutionId)!);
  }
  return keys;
}

/** Tabbycat's team–institution conflicts: the team's own institution(s) and those it declared. */
export function teamConflictInstitutions(team: Team): Set<string> {
  const keys = new Set<string>(teamInstitutionIds(team));
  for (const id of team.institutionConflictIds ?? []) keys.add(id);
  const own = institutionNameKey(team.institutionName);
  if (own) keys.add(own);
  return keys;
}

function intersects(first: Set<string>, second: Set<string>): boolean {
  const [small, large] = first.size <= second.size ? [first, second] : [second, first];
  for (const key of small) if (large.has(key)) return true;
  return false;
}

/** Two adjudicators share a conflicted institution (Tabbycat institutional_conflict_adj_adj). */
export function adjudicatorsShareInstitution(first: Adjudicator, second: Adjudicator): boolean {
  if (first.id === second.id) return false;
  return intersects(adjudicatorConflictInstitutions(first), adjudicatorConflictInstitutions(second));
}

/** Tabbycat conflict_adj_team: a personal conflict, or an institution both conflict with. */
export function tabbycatAdjTeamConflict(adj: Adjudicator, team: Team): boolean {
  return (
    (adj.conflicts ?? []).some((conflict) => conflict.teamId === team.id) ||
    intersects(adjudicatorConflictInstitutions(adj), teamConflictInstitutions(team))
  );
}

/** Tabbycat conflict_adj_adj: a personal conflict (declared by either), or a shared institution. */
export function tabbycatAdjAdjConflict(first: Adjudicator, second: Adjudicator): boolean {
  return adjudicatorsConflict(first, second) || adjudicatorsShareInstitution(first, second);
}

/** A conflict between two panel members, honouring the respect flags. */
function panelPairConflicts(first: Adjudicator, second: Adjudicator, options: AllocationOptions): boolean {
  return (
    (options.respectPersonalConflicts && adjudicatorsConflict(first, second)) ||
    (options.respectInstitutionConflicts && adjudicatorsShareInstitution(first, second))
  );
}

function sharesInstitution(adj: Adjudicator, team: Team): boolean {
  if (adj.independent) return false;
  // A composite team's other institutions count as its own (lib/compositeTeams.ts).
  if (team.isComposite && adj.institutionId && teamInstitutionIds(team).includes(adj.institutionId)) return true;
  if (adj.institutionId && team.institutionId) return adj.institutionId === team.institutionId;
  return Boolean(
    adj.institutionName &&
      team.institutionName &&
      adj.institutionName.trim().toLowerCase() === team.institutionName.trim().toLowerCase()
  );
}

function declaredInstitutionMatches(institutionId: string, team: Team): boolean {
  return Boolean(
    (team.institutionId && institutionId === team.institutionId) ||
      (team.institutionName && institutionId.toLowerCase() === team.institutionName.toLowerCase())
  );
}

/** The team declared a conflict with the adjudicator's institution (Tabbycat's team–institution conflict). */
function teamDeclaresInstitution(adj: Adjudicator, team: Team): boolean {
  return Boolean(adj.institutionId && team.institutionConflictIds?.includes(adj.institutionId)) && !sharesInstitution(adj, team);
}

/**
 * Calculates conflict penalty between an adjudicator and a debate's teams/institutions,
 * and (when given) the other adjudicators on the same panel.
 */
export function calculateAdjDebateConflict(
  adj: Adjudicator,
  debateTeams: Team[],
  pastAdjudicatorTeams: Map<string, Set<string>> = new Map(), // adjId -> Set of teamIds
  customWeights?: AllocationWeights,
  otherPanelAdjudicators: Adjudicator[] = []
): AdjDebateConflictResult {
  const weights = customWeights || WEIGHTS;
  let penalty = 0;
  const reasons: string[] = [];
  let hasInstitutionalClash = false;
  let hasPersonalClash = false;
  let hasHistoryClash = false;
  let hasAdjudicatorClash = false;

  for (const team of debateTeams) {
    if (!team) continue;

    // 1. Direct Institutional Conflict (unless judge is explicitly marked independent with no institution)
    if (sharesInstitution(adj, team)) {
      penalty += weights.INSTITUTION_CONFLICT;
      hasInstitutionalClash = true;
      reasons.push(`Institutional clash with ${team.name} (${team.institutionName || "Same Institution"})`);
    }

    // 2. Declared conflicts (personal, institutional, etc.)
    for (const conflict of adj.conflicts ?? []) {
      if (conflict.teamId && conflict.teamId === team.id) {
        penalty += weights.PERSONAL_CONFLICT;
        hasPersonalClash = true;
        reasons.push(`Personal clash with team "${team.name}"`);
      }
      if (
        conflict.institutionId &&
        declaredInstitutionMatches(conflict.institutionId, team) &&
        !sharesInstitution(adj, team)
      ) {
        penalty += weights.DECLARED_INSTITUTION_CONFLICT;
        hasInstitutionalClash = true;
        reasons.push(`Declared institutional clash with ${team.name}`);
      }
    }

    if (teamDeclaresInstitution(adj, team)) {
      penalty += weights.DECLARED_INSTITUTION_CONFLICT;
      hasInstitutionalClash = true;
      reasons.push(`${team.name} declared a clash with ${adj.institutionName || "the adjudicator's institution"}`);
    }

    // 3. Past debate history clash (adjudicated this team in earlier rounds)
    const judgedTeams = pastAdjudicatorTeams.get(adj.id);
    if (judgedTeams && judgedTeams.has(team.id)) {
      penalty += weights.REPEAT_TEAM;
      hasHistoryClash = true;
      reasons.push(`Previously judged ${team.name}`);
    }
  }

  // 4. Adjudicator-adjudicator conflicts on the same panel: personal, or a shared institution
  //    (Tabbycat conflict_adj_adj, shown there as a conflict "via institution").
  for (const other of otherPanelAdjudicators) {
    if (adjudicatorsConflict(adj, other)) {
      penalty += weights.ADJUDICATOR_CONFLICT;
      hasAdjudicatorClash = true;
      reasons.push(`Personal clash with adjudicator "${other.name}"`);
    } else if (adjudicatorsShareInstitution(adj, other)) {
      penalty += weights.ADJUDICATOR_CONFLICT;
      hasAdjudicatorClash = true;
      reasons.push(`Institutional clash with adjudicator "${other.name}"`);
    }
  }

  return {
    penalty,
    reasons,
    hasClash: reasons.length > 0,
    hasInstitutionalClash,
    hasPersonalClash,
    hasHistoryClash,
    hasAdjudicatorClash,
  };
}

interface TeamConflictCosts {
  institution: number;
  personal: number;
  history: number;
}

/** Team-facing conflict costs for one adjudicator in one debate, honouring the respect flags. */
function teamConflictCosts(
  adj: Adjudicator,
  debateTeams: Team[],
  pastAdjTeams: Map<string, Set<string>>,
  options: AllocationOptions,
  weights: AllocationWeights
): TeamConflictCosts {
  const costs: TeamConflictCosts = { institution: 0, personal: 0, history: 0 };
  for (const team of debateTeams) {
    if (options.respectInstitutionConflicts && sharesInstitution(adj, team)) {
      costs.institution += weights.INSTITUTION_CONFLICT;
    }
    for (const conflict of adj.conflicts ?? []) {
      if (options.respectPersonalConflicts && conflict.teamId && conflict.teamId === team.id) {
        costs.personal += weights.PERSONAL_CONFLICT;
      }
      if (
        options.respectInstitutionConflicts &&
        conflict.institutionId &&
        declaredInstitutionMatches(conflict.institutionId, team) &&
        !sharesInstitution(adj, team)
      ) {
        costs.institution += weights.DECLARED_INSTITUTION_CONFLICT;
      }
    }
    if (options.respectInstitutionConflicts && teamDeclaresInstitution(adj, team)) {
      costs.institution += weights.DECLARED_INSTITUTION_CONFLICT;
    }
    if (options.respectHistoryConflicts && pastAdjTeams.get(adj.id)?.has(team.id)) {
      costs.history += weights.REPEAT_TEAM;
    }
  }
  return costs;
}

function adjudicatorPairCost(
  first: Adjudicator,
  second: Adjudicator,
  pastPanelHistory: Map<string, number>,
  options: AllocationOptions,
  weights: AllocationWeights
): number {
  let cost = 0;
  if (panelPairConflicts(first, second, options)) {
    cost += weights.ADJUDICATOR_CONFLICT;
  }
  const key = [first.id, second.id].sort().join(":");
  cost += (pastPanelHistory.get(key) ?? 0) * weights.REPEAT_PANEL;
  return cost;
}

/**
 * adjudicatorPairCost for every pair of voters that can cost anything (a declared conflict or a
 * past panel together), indexed by position in `voters`; every other pair costs exactly 0. Past
 * panels are counted exactly as buildPastPanelHistory counts them.
 */
function votingPairCosts(
  voters: Adjudicator[],
  pastDebates: Debate[],
  options: AllocationOptions,
  weights: AllocationWeights
): Array<Map<number, number> | undefined> {
  const indexById = new Map(voters.map((voter, index) => [voter.id, index]));
  const history = new Map<string, number>();
  const candidates: Array<Set<number> | undefined> = voters.map(() => undefined);
  const link = (a: number, b: number) => {
    if (a === b) return;
    (candidates[a] ??= new Set()).add(b);
    (candidates[b] ??= new Set()).add(a);
  };

  voters.forEach((voter, index) => {
    for (const conflict of voter.conflicts ?? []) {
      const other = conflict.adjudicatorId ? indexById.get(conflict.adjudicatorId) : undefined;
      if (other !== undefined) link(index, other);
    }
  });
  if (options.respectInstitutionConflicts) {
    // Voters who share a conflicted institution conflict with each other.
    const byInstitution = new Map<string, number[]>();
    voters.forEach((voter, index) => {
      for (const key of adjudicatorConflictInstitutions(voter)) {
        const members = byInstitution.get(key);
        if (members) members.push(index);
        else byInstitution.set(key, [index]);
      }
    });
    for (const members of byInstitution.values()) {
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) link(members[i], members[j]);
      }
    }
  }
  if (weights.REPEAT_PANEL !== 0) {
    for (const debate of pastDebates) {
      if (debate.postponed || !debate.adjudicators) continue;
      const panel = [
        ...(debate.adjudicators.chairId ? [debate.adjudicators.chairId] : []),
        ...(debate.adjudicators.panellistIds || []),
      ];
      for (let i = 0; i < panel.length; i++) {
        for (let j = i + 1; j < panel.length; j++) {
          const a = indexById.get(panel[i]);
          const b = indexById.get(panel[j]);
          if (a === undefined || b === undefined) continue;
          const key = [panel[i], panel[j]].sort().join(":");
          history.set(key, (history.get(key) || 0) + 1);
          link(a, b);
        }
      }
    }
  }

  return candidates.map((partners, index) => {
    if (!partners) return undefined;
    const costs = new Map<number, number>();
    for (const partner of partners) {
      costs.set(partner, adjudicatorPairCost(voters[index], voters[partner], history, options, weights));
    }
    return costs;
  });
}

// ─── Break Liveness ─────────────────────────────────────────────────

/**
 * Computes "break liveness" for each team: a value between 0 and 1 indicating
 * how likely a team is still in contention for the break.
 *
 * A team is "live" (1.0) if it could theoretically still break, and "dead" (0.0)
 * if it has no mathematical chance. We estimate using distance from the break
 * threshold in terms of remaining possible points.
 *
 * If no standings are provided or there are no break categories, all teams get 0.5.
 */
export function computeBreakLiveness(
  teams: Team[],
  standings: TeamStandingRow[],
  breakCategories: BreakCategory[],
  completedRounds: number,
  totalPrelimRounds: number,
  isBP: boolean
): Map<string, number> {
  const liveness = new Map<string, number>();

  if (standings.length === 0 || breakCategories.length === 0 || completedRounds === 0) {
    // Before any results, every team is equally live
    teams.forEach((t) => liveness.set(t.id, 0.5));
    return liveness;
  }

  const remainingRounds = Math.max(0, totalPrelimRounds - completedRounds);
  // Maximum points a team can still earn
  const maxRemainingPoints = isBP ? remainingRounds * 3 : remainingRounds;

  // Find the overall break threshold: the points of the team at the breakSize position
  const generalBreak = breakCategories.find((bc) => bc.isGeneral);
  const breakSize = generalBreak ? generalBreak.breakSize : Math.min(8, Math.floor(teams.length / 2));

  const standingsByRank = [...standings].sort((a, b) => a.rank - b.rank);
  const breakThresholdPoints = breakSize < standingsByRank.length
    ? standingsByRank[breakSize - 1].points
    : 0;

  for (const team of teams) {
    const standing = standings.find((s) => s.teamId === team.id);
    if (!standing) {
      liveness.set(team.id, 0.5);
      continue;
    }

    const currentPoints = standing.points;
    const bestPossible = currentPoints + maxRemainingPoints;

    if (remainingRounds === 0) {
      // After all rounds, liveness is binary: breaking or not
      liveness.set(team.id, standing.rank <= breakSize ? 1.0 : 0.0);
    } else if (bestPossible < breakThresholdPoints) {
      // Mathematically eliminated
      liveness.set(team.id, 0.0);
    } else if (currentPoints >= breakThresholdPoints) {
      // Currently in break territory
      const buffer = currentPoints - breakThresholdPoints;
      const normalizedBuffer = Math.min(buffer / Math.max(1, maxRemainingPoints), 1);
      liveness.set(team.id, 0.7 + 0.3 * normalizedBuffer);
    } else {
      // Behind but still possible
      const deficit = breakThresholdPoints - currentPoints;
      const catchUpRatio = 1 - deficit / Math.max(1, maxRemainingPoints);
      liveness.set(team.id, Math.max(0.05, Math.min(0.7, catchUpRatio)));
    }
  }

  return liveness;
}

// ─── Debate Priority Scoring ────────────────────────────────────────

/**
 * Calculates a composite priority score for each debate in a round.
 *
 * Priority = weighted combination of:
 *   - Bracket position (higher bracket → more important)
 *   - Break liveness (debates where teams still contending → more important)
 *   - Manual importance override (user can bump debates up/down)
 *
 * Returns a score on a 0-10 scale.
 */
export function calculateDebatePriorities(
  debates: Debate[],
  teamsMap: Map<string, Team>,
  breakLiveness: Map<string, number>
): DebatePriorityInfo[] {
  if (debates.length === 0) return [];

  // Find bracket range for normalization
  const brackets = debates.map((d) => d.bracket || 0);
  const maxBracket = Math.max(...brackets, 1);
  const minBracket = Math.min(...brackets, 0);
  const bracketRange = Math.max(maxBracket - minBracket, 1);

  return debates.map((debate) => {
    // 1. Bracket component (0-10 normalized)
    const bracketNorm = ((debate.bracket || 0) - minBracket) / bracketRange * 10;

    // 2. Break liveness component: average liveness of teams in this debate (0-10)
    const debateTeamIds = Object.values(debate.teams || {}).map((t) => t?.teamId).filter(Boolean) as string[];
    const teamLivenesses = debateTeamIds.map((tid) => breakLiveness.get(tid) ?? 0.5);
    const avgLiveness = teamLivenesses.length > 0
      ? teamLivenesses.reduce((s, v) => s + v, 0) / teamLivenesses.length
      : 0.5;
    const livenessComponent = avgLiveness * 10;

    // 3. Manual priority component (debate.importance, 0-10 scale, default 0)
    const manualPriority = clampDebateImportance(debate.importance);

    // Composite: bracket (40%), liveness (40%), manual (20%)
    const priorityScore = bracketNorm * 0.4 + livenessComponent * 0.4 + manualPriority * 0.2;

    return {
      debateId: debate.id,
      bracket: debate.bracket || 0,
      breakLiveness: avgLiveness,
      manualPriority,
      priorityScore: Math.round(priorityScore * 100) / 100,
    };
  });
}


// ─── Panel Strength ─────────────────────────────────────────────────

/**
 * Effective adjudicator score: the test score (or base score) blended with the
 * feedback average using the round's feedback weight. `feedbackScores` must already
 * be on the adjudicator score scale (see calculateScaledFeedbackScores).
 */
export function effectiveAdjScore(
  adj: Adjudicator,
  feedbackScores?: Map<string, number>, // adjId -> feedback average
  feedbackWeight?: number
): number {
  return blendAdjudicatorScore(adj, feedbackScores?.get(adj.id), feedbackWeight);
}

export function isFeedbackEligibleForRating(submission: FeedbackSubmission): boolean {
  return submission.confirmed && !submission.ignored && Number.isFinite(submission.score);
}

/** Unweighted raw feedback average per adjudicator (confirmed, not ignored). */
export function calculateAdjudicatorFeedbackScores(
  submissions: FeedbackSubmission[]
): Map<string, number> {
  const totals = new Map<string, { total: number; count: number }>();
  for (const submission of submissions) {
    if (!isFeedbackCountedForScore(submission)) continue;

    const current = totals.get(submission.targetAdjudicatorId!) ?? { total: 0, count: 0 };
    current.total += submission.score;
    current.count += 1;
    totals.set(submission.targetAdjudicatorId!, current);
  }

  return new Map(
    [...totals].map(([adjudicatorId, { total, count }]) => [adjudicatorId, total / count])
  );
}

// ─── Past Panel History ─────────────────────────────────────────────

/**
 * Builds a map of which adjudicators have been on the same panel together.
 * Key: "adjId1:adjId2" (sorted), Value: count of co-panellings.
 */
export function buildPastPanelHistory(
  allDebates: Debate[]
): Map<string, number> {
  const history = new Map<string, number>();

  for (const debate of allDebates) {
    if (debate.postponed) continue;
    const adjs = debate.adjudicators;
    if (!adjs) continue;

    const panelAdjIds: string[] = [];
    if (adjs.chairId) panelAdjIds.push(adjs.chairId);
    panelAdjIds.push(...(adjs.panellistIds || []));
    // Trainees are intentionally excluded from panel repeat tracking

    // Record all pairs
    for (let i = 0; i < panelAdjIds.length; i++) {
      for (let j = i + 1; j < panelAdjIds.length; j++) {
        const key = [panelAdjIds[i], panelAdjIds[j]].sort().join(":");
        history.set(key, (history.get(key) || 0) + 1);
      }
    }
  }

  return history;
}

/**
 * Builds a map of adjId -> Set<teamId> for all teams an adjudicator has judged.
 */
export function buildPastAdjTeams(
  allDebates: Debate[]
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();

  for (const debate of allDebates) {
    if (debate.postponed) continue;
    const adjs = debate.adjudicators;
    if (!adjs) continue;

    const teamIds = Object.values(debate.teams || {})
      .map((slot) => slot?.teamId)
      .filter(Boolean) as string[];

    const adjIds: string[] = [];
    if (adjs.chairId) adjIds.push(adjs.chairId);
    adjIds.push(...(adjs.panellistIds || []));
    adjIds.push(...(adjs.traineeIds || []));

    for (const adjId of adjIds) {
      if (!map.has(adjId)) map.set(adjId, new Set());
      const set = map.get(adjId)!;
      for (const tid of teamIds) set.add(tid);
    }
  }

  return map;
}


// ─── Multi-factor Cost Function ─────────────────────────────────────

/**
 * Computes the total cost of assigning an adjudicator to a debate,
 * considering all factors in the cost function.
 */
export function computeAssignmentCost(
  adj: Adjudicator,
  debate: Debate,
  debateTeams: Team[],
  debatePriority: number,       // 0-10 composite score
  adjEffectiveScore: number,    // 0-10 effective adj score
  pastAdjTeams: Map<string, Set<string>>,
  pastPanelHistory: Map<string, number>,
  currentPanelAdjIds: string[], // other adjs already assigned to this debate
  role: "chair" | "panellist" | "trainee",
  options: AllocationOptions,
  strengthTarget: number = debatePriority,
  weightOverrides?: AllocationWeights
): AllocationCostBreakdown {
  const weights = weightOverrides ?? getAllocationWeights(options.preferences);
  const teamCosts = teamConflictCosts(adj, debateTeams, pastAdjTeams, options, weights);
  const priorityStrengthMismatch = strengthMismatchCost(strengthTarget - adjEffectiveScore, weights);

  let repeatPanelConflict = 0;
  for (const otherAdjId of currentPanelAdjIds) {
    const key = [adj.id, otherAdjId].sort().join(":");
    repeatPanelConflict += weights.REPEAT_PANEL * (pastPanelHistory.get(key) || 0);
  }

  let traineeSuitability = 0;
  if (adj.trainee) {
    if (role === "chair") traineeSuitability += weights.TRAINEE_AS_CHAIR;
    // Prefer trainees in lower-priority debates
    if (debatePriority > 7) traineeSuitability += weights.TRAINEE_TOP_DEBATE;
  }

  const total =
    priorityStrengthMismatch +
    teamCosts.institution +
    teamCosts.personal +
    teamCosts.history +
    repeatPanelConflict +
    traineeSuitability;

  return {
    priorityStrengthMismatch,
    institutionConflict: teamCosts.institution,
    personalConflict: teamCosts.personal,
    repeatTeamConflict: teamCosts.history,
    repeatPanelConflict,
    traineeSuitability,
    total,
  };
}

// ─── Panel sizing ───────────────────────────────────────────────────

/**
 * Voting panel size per debate, in the order the debates are given (highest priority first).
 *
 * "fixed": every debate gets maxPanelSize (slots beyond the available voting adjudicators
 * are dropped from the lowest-priority panels first).
 * "by_priority": every debate gets a chair, then panels grow to 3, then 5, ... (odd sizes
 * only, up to maxPanelSize) in priority order while voting adjudicators remain.
 */
export function planPanelSizes(
  debateCount: number,
  votingCount: number,
  maxPanelSize: number,
  mode: PanelSizingMode = "fixed"
): number[] {
  const maxSize = Math.max(1, Math.floor(maxPanelSize));
  if (mode === "fixed") return Array.from({ length: debateCount }, () => maxSize);

  const sizes = Array.from({ length: debateCount }, () => 1);
  let remaining = votingCount - debateCount;
  for (let target = 3; target <= maxSize; target += 2) {
    for (let index = 0; index < debateCount && remaining >= 2; index++) {
      if (sizes[index] === target - 2) {
        sizes[index] = target;
        remaining -= 2;
      }
    }
  }
  return sizes;
}

// ─── Bounded local search ───────────────────────────────────────────

export interface PanelSearchProblem {
  /** slotCost[slot][candidate]: separable cost of seating a candidate in a slot. */
  slotCost: number[][];
  groupOfSlot: number[];
  slotsByGroup: number[][];
  /**
   * Non-separable cost of a group's members (pairwise penalties, panel balance). `members` may be
   * a reused buffer: read it, do not keep it.
   */
  groupCost(group: number, members: number[]): number;
  /**
   * Promise that groupCost never returns a negative number. The search then skips moves whose
   * cost cannot beat the best move found so far without computing their group costs; the result
   * is exactly the same (see improvePanelAssignment).
   */
  nonNegativeGroupCosts?: boolean;
}

export interface PanelSearchResult {
  assignment: number[];
  cost: number;
  iterations: number;
  /** True when the iteration cap or evaluation budget ended the search. */
  stoppedEarly: boolean;
}

/**
 * Best-improvement local search over single replacements and swaps. Each pass evaluates
 * every (slot, candidate) move using only the costs that move changes. Passes are capped
 * so large tournaments stay responsive; the result is a local optimum only when the
 * search was not stopped early.
 *
 * Speed (wave 4): with `nonNegativeGroupCosts`, a move's group-cost change is at least minus the
 * current costs of the groups it touches, so its delta is at least
 * `slotDelta - groupCost(first) - groupCost(second)`. IEEE rounding is monotone, so that bound
 * computed in floating point is also a lower bound of the delta as the search computes it; when
 * the bound cannot beat the best delta so far the move is counted (for the evaluation budget) but
 * its group costs are not computed. The moves chosen, and so the result, are identical.
 */
export function improvePanelAssignment(
  problem: PanelSearchProblem,
  initial: number[],
  maxIterations: number = DEFAULT_LOCAL_SEARCH_ITERATIONS,
  evaluationBudget: number = LOCAL_SEARCH_EVALUATION_BUDGET
): PanelSearchResult {
  const assignment = [...initial];
  const candidateCount = problem.slotCost[0]?.length ?? 0;
  const slotOfCandidate = new Array<number>(candidateCount).fill(-1);
  assignment.forEach((candidate, slot) => {
    if (candidate >= 0) slotOfCandidate[candidate] = slot;
  });
  const memberBuffer: number[] = [];
  const membersOf = (group: number) => {
    memberBuffer.length = 0;
    for (const slot of problem.slotsByGroup[group]) {
      const candidate = assignment[slot];
      if (candidate >= 0) memberBuffer.push(candidate);
    }
    return memberBuffer;
  };
  const slotCost = problem.slotCost;
  const slotPart = (slot: number, candidate: number) =>
    candidate >= 0 ? slotCost[slot][candidate] : 0;
  const groupOfSlot = problem.groupOfSlot;
  const prune = problem.nonNegativeGroupCosts === true;
  const groupCosts = problem.slotsByGroup.map((_, group) => problem.groupCost(group, membersOf(group)));

  let cost =
    assignment.reduce((sum, candidate, slot) => sum + slotPart(slot, candidate), 0) +
    groupCosts.reduce((sum, value) => sum + value, 0);
  let iterations = 0;
  let evaluations = 0;
  let stoppedEarly = false;

  while (!stoppedEarly) {
    if (iterations >= maxIterations) {
      stoppedEarly = true;
      break;
    }
    iterations++;

    let bestDelta = -1e-9;
    let bestMove: { slot: number; candidate: number; groupCosts: Array<[number, number]> } | undefined;

    for (let slot = 0; slot < assignment.length && !stoppedEarly; slot++) {
      const current = assignment[slot];
      const row = slotCost[slot];
      const currentPart = current >= 0 ? row[current] : 0;
      const firstGroup = groupOfSlot[slot];
      for (let candidate = 0; candidate < candidateCount; candidate++) {
        if (candidate === current) continue;
        if (++evaluations > evaluationBudget) {
          stoppedEarly = true;
          break;
        }
        const otherSlot = slotOfCandidate[candidate];
        let delta = row[candidate] - currentPart;
        if (otherSlot >= 0) delta += slotPart(otherSlot, current) - slotCost[otherSlot][candidate];

        const secondGroup = otherSlot >= 0 ? groupOfSlot[otherSlot] : -1;
        if (secondGroup !== firstGroup) {
          if (prune) {
            let bound = delta - groupCosts[firstGroup];
            if (secondGroup >= 0) bound -= groupCosts[secondGroup];
            if (bound >= bestDelta) continue;
          }
          const changedGroups: Array<[number, number]> = [];
          assignment[slot] = candidate;
          if (otherSlot >= 0) assignment[otherSlot] = current;
          let updated = problem.groupCost(firstGroup, membersOf(firstGroup));
          delta += updated - groupCosts[firstGroup];
          changedGroups.push([firstGroup, updated]);
          if (secondGroup >= 0) {
            updated = problem.groupCost(secondGroup, membersOf(secondGroup));
            delta += updated - groupCosts[secondGroup];
            changedGroups.push([secondGroup, updated]);
          }
          assignment[slot] = current;
          if (otherSlot >= 0) assignment[otherSlot] = candidate;
          if (delta < bestDelta) {
            bestDelta = delta;
            bestMove = { slot, candidate, groupCosts: changedGroups };
          }
        } else if (delta < bestDelta) {
          bestDelta = delta;
          bestMove = { slot, candidate, groupCosts: [] };
        }
      }
    }

    if (!bestMove) break;
    const { slot, candidate } = bestMove;
    const current = assignment[slot];
    const otherSlot = slotOfCandidate[candidate];
    assignment[slot] = candidate;
    slotOfCandidate[candidate] = slot;
    if (current >= 0) slotOfCandidate[current] = otherSlot;
    if (otherSlot >= 0) assignment[otherSlot] = current;
    bestMove.groupCosts.forEach(([group, value]) => {
      groupCosts[group] = value;
    });
    cost += bestDelta;
  }

  return { assignment, cost, iterations, stoppedEarly };
}

// ─── Intelligent Auto-Allocator ─────────────────────────────────────

export interface IntelligentAllocationContext {
  /** All debates from previous completed rounds (for history) */
  allPastDebates: Debate[];
  /** Current team standings (for break liveness) */
  standings: TeamStandingRow[];
  /** Break categories (for liveness calculation) */
  breakCategories: BreakCategory[];
  /** Total number of preliminary rounds in the tournament */
  totalPrelimRounds: number;
  /** Number of preliminary rounds already completed */
  completedRounds: number;
  /** Whether tournament is BP format */
  isBP: boolean;
  /** Optional feedback averages, already on the adjudicator score scale. */
  feedbackScores?: Map<string, number>;
  /** The allocated round's feedback weight (0-1). Absent: the legacy 60% feedback blend. */
  feedbackWeight?: number;
  /** Venue id to priority; used to align stronger adjudicators with better rooms. */
  venuePriorities?: Map<string, number>;
  /** Panels formed before the draw; placed as units before the other debates are filled. */
  preformedPanels?: PreformedPanel[];
  /** Receives non-fatal allocation warnings (e.g. too few voting adjudicators). */
  warnings?: string[];
}

/**
 * Tabbycat's conflict and history costs (adjallocation/allocators/hungarian.py calc_cost and
 * preformed/hungarian.py): per team, `adj_conflict_penalty` when the adjudicator conflicts with it
 * (personal OR institutional, counted once) plus `adj_history_penalty` when they have seen it; with
 * a chair, the same for the adjudicator–chair pair (personal or shared institution; judged together
 * before, trainees included). Seen-before is a yes/no, as in Tabbycat, not a count.
 */
export interface TabbycatCostModel {
  teamCost(adj: Adjudicator, teams: Team[]): number;
  pairCost(adj: Adjudicator, other: Adjudicator): number;
}

export function createTabbycatCostModel(
  pastDebates: Debate[],
  pastAdjTeams: Map<string, Set<string>>,
  options: AllocationOptions,
  weights: AllocationWeights
): TabbycatCostModel {
  const conflictPenalty = weights.PERSONAL_CONFLICT;
  const historyPenalty = weights.REPEAT_TEAM;
  const seenTogether = new Set<string>();
  if (options.respectHistoryConflicts) {
    for (const debate of pastDebates) {
      if (debate.postponed || !debate.adjudicators) continue;
      const members = [
        debate.adjudicators.chairId,
        ...(debate.adjudicators.panellistIds ?? []),
        ...(debate.adjudicators.traineeIds ?? []),
      ].filter((id): id is string => Boolean(id));
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) seenTogether.add([members[i], members[j]].sort().join(":"));
      }
    }
  }
  const adjInstitutions = new Map<string, Set<string>>();
  const teamInstitutions = new Map<string, Set<string>>();
  const institutionsOfAdj = (adj: Adjudicator) => {
    let keys = adjInstitutions.get(adj.id);
    if (!keys) adjInstitutions.set(adj.id, (keys = adjudicatorConflictInstitutions(adj)));
    return keys;
  };
  const institutionsOfTeam = (team: Team) => {
    let keys = teamInstitutions.get(team.id);
    if (!keys) teamInstitutions.set(team.id, (keys = teamConflictInstitutions(team)));
    return keys;
  };
  return {
    teamCost(adj, teams) {
      let cost = 0;
      for (const team of teams) {
        const conflict =
          (options.respectPersonalConflicts && (adj.conflicts ?? []).some((item) => item.teamId === team.id)) ||
          (options.respectInstitutionConflicts && intersects(institutionsOfAdj(adj), institutionsOfTeam(team)));
        if (conflict) cost += conflictPenalty;
        if (options.respectHistoryConflicts && pastAdjTeams.get(adj.id)?.has(team.id)) cost += historyPenalty;
      }
      return cost;
    },
    pairCost(adj, other) {
      if (adj.id === other.id) return 0;
      let cost = 0;
      const conflict =
        (options.respectPersonalConflicts && adjudicatorsConflict(adj, other)) ||
        (options.respectInstitutionConflicts && intersects(institutionsOfAdj(adj), institutionsOfAdj(other)));
      if (conflict) cost += conflictPenalty;
      if (seenTogether.has([adj.id, other.id].sort().join(":"))) cost += historyPenalty;
      return cost;
    },
  };
}

/** Tabbycat orders debates by importance, then room rank (hungarian.py debates_sorted). */
function byTabbycatImportance(a: Debate, b: Debate): number {
  return (
    tabbycatImportanceLevel(b.importance ?? 0) - tabbycatImportanceLevel(a.importance ?? 0) ||
    a.roomRank - b.roomRank ||
    a.id.localeCompare(b.id)
  );
}

function tabbycatHungarianMode(strategy: AdjudicatorPanelStrategy | undefined): TabbycatHungarianMode | undefined {
  if (strategy === "tabbycat_voting") return "voting";
  if (strategy === "tabbycat_consensus") return "consensus";
  return undefined;
}

function emptyAllocation(debateId: string): AdjudicatorAllocationResult {
  return {
    debateId,
    panellistIds: [],
    panellistNames: [],
    traineeIds: [],
    traineeNames: [],
    conflicts: [],
  };
}

interface PreformedPlacementInput {
  /** Adjudicators available this round. */
  adjById: Map<string, Adjudicator>;
  adjScores: Map<string, number>;
  priorityOf(debate: Debate): number;
  teamsOf(debate: Debate): Team[];
  pastAdjTeams: Map<string, Set<string>>;
  options: AllocationOptions;
  weights: AllocationWeights;
  includePanellists: boolean;
  includeTrainees: boolean;
  /** "direct": panels by room rank onto debates by room rank, without optimisation. Default "optimise". */
  placement?: PreformedPanelPlacement;
  /** Names of every adjudicator (available or not), for warnings. */
  nameOf?(adjudicatorId: string): string;
  /** Receives a warning for every panel member left out because they are unavailable. */
  warnings?: string[];
  /** Past debates, for Tabbycat's judged-together history (optimise placement). */
  pastDebates?: Debate[];
}

/**
 * Matches preformed panels to debates as whole units.
 *
 * "optimise" is Tabbycat's HungarianPreformedPanelAllocator (preformed/hungarian.py): the cost of a
 * panel in a debate is `preformed_panel_mismatch_penalty × (debate importance − panel importance)²`
 * (both as Tabbycat importance levels, see tabbycatImportanceLevel) plus, for every member and
 * team, the conflict penalty when they conflict (personal or institutional, counted once) and the
 * history penalty when the member has judged the team. When those costs tie (e.g. every debate
 * has the same importance), panels ranked by importance then average voting strength go to
 * debates ranked by CrabbyTab's priority, as a tie-break far smaller than any Tabbycat cost.
 *
 * Members who are unavailable this round are left out and reported in `warnings`; a panel with no
 * available voting member is not placed (reported too).
 */
export function placePreformedPanels(
  panels: PreformedPanel[],
  debatesByPriority: Debate[],
  input: PreformedPlacementInput
): Map<string, PreformedPanel> {
  const placements = new Map<string, PreformedPanel>();
  const score = (id: string) => input.adjScores.get(id) ?? 5;
  const nameOf = (id: string) => input.nameOf?.(id) ?? input.adjById.get(id)?.name ?? id;
  panels.forEach((panel, index) => {
    const unavailable = [panel.chairId, ...panel.panellistIds, ...panel.traineeIds].filter(
      (id): id is string => Boolean(id) && !input.adjById.has(id!)
    );
    if (unavailable.length > 0) {
      input.warnings?.push(
        `Preformed panel ${panel.roomRank ?? index + 1}: ${unavailable.map(nameOf).join(", ")} ` +
          `${unavailable.length === 1 ? "is" : "are"} not available this round and ${unavailable.length === 1 ? "was" : "were"} left out.`
      );
    }
  });
  const usable = panels
    .map((panel) => ({
      ...panel,
      chairId: panel.chairId && input.adjById.has(panel.chairId) ? panel.chairId : undefined,
      panellistIds: input.includePanellists
        ? panel.panellistIds.filter((id) => input.adjById.has(id))
        : [],
      traineeIds: input.includeTrainees ? panel.traineeIds.filter((id) => input.adjById.has(id)) : [],
    }))
    .filter((panel, index) => {
      const placeable = Boolean(panel.chairId || panel.panellistIds.length > 0);
      if (!placeable && (panels[index].chairId || panels[index].panellistIds.length > 0)) {
        input.warnings?.push(
          `Preformed panel ${panel.roomRank ?? index + 1} has no available voting adjudicator and was not placed.`
        );
      }
      return placeable;
    });
  if (usable.length === 0 || debatesByPriority.length === 0) return placements;

  if (input.placement === "direct") {
    // Tabbycat's DirectPreformedPanelAllocator: debates and panels both in room-rank order,
    // zipped. Panels without a room rank (made by hand) follow those with one, in stored order.
    const byRoomRank = <T extends { roomRank?: number }>(items: T[]) =>
      items
        .map((item, index) => ({ item, index }))
        .sort((a, b) =>
          (a.item.roomRank ?? Number.POSITIVE_INFINITY) - (b.item.roomRank ?? Number.POSITIVE_INFINITY) ||
          a.index - b.index)
        .map(({ item }) => item);
    const debates = byRoomRank(debatesByPriority);
    byRoomRank(usable).forEach((panel, index) => {
      if (index < debates.length) placements.set(debates[index].id, panel);
    });
    return placements;
  }

  const votingAverage = (panel: PreformedPanel) => {
    const ids = [panel.chairId, ...panel.panellistIds].filter((id): id is string => Boolean(id));
    return ids.reduce((sum, id) => sum + score(id), 0) / ids.length;
  };
  const ranked = [...usable].sort(
    (a, b) =>
      (b.importance ?? 0) - (a.importance ?? 0) ||
      votingAverage(b) - votingAverage(a) ||
      a.id.localeCompare(b.id)
  );
  const priorities = debatesByPriority.map((debate) => input.priorityOf(debate));
  const model = createTabbycatCostModel(input.pastDebates ?? [], input.pastAdjTeams, input.options, input.weights);
  const positivePenalties = [
    input.weights.PRIORITY_STRENGTH_MISMATCH,
    input.weights.PERSONAL_CONFLICT,
    input.weights.REPEAT_TEAM,
  ].filter((value) => value > 0);
  // The tie-break never outweighs a whole Tabbycat cost unit, summed over every panel.
  const tieUnit = (positivePenalties.length > 0 ? Math.min(...positivePenalties) : 1) / (1000 * (ranked.length + 1));
  const costs = ranked.map((panel, panelRank) => {
    const idealPriority = priorities[Math.min(panelRank, priorities.length - 1)];
    const panelLevel = tabbycatImportanceLevel(panel.importance ?? 0);
    const members = [panel.chairId, ...panel.panellistIds, ...panel.traineeIds]
      .filter((id): id is string => Boolean(id))
      .map((id) => input.adjById.get(id)!);
    return debatesByPriority.map((debate, debateIndex) => {
      const teams = input.teamsOf(debate);
      const mismatch = tabbycatImportanceLevel(debate.importance ?? 0) - panelLevel;
      const conflictCost = members.reduce((sum, member) => sum + model.teamCost(member, teams), 0);
      const tieBreak = (tieUnit * Math.min(10, Math.abs(priorities[debateIndex] - idealPriority))) / 10;
      return input.weights.PRIORITY_STRENGTH_MISMATCH * mismatch * mismatch + conflictCost + tieBreak;
    });
  });

  solveHungarian(costs).forEach((debateIndex, panelRank) => {
    if (debateIndex < 0 || debateIndex >= debatesByPriority.length) return;
    placements.set(debatesByPriority[debateIndex].id, ranked[panelRank]);
  });
  return placements;
}

/**
 * Intelligently allocates adjudicators to debates using a minimum-cost assignment
 * that balances debate importance against panel strength.
 *
 * Algorithm:
 * 1. Compute debate priority scores (bracket + break liveness + manual priority)
 * 2. Compute effective adjudicator scores (test/base score blended with feedback)
 * 3. Build past history maps (teams judged, panel co-occurrences)
 * 4. Place preformed panels as units, when given
 * 5. Size the remaining voting panels and match them with a Hungarian assignment,
 *    then improve pairwise costs (adjudicator conflicts, repeat panels) with a
 *    bounded local search
 * 6. Seat trainees, avoiding team and adjudicator conflicts, in lower-priority debates
 * 7. Promote each panel's strongest conflict-free member to chair and report conflicts
 */
export function autoAllocateAdjudicators(
  debates: Debate[],
  teamsMap: Map<string, Team>,
  adjudicators: Adjudicator[],
  pastAdjudicatorTeams: Map<string, Set<string>>,
  options: AllocationOptions = {
    panelSize: 3,
    balancePanels: true,
    respectInstitutionConflicts: true,
    respectPersonalConflicts: true,
    respectHistoryConflicts: true,
  },
  context?: IntelligentAllocationContext
): AdjudicatorAllocationResult[] {
  if (debates.some((debate) => debate.byeTeamId)) {
    const eligibleDebates = debates.filter((debate) => !debate.byeTeamId);
    const eligibleAllocations = autoAllocateAdjudicators(
      eligibleDebates,
      teamsMap,
      adjudicators,
      pastAdjudicatorTeams,
      options,
      context
    );
    const allocationByDebateId = new Map(eligibleAllocations.map((allocation) => [allocation.debateId, allocation]));

    return debates.map((debate) => allocationByDebateId.get(debate.id) ?? emptyAllocation(debate.id));
  }

  const skipCheckins = options.preferences?.skipAdjCheckins ?? false;
  const roundId = debates[0]?.roundId;
  const availableAdjs = skipCheckins
    ? adjudicators
    : adjudicators.filter((adjudicator) =>
        isAvailableForRound(adjudicator, roundId, options.preferences?.checkInExpiresAfterHours)
      );
  const numDebates = debates.length;

  if (numDebates === 0) return [];
  // Tabbycat refuses (AdjudicatorAllocationError) rather than replacing panels with empty ones.
  if (availableAdjs.length === 0) throw new AdjudicatorAllocationError(NO_AVAILABLE_ADJUDICATORS_MESSAGE);
  const tabbycatMode = tabbycatHungarianMode(options.panelStrengthStrategy);

  const weights = getAllocationWeights(options.preferences);
  const minScoreToVote = options.preferences?.minAdjScoreToVote ?? 1.5;
  const noPanellists = options.preferences?.noPanellistAdjs ?? false;
  const noTrainees = options.preferences?.noTraineeAdjs ?? false;

  // ─── Step 1: Compute debate priorities ───
  let breakLiveness = new Map<string, number>();
  if (context) {
    const teams = Array.from(teamsMap.values());
    breakLiveness = computeBreakLiveness(
      teams,
      context.standings,
      context.breakCategories,
      context.completedRounds,
      context.totalPrelimRounds,
      context.isBP
    );
  } else {
    // Fallback: uniform liveness
    teamsMap.forEach((_, tid) => breakLiveness.set(tid, 0.5));
  }

  const debatePriorities = calculateDebatePriorities(debates, teamsMap, breakLiveness);
  const priorityMap = new Map<string, DebatePriorityInfo>();
  debatePriorities.forEach((dp) => priorityMap.set(dp.debateId, dp));

  if (context?.venuePriorities) {
    const venuePriorityLevels = [...new Set(
      debates.flatMap((debate) => {
        const priority = debate.venueId ? context.venuePriorities!.get(debate.venueId) : undefined;
        return priority === undefined ? [] : [priority];
      })
    )].sort((a, b) => b - a);
    const venuePriorityScores = new Map(
      venuePriorityLevels.map((priority, index) => [
        priority,
        venuePriorityLevels.length === 1
          ? 5
          : ((venuePriorityLevels.length - index - 1) / (venuePriorityLevels.length - 1)) * 10,
      ])
    );
    debates.forEach((debate) => {
      const venuePriority = debate.venueId
        ? context.venuePriorities!.get(debate.venueId)
        : undefined;
      const venueScore = venuePriority === undefined ? undefined : venuePriorityScores.get(venuePriority);
      const existing = priorityMap.get(debate.id);
      if (venueScore !== undefined && existing) {
        priorityMap.set(debate.id, {
          ...existing,
          priorityScore: existing.priorityScore * 0.75 + venueScore * 0.25,
        });
      }
    });
  }
  const priorityOf = (debate: Debate) => priorityMap.get(debate.id)?.priorityScore ?? 5;

  // Venue priority contributes to, but never replaces, debate importance.
  const sortedDebateIndices = Array.from({ length: numDebates }, (_, i) => i).sort((a, b) => {
    const pa = priorityMap.get(debates[a].id)?.priorityScore ?? 0;
    const pb = priorityMap.get(debates[b].id)?.priorityScore ?? 0;
    return pb - pa || debates[a].roomRank - debates[b].roomRank;
  });

  // ─── Step 2: Compute effective adjudicator scores ───
  // Tabbycat's Round.feedback_weight defaults to 0, so the Tabbycat strategies use the base score
  // for a round without a weight; CrabbyTab's own strategies keep the legacy 60% blend.
  const feedbackWeight = context?.feedbackWeight ?? (tabbycatMode ? 0 : undefined);
  const adjScores = new Map<string, number>();
  availableAdjs.forEach((adj) => {
    adjScores.set(adj.id, effectiveAdjScore(adj, context?.feedbackScores, feedbackWeight));
  });
  const scoreOf = (adj: Adjudicator) => adjScores.get(adj.id) ?? 5;

  // ─── Step 3: Build history maps ───
  const allPastDebates = context?.allPastDebates || [];

  // Merge any additional past adj-team relationships from context
  const fullPastAdjTeams = new Map(
    [...pastAdjudicatorTeams].map(([adjId, teamIds]) => [adjId, new Set(teamIds)])
  );
  if (allPastDebates.length > 0) {
    buildPastAdjTeams(allPastDebates).forEach((teamSet, adjId) => {
      const existing = fullPastAdjTeams.get(adjId);
      if (!existing) {
        fullPastAdjTeams.set(adjId, teamSet);
      } else {
        teamSet.forEach((tid) => existing.add(tid));
      }
    });
  }

  const adjById = new Map(availableAdjs.map((adj) => [adj.id, adj]));
  const teamsByDebateId = new Map(
    debates.map((debate) => [
      debate.id,
      Object.values(debate.teams)
        .map((slot) => teamsMap.get(slot.teamId))
        .filter((team): team is Team => team !== undefined),
    ])
  );
  const teamsOf = (debate: Debate) => teamsByDebateId.get(debate.id) ?? [];

  const resultsMap = new Map<string, AdjudicatorAllocationResult>();
  for (const debate of debates) resultsMap.set(debate.id, emptyAllocation(debate.id));
  const allNames = new Map(adjudicators.map((adj) => [adj.id, adj.name]));
  const nameOf = (id: string) => allNames.get(id) ?? id;

  // ─── Step 4: Preformed panels ───
  const usedAdjIds = new Set<string>();
  if (context?.preformedPanels?.length) {
    const placements = placePreformedPanels(
      context.preformedPanels,
      sortedDebateIndices.map((index) => debates[index]),
      {
        adjById,
        adjScores,
        priorityOf,
        teamsOf,
        pastAdjTeams: fullPastAdjTeams,
        options,
        weights,
        includePanellists: !noPanellists,
        includeTrainees: !noTrainees,
        placement: options.preferences?.preformedPanelPlacement,
        nameOf,
        warnings: context.warnings,
        pastDebates: allPastDebates,
      }
    );
    for (const [debateId, panel] of placements) {
      const result = resultsMap.get(debateId)!;
      if (panel.chairId) {
        result.chairId = panel.chairId;
        result.chairName = nameOf(panel.chairId);
        usedAdjIds.add(panel.chairId);
      }
      result.panellistIds = [...panel.panellistIds];
      result.panellistNames = panel.panellistIds.map(nameOf);
      result.traineeIds = [...panel.traineeIds];
      result.traineeNames = panel.traineeIds.map(nameOf);
      [...panel.panellistIds, ...panel.traineeIds].forEach((id) => usedAdjIds.add(id));
    }
  }

  // ─── Step 5: Voting panels for the remaining debates ───
  const openDebateOrder = sortedDebateIndices.filter((index) => {
    const result = resultsMap.get(debates[index].id)!;
    return !result.chairId && result.panellistIds.length === 0;
  });
  const nonTrainees = availableAdjs.filter(
    (adj) => !usedAdjIds.has(adj.id) && !adj.trainee && scoreOf(adj) >= minScoreToVote
  );
  // Tabbycat (adjallocation/allocators/hungarian.py): an adjudicator below the minimum score to vote
  // is seated as a trainee, never left out of the allocation.
  const voterPool = new Set(nonTrainees.map((adj) => adj.id));
  const trainees = noTrainees
    ? []
    : availableAdjs.filter((adj) => !usedAdjIds.has(adj.id) && !voterPool.has(adj.id));

  if (nonTrainees.length === 0 && openDebateOrder.length > 0) {
    // Tabbycat (check_matrix_exists): no voting adjudicator is an error, not an empty allocation.
    if (usedAdjIds.size === 0) throw new AdjudicatorAllocationError(NO_VOTING_ADJUDICATORS_MESSAGE);
    context?.warnings?.push(
      `${openDebateOrder.length} debate${openDebateOrder.length === 1 ? " has" : "s have"} no preformed panel and no voting adjudicators are left to fill ${openDebateOrder.length === 1 ? "it" : "them"}.`
    );
  }

  if (tabbycatMode && openDebateOrder.length > 0 && nonTrainees.length > 0) {
    const model = createTabbycatCostModel(allPastDebates, fullPastAdjTeams, options, weights);
    const openIds = new Set(openDebateOrder.map((index) => debates[index].id));
    const debateById = new Map(debates.filter((debate) => openIds.has(debate.id)).map((debate) => [debate.id, debate]));
    const candidate = (adj: Adjudicator) => ({ id: adj.id, score: scoreOf(adj) });
    const voterIds = new Set(nonTrainees.map((adj) => adj.id));
    // Tabbycat uses the debate's own importance (not CrabbyTab's composite priority) and room rank.
    const tabbycatOrder = openDebateOrder.map((index) => debates[index]).sort(byTabbycatImportance);
    const { panels, warnings } = allocateTabbycatHungarian({
      mode: tabbycatMode,
      debates: tabbycatOrder.map((debate) => ({ id: debate.id, priority: debate.importance ?? 0 })),
      voters: nonTrainees.map(candidate),
      // Tabbycat seats every non-voter (trainees and voters below the minimum score) as a trainee.
      trainees: noTrainees
        ? []
        : availableAdjs.filter((adj) => !usedAdjIds.has(adj.id) && !voterIds.has(adj.id)).map(candidate),
      noPanellists,
      noTrainees,
      conflictCost(adjudicatorId, debateId, chairId) {
        const adj = adjById.get(adjudicatorId)!;
        let cost = model.teamCost(adj, teamsOf(debateById.get(debateId)!));
        const chair = chairId ? adjById.get(chairId) : undefined;
        if (chair) cost += model.pairCost(adj, chair);
        return cost;
      },
    });
    context?.warnings?.push(...warnings);
    for (const panel of panels) {
      const result = resultsMap.get(panel.debateId)!;
      if (panel.chairId) {
        result.chairId = panel.chairId;
        result.chairName = nameOf(panel.chairId);
      }
      result.panellistIds.push(...panel.panellistIds);
      result.panellistNames.push(...panel.panellistIds.map(nameOf));
      result.traineeIds.push(...panel.traineeIds);
      result.traineeNames.push(...panel.traineeIds.map(nameOf));
    }
  } else if (nonTrainees.length > 0 && openDebateOrder.length > 0) {
    const sizes = planPanelSizes(
      openDebateOrder.length,
      nonTrainees.length,
      noPanellists ? 1 : options.panelSize,
      noPanellists ? "fixed" : options.panelSizing ?? "fixed"
    );
    // Position-major slot order: every chair slot (by priority), then every second seat, ...
    const slots: Array<{ debateIndex: number; group: number }> = [];
    const largestPanel = Math.max(...sizes);
    for (let seat = 0; seat < largestPanel; seat++) {
      openDebateOrder.forEach((debateIndex, group) => {
        if (sizes[group] > seat) slots.push({ debateIndex, group });
      });
    }
    slots.length = Math.min(slots.length, nonTrainees.length);

    const panelAverage = options.panelStrengthStrategy === "panel_average";
    const voterScores = nonTrainees.map(scoreOf);
    // The k-th slot ideally holds the k-th strongest voting adjudicator.
    const idealScores = [...voterScores].sort((a, b) => b - a);
    // Team conflict costs depend only on the debate, so every seat of a panel shares one row.
    const conflictRows = new Map<number, number[]>();
    const conflictRowOf = (debateIndex: number) => {
      let row = conflictRows.get(debateIndex);
      if (!row) {
        const teams = teamsOf(debates[debateIndex]);
        row = nonTrainees.map((adj) => {
          const costs = teamConflictCosts(adj, teams, fullPastAdjTeams, options, weights);
          return costs.institution + costs.personal + costs.history;
        });
        conflictRows.set(debateIndex, row);
      }
      return row;
    };
    const slotCost = slots.map(({ debateIndex }, slotIndex) => {
      const conflictRow = conflictRowOf(debateIndex);
      if (panelAverage) return [...conflictRow];
      const ideal = idealScores[slotIndex];
      return conflictRow.map(
        (conflictCost, adjIndex) => conflictCost + strengthMismatchCost(voterScores[adjIndex] - ideal, weights)
      );
    });
    // Panel-average costs are not separable; seed the matching with per-adjudicator distance
    // to the debate priority and let the local search optimise the real panel averages.
    const seedCost = panelAverage
      ? slotCost.map((row, slotIndex) => {
          const priority = priorityOf(debates[slots[slotIndex].debateIndex]);
          return row.map((cost, adjIndex) => cost + strengthMismatchCost(voterScores[adjIndex] - priority, weights));
        })
      : slotCost;
    const seed = solveHungarian(seedCost).map((adjIndex) =>
      adjIndex >= 0 && adjIndex < nonTrainees.length ? adjIndex : -1
    );

    const slotsByGroup: number[][] = openDebateOrder.map(() => []);
    slots.forEach((slot, slotIndex) => slotsByGroup[slot.group].push(slotIndex));
    const pairCosts = votingPairCosts(nonTrainees, allPastDebates, options, weights);
    const groupPriorities = openDebateOrder.map((debateIndex) => priorityOf(debates[debateIndex]));
    const groupCost = (group: number, members: number[]) => {
      let cost = 0;
      if (members.length > 0 && (panelAverage || options.balancePanels)) {
        let total = 0;
        for (const member of members) total += voterScores[member];
        const average = total / members.length;
        const priority = groupPriorities[group];
        cost += panelAverage
          ? strengthMismatchCost(average - priority, weights)
          : Math.abs(average - priority) * 0.001;
      }
      // Pairs without a conflict or shared history cost exactly 0, so only the others are added
      // (in the same order as a full pairwise loop, which keeps the sum bit-for-bit identical).
      for (let i = 0; i < members.length; i++) {
        const partners = pairCosts[members[i]];
        if (!partners) continue;
        for (let j = i + 1; j < members.length; j++) {
          const pairCost = partners.get(members[j]);
          if (pairCost !== undefined) cost += pairCost;
        }
      }
      return cost;
    };

    const { assignment } = improvePanelAssignment(
      {
        slotCost,
        groupOfSlot: slots.map((slot) => slot.group),
        slotsByGroup,
        groupCost,
        nonNegativeGroupCosts:
          weights.PRIORITY_STRENGTH_MISMATCH >= 0 && weights.ADJUDICATOR_CONFLICT >= 0 && weights.REPEAT_PANEL >= 0,
      },
      seed,
      options.maxLocalSearchIterations ?? DEFAULT_LOCAL_SEARCH_ITERATIONS
    );

    slots.forEach(({ debateIndex }, slotIndex) => {
      const adjIndex = assignment[slotIndex];
      if (adjIndex === undefined || adjIndex < 0) return;
      const chosen = nonTrainees[adjIndex];
      const result = resultsMap.get(debates[debateIndex].id)!;
      result.panellistIds.push(chosen.id);
      result.panellistNames.push(chosen.name);
    });
  }

  // ─── Step 6: Trainees (conflict-checked, lower-priority debates first) ───
  if (!tabbycatMode && trainees.length > 0) {
    const lowestPriorityFirst = [...sortedDebateIndices].reverse();
    const sortedTrainees = [...trainees].sort((a, b) => scoreOf(a) - scoreOf(b) || a.id.localeCompare(b.id));
    for (const trainee of sortedTrainees) {
      let best: { result: AdjudicatorAllocationResult; cost: number; count: number } | undefined;
      for (const debateIndex of lowestPriorityFirst) {
        const debate = debates[debateIndex];
        const result = resultsMap.get(debate.id)!;
        const teamCosts = teamConflictCosts(trainee, teamsOf(debate), fullPastAdjTeams, options, weights);
        let cost = teamCosts.institution + teamCosts.personal + teamCosts.history;
        for (const memberId of [result.chairId, ...result.panellistIds, ...result.traineeIds]) {
          const member = memberId ? adjById.get(memberId) : undefined;
          if (member && panelPairConflicts(trainee, member, options)) cost += weights.ADJUDICATOR_CONFLICT;
        }
        const count = result.traineeIds.length;
        if (!best || cost < best.cost || (cost === best.cost && count < best.count)) {
          best = { result, cost, count };
        }
      }
      best?.result.traineeIds.push(trainee.id);
      best?.result.traineeNames.push(trainee.name);
    }
  }

  // ─── Step 7: Chairs and conflict report ───
  for (const debate of debates) {
    const result = resultsMap.get(debate.id)!;
    const debateTeams = teamsOf(debate);

    if (!result.chairId && result.panellistIds.length > 0) {
      const panelMembers = result.panellistIds;
      const conflictFreeChairIds = panelMembers.filter((adjId) => {
        const adj = adjById.get(adjId);
        if (!adj) return false;
        const conflict = calculateAdjDebateConflict(adj, debateTeams, fullPastAdjTeams, weights);
        return !(
          (options.respectInstitutionConflicts && conflict.hasInstitutionalClash) ||
          (options.respectPersonalConflicts && conflict.hasPersonalClash) ||
          (options.respectHistoryConflicts && conflict.hasHistoryClash)
        );
      });
      const chairCandidates = conflictFreeChairIds.length > 0 ? conflictFreeChairIds : panelMembers;
      const chairId = [...chairCandidates].sort(
        (a, b) => (adjScores.get(b) ?? 0) - (adjScores.get(a) ?? 0)
      )[0];

      result.chairId = chairId;
      result.chairName = nameOf(chairId);
      result.panellistIds = panelMembers.filter((id) => id !== chairId);
      result.panellistNames = result.panellistIds.map(nameOf);
    }

    const members = [result.chairId, ...result.panellistIds, ...result.traineeIds]
      .map((id) => (id ? adjById.get(id) : undefined))
      .filter((adj): adj is Adjudicator => adj !== undefined);
    members.forEach((member, index) => {
      const { reasons } = calculateAdjDebateConflict(
        member,
        debateTeams,
        fullPastAdjTeams,
        weights,
        members.slice(index + 1)
      );
      result.conflicts.push(...reasons.map((reason) => `${member.name}: ${reason}`));
    });
  }

  return debates.map((d) => resultsMap.get(d.id)!);
}

// ─── Filling preformed panels ───────────────────────────────────────

export interface PreformedPanelFillOptions {
  /** Tabbycat's allocator for the panels: voting when ballots are per adjudicator, else consensus. */
  mode: TabbycatHungarianMode;
  roundId: string;
  preferences?: Partial<TournamentPreferences>;
  /** Feedback averages already on the adjudicator score scale. */
  feedbackScores?: Map<string, number>;
  /** The round's feedback weight; absent = 0, as Tabbycat's Round.feedback_weight default. */
  feedbackWeight?: number;
  /** Debates of earlier rounds, for Tabbycat's judged-together history. */
  pastDebates?: Debate[];
}

export interface PreformedPanelFillResult {
  panels: PreformedPanel[];
  warnings: string[];
}

export const NO_PANELS_TO_FILL_MESSAGE = "There aren't any panels to fill. Create panels first.";

/**
 * Tabbycat's "auto-allocate adjudicators to preformed panels" (adjallocation/consumers.py
 * allocate_panel_adjs): the Voting or Consensus Hungarian allocator run over the panels instead
 * of debates. Every available adjudicator may be seated; each panel's members are replaced. Panels
 * have no teams, so only the trainee–chair conflict and judged-together history apply, and panels
 * are taken by importance, then room rank. Throws AdjudicatorAllocationError when there are no
 * panels, no available adjudicators or no voting adjudicators (nothing is changed).
 */
export function allocateAdjudicatorsToPreformedPanels(
  panels: PreformedPanel[],
  adjudicators: Adjudicator[],
  options: PreformedPanelFillOptions
): PreformedPanelFillResult {
  if (panels.length === 0) throw new AdjudicatorAllocationError(NO_PANELS_TO_FILL_MESSAGE);
  const preferences = options.preferences;
  const available = preferences?.skipAdjCheckins
    ? adjudicators
    : adjudicators.filter((adjudicator) =>
        isAvailableForRound(adjudicator, options.roundId, preferences?.checkInExpiresAfterHours)
      );
  if (available.length === 0) throw new AdjudicatorAllocationError(NO_AVAILABLE_ADJUDICATORS_MESSAGE);

  const weights = getAllocationWeights(preferences);
  const allocationOptions: AllocationOptions = {
    panelSize: 3,
    balancePanels: false,
    respectInstitutionConflicts: weights.PERSONAL_CONFLICT > 0,
    respectPersonalConflicts: weights.PERSONAL_CONFLICT > 0,
    respectHistoryConflicts: weights.REPEAT_TEAM > 0,
    preferences,
  };
  const minScoreToVote = preferences?.minAdjScoreToVote ?? 1.5;
  const score = (adjudicator: Adjudicator) =>
    effectiveAdjScore(adjudicator, options.feedbackScores, options.feedbackWeight ?? 0);
  const voters = available.filter((adjudicator) => !adjudicator.trainee && score(adjudicator) >= minScoreToVote);
  const voterIds = new Set(voters.map((adjudicator) => adjudicator.id));
  const noTrainees = preferences?.noTraineeAdjs ?? false;
  const trainees = noTrainees ? [] : available.filter((adjudicator) => !voterIds.has(adjudicator.id));
  const byId = new Map(available.map((adjudicator) => [adjudicator.id, adjudicator]));
  const model = createTabbycatCostModel(options.pastDebates ?? [], new Map(), allocationOptions, weights);
  const ordered = panels
    .map((panel, index) => ({ panel, index }))
    .sort(
      (a, b) =>
        tabbycatImportanceLevel(b.panel.importance) - tabbycatImportanceLevel(a.panel.importance) ||
        (a.panel.roomRank ?? Number.POSITIVE_INFINITY) - (b.panel.roomRank ?? Number.POSITIVE_INFINITY) ||
        a.index - b.index
    )
    .map(({ panel }) => panel);
  const candidate = (adjudicator: Adjudicator) => ({ id: adjudicator.id, score: score(adjudicator) });
  const { panels: filled, warnings } = allocateTabbycatHungarian({
    mode: options.mode,
    debates: ordered.map((panel) => ({ id: panel.id, priority: panel.importance })),
    voters: voters.map(candidate),
    trainees: trainees.map(candidate),
    noPanellists: preferences?.noPanellistAdjs ?? false,
    noTrainees,
    conflictCost(adjudicatorId, _panelId, chairId) {
      const chair = chairId ? byId.get(chairId) : undefined;
      return chair ? model.pairCost(byId.get(adjudicatorId)!, chair) : 0;
    },
  });
  const byPanel = new Map(filled.map((panel) => [panel.debateId, panel]));
  return {
    panels: panels.map((panel) => {
      const result = byPanel.get(panel.id);
      return {
        ...panel,
        chairId: result?.chairId,
        panellistIds: result?.panellistIds ?? [],
        traineeIds: result?.traineeIds ?? [],
      };
    }),
    warnings,
  };
}

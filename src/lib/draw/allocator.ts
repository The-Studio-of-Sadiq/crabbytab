import { Adjudicator, Debate, Team, Venue, Round, BreakCategory, TeamStandingRow, BallotSubmission, FeedbackSubmission, TournamentPreferences } from "@/types";
import { solveHungarian } from "./hungarian";

// ─── Types & Interfaces ──────────────────────────────────────────────

export interface AllocationOptions {
  panelSize: number; // e.g., 1 (solo chair), 3 (chair + 2 panellists), or 5
  /** Match each full panel's average strength to its debate priority. */
  balancePanels: boolean;
  respectInstitutionConflicts: boolean;
  respectPersonalConflicts: boolean;
  respectHistoryConflicts: boolean;
  preferences?: Partial<TournamentPreferences>;
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

export function getAllocationWeights(prefs?: Partial<TournamentPreferences>) {
  const conflictPenalty = prefs?.adjConflictPenalty ?? 1_000_000;
  const historyPenalty = prefs?.adjHistoryPenalty ?? 10_000;
  const mismatchPenalty = prefs?.importanceMismatchPenalty ?? 10_000_000;

  return {
    PRIORITY_STRENGTH_MISMATCH: mismatchPenalty,
    INSTITUTION_CONFLICT: conflictPenalty,
    PERSONAL_CONFLICT: conflictPenalty,
    DECLARED_INSTITUTION_CONFLICT: Math.round(conflictPenalty * 0.8),
    REPEAT_TEAM: historyPenalty,
    REPEAT_PANEL: Math.round(historyPenalty * 0.4),
    TRAINEE_TOP_DEBATE: Math.round(conflictPenalty * 0.3),
    TRAINEE_AS_CHAIR: conflictPenalty * 5,
  };
}

function prioritizeClashAvoidance(
  options: AllocationOptions,
  debateCount: number
): ReturnType<typeof getAllocationWeights> {
  const weights = getAllocationWeights(options.preferences);
  const maximumStrengthMismatch =
    weights.PRIORITY_STRENGTH_MISMATCH * 20 * debateCount * Math.max(1, options.panelSize);
  const clashPenaltyFloor = maximumStrengthMismatch + 1;
  const adjustedWeights = { ...weights };

  if (options.respectInstitutionConflicts) {
    adjustedWeights.INSTITUTION_CONFLICT = Math.max(
      weights.INSTITUTION_CONFLICT,
      clashPenaltyFloor
    );
    adjustedWeights.DECLARED_INSTITUTION_CONFLICT = Math.max(
      weights.DECLARED_INSTITUTION_CONFLICT,
      clashPenaltyFloor
    );
  }
  if (options.respectPersonalConflicts) {
    adjustedWeights.PERSONAL_CONFLICT = Math.max(
      weights.PERSONAL_CONFLICT,
      clashPenaltyFloor
    );
  }
  if (options.respectHistoryConflicts) {
    adjustedWeights.REPEAT_TEAM = Math.max(weights.REPEAT_TEAM, clashPenaltyFloor);
    adjustedWeights.REPEAT_PANEL = Math.max(weights.REPEAT_PANEL, clashPenaltyFloor);
  }

  return adjustedWeights;
}

export const WEIGHTS = getAllocationWeights();

// ─── Conflict Detection ─────────────────────────────────────────────

/**
 * Calculates conflict penalty between an adjudicator and a debate's teams/institutions.
 */
export function calculateAdjDebateConflict(
  adj: Adjudicator,
  debateTeams: Team[],
  pastAdjudicatorTeams: Map<string, Set<string>> = new Map(), // adjId -> Set of teamIds
  customWeights?: ReturnType<typeof getAllocationWeights>
): AdjDebateConflictResult {
  const weights = customWeights || WEIGHTS;
  let penalty = 0;
  const reasons: string[] = [];
  let hasInstitutionalClash = false;
  let hasPersonalClash = false;
  let hasHistoryClash = false;

  for (const team of debateTeams) {
    if (!team) continue;

    // 1. Direct Institutional Conflict (unless judge is explicitly marked independent with no institution)
    if (!adj.independent) {
      if (adj.institutionId && team.institutionId && adj.institutionId === team.institutionId) {
        penalty += weights.INSTITUTION_CONFLICT;
        hasInstitutionalClash = true;
        reasons.push(`Institutional clash with ${team.name} (${team.institutionName || "Same Institution"})`);
      } else if (
        adj.institutionName &&
        team.institutionName &&
        adj.institutionName.trim().toLowerCase() === team.institutionName.trim().toLowerCase()
      ) {
        penalty += weights.INSTITUTION_CONFLICT;
        hasInstitutionalClash = true;
        reasons.push(`Institutional clash with ${team.name} (${team.institutionName})`);
      }
    }

    // 2. Declared conflicts (personal, institutional, etc.)
    if (adj.conflicts && adj.conflicts.length > 0) {
      for (const conflict of adj.conflicts) {
        if (conflict.teamId && conflict.teamId === team.id) {
          penalty += weights.PERSONAL_CONFLICT;
          hasPersonalClash = true;
          reasons.push(`Personal clash with team "${team.name}"`);
        }
        if (
          conflict.institutionId &&
          ((team.institutionId && conflict.institutionId === team.institutionId) ||
            (team.institutionName && conflict.institutionId.toLowerCase() === team.institutionName.toLowerCase()))
        ) {
          penalty += weights.DECLARED_INSTITUTION_CONFLICT;
          hasInstitutionalClash = true;
          reasons.push(`Declared institutional clash with ${team.name}`);
        }
      }
    }

    // 3. Past debate history clash (adjudicated this team in earlier rounds)
    const judgedTeams = pastAdjudicatorTeams.get(adj.id);
    if (judgedTeams && judgedTeams.has(team.id)) {
      penalty += weights.REPEAT_TEAM;
      hasHistoryClash = true;
      reasons.push(`Previously judged ${team.name}`);
    }
  }

  return {
    penalty,
    reasons,
    hasClash: reasons.length > 0,
    hasInstitutionalClash,
    hasPersonalClash,
    hasHistoryClash,
  };
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
    const manualPriority = debate.importance || 0;

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
 * Computes effective panel strength for an adjudicator, incorporating
 * feedback-adjusted scores when available.
 */
export function effectiveAdjScore(
  adj: Adjudicator,
  feedbackScores?: Map<string, number> // adjId -> feedback average
): number {
  const feedbackScore = feedbackScores?.get(adj.id);
  if (feedbackScore !== undefined) {
    // Blend base score (40%) with feedback (60%) for feedback-adjusted score
    return adj.baseScore * 0.4 + feedbackScore * 0.6;
  }
  return adj.baseScore || 5;
}

export function isFeedbackEligibleForRating(submission: FeedbackSubmission): boolean {
  return submission.confirmed && Number.isFinite(submission.score);
}

export function calculateAdjudicatorFeedbackScores(
  submissions: FeedbackSubmission[]
): Map<string, number> {
  const totals = new Map<string, { total: number; count: number }>();
  for (const submission of submissions) {
    if (!isFeedbackEligibleForRating(submission)) continue;

    const current = totals.get(submission.targetAdjudicatorId) ?? { total: 0, count: 0 };
    current.total += submission.score;
    current.count += 1;
    totals.set(submission.targetAdjudicatorId, current);
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
  weightOverrides?: ReturnType<typeof getAllocationWeights>
): AllocationCostBreakdown {
  const weights = weightOverrides ?? getAllocationWeights(options.preferences);
  let priorityStrengthMismatch = 0;
  let institutionConflict = 0;
  let personalConflict = 0;
  let repeatTeamConflict = 0;
  let repeatPanelConflict = 0;
  let traineeSuitability = 0;

  // 1. Priority-Strength Mismatch
  // We want high-scored judges in high-priority debates
  const mismatch = Math.abs(strengthTarget - adjEffectiveScore);
  priorityStrengthMismatch = mismatch * weights.PRIORITY_STRENGTH_MISMATCH;

  // 2. Institution Conflict
  if (options.respectInstitutionConflicts && !adj.independent) {
    for (const team of debateTeams) {
      if (!team) continue;
      if (adj.institutionId && team.institutionId && adj.institutionId === team.institutionId) {
        institutionConflict += weights.INSTITUTION_CONFLICT;
      } else if (
        adj.institutionName &&
        team.institutionName &&
        adj.institutionName.trim().toLowerCase() === team.institutionName.trim().toLowerCase()
      ) {
        institutionConflict += weights.INSTITUTION_CONFLICT;
      }
    }
  }

  // 3. Personal Conflict
  if (options.respectPersonalConflicts && adj.conflicts?.length) {
    for (const conflict of adj.conflicts) {
      for (const team of debateTeams) {
        if (!team) continue;
        if (conflict.teamId && conflict.teamId === team.id) {
          personalConflict += weights.PERSONAL_CONFLICT;
        }
        if (
          conflict.institutionId &&
          ((team.institutionId && conflict.institutionId === team.institutionId) ||
            (team.institutionName && conflict.institutionId.toLowerCase() === team.institutionName.toLowerCase()))
        ) {
          institutionConflict += weights.DECLARED_INSTITUTION_CONFLICT;
        }
      }
    }
  }

  // 4. Repeat-Team Conflict
  if (options.respectHistoryConflicts) {
    const judgedTeams = pastAdjTeams.get(adj.id);
    if (judgedTeams) {
      for (const team of debateTeams) {
        if (!team) continue;
        if (judgedTeams.has(team.id)) {
          repeatTeamConflict += weights.REPEAT_TEAM;
        }
      }
    }
  }

  // 5. Repeat-Panel Conflict
  for (const otherAdjId of currentPanelAdjIds) {
    const key = [adj.id, otherAdjId].sort().join(":");
    const coCount = pastPanelHistory.get(key) || 0;
    if (coCount > 0) {
      repeatPanelConflict += weights.REPEAT_PANEL * coCount;
    }
  }

  // 6. Trainee Suitability
  if (adj.trainee) {
    if (role === "chair") {
      traineeSuitability += weights.TRAINEE_AS_CHAIR;
    }
    // Prefer trainees in lower-priority debates
    if (debatePriority > 7) {
      traineeSuitability += weights.TRAINEE_TOP_DEBATE;
    }
  }

  const total =
    priorityStrengthMismatch +
    institutionConflict +
    personalConflict +
    repeatTeamConflict +
    repeatPanelConflict +
    traineeSuitability;

  return {
    priorityStrengthMismatch,
    institutionConflict,
    personalConflict,
    repeatTeamConflict,
    repeatPanelConflict,
    traineeSuitability,
    total,
  };
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
  /** Optional feedback-adjusted scores */
  feedbackScores?: Map<string, number>;
  /** Venue id to priority; used to align stronger adjudicators with better rooms. */
  venuePriorities?: Map<string, number>;
}

/**
 * Intelligently allocates adjudicators to debates using a minimum-cost assignment
 * that balances debate importance against panel strength.
 *
 * Algorithm:
 * 1. Compute debate priority scores (bracket + break liveness + manual priority)
 * 2. Compute effective adjudicator scores (base + feedback blend)
 * 3. Build past history maps (teams judged, panel co-occurrences)
 * 4. Match complete voting panels while balancing average panel strength to debate priority
 * 5. Promote each panel's strongest conflict-free member to chair
 * 6. Distribute trainees to lower-priority debates
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

    return debates.map((debate) => allocationByDebateId.get(debate.id) ?? {
      debateId: debate.id,
      panellistIds: [],
      panellistNames: [],
      traineeIds: [],
      traineeNames: [],
      conflicts: [],
    });
  }

  const skipCheckins = options.preferences?.skipAdjCheckins ?? false;
  const availableAdjs = skipCheckins ? adjudicators : adjudicators.filter((a) => a.checkedIn !== false);
  const numDebates = debates.length;

  if (numDebates === 0 || availableAdjs.length === 0) {
    return debates.map((d) => ({
      debateId: d.id,
      panellistIds: [],
      panellistNames: [],
      traineeIds: [],
      traineeNames: [],
      conflicts: [],
    }));
  }

  const weights = getAllocationWeights(options.preferences);
  const minScoreToVote = options.preferences?.minAdjScoreToVote ?? 1.5;
  const noPanellists = options.preferences?.noPanellistAdjs ?? false;
  const noTrainees = options.preferences?.noTraineeAdjs ?? false;
  const allocationWeights = prioritizeClashAvoidance(options, numDebates);

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

  // Venue priority contributes to, but never replaces, debate importance.
  const sortedDebateIndices = Array.from({ length: numDebates }, (_, i) => i).sort((a, b) => {
    const pa = priorityMap.get(debates[a].id)?.priorityScore ?? 0;
    const pb = priorityMap.get(debates[b].id)?.priorityScore ?? 0;
    return pb - pa || debates[a].roomRank - debates[b].roomRank;
  });

  // ─── Step 2: Compute effective adjudicator scores ───
  const feedbackScores = context?.feedbackScores;
  const adjScores = new Map<string, number>();
  availableAdjs.forEach((adj) => {
    adjScores.set(adj.id, effectiveAdjScore(adj, feedbackScores));
  });

  // ─── Step 3: Build history maps ───
  const allPastDebates = context?.allPastDebates || [];
  const pastPanelHistory = buildPastPanelHistory(allPastDebates);

  // Merge any additional past adj-team relationships from context
  const fullPastAdjTeams = new Map(pastAdjudicatorTeams);
  if (allPastDebates.length > 0) {
    const historyFromDebates = buildPastAdjTeams(allPastDebates);
    historyFromDebates.forEach((teamSet, adjId) => {
      if (!fullPastAdjTeams.has(adjId)) {
        fullPastAdjTeams.set(adjId, teamSet);
      } else {
        const existing = fullPastAdjTeams.get(adjId)!;
        teamSet.forEach((tid) => existing.add(tid));
      }
    });
  }

  // ─── Step 4: Identify voting adjudicators and trainees ───
  // Adjudicators can only vote (chair/panellist) if not marked trainee AND score >= minScoreToVote
  const nonTrainees = availableAdjs.filter(
    (a) => !a.trainee && (adjScores.get(a.id) ?? 5) >= minScoreToVote
  );
  const trainees = noTrainees
    ? []
    : availableAdjs.filter((a) => a.trainee);

  const resultsMap = new Map<string, AdjudicatorAllocationResult>();
  for (const debate of debates) {
    resultsMap.set(debate.id, {
      debateId: debate.id,
      panellistIds: [],
      panellistNames: [],
      traineeIds: [],
      traineeNames: [],
      conflicts: [],
    });
  }

  // ─── Step 5: Assign complete voting panels via global minimum-cost matching ───
  const votingPanelSize = noPanellists ? 1 : Math.max(1, options.panelSize);
  if (nonTrainees.length > 0) {
    const panelSlots = Array.from({ length: votingPanelSize }, (_, panelPosition) =>
      sortedDebateIndices.map((debateIdx) => ({
        debate: debates[debateIdx],
      }))
    ).flat();
    const rankedAdjudicators = [...nonTrainees].sort((a, b) =>
      (adjScores.get(b.id) ?? 5) - (adjScores.get(a.id) ?? 5) ||
      b.baseScore - a.baseScore ||
      a.id.localeCompare(b.id)
    );
    const adjudicatorRank = new Map<string, number>();
    for (let start = 0; start < rankedAdjudicators.length;) {
      const score = adjScores.get(rankedAdjudicators[start].id) ?? 5;
      let end = start + 1;
      while (
        end < rankedAdjudicators.length &&
        (adjScores.get(rankedAdjudicators[end].id) ?? 5) === score
      ) {
        end++;
      }
      const rank = (start + end - 1) / 2;
      for (let index = start; index < end; index++) {
        adjudicatorRank.set(rankedAdjudicators[index].id, rank);
      }
      start = end;
    }
    const maxPanelRepeatCount = Math.max(0, ...pastPanelHistory.values());
    const repeatPanelCostBound =
      maxPanelRepeatCount *
      allocationWeights.REPEAT_PANEL *
      panelSlots.length *
      panelSlots.length;
    const strengthRankWeight = repeatPanelCostBound + 1;
    const maxRankDistance = Math.max(nonTrainees.length, panelSlots.length);
    const strengthCostBound =
      panelSlots.length * maxRankDistance * maxRankDistance * strengthRankWeight;
    const balanceCostBound = numDebates * 0.01;
    const hardConflictCost =
      strengthCostBound + repeatPanelCostBound + balanceCostBound + 1;
    const basePanelCostMatrix = panelSlots.map(({ debate }, slotIdx) => {
      const debateTeams: Team[] = Object.values(debate.teams)
        .map((t) => teamsMap.get(t.teamId))
        .filter((t): t is Team => t !== undefined);
      const debatePriority = priorityMap.get(debate.id)?.priorityScore ?? 5;

      return nonTrainees.map((adj) => {
        const cost = computeAssignmentCost(
          adj,
          debate,
          debateTeams,
          debatePriority,
          adjScores.get(adj.id) ?? 5,
          fullPastAdjTeams,
          pastPanelHistory,
          [],
          "panellist",
          options,
          debatePriority,
          allocationWeights
        );
        const hasRespectedConflict =
          (options.respectInstitutionConflicts && cost.institutionConflict > 0) ||
          (options.respectPersonalConflicts && cost.personalConflict > 0) ||
          (options.respectHistoryConflicts && cost.repeatTeamConflict > 0          );
          const rankDistance = Math.abs(
        slotIdx - (adjudicatorRank.get(adj.id) ?? nonTrainees.length)
          );
          return (hasRespectedConflict ? hardConflictCost : 0) +
        rankDistance * rankDistance * strengthRankWeight;
      });
    });
    const panelCostMatrix = basePanelCostMatrix;

    const panelSlotsByDebate = new Map<string, number[]>();
    panelSlots.forEach(({ debate }, slotIdx) => {
      const slots = panelSlotsByDebate.get(debate.id) ?? [];
      slots.push(slotIdx);
      panelSlotsByDebate.set(debate.id, slots);
    });

    const panelAssignmentCost = (assignment: number[]) => {
      let total = 0;
      assignment.forEach((adjIdx, slotIdx) => {
        if (adjIdx >= 0) total += panelCostMatrix[slotIdx][adjIdx];
      });

      for (const slotIndices of panelSlotsByDebate.values()) {
        if (options.balancePanels && slotIndices.length > 0) {
          const panelScores = slotIndices
            .map((slotIdx) => assignment[slotIdx])
            .filter((adjIdx) => adjIdx >= 0)
            .map((adjIdx) => adjScores.get(nonTrainees[adjIdx].id) ?? 5);
          if (panelScores.length > 0) {
            const debateId = panelSlots[slotIndices[0]].debate.id;
            const priority = priorityMap.get(debateId)?.priorityScore ?? 5;
            const averageStrength = panelScores.reduce((sum, score) => sum + score, 0) / panelScores.length;
            total += Math.abs(averageStrength - priority) * 0.001;
          }
        }
        for (let i = 0; i < slotIndices.length; i++) {
          const firstAdjIdx = assignment[slotIndices[i]];
          if (firstAdjIdx < 0) continue;
          for (let j = i + 1; j < slotIndices.length; j++) {
            const secondAdjIdx = assignment[slotIndices[j]];
            if (secondAdjIdx < 0) continue;
            const key = [
              nonTrainees[firstAdjIdx].id,
              nonTrainees[secondAdjIdx].id,
            ].sort().join(":");
            total += (pastPanelHistory.get(key) ?? 0) * allocationWeights.REPEAT_PANEL;
          }
        }
      }
      return total;
    };

    const panelMatching = solveHungarian(panelCostMatrix).map((adjIdx) =>
      adjIdx >= 0 && adjIdx < nonTrainees.length ? adjIdx : -1
    );

    // Pairwise repeat-panel penalties are not separable in the Hungarian matrix.
    // Improve its global assignment by accepting cost-reducing replacements/swaps.
    let currentPanelCost = panelAssignmentCost(panelMatching);
    while (true) {
      let bestCost = currentPanelCost;
      let bestAssignment: number[] | undefined;
      const slotByAdj = new Map<number, number>();
      panelMatching.forEach((adjIdx, slotIdx) => {
        if (adjIdx >= 0) slotByAdj.set(adjIdx, slotIdx);
      });

      for (let slotIdx = 0; slotIdx < panelMatching.length; slotIdx++) {
        const currentAdjIdx = panelMatching[slotIdx];
        for (let candidateIdx = 0; candidateIdx < nonTrainees.length; candidateIdx++) {
          if (candidateIdx === currentAdjIdx) continue;
          const candidateSlot = slotByAdj.get(candidateIdx);
          const candidateAssignment = [...panelMatching];
          candidateAssignment[slotIdx] = candidateIdx;
          if (candidateSlot !== undefined) {
            candidateAssignment[candidateSlot] = currentAdjIdx;
          }

          const candidateCost = panelAssignmentCost(candidateAssignment);
          if (candidateCost < bestCost) {
            bestCost = candidateCost;
            bestAssignment = candidateAssignment;
          }
        }
      }

      if (!bestAssignment) break;
      panelMatching.splice(0, panelMatching.length, ...bestAssignment);
      currentPanelCost = bestCost;
    }

    panelSlots.forEach(({ debate }, slotIdx) => {
      const adjIdx = panelMatching[slotIdx];
      if (adjIdx === undefined || adjIdx < 0 || adjIdx >= nonTrainees.length) return;

      const chosen = nonTrainees[adjIdx];
      const res = resultsMap.get(debate.id)!;
      res.panellistIds.push(chosen.id);
      res.panellistNames.push(chosen.name);

      const debateTeams: Team[] = Object.values(debate.teams)
        .map((t) => teamsMap.get(t.teamId))
        .filter((t): t is Team => t !== undefined);
      const { reasons } = calculateAdjDebateConflict(chosen, debateTeams, fullPastAdjTeams, weights);
      res.conflicts.push(...reasons);
    });
  }

  // ─── Step 6: Distribute trainees (prefer lower-priority debates) ───
  if (!noTrainees && trainees.length > 0) {
    const sortedTrainees = [...trainees].sort(
      (a, b) => (adjScores.get(a.id) ?? 0) - (adjScores.get(b.id) ?? 0)
    );

    // Assign trainees starting from the lowest-priority debates
    const reversePriorityOrder = [...sortedDebateIndices].reverse();
    let traineeIdx = 0;

    while (traineeIdx < sortedTrainees.length) {
      for (const debateIdx of reversePriorityOrder) {
        if (traineeIdx >= sortedTrainees.length) break;
        const debate = debates[debateIdx];
        const res = resultsMap.get(debate.id)!;
        const trainee = sortedTrainees[traineeIdx++];

        res.traineeIds.push(trainee.id);
        res.traineeNames.push(trainee.name);
      }
    }
  }

  for (const debate of debates) {
    const result = resultsMap.get(debate.id);
    if (!result) continue;

    const panelMembers = result.panellistIds;
    if (panelMembers.length === 0) continue;

    const debateTeams: Team[] = Object.values(debate.teams)
      .map((teamSlot) => teamsMap.get(teamSlot.teamId))
      .filter((team): team is Team => team !== undefined);
    const conflictFreeChairIds = panelMembers.filter((adjId) => {
      const adj = availableAdjs.find((candidate) => candidate.id === adjId);
      if (!adj) return false;

      const conflict = calculateAdjDebateConflict(
        adj,
        debateTeams,
        fullPastAdjTeams,
        allocationWeights
      );
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
    result.chairName = availableAdjs.find((adj) => adj.id === chairId)?.name ?? result.chairName;
    result.panellistIds = panelMembers.filter((id) => id !== chairId);
    result.panellistNames = result.panellistIds.map(
      (id) => availableAdjs.find((adj) => adj.id === id)?.name ?? id
    );
  }

  return debates.map((d) => resultsMap.get(d.id)!);
}

/**
 * Break liveness per break category (Tabbycat `breakqual/liveness.py` and
 * `breakqual/utils.py` calculate_live_thresholds / determine_liveness).
 *
 * Before a preliminary round, every break category gets two thresholds: a team on at least `safe`
 * points is certain to break, a team on at most `dead` points can no longer break, and every team
 * in between is live. The general (open) category works them out from the number of teams and
 * rounds alone; any other category also looks at the scores of its own teams. These are the same
 * strict mathematical bounds Tabbycat uses: they ignore institution caps, overrides and teams
 * breaking in a higher-priority category, so "safe" and "dead" are a guide, not a promise.
 */
import type { BallotSubmission, BreakCategory, Debate, Round, Team, Tournament } from "@/types";
import { openLiveThresholds, type LiveThresholds } from "@/lib/draw/anticipatedDraw";
import { calculateStandings } from "@/lib/standings/calculator";

export type { LiveThresholds };

export type LivenessStatus = "safe" | "live" | "dead";

export interface CategoryThresholdInput {
  teamsPerDebate: 2 | 4;
  isGeneral: boolean;
  /** 1-based position of the round among the preliminary rounds. */
  roundSeq: number;
  breakSize: number;
  /** Every (non-swing) team in the tournament. */
  totalTeams: number;
  totalPrelimRounds: number;
  /**
   * Non-general categories only: the points before this round of every team in the category,
   * highest first (teams without results count 0).
   */
  categoryScores?: number[];
}

/**
 * Tabbycat liveness_twoteam / liveness_bp. Null when the break size is 1 or less or there are no
 * teams (Tabbycat's "bad input": no status is shown).
 */
export function categoryLiveThresholds(input: CategoryThresholdInput): LiveThresholds | null {
  const open = openLiveThresholds(input);
  if (!open || input.isGeneral) return open;
  const scores = input.categoryScores ?? [];
  const { breakSize } = input;
  // Fewer teams than the break (overall, or in the category): everyone is safe.
  if (input.totalTeams < breakSize || scores.length <= breakSize) {
    return input.teamsPerDebate === 4 ? { safe: -1, dead: -1 } : { safe: 0, dead: -1 };
  }
  const pointsPerRound = input.teamsPerDebate === 4 ? 3 : 1;
  const pointsToGo = (input.totalPrelimRounds - input.roundSeq + 1) * pointsPerRound;
  return {
    // A team in the breaking range that the first team outside it can still catch is not safe.
    safe: Math.min(open.safe, scores[breakSize] + pointsToGo + 1),
    // The highest score from which a team can no longer catch the last breaking team.
    dead: scores[breakSize - 1] - pointsToGo - 1,
  };
}

/** Tabbycat determine_liveness. A team without results counts 0 points. */
export function livenessStatus(thresholds: LiveThresholds, points: number | undefined): LivenessStatus {
  const value = points ?? 0;
  if (value >= thresholds.safe) return "safe";
  if (value <= thresholds.dead) return "dead";
  return "live";
}

/**
 * Teams that belong to a break category for liveness: every team for a general category unless
 * the tab director marked it ineligible, otherwise the teams marked eligible for it. Swing teams
 * never break.
 */
export function teamInBreakCategory(category: BreakCategory, team: Team): boolean {
  if (team.isSwing) return false;
  if (category.isGeneral) return category.teamOverrides?.[team.id] !== "ineligible";
  return Boolean(team.breakCategories?.includes(category.id));
}

export interface TeamCategoryLiveness {
  categoryId: string;
  status: LivenessStatus;
}

export interface BreakLiveness {
  /** 1-based preliminary round the thresholds are for (the points are those before it). */
  roundSeq: number;
  /** Thresholds per category id; null when the category's break size makes them meaningless. */
  thresholds: Map<string, LiveThresholds | null>;
  /** Each team's status in every category it belongs to that has thresholds, in category order. */
  byTeam: Map<string, TeamCategoryLiveness[]>;
}

export interface BreakLivenessInput {
  teamsPerDebate: 2 | 4;
  categories: BreakCategory[];
  teams: Team[];
  /** Points before the round; teams missing from the map count 0. */
  pointsByTeam: Map<string, number>;
  roundSeq: number;
  totalPrelimRounds: number;
}

/** Liveness of every team in every break category before round `roundSeq`. */
export function calculateBreakLiveness(input: BreakLivenessInput): BreakLiveness {
  const regularTeams = input.teams.filter((team) => !team.isSwing);
  const categories = [...input.categories].sort(
    (left, right) => (right.priority || 0) - (left.priority || 0) || left.seq - right.seq
  );
  const thresholds = new Map<string, LiveThresholds | null>();
  const byTeam = new Map<string, TeamCategoryLiveness[]>();
  for (const category of categories) {
    const members = regularTeams.filter((team) => teamInBreakCategory(category, team));
    const categoryThresholds = categoryLiveThresholds({
      teamsPerDebate: input.teamsPerDebate,
      isGeneral: category.isGeneral,
      roundSeq: input.roundSeq,
      breakSize: category.breakSize,
      totalTeams: regularTeams.length,
      totalPrelimRounds: input.totalPrelimRounds,
      categoryScores: category.isGeneral
        ? undefined
        : members.map((team) => input.pointsByTeam.get(team.id) ?? 0).sort((a, b) => b - a),
    });
    thresholds.set(category.id, categoryThresholds);
    if (!categoryThresholds) continue;
    for (const team of members) {
      const list = byTeam.get(team.id) ?? [];
      list.push({ categoryId: category.id, status: livenessStatus(categoryThresholds, input.pointsByTeam.get(team.id)) });
      byTeam.set(team.id, list);
    }
  }
  return { roundSeq: input.roundSeq, thresholds, byTeam };
}

/**
 * A debate's liveness (Tabbycat's allocation view): the number of (team, category) pairs in the
 * debate that are still live.
 */
export function debateLiveness(teamIds: string[], liveness: BreakLiveness): number {
  return teamIds.reduce(
    (count, teamId) => count + (liveness.byTeam.get(teamId) ?? []).filter((entry) => entry.status === "live").length,
    0
  );
}

/** CrabbyTab's 0-10 importance for Tabbycat's 1 (important), 0 (neutral) and -2 (meh). */
export const LIVENESS_IMPORTANCE = { live: 10, safe: 7, dead: 0 } as const;

/**
 * Tabbycat's "prioritise debates by liveness" (adjallocation/consumers.py prioritise_debates), on
 * the general category's thresholds: a debate whose lowest team is safe is neutral, one whose
 * highest team is dead is unimportant, and every other debate is important.
 */
export function importanceByLiveness(
  debates: { id: string; teamIds: string[] }[],
  pointsByTeam: Map<string, number>,
  openThresholds: LiveThresholds
): Map<string, number> {
  const result = new Map<string, number>();
  for (const debate of debates) {
    const points = debate.teamIds.map((teamId) => pointsByTeam.get(teamId) ?? 0);
    if (points.length === 0) continue;
    const lowest = Math.min(...points);
    const highest = Math.max(...points);
    result.set(
      debate.id,
      lowest >= openThresholds.safe
        ? LIVENESS_IMPORTANCE.safe
        : highest <= openThresholds.dead
          ? LIVENESS_IMPORTANCE.dead
          : LIVENESS_IMPORTANCE.live
    );
  }
  return result;
}

export interface RoundLivenessSource {
  tournament: Tournament;
  rounds: Round[];
  teams: Team[];
  debates: Debate[];
  ballots: BallotSubmission[];
  breakCategories: BreakCategory[];
}

export interface RoundLiveness extends BreakLiveness {
  /** Team points before the round (confirmed results of earlier preliminary rounds). */
  pointsByTeam: Map<string, number>;
}

/**
 * Liveness before a preliminary round: points come from the confirmed results of the earlier
 * non-cancelled preliminary rounds, and the round's position among the preliminary rounds sets
 * how many rounds remain. With no `round`, it is computed for the first preliminary round that is
 * not completed (null once every preliminary round is completed). Null for elimination rounds and
 * when there are no break categories.
 */
export function roundBreakLiveness(source: RoundLivenessSource, round?: Round): RoundLiveness | null {
  if (source.breakCategories.length === 0) return null;
  const prelims = source.rounds
    .filter((item) => item.stage === "preliminary" && !item.cancelled)
    .sort((a, b) => a.seq - b.seq);
  const target = round ?? prelims.find((item) => !item.completed);
  if (!target || target.stage !== "preliminary" || target.cancelled) return null;
  const earlier = prelims.filter((item) => item.seq < target.seq);
  const earlierIds = new Set(earlier.map((item) => item.id));
  const standings = calculateStandings(
    source.tournament,
    earlier,
    source.teams,
    source.debates.filter((debate) => earlierIds.has(debate.roundId)),
    source.ballots.filter((ballot) => earlierIds.has(ballot.roundId))
  );
  // Tabbycat's liveness reads the raw sum of points (Sum('teamscore__points')), not the
  // round-weighted points metric, so a weighted round counts its points once here.
  const pointsByTeam = new Map(
    standings.teams.map((row) => [row.teamId, row.roundResults.reduce((sum, result) => sum + result.points, 0)])
  );
  const liveness = calculateBreakLiveness({
    teamsPerDebate: source.tournament.format === "bp" ? 4 : 2,
    categories: source.breakCategories,
    teams: source.teams,
    pointsByTeam,
    roundSeq: earlier.length + 1,
    totalPrelimRounds: prelims.length,
  });
  return { ...liveness, pointsByTeam };
}

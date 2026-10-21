import type { MetricValue, TeamMetricId, SpeakerMetricId } from "@/types";

/* -------------------------------------------------------------------------- */
/* Labels and sort direction                                                  */
/* -------------------------------------------------------------------------- */

export const TEAM_METRIC_LABELS: Record<TeamMetricId, string> = {
  wins: "Wins",
  points: "Points",
  speaks_sum: "Total speaker score",
  speaks_avg: "Average speaker score (per round)",
  speaks_ind_avg: "Average individual speaker score",
  speaks_stddev: "Speaker score standard deviation",
  margin_sum: "Total margin",
  margin_avg: "Average margin",
  draw_strength_wins: "Draw strength (opponents' wins)",
  draw_strength: "Draw strength (opponents' points)",
  draw_strength_speaks: "Draw strength (opponents' speaks)",
  draw_strength_rank: "Draw strength (opponents' mean rank)",
  firsts: "1sts",
  seconds: "2nds",
  thirds: "3rds",
  pullups: "Times pulled up",
  pullup_debates: "Debates with a pull-up",
  wbw: "Who-beat-whom",
  num_adjs: "Votes/ballots carried",
  num_iron: "Iron-person speeches",
};

export const SPEAKER_METRIC_LABELS: Record<SpeakerMetricId, string> = {
  speaks_sum: "Total score",
  speaks_avg: "Average score",
  speaks_stddev: "Standard deviation",
  speaks_trimmed_mean: "Trimmed mean (high-low drop)",
  speeches_count: "Speeches given",
  reply_sum: "Total reply score",
  reply_avg: "Average reply score",
  srank: "Speech ranks (sum)",
  reply_stddev: "Reply score standard deviation",
  reply_count: "Replies given",
  team_points: "Team points",
  team_wins: "Team wins",
  firsts: "Team 1sts",
  seconds: "Team 2nds",
  thirds: "Team 3rds",
  num_adjs: "Team votes/ballots carried",
};

/** 1 = higher value ranks better; -1 = lower value ranks better. */
export const TEAM_METRIC_DIRECTION: Record<TeamMetricId, 1 | -1> = {
  wins: 1,
  points: 1,
  speaks_sum: 1,
  speaks_avg: 1,
  speaks_ind_avg: 1,
  speaks_stddev: -1,
  margin_sum: 1,
  margin_avg: 1,
  draw_strength_wins: 1,
  draw_strength: 1,
  draw_strength_speaks: 1,
  // A lower mean opponent rank is a harder draw (Tabbycat: ascending).
  draw_strength_rank: -1,
  firsts: 1,
  seconds: 1,
  thirds: 1,
  // Tabbycat's npullups and pullup_debates are not ascending: more ranks higher
  // (standings/teams.py; BaseMetricAnnotator.ascending defaults to False).
  pullups: 1,
  pullup_debates: 1,
  wbw: 1,
  num_adjs: 1,
  // Fewer debates with a duplicate speech ranks higher, as in Tabbycat.
  num_iron: -1,
};

export const SPEAKER_METRIC_DIRECTION: Record<SpeakerMetricId, 1 | -1> = {
  speaks_sum: 1,
  speaks_avg: 1,
  speaks_stddev: -1,
  speaks_trimmed_mean: 1,
  speeches_count: 1,
  reply_sum: 1,
  reply_avg: 1,
  // A lower sum of speech ranks is better, as Tabbycat's srank.
  srank: -1,
  reply_stddev: -1,
  reply_count: 1,
  team_points: 1,
  team_wins: 1,
  firsts: 1,
  seconds: 1,
  thirds: 1,
  num_adjs: 1,
};

export const ALL_TEAM_METRICS = Object.keys(TEAM_METRIC_LABELS) as TeamMetricId[];
export const ALL_SPEAKER_METRICS = Object.keys(SPEAKER_METRIC_LABELS) as SpeakerMetricId[];

/** Metrics that only make sense in a given format; used to grey out choices in the UI. */
export const BP_ONLY_TEAM_METRICS: TeamMetricId[] = ["firsts", "seconds", "thirds"];
/**
 * Two-team only. BP preliminary rounds record no wins (as in Tabbycat), so wins and the
 * draw strength built on them are always 0 in BP; use points and draw_strength there.
 */
export const TWO_TEAM_ONLY_TEAM_METRICS: TeamMetricId[] = ["margin_sum", "margin_avg", "num_adjs", "wins", "draw_strength_wins"];
export const BP_ONLY_SPEAKER_METRICS: SpeakerMetricId[] = ["firsts", "seconds", "thirds"];
export const TWO_TEAM_ONLY_SPEAKER_METRICS: SpeakerMetricId[] = ["team_wins", "num_adjs"];
/** Metrics that may appear more than once in a precedence chain (Tabbycat allows repeated who-beat-whom). */
export const REPEATABLE_TEAM_METRICS: TeamMetricId[] = ["wbw"];
/** Metrics that only make sense as a tiebreak and so are not offered as "extra" display columns. */
export const RANKING_ONLY_TEAM_METRICS: TeamMetricId[] = ["wbw"];
/**
 * Metrics that can only be displayed, never ranked on: draw strength by rank is computed from the
 * ranking itself (Tabbycat's extra_only).
 */
export const EXTRA_ONLY_TEAM_METRICS: TeamMetricId[] = ["draw_strength_rank"];

/** Tabbycat normalises votes carried to a panel of this size (NumberOfAdjudicatorsMetricAnnotator). */
export const VOTES_NORMALISED_PANEL_SIZE = 3;

/** Defaults chosen to exactly reproduce the tab's pre-existing, hardcoded sort order. */
export const DEFAULT_TEAM_PRECEDENCE: Record<"bp" | "two_team" | "poly", TeamMetricId[]> = {
  bp: ["points", "speaks_sum", "firsts", "seconds", "thirds"],
  two_team: ["points", "speaks_sum", "margin_sum"],
  // N teams per room: Tabbycat's default ranks on wins (always 0 here) then average speaks, and its
  // Public Speaking preset on average speaks alone.
  poly: ["speaks_avg"],
};
export const DEFAULT_SPEAKER_PRECEDENCE: SpeakerMetricId[] = ["speaks_sum", "speaks_avg"];

/** Display form of a metric value: whole numbers as they are, anything else to two decimals; "—" for no value. */
export function formatMetricValue(value: MetricValue | undefined): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/* -------------------------------------------------------------------------- */
/* Small stats helpers                                                        */
/* -------------------------------------------------------------------------- */

/*
 * Tabbycat computes most metrics as SQL aggregates (Sum, Avg, StdDev) over the results a team or
 * speaker has. Over no results those are NULL, not 0 (standings/teams.py, speakers.py); counts
 * (Count) are 0. The helpers below follow that: an aggregate over nothing is null ("no value").
 */

/** Sum, or null when there is nothing to sum (SQL SUM over no rows). */
function sumOrNull(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
}

/** Mean, or null when there is nothing to average (SQL AVG over no rows). */
function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Population standard deviation (Tabbycat's StdDev, STDDEV_POP); null over no values. */
function popStdDev(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
}

/* -------------------------------------------------------------------------- */
/* Team metrics                                                               */
/* -------------------------------------------------------------------------- */

export interface TeamRoundAccum {
  points: number;
  win: boolean;
  /** This team's total substantive speaker score for the round. Absent = forfeit/no ballot, excluded from speaks_avg. */
  speaksSum: number | null;
  /** Each of this team's speakers' individual substantive scores this round. */
  individualScores: number[];
  /** 0 for formats with no margin concept (e.g. BP). */
  margin: number;
  opponentTeamIds: string[];
  pulledUp: boolean;
  /** A bye awarded as a win: counts for points and wins, but has no speaks or margin. */
  bye?: boolean;
  /** 1..4 in BP (from points); undefined for two-team formats. */
  rankInRoom?: number;
  /** Voting ballots only: votes this team received and the panel's total votes. */
  votesGiven?: number;
  votesPossible?: number;
  /** The team gave an iron-person (duplicate) speech in this debate. */
  ironed?: boolean;
  /** Some team in this debate was pulled up (Tabbycat's debate "pullup" flag). */
  pullupDebate?: boolean;
  /**
   * A drawn debate without a confirmed result: it carries only the opponents (draw strength) and
   * pull-ups, which Tabbycat counts for every preliminary debate; every other metric ignores it.
   */
  noResult?: boolean;
  /**
   * The round's weight (Tabbycat Round.weight; absent = 1). Draw strength multiplies opponents'
   * points by it, as Tabbycat's PointsMetricAnnotator does.
   */
  roundWeight?: number;
}

/** Points this team earned, each round's points multiplied by its weight (Tabbycat's points metric). */
export function weightedPoints(rounds: TeamRoundAccum[]): number {
  return rounds.reduce((sum, round) => sum + round.points * (round.roundWeight ?? 1), 0);
}

/**
 * Adjudicator votes carried, normalised to a panel of three (Tabbycat's num_adjs, which reports a
 * team with none as 0). Consensus ballots record no votes and so carry none, as in Tabbycat.
 */
function votesCarried(rounds: TeamRoundAccum[]): number {
  return rounds.reduce(
    (s, r) => (r.votesPossible ? s + ((r.votesGiven ?? 0) * VOTES_NORMALISED_PANEL_SIZE) / r.votesPossible : s),
    0
  );
}

export interface TeamMetricContext {
  /** Every other team's own wins / speaks_sum, for draw strength. */
  opponentWins: Map<string, number>;
  /** Every other team's round-weighted points, for Tabbycat's draw_strength. */
  opponentPoints: Map<string, number>;
  opponentSpeaksSum: Map<string, number>;
}

export function computeTeamMetrics(
  rounds: TeamRoundAccum[],
  ctx: TeamMetricContext
): Record<TeamMetricId, MetricValue> {
  const played = rounds.filter((r) => r.speaksSum !== null);
  // Rounds with a confirmed result (a bye win included): Tabbycat's TeamScore rows. A team with
  // none has no points (null), as Tabbycat's Sum over no TeamScores; it ranks below 0 points.
  const resulted = rounds.filter((r) => !r.noResult);
  // Tabbycat multiplies points by the round's weight (Round.weight); wins and who-beat-whom are unweighted.
  const points = resulted.length ? weightedPoints(resulted) : null;
  const wins = rounds.filter((r) => r.win).length;
  const speaksValues = played.map((r) => r.speaksSum as number);
  const individualScores = rounds.flatMap((r) => r.individualScores);
  // Byes, forfeits and results-only ballots have no margin (null in Tabbycat), so they are left out.
  const margins = rounds.filter((r) => !r.bye && r.speaksSum !== null).map((r) => r.margin);
  const firsts = rounds.filter((r) => r.rankInRoom === 1).length;
  const seconds = rounds.filter((r) => r.rankInRoom === 2).length;
  const thirds = rounds.filter((r) => r.rankInRoom === 3).length;
  const pullups = rounds.filter((r) => r.pulledUp).length;

  const opponentIds = rounds.flatMap((r) => r.opponentTeamIds);
  const drawStrengthWins = opponentIds.reduce((s, id) => s + (ctx.opponentWins.get(id) ?? 0), 0);
  const drawStrength = opponentIds.reduce((s, id) => s + (ctx.opponentPoints.get(id) ?? 0), 0);
  const drawStrengthSpeaks = opponentIds.reduce((s, id) => s + (ctx.opponentSpeaksSum.get(id) ?? 0), 0);

  return {
    wins,
    points,
    speaks_sum: sumOrNull(speaksValues),
    speaks_avg: mean(speaksValues),
    speaks_ind_avg: mean(individualScores),
    speaks_stddev: popStdDev(speaksValues),
    margin_sum: sumOrNull(margins),
    margin_avg: mean(margins),
    draw_strength_wins: drawStrengthWins,
    draw_strength: drawStrength,
    draw_strength_speaks: drawStrengthSpeaks,
    // Filled in by the calculator once every team is ranked; null (shown as "—") without opponents.
    draw_strength_rank: null,
    firsts,
    seconds,
    thirds,
    pullups,
    pullup_debates: rounds.filter((r) => r.pullupDebate).length,
    // Filled in by the calculator, which needs every team's standing to evaluate it.
    wbw: 0,
    num_adjs: votesCarried(rounds),
    num_iron: rounds.filter((r) => r.ironed).length,
  };
}

/* -------------------------------------------------------------------------- */
/* Speaker metrics                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Tabbycat's "trimmed mean (high-low drop)": drops the `trim` highest and `trim` lowest scores
 * when more than 2·trim remain, otherwise the plain mean. Tabbycat always drops one from each end
 * (trim = 1); CrabbyTab lets `speakerTrim` choose how many.
 */
export function trimmedMean(scores: number[], trim: number): number | null {
  const sorted = [...scores].sort((a, b) => a - b);
  const kept = trim > 0 && sorted.length > 2 * trim ? sorted.slice(trim, sorted.length - trim) : sorted;
  return mean(kept);
}

/**
 * The speaker's team's results over the same preliminary rounds, as Tabbycat's speaker metrics
 * team_points, team_wins, firsts/seconds/thirds and num_adjs: these count every debate of the
 * team, whether or not this speaker spoke in it.
 */
export interface SpeakerTeamResults {
  /** null when the team has no confirmed results (Tabbycat's Sum over no TeamScores). */
  points: number | null;
  wins: number;
  firsts: number;
  seconds: number;
  thirds: number;
  votesCarried: number;
}

export const NO_TEAM_RESULTS: SpeakerTeamResults = { points: null, wins: 0, firsts: 0, seconds: 0, thirds: 0, votesCarried: 0 };

/**
 * The speaker team metrics from the team's rounds. Points are not multiplied by round weights:
 * Tabbycat's speaker team_points sums TeamScore.points directly.
 */
export function speakerTeamResults(rounds: TeamRoundAccum[] | undefined): SpeakerTeamResults {
  if (!rounds || rounds.length === 0) return NO_TEAM_RESULTS;
  const resulted = rounds.filter((round) => !round.noResult);
  return {
    points: resulted.length ? resulted.reduce((sum, round) => sum + round.points, 0) : null,
    wins: rounds.filter((round) => round.win).length,
    firsts: rounds.filter((round) => round.rankInRoom === 1).length,
    seconds: rounds.filter((round) => round.rankInRoom === 2).length,
    thirds: rounds.filter((round) => round.rankInRoom === 3).length,
    votesCarried: votesCarried(rounds),
  };
}

/**
 * `speechRanks` are the ranks of the speaker's counted substantive speeches, for Tabbycat's
 * "srank" (their sum). Aggregates over no speeches (scores, replies, ranks) are null, as in
 * Tabbycat; counts are 0.
 */
export function computeSpeakerMetrics(
  substantiveScores: number[],
  replyScores: number[],
  trim: number,
  team: SpeakerTeamResults = NO_TEAM_RESULTS,
  speechRanks: number[] = []
): Record<SpeakerMetricId, MetricValue> {
  return {
    speaks_sum: sumOrNull(substantiveScores),
    speaks_avg: mean(substantiveScores),
    speaks_stddev: popStdDev(substantiveScores),
    speaks_trimmed_mean: trimmedMean(substantiveScores, trim),
    speeches_count: substantiveScores.length,
    reply_sum: sumOrNull(replyScores),
    reply_avg: mean(replyScores),
    srank: sumOrNull(speechRanks),
    reply_stddev: popStdDev(replyScores),
    reply_count: replyScores.length,
    team_points: team.points,
    team_wins: team.wins,
    firsts: team.firsts,
    seconds: team.seconds,
    thirds: team.thirds,
    num_adjs: team.votesCarried,
  };
}

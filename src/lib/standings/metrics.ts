import type { TeamMetricId, SpeakerMetricId } from "@/types";

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
  draw_strength_speaks: "Draw strength (opponents' speaks)",
  firsts: "1sts",
  seconds: "2nds",
  thirds: "3rds",
  pullups: "Times pulled up",
};

export const SPEAKER_METRIC_LABELS: Record<SpeakerMetricId, string> = {
  speaks_sum: "Total score",
  speaks_avg: "Average score",
  speaks_stddev: "Standard deviation",
  speaks_trimmed_mean: "Trimmed mean",
  speeches_count: "Speeches given",
  reply_sum: "Total reply score",
  reply_avg: "Average reply score",
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
  draw_strength_speaks: 1,
  firsts: 1,
  seconds: 1,
  thirds: 1,
  pullups: 1,
};

export const SPEAKER_METRIC_DIRECTION: Record<SpeakerMetricId, 1 | -1> = {
  speaks_sum: 1,
  speaks_avg: 1,
  speaks_stddev: -1,
  speaks_trimmed_mean: 1,
  speeches_count: 1,
  reply_sum: 1,
  reply_avg: 1,
};

export const ALL_TEAM_METRICS = Object.keys(TEAM_METRIC_LABELS) as TeamMetricId[];
export const ALL_SPEAKER_METRICS = Object.keys(SPEAKER_METRIC_LABELS) as SpeakerMetricId[];

/** Metrics that only make sense in a given format; used to grey out choices in the UI. */
export const BP_ONLY_TEAM_METRICS: TeamMetricId[] = ["firsts", "seconds", "thirds"];
export const TWO_TEAM_ONLY_TEAM_METRICS: TeamMetricId[] = ["margin_sum", "margin_avg"];

/** Defaults chosen to exactly reproduce the tab's pre-existing, hardcoded sort order. */
export const DEFAULT_TEAM_PRECEDENCE: Record<"bp" | "two_team", TeamMetricId[]> = {
  bp: ["points", "speaks_sum", "firsts", "seconds", "thirds"],
  two_team: ["points", "speaks_sum", "margin_sum"],
};
export const DEFAULT_SPEAKER_PRECEDENCE: SpeakerMetricId[] = ["speaks_sum", "speaks_avg"];

/* -------------------------------------------------------------------------- */
/* Small stats helpers                                                        */
/* -------------------------------------------------------------------------- */

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Population standard deviation (matches Tabbycat's own metric). */
function popStdDev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
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
  /** 1..4 in BP (from points); undefined for two-team formats. */
  rankInRoom?: number;
}

export interface TeamMetricContext {
  /** Every other team's own wins / speaks_sum, for draw strength. */
  opponentWins: Map<string, number>;
  opponentSpeaksSum: Map<string, number>;
}

export function computeTeamMetrics(
  rounds: TeamRoundAccum[],
  ctx: TeamMetricContext
): Record<TeamMetricId, number> {
  const played = rounds.filter((r) => r.speaksSum !== null);
  const points = rounds.reduce((s, r) => s + r.points, 0);
  const wins = rounds.filter((r) => r.win).length;
  const speaksValues = played.map((r) => r.speaksSum as number);
  const speaksSum = speaksValues.reduce((s, v) => s + v, 0);
  const individualScores = rounds.flatMap((r) => r.individualScores);
  const marginSum = rounds.reduce((s, r) => s + r.margin, 0);
  const firsts = rounds.filter((r) => r.rankInRoom === 1).length;
  const seconds = rounds.filter((r) => r.rankInRoom === 2).length;
  const thirds = rounds.filter((r) => r.rankInRoom === 3).length;
  const pullups = rounds.filter((r) => r.pulledUp).length;

  const opponentIds = rounds.flatMap((r) => r.opponentTeamIds);
  const drawStrengthWins = opponentIds.reduce((s, id) => s + (ctx.opponentWins.get(id) ?? 0), 0);
  const drawStrengthSpeaks = opponentIds.reduce((s, id) => s + (ctx.opponentSpeaksSum.get(id) ?? 0), 0);

  return {
    wins,
    points,
    speaks_sum: speaksSum,
    speaks_avg: mean(speaksValues),
    speaks_ind_avg: mean(individualScores),
    speaks_stddev: popStdDev(speaksValues),
    margin_sum: marginSum,
    margin_avg: mean(rounds.map((r) => r.margin)),
    draw_strength_wins: drawStrengthWins,
    draw_strength_speaks: drawStrengthSpeaks,
    firsts,
    seconds,
    thirds,
    pullups,
  };
}

/* -------------------------------------------------------------------------- */
/* Speaker metrics                                                            */
/* -------------------------------------------------------------------------- */

export function computeSpeakerMetrics(
  substantiveScores: number[],
  replyScores: number[],
  trim: number
): Record<SpeakerMetricId, number> {
  const sum = substantiveScores.reduce((a, b) => a + b, 0);
  const sorted = [...substantiveScores].sort((a, b) => a - b);
  const kept = trim > 0 && sorted.length > trim ? sorted.slice(trim) : sorted;
  const replySum = replyScores.reduce((a, b) => a + b, 0);

  return {
    speaks_sum: sum,
    speaks_avg: mean(substantiveScores),
    speaks_stddev: popStdDev(substantiveScores),
    speaks_trimmed_mean: mean(kept),
    speeches_count: substantiveScores.length,
    reply_sum: replySum,
    reply_avg: mean(replyScores),
  };
}

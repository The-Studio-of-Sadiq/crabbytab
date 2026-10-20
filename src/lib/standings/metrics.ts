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
  // Fewer pull-ups ranks higher, as in Tabbycat.
  pullups: -1,
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
};

export const ALL_TEAM_METRICS = Object.keys(TEAM_METRIC_LABELS) as TeamMetricId[];
export const ALL_SPEAKER_METRICS = Object.keys(SPEAKER_METRIC_LABELS) as SpeakerMetricId[];

/** Metrics that only make sense in a given format; used to grey out choices in the UI. */
export const BP_ONLY_TEAM_METRICS: TeamMetricId[] = ["firsts", "seconds", "thirds"];
export const TWO_TEAM_ONLY_TEAM_METRICS: TeamMetricId[] = ["margin_sum", "margin_avg", "num_adjs"];
/** Metrics that may appear more than once in a precedence chain (Tabbycat allows repeated who-beat-whom). */
export const REPEATABLE_TEAM_METRICS: TeamMetricId[] = ["wbw"];
/** Metrics that only make sense as a tiebreak and so are not offered as "extra" display columns. */
export const RANKING_ONLY_TEAM_METRICS: TeamMetricId[] = ["wbw"];

/** Tabbycat normalises votes carried to a panel of this size (NumberOfAdjudicatorsMetricAnnotator). */
export const VOTES_NORMALISED_PANEL_SIZE = 3;

/** Defaults chosen to exactly reproduce the tab's pre-existing, hardcoded sort order. */
export const DEFAULT_TEAM_PRECEDENCE: Record<"bp" | "two_team", TeamMetricId[]> = {
  bp: ["points", "speaks_sum", "firsts", "seconds", "thirds"],
  two_team: ["points", "speaks_sum", "margin_sum"],
};
export const DEFAULT_SPEAKER_PRECEDENCE: SpeakerMetricId[] = ["speaks_sum", "speaks_avg"];

/** Display form of a metric value: whole numbers as they are, anything else to two decimals. */
export function formatMetricValue(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

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
  /** A bye awarded as a win: counts for points and wins, but has no speaks or margin. */
  bye?: boolean;
  /** 1..4 in BP (from points); undefined for two-team formats. */
  rankInRoom?: number;
  /** Voting ballots only: votes this team received and the panel's total votes. */
  votesGiven?: number;
  votesPossible?: number;
  /** The team gave an iron-person (duplicate) speech in this debate. */
  ironed?: boolean;
  /** The round's weight (Round.weight); points count this many times. Absent = 1. */
  roundWeight?: number;
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
  // Tabbycat multiplies points by the round's weight (Round.weight); wins and who-beat-whom are unweighted.
  const points = rounds.reduce((s, r) => s + r.points * (r.roundWeight ?? 1), 0);
  const wins = rounds.filter((r) => r.win).length;
  const speaksValues = played.map((r) => r.speaksSum as number);
  const speaksSum = speaksValues.reduce((s, v) => s + v, 0);
  const individualScores = rounds.flatMap((r) => r.individualScores);
  const marginSum = rounds.reduce((s, r) => s + r.margin, 0);
  const firsts = rounds.filter((r) => r.rankInRoom === 1).length;
  const seconds = rounds.filter((r) => r.rankInRoom === 2).length;
  const thirds = rounds.filter((r) => r.rankInRoom === 3).length;
  const pullups = rounds.filter((r) => r.pulledUp).length;
  // Consensus ballots record no votes and so carry none, as in Tabbycat.
  const votesCarried = rounds.reduce(
    (s, r) => (r.votesPossible ? s + ((r.votesGiven ?? 0) * VOTES_NORMALISED_PANEL_SIZE) / r.votesPossible : s),
    0
  );

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
    // Byes, forfeits and results-only ballots have no margin (null in Tabbycat), so they are left out.
    margin_avg: mean(rounds.filter((r) => !r.bye && r.speaksSum !== null).map((r) => r.margin)),
    draw_strength_wins: drawStrengthWins,
    draw_strength_speaks: drawStrengthSpeaks,
    firsts,
    seconds,
    thirds,
    pullups,
    // Filled in by the calculator, which needs every team's standing to evaluate it.
    wbw: 0,
    num_adjs: votesCarried,
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
export function trimmedMean(scores: number[], trim: number): number {
  const sorted = [...scores].sort((a, b) => a - b);
  const kept = trim > 0 && sorted.length > 2 * trim ? sorted.slice(trim, sorted.length - trim) : sorted;
  return mean(kept);
}

/**
 * `speechRanks` are the ranks of the speaker's counted substantive speeches, for Tabbycat's
 * "srank" (their sum). A speaker with no ranked speeches gets 0, as Tabbycat sorts a missing sum.
 */
export function computeSpeakerMetrics(
  substantiveScores: number[],
  replyScores: number[],
  trim: number,
  speechRanks: number[] = []
): Record<SpeakerMetricId, number> {
  const sum = substantiveScores.reduce((a, b) => a + b, 0);
  const replySum = replyScores.reduce((a, b) => a + b, 0);

  return {
    speaks_sum: sum,
    speaks_avg: mean(substantiveScores),
    speaks_stddev: popStdDev(substantiveScores),
    speaks_trimmed_mean: trimmedMean(substantiveScores, trim),
    speeches_count: substantiveScores.length,
    reply_sum: replySum,
    reply_avg: mean(replyScores),
    srank: speechRanks.reduce((a, b) => a + b, 0),
  };
}

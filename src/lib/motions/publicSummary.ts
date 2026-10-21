import type { BallotSubmission, Debate, Motion, Tournament } from "@/types";
import { getPublicSiteSettings } from "@/lib/publicFeatures";
import { summariseTournamentMotions, type TournamentMotionSummary } from "@/lib/motions/crossTournament";

/**
 * A published tournament's contribution to the public cross-tournament motion statistics, built
 * from its public view only (released motions, public results), so it can never reveal more than
 * the tournament's own public pages. Present only when the tournament has released its motion
 * statistics (Tabbycat `motion_tab_released`) and has at least one released motion with text.
 */
export type PublicMotionSummary = TournamentMotionSummary & {
  tournament: { id: string; name: string; slug: string };
  /**
   * The tournament keeps search engines off pages other than (or including) its homepage
   * (Tabbycat `search_engine_indexing` other than "all"), so the pooled page must not be indexed.
   */
  noindex?: true;
};

interface PublicRoundContentLike {
  debates?: unknown;
  ballots?: unknown;
}

export function buildPublicMotionSummary(input: {
  tournamentId: string;
  slug: string;
  tournament: unknown;
  motions: unknown;
  rounds: PublicRoundContentLike[];
}): PublicMotionSummary | undefined {
  const tournament = (input.tournament ?? {}) as Partial<Tournament>;
  const settings = getPublicSiteSettings(tournament.preferences);
  if (!settings.motionTab) return undefined;
  const motions = (Array.isArray(input.motions) ? (input.motions as Motion[]) : []).filter(
    (motion) => motion?.released === true && typeof motion.text === "string" && motion.text.trim() !== ""
  );
  if (motions.length === 0) return undefined;
  const debates = input.rounds.flatMap((round) => (Array.isArray(round.debates) ? (round.debates as Debate[]) : []));
  const ballots = input.rounds.flatMap((round) => (Array.isArray(round.ballots) ? (round.ballots as BallotSubmission[]) : []));
  const name = tournament.name || tournament.shortName || input.slug;
  const summary = summariseTournamentMotions({
    tournament: { id: input.tournamentId, name, format: tournament.format ?? "bp" },
    motions,
    debates,
    ballots,
  });
  return {
    ...summary,
    tournament: { id: input.tournamentId, name, slug: input.slug },
    ...(settings.searchEngineIndexing !== "all" ? { noindex: true as const } : {}),
  };
}

/** Narrows an unknown stored value (a public view root field) to a summary, or undefined. */
export function readPublicMotionSummary(value: unknown): PublicMotionSummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<PublicMotionSummary>;
  const tournament = record.tournament;
  if (
    !tournament ||
    typeof tournament.id !== "string" ||
    typeof tournament.name !== "string" ||
    typeof tournament.slug !== "string" ||
    typeof record.isBP !== "boolean" ||
    !Array.isArray(record.motions)
  ) {
    return undefined;
  }
  const motions = record.motions.filter(
    (motion) =>
      motion &&
      typeof motion.text === "string" &&
      Number.isFinite(motion.debatesCounted) &&
      Number.isFinite(motion.vetoes) &&
      Array.isArray(motion.positionWins)
  );
  return { tournament, isBP: record.isBP, motions, ...(record.noindex === true ? { noindex: true as const } : {}) };
}

/** The pooled motions page is indexable only when every tournament on it allows indexing. */
export function pooledMotionsIndexable(summaries: readonly Pick<PublicMotionSummary, "noindex">[]): boolean {
  return summaries.every((summary) => summary.noindex !== true);
}

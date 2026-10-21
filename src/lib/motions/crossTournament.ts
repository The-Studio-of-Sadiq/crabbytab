import type { BallotSubmission, Debate, DebateSide, Motion, Tournament } from "@/types";
import { analyzeMotionBalance, type MotionBalanceAnalysis } from "@/lib/motionBalance";
import { BP_POSITIONS, computeMotionStatistics, TWO_TEAM_POSITIONS } from "@/lib/motionStatistics";
import { isPolyFormat } from "@/lib/debateSides";

/**
 * Motion statistics across several tournaments run by the same tab director (Tabbycat shows them
 * per tournament only). The same motion set at two tournaments is recognised by its text, compared
 * without case, punctuation or extra spaces. BP and two-team results are never pooled: their
 * positions differ.
 */

export interface TournamentMotionData {
  tournament: Pick<Tournament, "id" | "name" | "format">;
  motions: Motion[];
  debates: Pick<Debate, "id" | "motionId">[];
  ballots: Pick<BallotSubmission, "debateId" | "motionId" | "teamScores" | "confirmed" | "discarded" | "forfeitSide" | "vetoes">[];
}

export interface CrossTournamentMotionStatistic {
  key: string;
  text: string;
  isBP: boolean;
  tournaments: Array<{ id: string; name: string; debates: number }>;
  debatesCounted: number;
  /** BP: first places per position; two-team: wins per side. */
  positionWins: Array<{ side: DebateSide; wins: number }>;
  vetoes: number;
  balance: MotionBalanceAnalysis;
}

export function motionTextKey(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** One tournament's statistics for one motion, before pooling (also stored in public view roots). */
export interface TournamentMotionSummaryEntry {
  text: string;
  debatesCounted: number;
  positionWins: Array<{ side: DebateSide; wins: number }>;
  vetoes: number;
}

/** A tournament's motion statistics, ready to pool with other tournaments'. */
export interface TournamentMotionSummary {
  tournament: { id: string; name: string; slug?: string };
  isBP: boolean;
  motions: TournamentMotionSummaryEntry[];
}

/** Per-motion results of one tournament (confirmed, non-discarded ballots; vetoes from the same ballots). */
export function summariseTournamentMotions(entry: TournamentMotionData): TournamentMotionSummary {
  const isBP = entry.tournament.format === "bp";
  const vetoCounts = new Map<string, number>();
  for (const ballot of entry.ballots) {
    if (!ballot.confirmed || ballot.discarded) continue;
    for (const motionId of Object.values(ballot.vetoes || {})) {
      if (motionId) vetoCounts.set(motionId, (vetoCounts.get(motionId) ?? 0) + 1);
    }
  }
  // Tabbycat has no motion statistics for other team counts, so poly tournaments contribute none.
  if (isPolyFormat(entry.tournament.format)) {
    return { tournament: { id: entry.tournament.id, name: entry.tournament.name }, isBP, motions: [] };
  }
  return {
    tournament: { id: entry.tournament.id, name: entry.tournament.name },
    isBP,
    motions: computeMotionStatistics(entry.motions, entry.debates, entry.ballots, isBP)
      .filter((statistic) => motionTextKey(statistic.motion.text || "") !== "")
      .map((statistic) => ({
        text: statistic.motion.text.trim(),
        debatesCounted: statistic.debatesCounted,
        positionWins: statistic.positions.map((position) => ({ side: position.side, wins: position.wins })),
        vetoes: vetoCounts.get(statistic.motion.id) ?? 0,
      })),
  };
}

/** Pools per-tournament summaries: the same motion text (and format family) is one row. */
export function poolMotionSummaries(summaries: readonly TournamentMotionSummary[]): CrossTournamentMotionStatistic[] {
  const groups = new Map<string, CrossTournamentMotionStatistic>();
  for (const summary of summaries) {
    const sides: DebateSide[] = summary.isBP ? BP_POSITIONS : TWO_TEAM_POSITIONS;
    for (const motion of summary.motions) {
      const textKey = motionTextKey(motion.text || "");
      if (!textKey) continue;
      const key = `${summary.isBP ? "bp" : "two"}:${textKey}`;
      const group = groups.get(key) ?? {
        key,
        text: motion.text.trim(),
        isBP: summary.isBP,
        tournaments: [],
        debatesCounted: 0,
        positionWins: sides.map((side) => ({ side, wins: 0 })),
        vetoes: 0,
        balance: analyzeMotionBalance(sides.map(() => 0)),
      };
      const existing = group.tournaments.find((item) => item.id === summary.tournament.id);
      if (existing) existing.debates += motion.debatesCounted;
      else group.tournaments.push({ id: summary.tournament.id, name: summary.tournament.name, debates: motion.debatesCounted });
      group.debatesCounted += motion.debatesCounted;
      for (const position of motion.positionWins ?? []) {
        const slot = group.positionWins.find((item) => item.side === position.side);
        if (slot && Number.isFinite(position.wins)) slot.wins += position.wins;
      }
      group.vetoes += Number.isFinite(motion.vetoes) ? motion.vetoes : 0;
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .map((group) => ({ ...group, balance: analyzeMotionBalance(group.positionWins.map((item) => item.wins)) }))
    .sort((left, right) =>
      right.tournaments.length - left.tournaments.length ||
      right.debatesCounted - left.debatesCounted ||
      left.text.localeCompare(right.text)
    );
}

export function crossTournamentMotionStatistics(data: readonly TournamentMotionData[]): CrossTournamentMotionStatistic[] {
  return poolMotionSummaries(data.map(summariseTournamentMotions));
}

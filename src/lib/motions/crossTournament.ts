import type { BallotSubmission, Debate, DebateSide, Motion, Tournament } from "@/types";
import { analyzeMotionBalance, type MotionBalanceAnalysis } from "@/lib/motionBalance";
import { BP_POSITIONS, computeMotionStatistics, TWO_TEAM_POSITIONS } from "@/lib/motionStatistics";

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

export function crossTournamentMotionStatistics(data: readonly TournamentMotionData[]): CrossTournamentMotionStatistic[] {
  const groups = new Map<string, CrossTournamentMotionStatistic>();
  for (const entry of data) {
    const isBP = entry.tournament.format === "bp";
    const sides: DebateSide[] = isBP ? BP_POSITIONS : TWO_TEAM_POSITIONS;
    const vetoCounts = new Map<string, number>();
    for (const ballot of entry.ballots) {
      if (!ballot.confirmed || ballot.discarded) continue;
      for (const motionId of Object.values(ballot.vetoes || {})) {
        if (motionId) vetoCounts.set(motionId, (vetoCounts.get(motionId) ?? 0) + 1);
      }
    }
    for (const statistic of computeMotionStatistics(entry.motions, entry.debates, entry.ballots, isBP)) {
      const textKey = motionTextKey(statistic.motion.text || "");
      if (!textKey) continue;
      const key = `${isBP ? "bp" : "two"}:${textKey}`;
      const group = groups.get(key) ?? {
        key,
        text: statistic.motion.text.trim(),
        isBP,
        tournaments: [],
        debatesCounted: 0,
        positionWins: sides.map((side) => ({ side, wins: 0 })),
        vetoes: 0,
        balance: analyzeMotionBalance(sides.map(() => 0)),
      };
      const existing = group.tournaments.find((item) => item.id === entry.tournament.id);
      if (existing) existing.debates += statistic.debatesCounted;
      else group.tournaments.push({ id: entry.tournament.id, name: entry.tournament.name, debates: statistic.debatesCounted });
      group.debatesCounted += statistic.debatesCounted;
      for (const position of statistic.positions) {
        const slot = group.positionWins.find((item) => item.side === position.side);
        if (slot) slot.wins += position.wins;
      }
      group.vetoes += vetoCounts.get(statistic.motion.id) ?? 0;
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

import type { BallotSubmission, BPSide, Debate, DebateSide, Motion, TwoTeamSide } from "@/types";
import { analyzeMotionBalance, type MotionBalanceAnalysis } from "@/lib/motionBalance";

export const BP_POSITIONS: BPSide[] = ["OG", "OO", "CG", "CO"];
export const TWO_TEAM_POSITIONS: TwoTeamSide[] = ["AFF", "NEG"];

export interface MotionPositionStatistic {
  side: DebateSide;
  /** BP: first places; two-team formats: wins. */
  wins: number;
  /** Mean team points earned in this position, or null when no debate counted. */
  averagePoints: number | null;
}

export interface MotionStatistic {
  motion: Motion;
  /** Debates that used the motion and have a counted result. */
  debatesCounted: number;
  positions: MotionPositionStatistic[];
  balance: MotionBalanceAnalysis;
}

type BallotForStatistics = Pick<BallotSubmission, "debateId" | "motionId" | "teamScores" | "confirmed" | "discarded"> &
  Partial<Pick<BallotSubmission, "forfeitSide">>;

/**
 * Per-motion side results from confirmed ballots. One confirmed, non-discarded ballot per debate
 * counts (confirming a ballot discards the others), forfeits are excluded (they were never debated), and the motion is taken from
 * the ballot or, failing that, from the debate. Callers decide which ballots are visible: the public
 * page passes only ballots from the public projection, which already holds released results only.
 */
export function computeMotionStatistics(
  motions: Motion[],
  debates: Pick<Debate, "id" | "motionId">[],
  ballots: BallotForStatistics[],
  isBP: boolean
): MotionStatistic[] {
  const positions: DebateSide[] = isBP ? BP_POSITIONS : TWO_TEAM_POSITIONS;
  const debateMotion = new Map(debates.map((debate) => [debate.id, debate.motionId]));
  const ballotByDebate = new Map<string, BallotForStatistics>();
  for (const ballot of ballots) {
    if (!ballot.confirmed || ballot.discarded || ballot.forfeitSide) continue;
    // Never count a debate twice, even if stale data holds two confirmed ballots for it.
    if (!ballotByDebate.has(ballot.debateId)) ballotByDebate.set(ballot.debateId, ballot);
  }

  const ballotsByMotion = new Map<string, BallotForStatistics[]>();
  for (const ballot of ballotByDebate.values()) {
    const motionId = ballot.motionId || debateMotion.get(ballot.debateId);
    if (!motionId) continue;
    const list = ballotsByMotion.get(motionId) ?? [];
    list.push(ballot);
    ballotsByMotion.set(motionId, list);
  }

  return motions.map((motion) => {
    const motionBallots = (ballotsByMotion.get(motion.id) ?? []).filter((ballot) =>
      positions.every((side) => ballot.teamScores?.[side] !== undefined)
    );
    const positionStats = positions.map((side): MotionPositionStatistic => {
      const scores = motionBallots.map((ballot) => ballot.teamScores[side]);
      const wins = scores.filter((score) => (isBP ? score.points === 3 || score.rank === 1 : score.win === true)).length;
      const totalPoints = scores.reduce((sum, score) => sum + (Number(score.points) || 0), 0);
      return { side, wins, averagePoints: scores.length > 0 ? totalPoints / scores.length : null };
    });
    return {
      motion,
      debatesCounted: motionBallots.length,
      positions: positionStats,
      balance: analyzeMotionBalance(positionStats.map((position) => position.wins)),
    };
  });
}

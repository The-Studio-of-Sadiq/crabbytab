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

  return motions.map((motion) => statisticFor(motion, ballotsByMotion.get(motion.id) ?? [], positions, isBP));
}

function statisticFor(
  motion: Motion,
  ballots: BallotForStatistics[],
  positions: DebateSide[],
  isBP: boolean
): MotionStatistic {
  const motionBallots = ballots.filter((ballot) => positions.every((side) => ballot.teamScores?.[side] !== undefined));
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
}

export interface MotionRoundStatistic extends MotionStatistic {
  /** The round the statistics cover; undefined for a motion not assigned to any round yet. */
  roundId?: string;
}

/**
 * Motion statistics split by round (Tabbycat motions-statistics, one row per RoundMotion): a motion
 * reused in several rounds gets one row per round, each counting only that round's debates. The
 * same counting rules as computeMotionStatistics. Rows follow `roundOrder` (round ids by sequence),
 * then the motions' order.
 */
export function computeMotionRoundStatistics(
  motions: Motion[],
  debates: Pick<Debate, "id" | "motionId" | "roundId">[],
  ballots: BallotForStatistics[],
  isBP: boolean,
  roundOrder: readonly string[] = []
): MotionRoundStatistic[] {
  const positions: DebateSide[] = isBP ? BP_POSITIONS : TWO_TEAM_POSITIONS;
  const debateById = new Map(debates.map((debate) => [debate.id, debate]));
  const byDebate = new Map<string, BallotForStatistics>();
  for (const ballot of ballots) {
    if (!ballot.confirmed || ballot.discarded || ballot.forfeitSide) continue;
    if (!byDebate.has(ballot.debateId)) byDebate.set(ballot.debateId, ballot);
  }
  const ballotsByKey = new Map<string, BallotForStatistics[]>();
  const roundsByMotion = new Map<string, Set<string>>();
  for (const ballot of byDebate.values()) {
    const debate = debateById.get(ballot.debateId);
    const motionId = ballot.motionId || debate?.motionId;
    if (!motionId || !debate?.roundId) continue;
    const key = `${motionId}|${debate.roundId}`;
    ballotsByKey.set(key, [...(ballotsByKey.get(key) ?? []), ballot]);
    roundsByMotion.set(motionId, (roundsByMotion.get(motionId) ?? new Set()).add(debate.roundId));
  }
  const orderOf = (roundId: string) => {
    const index = roundOrder.indexOf(roundId);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const rows: Array<MotionRoundStatistic & { motionIndex: number }> = [];
  motions.forEach((motion, motionIndex) => {
    const roundIds = new Set([...(motion.rounds ?? []), ...(roundsByMotion.get(motion.id) ?? [])]);
    if (roundIds.size === 0) {
      rows.push({ ...statisticFor(motion, [], positions, isBP), motionIndex });
      return;
    }
    for (const roundId of roundIds) {
      rows.push({ ...statisticFor(motion, ballotsByKey.get(`${motion.id}|${roundId}`) ?? [], positions, isBP), roundId, motionIndex });
    }
  });
  return rows
    .sort((left, right) =>
      (left.roundId === undefined ? Number.MAX_SAFE_INTEGER : orderOf(left.roundId)) -
        (right.roundId === undefined ? Number.MAX_SAFE_INTEGER : orderOf(right.roundId)) ||
      left.motionIndex - right.motionIndex)
    .map(({ motionIndex: _motionIndex, ...row }) => row);
}

/** Times a motion was vetoed on confirmed ballots, optionally in one round only. */
export function countMotionVetoes(
  ballots: Array<Pick<BallotSubmission, "roundId" | "confirmed" | "discarded" | "vetoes">>,
  motionId: string,
  roundId?: string
): number {
  return ballots.reduce((count, ballot) => {
    if (!ballot.confirmed || ballot.discarded || (roundId !== undefined && ballot.roundId !== roundId)) return count;
    return count + Object.values(ballot.vetoes || {}).filter((vetoed) => vetoed === motionId).length;
  }, 0);
}

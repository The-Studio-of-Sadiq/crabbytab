import type { BallotSubmission, DebateSide, Motion } from "@/types";

/**
 * Ranked motion preferences (Tabbycat's DebateTeamMotionPreference with preference 1, 2, ...):
 * each side lists the round's motions from most to least preferred. They are recorded alongside
 * vetoes and only feed statistics; they never change a result.
 */

export type MotionPreferences = Partial<Record<DebateSide, string[]>>;

/** Drops blanks, unknown motions and repeats, keeping the first occurrence of each motion. */
export function normalizeMotionPreferences(
  preferences: MotionPreferences | undefined,
  motionIds: readonly string[]
): MotionPreferences {
  const allowed = new Set(motionIds);
  const result: MotionPreferences = {};
  for (const [side, ranking] of Object.entries(preferences || {}) as Array<[DebateSide, string[] | undefined]>) {
    const seen = new Set<string>();
    const cleaned = (ranking || []).filter((id) => {
      if (!id || !allowed.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (cleaned.length > 0) result[side] = cleaned;
  }
  return result;
}

export interface MotionPreferenceProblem {
  side: DebateSide;
  message: string;
}

/**
 * Problems with a ballot's preferences: a motion ranked twice, a motion that is not one of the
 * round's, or a side whose first choice is the motion it vetoed.
 */
export function validateMotionPreferences(
  preferences: MotionPreferences | undefined,
  motionIds: readonly string[],
  vetoes?: Partial<Record<DebateSide, string>>
): MotionPreferenceProblem[] {
  const allowed = new Set(motionIds);
  const problems: MotionPreferenceProblem[] = [];
  for (const [side, ranking] of Object.entries(preferences || {}) as Array<[DebateSide, string[] | undefined]>) {
    const filled = (ranking || []).filter(Boolean);
    if (new Set(filled).size !== filled.length) problems.push({ side, message: `${side} ranks a motion more than once.` });
    if (filled.some((id) => !allowed.has(id))) problems.push({ side, message: `${side} ranks a motion that is not in this round.` });
    if (filled[0] && vetoes?.[side] === filled[0]) {
      problems.push({ side, message: `${side}'s first choice is the motion it vetoed.` });
    }
  }
  return problems;
}

export interface MotionPreferenceStatistic {
  motionId: string;
  /** Teams that ranked the motion. */
  rankings: number;
  /** Teams that ranked it first. */
  firstChoices: number;
  /** Mean rank (1 = most preferred), or null when nobody ranked it. */
  averageRank: number | null;
}

/**
 * Preference statistics from confirmed, non-discarded ballots (one per debate, as the motion
 * statistics count them).
 */
export function computeMotionPreferenceStatistics(
  motions: Pick<Motion, "id">[],
  ballots: Pick<BallotSubmission, "debateId" | "confirmed" | "discarded" | "motionPreferences">[]
): MotionPreferenceStatistic[] {
  const counted = new Map<string, (typeof ballots)[number]>();
  for (const ballot of ballots) {
    if (!ballot.confirmed || ballot.discarded || counted.has(ballot.debateId)) continue;
    counted.set(ballot.debateId, ballot);
  }
  const totals = new Map<string, { rankings: number; firsts: number; rankSum: number }>();
  for (const ballot of counted.values()) {
    for (const ranking of Object.values(ballot.motionPreferences || {})) {
      (ranking || []).forEach((motionId, index) => {
        const total = totals.get(motionId) ?? { rankings: 0, firsts: 0, rankSum: 0 };
        total.rankings += 1;
        total.rankSum += index + 1;
        if (index === 0) total.firsts += 1;
        totals.set(motionId, total);
      });
    }
  }
  return motions.map((motion) => {
    const total = totals.get(motion.id);
    return {
      motionId: motion.id,
      rankings: total?.rankings ?? 0,
      firstChoices: total?.firsts ?? 0,
      averageRank: total && total.rankings > 0 ? total.rankSum / total.rankings : null,
    };
  });
}

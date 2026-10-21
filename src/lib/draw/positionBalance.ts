import type { BallotSubmission, BPSide, Debate, Round, TournamentPreferences } from "@/types";
import { buildMatchupHistory } from "./generator";
import { BP_SIDES, computeBPSideCost, sideCounts, type SideAllocationOptions } from "./sideAllocator";
import { sidesPending } from "./manualSides";
import { earlierDebates } from "./validateDraw";

/**
 * Tabbycat's position balance report (draw-position-balance) for a BP preliminary round: each
 * team's position history before and after the round, the position cost of the position it was
 * given under the configured cost function (bp_position_cost, Rényi order, exponent), and how its
 * balance changed.
 *
 * "Balanced" means the counts of the four positions differ by at most one. Statuses, as Tabbycat:
 * - regression: balanced before, imbalanced now;
 * - resolved: imbalanced before, balanced now;
 * - improving: still imbalanced, but one fewer position at the minimum count (the best this round
 *   could do);
 * - still_bad: imbalanced before and still imbalanced without that improvement.
 *
 * The cost is the position cost only; CrabbyTab's draw has no BP pull-up penalty to add to it.
 */
export type PositionBalanceStatus = "regression" | "resolved" | "improving" | "still_bad";

export interface PositionBalanceRow {
  teamId: string;
  teamName: string;
  debateId: string;
  roomRank: number;
  side: BPSide;
  /** Times in OG, OO, CG, CO before this round. */
  before: number[];
  /** Times in OG, OO, CG, CO including this round. */
  after: number[];
  /** Position cost of `side` given `before` (raised to the exponent). */
  cost: number;
  /** Absent when the team was balanced before and after. */
  status?: PositionBalanceStatus;
}

export interface PositionBalanceReport {
  /** Every team placed in the round, by room rank then position. */
  rows: PositionBalanceRow[];
  /** Teams with a status, highest cost first (Tabbycat's "teams with position imbalances"). */
  imbalanced: PositionBalanceRow[];
  /** Debates whose positions are not decided yet (manual-ballot sides); they are left out. */
  sidesPendingDebates: number;
}

export type PositionBalanceUnavailable = "not_bp" | "elimination" | "first_round";

const isBalanced = (counts: number[]) => Math.max(...counts) - Math.min(...counts) <= 1;

export function positionBalanceStatus(before: number[], after: number[]): PositionBalanceStatus | undefined {
  const balancedBefore = isBalanced(before);
  const balancedAfter = isBalanced(after);
  if (balancedBefore && balancedAfter) return undefined;
  if (balancedBefore) return "regression";
  if (balancedAfter) return "resolved";
  const minimum = Math.min(...before);
  const atMinimum = (counts: number[]) => counts.filter((count) => count === minimum).length;
  return atMinimum(after) < atMinimum(before) ? "improving" : "still_bad";
}

/** Why the report does not apply to this round, or undefined when it does. */
export function positionBalanceUnavailable(
  format: string,
  round: Pick<Round, "id" | "seq" | "stage">,
  rounds: Array<Pick<Round, "id" | "seq" | "cancelled">>
): PositionBalanceUnavailable | undefined {
  if (format !== "bp") return "not_bp";
  if (round.stage === "elimination") return "elimination";
  if (!rounds.some((item) => !item.cancelled && item.seq < round.seq)) return "first_round";
  return undefined;
}

export function positionCostOptions(preferences: Partial<TournamentPreferences> | undefined): SideAllocationOptions {
  return {
    bpPositionCost: preferences?.bpPositionCost,
    renyiOrder: preferences?.renyiOrder,
    bpPositionCostExponent: preferences?.bpPositionCostExponent,
  };
}

export function buildPositionBalanceReport(input: {
  round: Round;
  rounds: Round[];
  debates: Debate[];
  ballots?: BallotSubmission[];
  teamName: (teamId: string) => string;
  preferences?: Partial<TournamentPreferences>;
}): PositionBalanceReport {
  const { round } = input;
  const history = buildMatchupHistory(earlierDebates(input));
  const options = positionCostOptions(input.preferences);
  const roundDebates = input.debates
    .filter((debate) => debate.roundId === round.id && !debate.postponed && !debate.byeTeamId)
    .sort((left, right) => left.roomRank - right.roomRank || left.id.localeCompare(right.id));
  const rows: PositionBalanceRow[] = [];
  let sidesPendingDebates = 0;
  for (const debate of roundDebates) {
    if (sidesPending(debate)) {
      sidesPendingDebates += 1;
      continue;
    }
    for (const side of BP_SIDES) {
      const teamId = debate.teams?.[side]?.teamId;
      if (!teamId) continue;
      const past = history.sides.get(teamId) ?? [];
      const before = sideCounts(past, BP_SIDES);
      const after = sideCounts([...past, side], BP_SIDES);
      const status = positionBalanceStatus(before, after);
      rows.push({
        teamId,
        teamName: input.teamName(teamId),
        debateId: debate.id,
        roomRank: debate.roomRank,
        side,
        before,
        after,
        cost: computeBPSideCost(past, side, options),
        ...(status ? { status } : {}),
      });
    }
  }
  const imbalanced = rows
    .filter((row) => row.status !== undefined)
    .sort((left, right) => right.cost - left.cost || left.teamName.localeCompare(right.teamName));
  return { rows, imbalanced, sidesPendingDebates };
}

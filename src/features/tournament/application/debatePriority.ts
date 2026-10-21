import type { BreakCategory, Debate } from "@/types";
import { importanceByBracket } from "@/lib/draw/anticipatedDraw";
import { importanceByLiveness, type RoundLiveness } from "@/lib/breakqual/liveness";

export type DebatePrioritiseMethod = "bracket" | "liveness";

export class DebatePriorityUnavailableError extends Error {}

function teamIdsOf(debate: Debate): string[] {
  return Object.values(debate.teams ?? {}).flatMap((slot) => (slot?.teamId ? [slot.teamId] : []));
}

/**
 * Tabbycat's one-click "auto-prioritise debates" (adjallocation/consumers.py prioritise_debates)
 * on CrabbyTab's 0-10 importance scale. By bracket: rooms sorted by bracket are split into
 * quarters with importance 10, 7, 3 and 0 (rooms on one bracket share a level). By liveness: from
 * the general break category's thresholds before the round, a room whose lowest team is safe gets
 * 7, a room whose highest team is dead gets 0, and every other room 10.
 *
 * Returns the round's debates with `importance` replaced. Throws DebatePriorityUnavailableError
 * when liveness is asked for but there is no general category with thresholds (Tabbycat: "You
 * have no break category set as 'is general'"), or the round is not a preliminary round.
 */
export function prioritiseDebates(
  roundDebates: Debate[],
  method: DebatePrioritiseMethod,
  breakCategories: BreakCategory[],
  liveness: RoundLiveness | null
): Debate[] {
  if (method === "bracket") {
    const levels = importanceByBracket(roundDebates, (debate) => debate.bracket ?? 0);
    return roundDebates.map((debate) => ({ ...debate, importance: levels.get(debate) ?? debate.importance }));
  }
  const open = breakCategories.find((category) => category.isGeneral);
  const thresholds = open ? liveness?.thresholds.get(open.id) : undefined;
  if (!open || !liveness || !thresholds) {
    throw new DebatePriorityUnavailableError(
      "Debate importances can only be set by liveness in a preliminary round with a general break category of more than one team."
    );
  }
  const importance = importanceByLiveness(
    roundDebates.map((debate) => ({ id: debate.id, teamIds: teamIdsOf(debate) })),
    liveness.pointsByTeam,
    thresholds
  );
  return roundDebates.map((debate) => ({ ...debate, importance: importance.get(debate.id) ?? debate.importance }));
}

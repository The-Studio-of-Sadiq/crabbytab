import type { Motion, Round } from "@/types";

/**
 * Motions are released one at a time (Motion.released), but private portals, data-entry
 * assistants and the public projection decide whether a round's debate motions may be shown from
 * Round.motionsReleased. A round's motions count as released once any motion assigned to it is.
 *
 * Returns the rounds whose flag must change, so callers only write when something differs.
 */
export function roundsNeedingMotionReleaseSync(
  rounds: Round[],
  motions: Pick<Motion, "rounds" | "released">[]
): Round[] {
  const releasedRoundIds = new Set(
    motions.filter((motion) => motion.released).flatMap((motion) => motion.rounds || [])
  );
  return rounds
    .filter((round) => Boolean(round.motionsReleased) !== releasedRoundIds.has(round.id))
    .map((round) => ({ ...round, motionsReleased: releasedRoundIds.has(round.id) }));
}

export function applyMotionReleaseSync(rounds: Round[], changed: Round[]): Round[] {
  const byId = new Map(changed.map((round) => [round.id, round]));
  return rounds.map((round) => byId.get(round.id) ?? round);
}

import type { Debate } from "@/types";

export type PrivateActorType = "adjudicator" | "team";

/**
 * Debates the private-URL actor may see or submit for. Built only from live
 * (non-deleted) debates so a soft-deleted debate can never crash the lookup.
 */
export function selectAssignedDebates(
  liveDebates: ReadonlyMap<string, Debate>,
  actorType: PrivateActorType,
  actorId: string
): Map<string, Debate> {
  const assigned = new Map<string, Debate>();
  for (const [id, debate] of liveDebates) {
    const isAssigned = actorType === "adjudicator"
      ? debate.adjudicators?.chairId === actorId ||
        debate.adjudicators?.panellistIds?.includes(actorId) === true ||
        debate.adjudicators?.traineeIds?.includes(actorId) === true
      : Object.values(debate.teams || {}).some((slot) => slot?.teamId === actorId);
    if (isAssigned) assigned.set(id, debate);
  }
  return assigned;
}

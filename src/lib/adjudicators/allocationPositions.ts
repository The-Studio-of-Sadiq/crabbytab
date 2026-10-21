import type { TournamentPreferences } from "@/types";

export type AllocationPosition = "chair" | "panellist" | "trainee";

/**
 * Whether an allocation position may take adjudicators. Tabbycat's `no_panellist_position` and
 * `no_trainee_position` remove those positions from the allocation interface as well as from the
 * auto-allocator; the chair position is always open. Adjudicators already seated in a closed
 * position stay visible so the tab room can move them out.
 */
export function allocationPositionOpen(
  role: AllocationPosition,
  preferences: Pick<TournamentPreferences, "noPanellistAdjs" | "noTraineeAdjs"> | undefined
): boolean {
  if (role === "panellist") return preferences?.noPanellistAdjs !== true;
  if (role === "trainee") return preferences?.noTraineeAdjs !== true;
  return true;
}

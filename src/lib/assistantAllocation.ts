import type { DebateAdjudicatorSlot } from "@/types";

/**
 * Adjudicator allocations made by adjudication-core staff (`allocation.edit`,
 * docs/staff-access.md), checked on the server before anything is written. The plan covers one
 * round at a time and is all-or-nothing for that round, so moving an adjudicator between two
 * rooms is checked on the final state rather than one room at a time.
 */

export interface AllocationDebateState {
  id: string;
  roundId: string;
  adjudicators?: Partial<DebateAdjudicatorSlot>;
  resultStatus?: unknown;
  syncVersion?: unknown;
  deletedAt?: unknown;
}

export interface AllocationRoundState {
  id: string;
  cancelled?: boolean;
  completed?: boolean;
  deletedAt?: unknown;
}

export interface AllocationPlan {
  /** Debates to write, with the panel (names filled from the adjudicator records). */
  updates: Array<{ debateId: string; adjudicators: DebateAdjudicatorSlot; syncVersion: number }>;
  /** Debates whose change was refused, with the reason. */
  refused: Array<{ debateId: string; reason: string }>;
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function panelIds(panel: Partial<DebateAdjudicatorSlot> | undefined): { chairId?: string; panellistIds: string[]; traineeIds: string[] } {
  return {
    ...(typeof panel?.chairId === "string" && panel.chairId ? { chairId: panel.chairId } : {}),
    panellistIds: ids(panel?.panellistIds),
    traineeIds: ids(panel?.traineeIds),
  };
}

function samePanel(left: Partial<DebateAdjudicatorSlot> | undefined, right: Partial<DebateAdjudicatorSlot> | undefined): boolean {
  const a = panelIds(left);
  const b = panelIds(right);
  return a.chairId === b.chairId &&
    a.panellistIds.join("\u0000") === b.panellistIds.join("\u0000") &&
    a.traineeIds.join("\u0000") === b.traineeIds.join("\u0000");
}

function members(panel: { chairId?: string; panellistIds: string[]; traineeIds: string[] }): string[] {
  return [...(panel.chairId ? [panel.chairId] : []), ...panel.panellistIds, ...panel.traineeIds];
}

/** Debates among `incoming` whose panel differs from the stored one. */
export function changedPanels(
  incoming: readonly AllocationDebateState[],
  currentById: ReadonlyMap<string, AllocationDebateState>
): AllocationDebateState[] {
  return incoming.filter((debate) => {
    const current = currentById.get(debate.id);
    return current !== undefined && !samePanel(debate.adjudicators, current.adjudicators);
  });
}

/**
 * Plans the panel changes of one round. `roundDebates` are every stored debate of the round,
 * `incoming` the debates the staff member changed (from `changedPanels`), and `adjudicatorNames`
 * the live (not deleted) adjudicators. A change is refused when the device's copy is older than
 * the stored debate, the round is closed, the debate already has a confirmed result, or the panel
 * names unknown or repeated adjudicators; if any change in the round is refused, none is written.
 */
export function planAssistantAllocation(input: {
  round: AllocationRoundState | undefined;
  roundDebates: readonly AllocationDebateState[];
  incoming: readonly AllocationDebateState[];
  adjudicatorNames: ReadonlyMap<string, string>;
}): AllocationPlan {
  const { round, roundDebates, incoming, adjudicatorNames } = input;
  const currentById = new Map(roundDebates.map((debate) => [debate.id, debate]));
  const refused: AllocationPlan["refused"] = [];
  const nextPanels = new Map<string, { chairId?: string; panellistIds: string[]; traineeIds: string[] }>();

  for (const debate of incoming) {
    const current = currentById.get(debate.id);
    const refuse = (reason: string) => refused.push({ debateId: debate.id, reason });
    if (!current || typeof current.deletedAt === "string" || current.roundId !== debate.roundId) {
      refuse("The debate no longer exists.");
    } else if (!round || typeof round.deletedAt === "string" || round.id !== current.roundId) {
      refuse("The round no longer exists.");
    } else if (round.cancelled === true || round.completed === true) {
      refuse("The round is closed.");
    } else if (current.resultStatus === "confirmed") {
      refuse("The debate already has a confirmed result.");
    } else if ((Number(debate.syncVersion) || 0) !== (Number(current.syncVersion) || 0)) {
      refuse("The allocation changed since this device loaded it. Reload and try again.");
    } else {
      const panel = panelIds(debate.adjudicators);
      const people = members(panel);
      if (people.some((id) => !adjudicatorNames.has(id))) refuse("The panel names an adjudicator who does not exist.");
      else if (new Set(people).size !== people.length) refuse("An adjudicator appears twice on the panel.");
      else nextPanels.set(debate.id, panel);
    }
  }

  if (refused.length === 0) {
    // Final state of the round: no adjudicator may sit in two rooms.
    const seen = new Map<string, string>();
    for (const debate of roundDebates) {
      if (typeof debate.deletedAt === "string") continue;
      const panel = nextPanels.get(debate.id) ?? panelIds(debate.adjudicators);
      for (const id of members(panel)) {
        const other = seen.get(id);
        if (other && other !== debate.id) {
          const name = adjudicatorNames.get(id) ?? id;
          for (const changed of nextPanels.keys()) {
            refused.push({ debateId: changed, reason: `${name} would be in two rooms in this round.` });
          }
          return { updates: [], refused };
        }
        seen.set(id, debate.id);
      }
    }
  }
  if (refused.length > 0) {
    // All-or-nothing per round: the other changes are refused too.
    const refusedIds = new Set(refused.map((item) => item.debateId));
    for (const debateId of nextPanels.keys()) {
      if (!refusedIds.has(debateId)) refused.push({ debateId, reason: "Another change in this round was refused." });
    }
    return { updates: [], refused };
  }

  return {
    refused,
    updates: [...nextPanels.entries()].map(([debateId, panel]) => ({
      debateId,
      syncVersion: (Number(currentById.get(debateId)?.syncVersion) || 0) + 1,
      adjudicators: {
        ...(panel.chairId ? { chairId: panel.chairId, chairName: adjudicatorNames.get(panel.chairId) ?? "" } : {}),
        panellistIds: panel.panellistIds,
        panellistNames: panel.panellistIds.map((id) => adjudicatorNames.get(id) ?? ""),
        traineeIds: panel.traineeIds,
        traineeNames: panel.traineeIds.map((id) => adjudicatorNames.get(id) ?? ""),
      },
    })),
  };
}

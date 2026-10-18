import type { Adjudicator, AuditCategory, PreformedPanel, Round } from "@/types";

export type PanelRole = "chair" | "panellist" | "trainee";

export function emptyPreformedPanel(id: string, importance = 0): PreformedPanel {
  return { id, panellistIds: [], traineeIds: [], importance };
}

export function panelMemberIds(panel: PreformedPanel): string[] {
  return [panel.chairId, ...panel.panellistIds, ...panel.traineeIds].filter((id): id is string => Boolean(id));
}

function withoutAdjudicator(panel: PreformedPanel, adjudicatorId: string): PreformedPanel {
  return {
    ...panel,
    chairId: panel.chairId === adjudicatorId ? undefined : panel.chairId,
    panellistIds: panel.panellistIds.filter((id) => id !== adjudicatorId),
    traineeIds: panel.traineeIds.filter((id) => id !== adjudicatorId),
  };
}

/** Removes an adjudicator from every panel. */
export function removeFromPanels(panels: PreformedPanel[], adjudicatorId: string): PreformedPanel[] {
  return panels.map((panel) => withoutAdjudicator(panel, adjudicatorId));
}

/**
 * Seats an adjudicator in one panel and role, removing them from wherever they were.
 * A displaced chair becomes a panellist of the same panel.
 */
export function assignToPanel(
  panels: PreformedPanel[],
  panelId: string,
  adjudicatorId: string,
  role: PanelRole
): PreformedPanel[] {
  return removeFromPanels(panels, adjudicatorId).map((panel) => {
    if (panel.id !== panelId) return panel;
    if (role === "chair") {
      return {
        ...panel,
        chairId: adjudicatorId,
        panellistIds: panel.chairId ? [...panel.panellistIds, panel.chairId] : panel.panellistIds,
      };
    }
    if (role === "panellist") return { ...panel, panellistIds: [...panel.panellistIds, adjudicatorId] };
    return { ...panel, traineeIds: [...panel.traineeIds, adjudicatorId] };
  });
}

/**
 * Builds panels from the CSV preformed_panel_id groups. The strongest non-trainee in a
 * group chairs; trainees stay trainees. Groups are ordered by their id.
 */
export function panelsFromPreformedIds(adjudicators: Adjudicator[]): PreformedPanel[] {
  const groups = new Map<string, Adjudicator[]>();
  for (const adjudicator of adjudicators) {
    const groupId = adjudicator.preformedPanelId?.trim();
    if (!groupId) continue;
    groups.set(groupId, [...(groups.get(groupId) ?? []), adjudicator]);
  }
  return [...groups.keys()].sort((a, b) => a.localeCompare(b)).map((groupId) => {
    const members = groups.get(groupId)!;
    const voters = members
      .filter((member) => !member.trainee)
      .sort((a, b) => b.baseScore - a.baseScore || a.name.localeCompare(b.name));
    return {
      id: `csv-${groupId}`,
      chairId: voters[0]?.id,
      panellistIds: voters.slice(1).map((member) => member.id),
      traineeIds: members.filter((member) => member.trainee).map((member) => member.id),
      importance: 0,
    };
  });
}

/** Problems that would make a set of panels unusable; empty when they can be saved. */
export function validatePreformedPanels(
  panels: PreformedPanel[],
  adjudicators: Array<Pick<Adjudicator, "id" | "name" | "trainee">>
): string[] {
  const errors: string[] = [];
  const byId = new Map(adjudicators.map((adjudicator) => [adjudicator.id, adjudicator]));
  const seenIn = new Map<string, number>();
  const ids = new Set<string>();

  panels.forEach((panel, index) => {
    const label = `Panel ${index + 1}`;
    if (ids.has(panel.id)) errors.push(`${label} has a duplicate id.`);
    ids.add(panel.id);
    if (!Number.isFinite(panel.importance) || panel.importance < 0 || panel.importance > 10) {
      errors.push(`${label}: importance must be between 0 and 10.`);
    }
    if (!panel.chairId) errors.push(`${label} needs a chair.`);
    for (const id of panelMemberIds(panel)) {
      const adjudicator = byId.get(id);
      if (!adjudicator) {
        errors.push(`${label} includes an adjudicator who no longer exists.`);
        continue;
      }
      const earlier = seenIn.get(id);
      if (earlier !== undefined) {
        errors.push(`${adjudicator.name} is in Panel ${earlier + 1} and ${label}.`);
      } else {
        seenIn.set(id, index);
      }
    }
    for (const id of [panel.chairId, ...panel.panellistIds]) {
      const adjudicator = id ? byId.get(id) : undefined;
      if (adjudicator?.trainee) errors.push(`${label}: ${adjudicator.name} is a trainee and cannot vote.`);
    }
  });
  return errors;
}

export interface PreformedPanelDependencies {
  rounds: Round[];
  adjudicators: Adjudicator[];
  updateRound(round: Round): Promise<void>;
  recordAuditEvent(event: {
    action: string;
    category: AuditCategory;
    summary: string;
    roundId?: string;
    details?: Record<string, unknown>;
  }): Promise<void>;
}

/** Validates and stores a round's preformed panels. Throws with every problem when invalid. */
export async function savePreformedPanelsCommand(
  roundId: string,
  panels: PreformedPanel[],
  dependencies: PreformedPanelDependencies
): Promise<void> {
  const round = dependencies.rounds.find((item) => item.id === roundId);
  if (!round) throw new Error("That round no longer exists.");
  const errors = validatePreformedPanels(panels, dependencies.adjudicators);
  if (errors.length > 0) throw new Error(errors.join(" "));

  await dependencies.updateRound({ ...round, preformedPanels: panels });
  await dependencies.recordAuditEvent({
    action: "adjudicators.preformed_panels_saved",
    category: "allocation",
    summary: `Saved ${panels.length} preformed panel(s) for ${round.name}`,
    roundId,
    details: { panels },
  });
}

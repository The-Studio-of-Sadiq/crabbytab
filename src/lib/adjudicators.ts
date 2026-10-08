import type { Adjudicator, DebateAdjudicatorSlot } from "@/types";

export function getPanelistNamesByScore(
  slot: Partial<DebateAdjudicatorSlot> | undefined,
  adjudicators: Adjudicator[]
): string[] {
  const ids = slot?.panellistIds || [];
  const names =
    slot?.panellistNames && slot.panellistNames.length > 0
      ? slot.panellistNames
      : ids.map((id) => adjudicators.find((adjudicator) => adjudicator.id === id)?.name || id);

  return names
    .map((name, index) => ({
      name,
      score:
        adjudicators.find((adjudicator) => adjudicator.id === ids[index] || adjudicator.name === name)
          ?.baseScore ?? -Infinity,
      index,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ name }) => name);
}

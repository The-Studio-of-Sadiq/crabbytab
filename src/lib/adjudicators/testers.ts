import type { Adjudicator, Debate } from "@/types";

/**
 * Adjudicator testers (Tabbycat adjfeedback/testers.py). An adjudicator is a tester when they are
 * on the adjudication core or have been marked as one (`isTester`). An adjudicator counts as
 * *tested* in a round when a tester other than themselves sat on their panel in that round.
 */
export function isAdjudicatorTester(adjudicator: Pick<Adjudicator, "adjCore" | "isTester">): boolean {
  return adjudicator.adjCore === true || adjudicator.isTester === true;
}

function panelIds(debate: Pick<Debate, "adjudicators">): string[] {
  const panel = debate.adjudicators;
  if (!panel) return [];
  return [
    ...new Set(
      [panel.chairId, ...(panel.panellistIds ?? []), ...(panel.traineeIds ?? [])].filter(
        (id): id is string => typeof id === "string" && id !== ""
      )
    ),
  ];
}

/** Adjudicator id -> ids of the rounds in which they were tested. */
export function testedRounds(
  adjudicators: Array<Pick<Adjudicator, "id" | "adjCore" | "isTester">>,
  debates: Array<Pick<Debate, "roundId" | "adjudicators">>
): Map<string, Set<string>> {
  const testers = new Set(adjudicators.filter(isAdjudicatorTester).map((adjudicator) => adjudicator.id));
  const tested = new Map<string, Set<string>>();
  if (testers.size === 0) return tested;
  for (const debate of debates) {
    const ids = panelIds(debate);
    const onPanel = ids.filter((id) => testers.has(id));
    if (onPanel.length === 0) continue;
    for (const id of ids) {
      if (!onPanel.some((tester) => tester !== id)) continue;
      const rounds = tested.get(id) ?? new Set<string>();
      rounds.add(debate.roundId);
      tested.set(id, rounds);
    }
  }
  return tested;
}

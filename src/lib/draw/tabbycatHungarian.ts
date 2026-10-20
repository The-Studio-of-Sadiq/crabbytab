/**
 * Tabbycat's two Hungarian adjudicator allocators (`adjallocation/allocators/hungarian.py`,
 * v2.12.1), as selectable strategies next to CrabbyTab's own.
 *
 * - **Voting** ("hungarian-voting"): the strongest voters are "solos". With D debates and V voters,
 *   `max(D - floor((V - D) / 2), 0)` solos chair the most important debates alone; the remaining
 *   voters form panels of three in the less important debates (the third seat of the top half of
 *   those panels may be a point weaker). Trainees (and voters below the minimum voting score) go
 *   one per solo debate. This follows Tabbycat's code: it is the solo debates, not the panels,
 *   that get the top rooms.
 * - **Consensus** ("hungarian-consensus"): every voter is used; panels are as even as possible
 *   (the most important debates get the extra member), each further seat may be a point weaker,
 *   and trainees go one per debate.
 *
 * Cost of seating an adjudicator (Tabbycat `calc_cost`): conflict and history costs with the
 * debate's teams (and, for trainees, the chair), plus `1000 * exp(diff - 0.25)` when
 * `diff = 5 + importance - score > 0.25`, plus `5 - score`. Scores are normalised to 0-5 (CrabbyTab
 * scores are 0-10) and importance to 1-5 (from the debate's 0-10 priority). Differences from
 * Tabbycat: no random shuffle before sorting voters (ties break by score, then id, so the result is
 * reproducible — Tabbycat's "deterministic Hungarian" wish), and conflict/history costs use
 * CrabbyTab's configured penalties.
 */
import { solveHungarian } from "./hungarian";

export type TabbycatHungarianMode = "voting" | "consensus";

export interface HungarianCandidate {
  id: string;
  /** Effective score on CrabbyTab's 0-10 scale. */
  score: number;
}

export interface HungarianDebateInput {
  id: string;
  /** CrabbyTab debate priority, 0-10. */
  priority: number;
}

export interface TabbycatHungarianInput {
  mode: TabbycatHungarianMode;
  /** Debates in allocation order: most important first. */
  debates: HungarianDebateInput[];
  /** Voters (non-trainees at or above the minimum voting score). */
  voters: HungarianCandidate[];
  /** Trainees and adjudicators below the minimum voting score; empty when trainees are off. */
  trainees: HungarianCandidate[];
  noPanellists: boolean;
  /** Tabbycat's "no trainee position": nobody is seated as a trainee. */
  noTrainees: boolean;
  /** Conflict and history cost of an adjudicator in a debate (teams and, when given, the chair). */
  conflictCost(adjudicatorId: string, debateId: string, chairId?: string): number;
}

export interface TabbycatHungarianPanel {
  debateId: string;
  chairId?: string;
  panellistIds: string[];
  traineeIds: string[];
}

export interface TabbycatHungarianResult {
  panels: TabbycatHungarianPanel[];
  /** Tabbycat's user warnings (too few voters or panellists). */
  warnings: string[];
}

export function normalisedAdjudicatorScore(score: number): number {
  return score / 2;
}

export function normalisedImportance(priority: number): number {
  return 1 + Math.max(0, Math.min(10, priority)) * 0.4;
}

/** Tabbycat's strength part of calc_cost (without conflicts). */
export function hungarianStrengthCost(priority: number, score: number, adjustment = 0): number {
  const normalised = normalisedAdjudicatorScore(score);
  const diff = 5 + normalisedImportance(priority) + adjustment - normalised;
  let cost = 0;
  if (diff > 0.25) cost += 1000 * Math.exp(diff - 0.25);
  return cost + (5 - normalised);
}

function byScore(a: HungarianCandidate, b: HungarianCandidate): number {
  return b.score - a.score || a.id.localeCompare(b.id);
}

function seatTrainees(
  input: TabbycatHungarianInput,
  trainees: HungarianCandidate[],
  panels: TabbycatHungarianPanel[]
): void {
  if (trainees.length === 0 || panels.length === 0) return;
  const priorityOf = new Map(input.debates.map((debate) => [debate.id, debate.priority]));
  const costs = panels.map((panel) =>
    trainees.map(
      (trainee) =>
        input.conflictCost(trainee.id, panel.debateId, panel.chairId) +
        hungarianStrengthCost(priorityOf.get(panel.debateId) ?? 5, trainee.score, -2)
    )
  );
  solveHungarian(costs).forEach((traineeIndex, panelIndex) => {
    if (traineeIndex >= 0 && traineeIndex < trainees.length) panels[panelIndex].traineeIds.push(trainees[traineeIndex].id);
  });
}

function seatPanels(
  input: TabbycatHungarianInput,
  debates: HungarianDebateInput[],
  seatsPerDebate: number[],
  candidates: HungarianCandidate[],
  adjustmentFor: (debateIndex: number, seat: number) => number
): TabbycatHungarianPanel[] {
  const rows: Array<{ debateIndex: number; seat: number }> = [];
  debates.forEach((_, debateIndex) => {
    for (let seat = 0; seat < seatsPerDebate[debateIndex]; seat++) rows.push({ debateIndex, seat });
  });
  const members: HungarianCandidate[][] = debates.map(() => []);
  if (rows.length > 0 && candidates.length > 0) {
    const costs = rows.map(({ debateIndex, seat }) =>
      candidates.map(
        (candidate) =>
          input.conflictCost(candidate.id, debates[debateIndex].id) +
          hungarianStrengthCost(debates[debateIndex].priority, candidate.score, adjustmentFor(debateIndex, seat))
      )
    );
    solveHungarian(costs).forEach((candidateIndex, rowIndex) => {
      if (candidateIndex >= 0 && candidateIndex < candidates.length) {
        members[rows[rowIndex].debateIndex].push(candidates[candidateIndex]);
      }
    });
  }
  return debates.map((debate, debateIndex) => {
    const panel = [...members[debateIndex]].sort(byScore);
    return {
      debateId: debate.id,
      chairId: panel[0]?.id,
      panellistIds: panel.slice(1).map((member) => member.id),
      traineeIds: [],
    };
  });
}

export function allocateTabbycatHungarian(input: TabbycatHungarianInput): TabbycatHungarianResult {
  const warnings: string[] = [];
  const debates = input.debates;
  const voting = [...input.voters].sort(byScore);
  const trainees = [...input.trainees].sort(byScore);
  if (debates.length === 0) return { panels: [], warnings };
  if (voting.length === 0) {
    warnings.push(
      "There are no adjudicators eligible to be a chair or panellist. Lower the minimum score to vote and try again."
    );
    return { panels: debates.map((debate) => ({ debateId: debate.id, panellistIds: [], traineeIds: [] })), warnings };
  }
  if (voting.length < debates.length) {
    warnings.push(`There are ${debates.length} debates but only ${voting.length} voting adjudicators.`);
  }

  if (input.mode === "consensus") {
    const used = input.noPanellists ? voting.slice(0, debates.length) : voting;
    // Voters left out by "no panellists" join the trainees, as in Tabbycat.
    const leftOver = input.noPanellists ? voting.slice(debates.length) : [];
    const floor = Math.floor(used.length / debates.length);
    const bigger = used.length % debates.length;
    const seats = debates.map((_, index) => (index < bigger ? floor + 1 : floor));
    const panels = seatPanels(input, debates, seats, used, (_, seat) => -seat);
    if (!input.noTrainees) seatTrainees(input, [...leftOver, ...trainees].sort(byScore), panels);
    return { panels, warnings };
  }

  const expectedSolos = input.noPanellists
    ? Math.min(debates.length, voting.length)
    : Math.max(debates.length - Math.floor((voting.length - debates.length) / 2), 0);
  const solos = voting.slice(0, expectedSolos);
  const panellists = input.noPanellists ? [] : voting.slice(expectedSolos);
  const soloDebates = debates.slice(0, solos.length);
  const panelDebates = debates.slice(solos.length);
  if (panellists.length < panelDebates.length * 3) {
    warnings.push(
      `There are ${panelDebates.length} panel debates but only ${panellists.length} available panellists (less than ${panelDebates.length * 3}).`
    );
  }

  const soloPanels = seatPanels(input, soloDebates, soloDebates.map(() => 1), solos, () => 0);
  const half = panelDebates.length / 2;
  const panelPanels = seatPanels(
    input,
    panelDebates,
    panelDebates.map(() => 3),
    panellists,
    (debateIndex, seat) => (debateIndex < half && seat === 2 ? -1 : 0)
  );
  // Trainees go one per solo debate; the rest stay unallocated, as in Tabbycat.
  if (!input.noTrainees) seatTrainees(input, trainees, soloPanels);
  return { panels: [...soloPanels, ...panelPanels], warnings };
}

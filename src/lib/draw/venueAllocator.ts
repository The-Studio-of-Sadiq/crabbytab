import { Adjudicator, Debate, Venue } from "@/types";
import { solveHungarian } from "./hungarian";
import {
  constraintLookup,
  debateVenueConstraints,
  isVenueAvailableForRound,
  venueInCategory,
  type ApplicableVenueConstraint,
  type VenueConstraintContext,
} from "@/lib/venues/venues";

export function getVenueIncompatibilities(debate: Debate, venue: Venue): string[] {
  const reasons: string[] = [];
  const requiredCategory = debate.requiredVenueCategory?.trim().toLowerCase();

  if (requiredCategory && !venueInCategory(venue, requiredCategory)) {
    reasons.push(`requires ${debate.requiredVenueCategory} category`);
  }
  if (
    debate.requiredVenueCapacity !== undefined &&
    (venue.capacity === undefined || venue.capacity < debate.requiredVenueCapacity)
  ) {
    reasons.push(`requires capacity of at least ${debate.requiredVenueCapacity}`);
  }
  if (debate.requiresAccessibleVenue && !venue.accessible) {
    reasons.push("requires an accessible venue");
  }
  if (debate.requiresOnlineVenue && !venue.online) {
    reasons.push("requires an online-capable venue");
  }
  if (debate.requiresNearTabRoom && !venue.nearTabRoom) {
    reasons.push("requires a venue near the tab room");
  }

  return reasons;
}

export interface AdjudicatorVenueRequirementsOutcome {
  debates: Debate[];
  /**
   * Debates whose panel asks for more than one hard room category. Their category requirement is
   * left as the debate's own (the other requirements still apply) and the clash is reported here,
   * so one awkward panel never aborts the whole allocation.
   */
  problems: Array<{ debateId: string; message: string }>;
}

export function applyAdjudicatorVenueRequirements(
  debates: Debate[],
  adjudicators: Adjudicator[]
): AdjudicatorVenueRequirementsOutcome {
  const adjudicatorsById = new Map(adjudicators.map((adjudicator) => [adjudicator.id, adjudicator]));
  const problems: AdjudicatorVenueRequirementsOutcome["problems"] = [];
  const updated = debates.map((debate) => {
    const assignedIds = [
      debate.adjudicators.chairId,
      ...(debate.adjudicators.panellistIds || []),
      ...(debate.adjudicators.traineeIds || []),
    ].filter((id): id is string => Boolean(id));
    const requirements = assignedIds
      .map((id) => adjudicatorsById.get(id)?.venueRequirements)
      .filter((item) => item !== undefined);
    const categories = [...new Set([
      debate.requiredVenueCategory?.trim(),
      ...requirements
      .map((item) => item?.category?.trim())
      .filter((category): category is string => Boolean(category)),
    ].filter((category): category is string => Boolean(category)))];
    if (categories.length > 1) {
      problems.push({
        debateId: debate.id,
        message: `Adjudicators assigned to ${debate.venueName || `Room ${debate.roomRank}`} require incompatible venue categories: ${categories.join(", ")}.`,
      });
    }
    return {
      ...debate,
      requiredVenueCategory: categories.length === 1 ? categories[0] : debate.requiredVenueCategory,
      requiredVenueCapacity: Math.max(
        debate.requiredVenueCapacity ?? 0,
        ...requirements.map((item) => item?.minimumCapacity ?? 0)
      ) || undefined,
      requiresAccessibleVenue: debate.requiresAccessibleVenue ||
        requirements.some((item) => item?.accessible === true) || undefined,
      requiresOnlineVenue: debate.requiresOnlineVenue ||
        requirements.some((item) => item?.online === true) || undefined,
      requiresNearTabRoom: debate.requiresNearTabRoom ||
        requirements.some((item) => item?.nearTabRoom === true) || undefined,
    };
  });
  return { debates: updated, problems };
}

/** Integer costs above this lose precision in the Hungarian solver's sums. */
const SAFE_COST = 2 ** 50;

/**
 * Penalty per unmet soft constraint, by priority. Weights are lexicographic: missing one
 * constraint of a priority costs more than missing every constraint of all lower priorities
 * together, and the smallest weight outweighs any difference in room ranking. If the weights would
 * be too large for exact arithmetic, each priority level instead weighs its rank (1, 2, ...) times
 * the unit, which still puts every constraint above room ranking.
 */
function constraintWeights(
  constraintsByDebate: ApplicableVenueConstraint[][],
  unit: number,
  limit: number = SAFE_COST
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const constraints of constraintsByDebate) {
    for (const constraint of constraints) counts.set(constraint.priority, (counts.get(constraint.priority) ?? 0) + 1);
  }
  const levels = [...counts.keys()].sort((a, b) => a - b);
  const weights = new Map<number, number>();
  let lowerTotal = 0;
  for (const level of levels) {
    const weight = (lowerTotal + 1) * unit;
    weights.set(level, weight);
    lowerTotal += counts.get(level)! * (lowerTotal + 1);
  }
  if ((lowerTotal + 1) * unit * Math.max(1, constraintsByDebate.length) > limit) {
    levels.forEach((level, index) => weights.set(level, (index + 1) * unit));
  }
  return weights;
}

export interface VenueAllocationOutcome {
  /** Debate id to its room. */
  assignments: Map<string, Venue>;
  /** Debates left without a room, with the reason (too few rooms, or no room meets its requirements). */
  unassigned: Array<{ debateId: string; message: string }>;
}

function debateLabel(debate: Debate): string {
  return debate.venueName || `Room ${debate.roomRank}`;
}

/**
 * Assigns rooms to a round's debates with a minimum-cost matching. Hard requirements
 * (category/capacity/access/online/near the tab room on the debate) must hold; soft ranked
 * constraints of the debate's teams, adjudicators and institutions (`context`) are met where
 * possible, higher priority first (Tabbycat's venue constraints, but optimal instead of greedy);
 * then higher-ranked debates get higher-priority rooms. Rooms unavailable in the debates' round are
 * not used.
 *
 * As Tabbycat's VenueAllocator (venues/allocator.py), a shortage never stops the allocation: as
 * many debates as possible get a room (the lowest-ranked debates go without when rooms run out)
 * and every debate left without one is reported in `unassigned`. A debate whose hard requirements
 * no free room meets is left without a room and reported too, never given an unsuitable room.
 */
export function allocateVenuesBestEffort(
  debates: Debate[],
  venues: Venue[],
  context?: VenueConstraintContext
): VenueAllocationOutcome {
  const roundId = debates[0]?.roundId;
  const rooms = venues
    .filter((venue) => isVenueAvailableForRound(venue, roundId))
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const eligibleDebates = debates
    .filter((debate) => !debate.byeTeamId && !debate.postponed)
    .sort(
      (a, b) =>
        b.bracket - a.bracket ||
        b.importance - a.importance ||
        a.roomRank - b.roomRank ||
        a.id.localeCompare(b.id)
    );
  const assignments = new Map<string, Venue>();
  if (eligibleDebates.length === 0) return { assignments, unassigned: [] };

  const n = eligibleDebates.length;
  const rankingTotal = (n + 1) * (rooms.length + 1) ** 2;
  const lookup = context ? constraintLookup(context) : undefined;
  const constraintsByDebate = eligibleDebates.map((debate) => (lookup ? debateVenueConstraints(debate, lookup) : []));
  const compatible = eligibleDebates.map((debate) =>
    rooms.map((venue) => getVenueIncompatibilities(debate, venue).length === 0)
  );
  const realCosts = (weights: Map<number, number>) =>
    eligibleDebates.map((_, debateRank) =>
      rooms.map((venue, venueRank) => {
        let cost = Math.abs(debateRank - venueRank) * (rooms.length + 1) + venueRank;
        for (const constraint of constraintsByDebate[debateRank]) {
          if (!venueInCategory(venue, constraint.category)) cost += weights.get(constraint.priority)!;
        }
        return cost;
      })
    );

  // Enough rooms: the plain matching (an incompatible pair costs more than any valid assignment).
  if (rooms.length >= n) {
    const weights = constraintWeights(constraintsByDebate, rankingTotal);
    const softTotal = constraintsByDebate.reduce(
      (sum, constraints) => sum + constraints.reduce((inner, constraint) => inner + weights.get(constraint.priority)!, 0),
      0
    );
    // Without constraints this is the original invalid cost, so plain draws are unchanged.
    const invalidCost = rankingTotal + softTotal;
    const costs = realCosts(weights).map((row, debateRank) =>
      row.map((cost, venueRank) => (compatible[debateRank][venueRank] ? cost : invalidCost))
    );
    const solution = solveHungarian(costs);
    if (eligibleDebates.every((_, index) => compatible[index][solution[index]] === true)) {
      eligibleDebates.forEach((debate, index) => assignments.set(debate.id, rooms[solution[index]]));
      return { assignments, unassigned: [] };
    }
  }

  // Too few rooms, or requirements that cannot all hold at once: one "no room" column per debate.
  // A room costs less than going without (`skip` outweighs every difference between valid
  // assignments, so as many debates as possible get a room) and an unsuitable room costs more
  // than going without, so it is never used.
  const weights = constraintWeights(constraintsByDebate, rankingTotal, SAFE_COST / (4 * (n + 1) ** 2));
  const costs = realCosts(weights);
  const largest = costs.reduce((max, row) => row.reduce((inner, cost) => Math.max(inner, cost), max), 0) + 1;
  const skip = largest * (n + 1);
  const unsuitable = skip * 2;
  const matrix = costs.map((row, debateRank) => [
    ...row.map((cost, venueRank) => (compatible[debateRank][venueRank] ? cost : unsuitable)),
    ...Array.from({ length: n }, () => skip),
  ]);
  const solution = solveHungarian(matrix);
  const unassigned: VenueAllocationOutcome["unassigned"] = [];
  const shortage = rooms.length < n;
  eligibleDebates.forEach((debate, index) => {
    const venueIndex = solution[index];
    if (venueIndex >= 0 && venueIndex < rooms.length && compatible[index][venueIndex]) {
      assignments.set(debate.id, rooms[venueIndex]);
      return;
    }
    const compatibleCount = compatible[index].filter(Boolean).length;
    unassigned.push({
      debateId: debate.id,
      message: compatibleCount === 0
        ? `No available venue meets the requirements for ${debateLabel(debate)}.`
        : shortage
          ? `Not enough available venues: ${n} required, but only ${rooms.length} available, so ${debateLabel(debate)} has no room.`
          : `Available venues cannot satisfy all debate requirements at the same time, so ${debateLabel(debate)} has no room.`,
    });
  });
  return { assignments, unassigned };
}

/**
 * allocateVenuesBestEffort, but every debate must get a room: throws with the reason when one
 * cannot.
 */
export function allocateVenuesToDebates(
  debates: Debate[],
  venues: Venue[],
  context?: VenueConstraintContext
): Map<string, Venue> {
  const { assignments, unassigned } = allocateVenuesBestEffort(debates, venues, context);
  if (unassigned.length > 0) {
    const required = debates.filter((debate) => !debate.byeTeamId && !debate.postponed).length;
    const available = venues.filter((venue) => isVenueAvailableForRound(venue, debates[0]?.roundId)).length;
    throw new Error(
      available < required
        ? `Not enough available venues: ${required} required, but only ${available} available.`
        : unassigned[0].message
    );
  }
  return assignments;
}

/**
 * Applies a best-effort room allocation: allocated debates get their room; debates left without
 * one lose any room they had (it may now be another debate's) and show their room number instead.
 */
export function withAllocatedVenues(debates: Debate[], outcome: VenueAllocationOutcome): Debate[] {
  const unassigned = new Set(outcome.unassigned.map((item) => item.debateId));
  return debates.map((debate) => {
    const venue = outcome.assignments.get(debate.id);
    if (venue) return { ...debate, venueId: venue.id, venueName: venue.name };
    if (unassigned.has(debate.id)) return { ...debate, venueId: undefined, venueName: `Room ${debate.roomRank}` };
    return debate;
  });
}

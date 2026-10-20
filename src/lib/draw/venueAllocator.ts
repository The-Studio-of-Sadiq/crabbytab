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

export function applyAdjudicatorVenueRequirements(
  debates: Debate[],
  adjudicators: Adjudicator[]
): Debate[] {
  const adjudicatorsById = new Map(adjudicators.map((adjudicator) => [adjudicator.id, adjudicator]));
  return debates.map((debate) => {
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
      throw new Error(`Adjudicators assigned to ${debate.venueName || debate.id} require incompatible venue categories: ${categories.join(", ")}.`);
    }
    return {
      ...debate,
      requiredVenueCategory: categories[0] || debate.requiredVenueCategory,
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
function constraintWeights(constraintsByDebate: ApplicableVenueConstraint[][], unit: number): Map<number, number> {
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
  if ((lowerTotal + 1) * unit * Math.max(1, constraintsByDebate.length) > SAFE_COST) {
    levels.forEach((level, index) => weights.set(level, (index + 1) * unit));
  }
  return weights;
}

/**
 * Assigns rooms to a round's debates with a minimum-cost matching. Hard requirements
 * (category/capacity/access/online/near the tab room on the debate) must hold; soft ranked
 * constraints of the debate's teams, adjudicators and institutions (`context`) are met where
 * possible, higher priority first (Tabbycat's venue constraints, but optimal instead of greedy);
 * then higher-ranked debates get higher-priority rooms. Rooms unavailable in the debates' round are
 * not used.
 */
export function allocateVenuesToDebates(
  debates: Debate[],
  venues: Venue[],
  context?: VenueConstraintContext
): Map<string, Venue> {
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

  if (rooms.length < eligibleDebates.length) {
    throw new Error(
      `Not enough available venues: ${eligibleDebates.length} required, but only ${rooms.length} available.`
    );
  }
  if (eligibleDebates.length === 0) return new Map();

  const rankingTotal = (eligibleDebates.length + 1) * (rooms.length + 1) ** 2;
  const lookup = context ? constraintLookup(context) : undefined;
  const constraintsByDebate = eligibleDebates.map((debate) => (lookup ? debateVenueConstraints(debate, lookup) : []));
  const weights = constraintWeights(constraintsByDebate, rankingTotal);
  const softTotal = constraintsByDebate.reduce(
    (sum, constraints) => sum + constraints.reduce((inner, constraint) => inner + weights.get(constraint.priority)!, 0),
    0
  );
  // Without constraints this is the original invalid cost, so plain draws are unchanged.
  const invalidCost = rankingTotal + softTotal;
  const costs = eligibleDebates.map((debate, debateRank) =>
    rooms.map((venue, venueRank) => {
      if (getVenueIncompatibilities(debate, venue).length > 0) return invalidCost;
      let cost = Math.abs(debateRank - venueRank) * (rooms.length + 1) + venueRank;
      for (const constraint of constraintsByDebate[debateRank]) {
        if (!venueInCategory(venue, constraint.category)) cost += weights.get(constraint.priority)!;
      }
      return cost;
    })
  );
  const assignments = solveHungarian(costs);
  const result = new Map<string, Venue>();

  eligibleDebates.forEach((debate, index) => {
    const venue = rooms[assignments[index]];
    if (!venue || getVenueIncompatibilities(debate, venue).length > 0) {
      const compatibleVenueCount = rooms.filter(
        (candidate) => getVenueIncompatibilities(debate, candidate).length === 0
      ).length;
      throw new Error(
        compatibleVenueCount === 0
          ? `No available venue meets the requirements for ${debate.venueName || `Room ${debate.roomRank}`}.`
          : "Available venues cannot satisfy all debate requirements at the same time. Check venue availability and debate requirements."
      );
    }
    result.set(debate.id, venue);
  });

  return result;
}

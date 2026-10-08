import { Debate, Venue } from "@/types";
import { solveHungarian } from "./hungarian";

export function getVenueIncompatibilities(debate: Debate, venue: Venue): string[] {
  const reasons: string[] = [];
  const requiredCategory = debate.requiredVenueCategory?.trim().toLowerCase();

  if (
    requiredCategory &&
    venue.category?.trim().toLowerCase() !== requiredCategory
  ) {
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

  return reasons;
}

export function allocateVenuesToDebates(
  debates: Debate[],
  venues: Venue[]
): Map<string, Venue> {
  const rooms = venues
    .filter((venue) => venue.available !== false)
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const eligibleDebates = debates
    .filter((debate) => !debate.byeTeamId)
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

  const invalidCost = (eligibleDebates.length + 1) * (rooms.length + 1) ** 2;
  const costs = eligibleDebates.map((debate, debateRank) =>
    rooms.map((venue, venueRank) =>
      getVenueIncompatibilities(debate, venue).length > 0
        ? invalidCost
        : Math.abs(debateRank - venueRank) * (rooms.length + 1) + venueRank
    )
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

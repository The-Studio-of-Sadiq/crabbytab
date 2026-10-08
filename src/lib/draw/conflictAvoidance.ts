import type { ConflictAvoidance, Team } from "@/types";
import type { MatchupHistory } from "./powerPaired";

function haveMet(a: Team, b: Team, history: MatchupHistory): boolean {
  return history.opponents.get(a.id)?.has(b.id) ?? false;
}

function sameInstitution(a: Team, b: Team): boolean {
  return Boolean(a.institutionId && b.institutionId && a.institutionId === b.institutionId);
}

function roomCost(
  a: Team,
  b: Team,
  history: MatchupHistory,
  repeatMatchupPenalty: number,
  institutionClashPenalty: number
): number {
  let cost = 0;
  if (haveMet(a, b, history)) cost += repeatMatchupPenalty;
  if (sameInstitution(a, b)) cost += institutionClashPenalty;
  return cost;
}

export interface ClashPenalties {
  repeatMatchupPenalty: number;
  institutionClashPenalty: number;
  previouslySawPullupPenalty?: number;
  sideBalancePenalty?: number;
  pairingDeviationPenalty?: number;
}

export const DEFAULT_CLASH_PENALTIES: ClashPenalties = {
  repeatMatchupPenalty: 1000,
  institutionClashPenalty: 200,
};

/**
 * A single greedy pass: for every clashing room, try swapping one of its
 * teams with a team in an adjacent room if that removes the clash without
 * making the adjacent room worse. Cheap, and only ever looks one room away
 * (hence "one up, one down") rather than searching the whole bracket.
 */
function oneUpOneDown(rooms: Team[][], history: MatchupHistory, penalties: ClashPenalties): Team[][] {
  const r = rooms.map((room) => [...room] as Team[]);
  const cost = (room: Team[]) =>
    roomCost(room[0], room[1], history, penalties.repeatMatchupPenalty, penalties.institutionClashPenalty);

  for (let i = 0; i < r.length; i++) {
    if (cost(r[i]) === 0) continue;
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= r.length) continue;
      const before = cost(r[i]) + cost(r[j]);
      for (const slotA of [0, 1]) {
        for (const slotB of [0, 1]) {
          [r[i][slotA], r[j][slotB]] = [r[j][slotB], r[i][slotA]];
          const after = cost(r[i]) + cost(r[j]);
          if (after < before) {
            if (cost(r[i]) === 0) break;
          } else {
            [r[i][slotA], r[j][slotB]] = [r[j][slotB], r[i][slotA]]; // undo
          }
        }
        if (cost(r[i]) === 0) break;
      }
      if (cost(r[i]) === 0) break;
    }
  }
  return r;
}

/** Applies the configured conflict-avoidance strategy to a set of 2-team rooms. */
export function avoidConflicts(
  rooms: Team[][],
  history: MatchupHistory,
  strategy: ConflictAvoidance,
  penalties: ClashPenalties = DEFAULT_CLASH_PENALTIES
): Team[][] {
  switch (strategy) {
    case "off":
      return rooms;
    case "one_up_one_down":
      return oneUpOneDown(rooms, history, penalties);
    case "min_cost":
      // Opponent reassignment would silently replace the configured pairing method.
      // Keep this legacy strategy value compatible without changing its matchups.
      return rooms;
  }
}

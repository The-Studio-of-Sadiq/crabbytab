import type { Debate, DebateSide, DebateTeamSlot } from "@/types";
import { sidesPending } from "./manualSides";

/**
 * Moving teams in the draw editor, shared by drag-and-drop and the keyboard/touch "pick, then
 * place" flow. Pure: returns the full debate list to save through the existing draw commands
 * (so live sync and the state rules apply) plus a sentence to announce.
 */

export type TeamLocation = { kind: "pool" } | { kind: "slot"; debateId: string; side: DebateSide };

export interface PickedTeam {
  teamId: string;
  teamName: string;
  from: TeamLocation;
}

export interface TeamMove {
  /** Every debate, with the move applied; unchanged (same array) when the move does nothing. */
  debates: Debate[];
  /** What happened, for an ARIA live region; empty when nothing changed. */
  announcement: string;
}

function roomName(debate: Debate | undefined): string {
  return debate ? debate.venueName || `Room ${debate.roomRank}` : "the room";
}

/** How a slot is named to the user: no side while sides are chosen on the ballot. */
export function slotName(debate: Debate | undefined, side: DebateSide): string {
  if (!debate) return side;
  return sidesPending(debate) ? roomName(debate) : `${roomName(debate)} ${side}`;
}

function emptySlot(side: DebateSide): DebateTeamSlot {
  return { teamId: "", teamName: "", side };
}

/** A team entering a slot from elsewhere: only its id and name travel (pull-ups belong to the old room). */
function placed(teamId: string, teamName: string, side: DebateSide): DebateTeamSlot {
  return teamId ? { teamId, teamName, side } : emptySlot(side);
}

export function sameLocation(a: TeamLocation, b: TeamLocation): boolean {
  if (a.kind === "pool" || b.kind === "pool") return a.kind === b.kind;
  return a.debateId === b.debateId && a.side === b.side;
}

export function moveTeam(debates: Debate[], pick: PickedTeam, target: TeamLocation): TeamMove {
  const unchanged = { debates, announcement: "" };
  if (sameLocation(pick.from, target)) return unchanged;
  const byId = new Map(debates.map((debate) => [debate.id, debate]));

  if (target.kind === "pool") {
    if (pick.from.kind !== "slot") return unchanged;
    const { debateId, side } = pick.from;
    const source = byId.get(debateId);
    if (!source) return unchanged;
    return {
      debates: debates.map((debate) =>
        debate.id === debateId ? { ...debate, teams: { ...debate.teams, [side]: emptySlot(side) } } : debate
      ),
      announcement: `${pick.teamName} removed from ${slotName(source, side)} and returned to the unassigned pool.`,
    };
  }

  const targetDebate = byId.get(target.debateId);
  if (!targetDebate) return unchanged;
  const occupant = targetDebate.teams[target.side];
  const occupantId = occupant?.teamId || "";
  const occupantName = occupant?.teamName || "";

  if (pick.from.kind === "pool") {
    return {
      debates: debates.map((debate) =>
        debate.id === target.debateId
          ? { ...debate, teams: { ...debate.teams, [target.side]: placed(pick.teamId, pick.teamName, target.side) } }
          : debate
      ),
      announcement: `${pick.teamName} placed in ${slotName(targetDebate, target.side)}` +
        (occupantId ? `; ${occupantName} returned to the unassigned pool.` : "."),
    };
  }

  const from = pick.from;
  const sourceDebate = byId.get(from.debateId);
  if (!sourceDebate) return unchanged;

  if (from.debateId === target.debateId) {
    // Same room, other side: the two teams keep their own slot details.
    const teams = { ...targetDebate.teams };
    const moving = teams[from.side];
    teams[from.side] = occupant?.teamId ? { ...occupant, side: from.side } : emptySlot(from.side);
    teams[target.side] = moving?.teamId ? { ...moving, side: target.side } : emptySlot(target.side);
    return {
      debates: debates.map((debate) => (debate.id === target.debateId ? { ...debate, teams } : debate)),
      announcement: occupantId
        ? `${pick.teamName} and ${occupantName} swapped sides in ${roomName(targetDebate)}.`
        : `${pick.teamName} moved to ${target.side} in ${roomName(targetDebate)}.`,
    };
  }

  return {
    debates: debates.map((debate) => {
      if (debate.id === from.debateId) {
        return { ...debate, teams: { ...debate.teams, [from.side]: placed(occupantId, occupantName, from.side) } };
      }
      if (debate.id === target.debateId) {
        return { ...debate, teams: { ...debate.teams, [target.side]: placed(pick.teamId, pick.teamName, target.side) } };
      }
      return debate;
    }),
    announcement: occupantId
      ? `${pick.teamName} (now ${slotName(targetDebate, target.side)}) swapped with ${occupantName} (now ${slotName(sourceDebate, from.side)}).`
      : `${pick.teamName} moved from ${slotName(sourceDebate, from.side)} to ${slotName(targetDebate, target.side)}.`,
  };
}

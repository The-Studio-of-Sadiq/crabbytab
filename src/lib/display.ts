import type { Debate, DebateSide, Motion } from "@/types";

/** Pure helpers for the projector display (`/[slug]/display`). */

export interface AlphabeticalDrawRow {
  teamId: string;
  teamName: string;
  /** Undefined for a bye. */
  side?: DebateSide;
  venueName?: string;
  opponents: string[];
  bye: boolean;
}

const BP_ORDER: DebateSide[] = ["OG", "OO", "CG", "CO"];
const TWO_TEAM_ORDER: DebateSide[] = ["AFF", "NEG"];

/**
 * One row per team in the given debates, sorted by team name (case-insensitive, then exact name
 * and id so the order is stable). Mirrors Tabbycat's "draw by team" projector view.
 */
export function buildAlphabeticalDraw(debates: Debate[], isBP: boolean): AlphabeticalDrawRow[] {
  const order = isBP ? BP_ORDER : TWO_TEAM_ORDER;
  const rows: AlphabeticalDrawRow[] = [];
  for (const debate of debates) {
    const slots = order
      .map((side) => debate.teams?.[side])
      .filter((slot): slot is NonNullable<typeof slot> => Boolean(slot?.teamId));
    if (debate.byeTeamId) {
      const byeSlot = slots.find((slot) => slot.teamId === debate.byeTeamId);
      rows.push({
        teamId: debate.byeTeamId,
        teamName: byeSlot?.teamName || "Team",
        opponents: [],
        bye: true,
      });
      continue;
    }
    for (const slot of slots) {
      rows.push({
        teamId: slot.teamId,
        teamName: slot.teamName,
        side: slot.side,
        venueName: debate.venueName,
        opponents: slots.filter((other) => other.teamId !== slot.teamId).map((other) => other.teamName),
        bye: false,
      });
    }
  }
  return rows.sort(
    (left, right) =>
      left.teamName.localeCompare(right.teamName, undefined, { sensitivity: "base" }) ||
      left.teamName.localeCompare(right.teamName) ||
      left.teamId.localeCompare(right.teamId)
  );
}

export type MotionRevealStep =
  | { kind: "cover" }
  | { kind: "info"; motion: Motion; index: number }
  | { kind: "motion"; motion: Motion; index: number };

/**
 * The reveal sequence for a round: a cover slide, then for each motion (in `seq` order) its
 * information slide, if it has one, followed by the motion itself.
 */
export function buildMotionRevealSteps(motions: Motion[]): MotionRevealStep[] {
  const ordered = [...motions].sort(
    (left, right) => (left.seq ?? Number.MAX_SAFE_INTEGER) - (right.seq ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id)
  );
  const steps: MotionRevealStep[] = [{ kind: "cover" }];
  ordered.forEach((motion, index) => {
    if (motion.infoSlide?.trim()) steps.push({ kind: "info", motion, index });
    steps.push({ kind: "motion", motion, index });
  });
  return steps;
}

/** Keys that advance or rewind the reveal; anything else leaves the step unchanged. */
export function nextRevealStep(current: number, key: string, stepCount: number): number {
  const last = Math.max(0, stepCount - 1);
  if (key === "ArrowRight" || key === " " || key === "PageDown" || key === "Enter") return Math.min(current + 1, last);
  if (key === "ArrowLeft" || key === "PageUp" || key === "Backspace") return Math.max(current - 1, 0);
  if (key === "Home") return 0;
  if (key === "End") return last;
  return Math.min(Math.max(current, 0), last);
}

/** Motions assigned to a round that the viewer may see: released ones, or all of them for staff. */
export function motionsForDisplay(motions: Motion[], roundId: string | undefined, includeUnreleased: boolean): Motion[] {
  if (!roundId) return [];
  return motions.filter((motion) => motion.rounds?.includes(roundId) && (includeUnreleased || motion.released === true));
}

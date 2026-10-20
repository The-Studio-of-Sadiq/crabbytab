import type { Debate, DebateSide, Motion, MotionsStatus } from "@/types";
import { sidesPending } from "@/lib/draw/manualSides";
import { motionSeqInRound } from "@/lib/motions/roundMotions";

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
    // Sides chosen at the debate are not shown before they are recorded.
    const pending = sidesPending(debate);
    for (const slot of slots) {
      rows.push({
        teamId: slot.teamId,
        teamName: slot.teamName,
        side: pending ? undefined : slot.side,
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
 * The reveal sequence for a round: a cover slide, then for each motion (in its order within the
 * round, `roundSeq`, falling back to `seq`) its information slide, if it has one, followed by the
 * motion itself. With `infoSlidesOnly` (the round's info slides are released but its motions are
 * not) the motions themselves are left out.
 */
export function buildMotionRevealSteps(
  motions: Motion[],
  options: { roundId?: string; infoSlidesOnly?: boolean } = {}
): MotionRevealStep[] {
  const order = (motion: Motion) =>
    (options.roundId ? motionSeqInRound(motion, options.roundId) : motion.seq) ?? Number.MAX_SAFE_INTEGER;
  const ordered = [...motions].sort((left, right) => order(left) - order(right) || left.id.localeCompare(right.id));
  const steps: MotionRevealStep[] = [{ kind: "cover" }];
  ordered.forEach((motion, index) => {
    if (motion.infoSlide?.trim()) steps.push({ kind: "info", motion, index });
    if (!options.infoSlidesOnly) steps.push({ kind: "motion", motion, index });
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

/**
 * Motions assigned to a round that the viewer may see: released ones, or all of them for staff.
 * When only the round's info slides are released (`status`), viewers get the motions that have an
 * info slide (the public projection carries them without their text).
 */
export function motionsForDisplay(
  motions: Motion[],
  roundId: string | undefined,
  includeUnreleased: boolean,
  status?: MotionsStatus
): Motion[] {
  if (!roundId) return [];
  return motions.filter((motion) =>
    motion.rounds?.includes(roundId) &&
    (includeUnreleased ||
      motion.released === true ||
      (status === "info_slides_released" && Boolean(motion.infoSlide?.trim())))
  );
}

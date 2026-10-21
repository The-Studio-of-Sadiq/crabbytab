import type { DebateSide, Motion, Tournament } from "@/types";
import { motionsEnabled } from "@/lib/ballots/ballotRules";
import { orderRoundMotions } from "@/lib/motions/roundMotions";

/**
 * Which motion a participant ballot (private URL or public form) records, as Tabbycat's
 * `BaseBallotSetForm` does for every ballot form:
 *
 * - motions on (`enable_motions`) and the round has several motions: the adjudicator must choose
 *   the debated motion, and it must be one of the round's motions;
 * - the round has exactly one motion: that motion, whatever the switch (Tabbycat stores it even
 *   with motions off);
 * - the round has no motion: nothing.
 *
 * The draw no longer stamps the round's first motion on every debate, and debates drawn before that
 * may still carry it, so the debate's own motion is never used to fill in a missing choice.
 */

export type ParticipantMotion = Pick<Motion, "id" | "text">;
type Prefs = Tournament["preferences"] | undefined;

export class ParticipantMotionError extends Error {}

/** The round's motions in order (id and text only). */
export function participantRoundMotions(motions: readonly Motion[], roundId: string): ParticipantMotion[] {
  return orderRoundMotions(motions, roundId).map((motion) => ({ id: motion.id, text: motion.text }));
}

/** Whether the ballot form must ask which motion was debated. */
export function participantBallotAsksMotion(preferences: Prefs, roundMotions: readonly ParticipantMotion[]): boolean {
  return motionsEnabled(preferences) && roundMotions.length > 1;
}

/** Whether the ballot form offers per-side motion veto fields (Tabbycat `motion_vetoes_enabled`). */
export function participantBallotAsksVetoes(preferences: Prefs, roundMotions: readonly ParticipantMotion[]): boolean {
  return motionsEnabled(preferences) && preferences?.enableMotionVetoes === true && roundMotions.length > 1;
}

/**
 * The motion to store on a participant ballot. Throws `ParticipantMotionError` when a choice is
 * required but missing or not one of the round's motions.
 */
export function resolveParticipantBallotMotion(
  submitted: unknown,
  preferences: Prefs,
  roundMotions: readonly ParticipantMotion[]
): ParticipantMotion | undefined {
  if (roundMotions.length === 0) return undefined;
  // One motion: it is the debated motion, whatever an (older) form sent.
  if (roundMotions.length === 1) return roundMotions[0];
  if (!motionsEnabled(preferences)) return undefined;
  if (typeof submitted !== "string" || submitted === "") {
    throw new ParticipantMotionError("Choose the motion that was debated.");
  }
  const chosen = roundMotions.find((motion) => motion.id === submitted);
  if (!chosen) throw new ParticipantMotionError("The motion is not one of this round's motions.");
  return chosen;
}

/**
 * Motion vetoes recorded on a participant ballot: side -> vetoed motion id. Only read when the
 * form offers them; each must be one of the round's motions and not the debated one.
 */
export function resolveParticipantBallotVetoes(
  submitted: unknown,
  sides: readonly DebateSide[],
  preferences: Prefs,
  roundMotions: readonly ParticipantMotion[],
  debatedMotionId: string | undefined
): Partial<Record<DebateSide, string>> | undefined {
  if (submitted === undefined || submitted === null) return undefined;
  if (typeof submitted !== "object" || Array.isArray(submitted)) {
    throw new ParticipantMotionError("The motion vetoes are invalid.");
  }
  const entries = Object.entries(submitted as Record<string, unknown>).filter(([, value]) => value !== undefined && value !== "" && value !== null);
  if (entries.length === 0) return undefined;
  if (!participantBallotAsksVetoes(preferences, roundMotions)) {
    throw new ParticipantMotionError("Motion vetoes are not enabled for this tournament.");
  }
  const ids = new Set(roundMotions.map((motion) => motion.id));
  const vetoes: Partial<Record<DebateSide, string>> = {};
  for (const [side, motionId] of entries) {
    if (!sides.includes(side as DebateSide)) throw new ParticipantMotionError(`Veto recorded for an unknown side (${side}).`);
    if (typeof motionId !== "string" || !ids.has(motionId)) {
      throw new ParticipantMotionError("A vetoed motion is not one of this round's motions.");
    }
    if (motionId === debatedMotionId) throw new ParticipantMotionError("A team cannot veto the motion that was debated.");
    vetoes[side as DebateSide] = motionId;
  }
  return vetoes;
}

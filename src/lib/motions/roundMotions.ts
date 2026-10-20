import type { Motion, Round } from "@/types";

/**
 * Motions belong to rounds through `Motion.rounds`, with an order inside each round
 * (`Motion.roundSeq[roundId]`, Tabbycat's RoundMotion.seq). Motions saved before per-round order
 * existed fall back to their global `seq`.
 */

export function motionSeqInRound(motion: Pick<Motion, "seq" | "roundSeq">, roundId: string): number | undefined {
  const value = motion.roundSeq?.[roundId];
  return typeof value === "number" && Number.isFinite(value) ? value : motion.seq;
}

function compareInRound(roundId: string) {
  return (left: Motion, right: Motion) =>
    (motionSeqInRound(left, roundId) ?? Number.MAX_SAFE_INTEGER) - (motionSeqInRound(right, roundId) ?? Number.MAX_SAFE_INTEGER) ||
    (left.seq ?? Number.MAX_SAFE_INTEGER) - (right.seq ?? Number.MAX_SAFE_INTEGER) ||
    left.id.localeCompare(right.id);
}

/** The round's motions in their order within the round. */
export function orderRoundMotions<T extends Motion>(motions: readonly T[], roundId: string): T[] {
  return motions.filter((motion) => motion.rounds?.includes(roundId)).sort(compareInRound(roundId));
}

function withRoundSeq(motion: Motion, roundId: string, seq: number): Motion {
  return { ...motion, roundSeq: { ...motion.roundSeq, [roundId]: seq } };
}

/**
 * Sets the order of a round's motions to `orderedIds` (positions 1, 2, ...). Ids not assigned to
 * the round are ignored; assigned motions missing from the list keep their relative order after
 * the listed ones. Returns only the motions that change.
 */
export function reorderRoundMotions(motions: readonly Motion[], roundId: string, orderedIds: readonly string[]): Motion[] {
  const inRound = orderRoundMotions(motions, roundId);
  const position = new Map(orderedIds.map((id, index) => [id, index]));
  const ordered = [...inRound].sort((left, right) =>
    (position.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (position.get(right.id) ?? Number.MAX_SAFE_INTEGER)
  );
  return ordered.flatMap((motion, index) =>
    motion.roundSeq?.[roundId] === index + 1 ? [] : [withRoundSeq(motion, roundId, index + 1)]
  );
}

/** Moves one motion up (-1) or down (+1) within its round. Returns the motions that change. */
export function moveRoundMotion(motions: readonly Motion[], roundId: string, motionId: string, offset: -1 | 1): Motion[] {
  const ids = orderRoundMotions(motions, roundId).map((motion) => motion.id);
  const index = ids.indexOf(motionId);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= ids.length) return [];
  [ids[index], ids[target]] = [ids[target], ids[index]];
  return reorderRoundMotions(motions, roundId, ids);
}

/**
 * Assigns motions to a round (Tabbycat's CopyMotionsView / CopyPreviousMotionsView reuse the same
 * motion records rather than duplicating them, so statistics see one motion). Motions already in
 * the round are left where they are; the others are appended in the order given, keeping their
 * order from `sourceRoundId` when one is given. Returns only the motions that change.
 */
export function copyMotionsToRound(
  motions: readonly Motion[],
  motionIds: readonly string[],
  targetRoundId: string,
  sourceRoundId?: string
): Motion[] {
  const byId = new Map(motions.map((motion) => [motion.id, motion]));
  const requested = motionIds.map((id) => byId.get(id)).filter((motion): motion is Motion => Boolean(motion));
  const toAdd = (sourceRoundId ? [...requested].sort(compareInRound(sourceRoundId)) : requested)
    .filter((motion, index, list) => !motion.rounds?.includes(targetRoundId) && list.indexOf(motion) === index);
  const existing = orderRoundMotions(motions, targetRoundId);
  const last = Math.max(0, ...existing.map((motion) => motionSeqInRound(motion, targetRoundId) ?? 0));
  return toAdd.map((motion, index) =>
    withRoundSeq({ ...motion, rounds: [...(motion.rounds || []), targetRoundId] }, targetRoundId, last + index + 1)
  );
}

/** Removes a motion from a round (the motion itself is kept). */
export function removeMotionFromRound(motion: Motion, roundId: string): Motion {
  const roundSeq = { ...motion.roundSeq };
  delete roundSeq[roundId];
  const { roundSeq: _previous, ...rest } = motion;
  void _previous;
  return {
    ...rest,
    rounds: (motion.rounds || []).filter((id) => id !== roundId),
    ...(Object.keys(roundSeq).length > 0 ? { roundSeq } : {}),
  };
}

/**
 * The round before `round` whose motions may be reused, as Tabbycat's Round.prev: the latest
 * earlier round that is preliminary or, for an elimination round, in the same break category.
 */
export function previousRoundForMotions(round: Round, rounds: readonly Round[]): Round | undefined {
  return rounds
    .filter((item) => !item.cancelled && item.seq < round.seq)
    .filter((item) =>
      round.stage !== "elimination" ||
      item.stage === "preliminary" ||
      Boolean(item.breakCategoryIds?.some((id) => round.breakCategoryIds?.includes(id)))
    )
    .sort((left, right) => right.seq - left.seq)[0];
}

/** Copies the previous round's motions into `round` (Tabbycat "copy from previous round"). */
export function copyPreviousRoundMotions(motions: readonly Motion[], round: Round, rounds: readonly Round[]): Motion[] {
  const previous = previousRoundForMotions(round, rounds);
  if (!previous) throw new Error("Motions cannot be copied to the first round.");
  const source = orderRoundMotions(motions, previous.id);
  if (source.length === 0) throw new Error(`${previous.name} has no motions to copy.`);
  return copyMotionsToRound(motions, source.map((motion) => motion.id), round.id, previous.id);
}

/**
 * Rounds in the order the public motions tab lists them: "reverse" (latest first, Tabbycat's
 * default) or "forward". Ties on seq keep the input order.
 */
export function orderMotionRoundsForPublic<T extends Pick<Round, "seq">>(
  rounds: readonly T[],
  order: "forward" | "reverse" | undefined
): T[] {
  const direction = order === "forward" ? 1 : -1;
  return [...rounds].sort((left, right) => direction * (left.seq - right.seq));
}

/** Merges changed motions into a list (for applying a planned change locally). */
export function mergeMotions(motions: readonly Motion[], changed: readonly Motion[]): Motion[] {
  const byId = new Map(changed.map((motion) => [motion.id, motion]));
  return motions.map((motion) => byId.get(motion.id) ?? motion);
}

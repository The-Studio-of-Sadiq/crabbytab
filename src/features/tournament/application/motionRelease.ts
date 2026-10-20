import type { Motion, MotionsStatus, Round, TournamentPreferences } from "@/types";

/**
 * Motion release has three states per round, as Tabbycat's Round.motions_status: not released,
 * information slides released (participants can read the info slides, not the motions) and
 * motions released. Motions are also released one at a time (Motion.released), which decides
 * what the public motions tab shows.
 *
 * Private portals, data-entry assistants and the public projection decide whether a round's
 * debate motions may be shown from the derived Round.motionsReleased flag, which is true exactly
 * when the status is "motions_released".
 */

export const MOTIONS_STATUSES: readonly MotionsStatus[] = ["not_released", "info_slides_released", "motions_released"];

/** The round's release state; rounds saved before the three states existed derive it from the flag. */
export function motionsStatusOf(round: Pick<Round, "motionsStatus" | "motionsReleased"> | undefined): MotionsStatus {
  if (!round) return "not_released";
  if (round.motionsStatus && MOTIONS_STATUSES.includes(round.motionsStatus)) return round.motionsStatus;
  return round.motionsReleased === true ? "motions_released" : "not_released";
}

/** True when participants may read the round's information slides (with or without the motions). */
export function infoSlidesVisible(round: Pick<Round, "motionsStatus" | "motionsReleased"> | undefined): boolean {
  return motionsStatusOf(round) !== "not_released";
}

export function motionsVisible(round: Pick<Round, "motionsStatus" | "motionsReleased"> | undefined): boolean {
  return motionsStatusOf(round) === "motions_released";
}

/**
 * Keeps each round's status in step with its motions' release toggles: a round counts as released
 * once any motion assigned to it is released; when none is, a released round falls back to "not
 * released" (an info-slides release is kept).
 *
 * Returns the rounds whose fields must change, so callers only write when something differs.
 */
export function roundsNeedingMotionReleaseSync(
  rounds: Round[],
  motions: Pick<Motion, "rounds" | "released">[]
): Round[] {
  const releasedRoundIds = new Set(
    motions.filter((motion) => motion.released).flatMap((motion) => motion.rounds || [])
  );
  return rounds.flatMap((round) => {
    const released = releasedRoundIds.has(round.id);
    const current = motionsStatusOf(round);
    const status: MotionsStatus = released
      ? "motions_released"
      : current === "info_slides_released" ? "info_slides_released" : "not_released";
    if (Boolean(round.motionsReleased) === released && current === status) return [];
    return [{ ...round, motionsReleased: released, motionsStatus: status }];
  });
}

export function applyMotionReleaseSync(rounds: Round[], changed: Round[]): Round[] {
  const byId = new Map(changed.map((round) => [round.id, round]));
  return rounds.map((round) => byId.get(round.id) ?? round);
}

/** Tabbycat's preparation_time: minutes from motion release to the round's start, when set. */
export function preparationMinutes(preferences: Pick<TournamentPreferences, "preparationTime"> | undefined): number | undefined {
  const minutes = preferences?.preparationTime;
  return typeof minutes === "number" && Number.isFinite(minutes) && minutes >= 0 ? Math.floor(minutes) : undefined;
}

export interface MotionsStatusChange {
  round: Round;
  /** Motions whose `released` flag changes. */
  motions: Motion[];
  previousStatus: MotionsStatus;
}

/**
 * Moves a round to a release state:
 * - "motions_released" releases every motion assigned to the round and, with preparation time
 *   on, sets the round's start to `now` plus that many minutes (as Tabbycat's ReleaseMotionsView);
 * - "info_slides_released" and "not_released" withdraw the round's motions, except motions also
 *   assigned to another round whose motions are released (they stay public there).
 *
 * Releasing motions or info slides needs at least one motion assigned to the round.
 */
export function planMotionsStatusChange(
  round: Round,
  status: MotionsStatus,
  context: {
    rounds: Round[];
    motions: Motion[];
    preferences?: Pick<TournamentPreferences, "preparationTime">;
    now?: Date;
  }
): MotionsStatusChange {
  const previousStatus = motionsStatusOf(round);
  const roundMotions = context.motions.filter((motion) => motion.rounds?.includes(round.id));
  if (status !== "not_released" && roundMotions.length === 0) {
    throw new Error(`${round.name} has no motions assigned yet. Add its motions before releasing them.`);
  }
  const otherReleasedRoundIds = new Set(
    context.rounds.filter((item) => item.id !== round.id && motionsVisible(item)).map((item) => item.id)
  );
  const release = status === "motions_released";
  const motions = roundMotions.flatMap((motion) => {
    const keepReleased = release || (motion.rounds || []).some((roundId) => otherReleasedRoundIds.has(roundId));
    return motion.released === keepReleased ? [] : [{ ...motion, released: keepReleased }];
  });
  const minutes = preparationMinutes(context.preferences);
  const startsAt = release && previousStatus !== "motions_released" && minutes !== undefined
    ? new Date((context.now ?? new Date()).getTime() + minutes * 60_000).toISOString()
    : round.startsAt;
  const nextRound: Round = {
    ...round,
    motionsStatus: status,
    motionsReleased: release,
    ...(startsAt !== undefined ? { startsAt } : {}),
  };
  return { round: nextRound, motions, previousStatus };
}

export interface MotionsStatusDependencies {
  rounds: Round[];
  motions: Motion[];
  preferences?: Pick<TournamentPreferences, "preparationTime">;
  saveMotions(motions: Motion[]): Promise<void>;
  saveRound(round: Round): Promise<void>;
  /**
   * Called after the change is saved, e.g. to send the motion-release email or a push message.
   * Failures are reported to the caller but never undo the release.
   */
  onMotionsStatusChanged?(change: MotionsStatusChange): Promise<void> | void;
}

/** Applies planMotionsStatusChange: motions first, so a released round never points at hidden motions. */
export async function setMotionsStatusCommand(
  roundId: string,
  status: MotionsStatus,
  dependencies: MotionsStatusDependencies,
  now: Date = new Date()
): Promise<MotionsStatusChange | null> {
  const round = dependencies.rounds.find((item) => item.id === roundId);
  if (!round) return null;
  if (round.cancelled) throw new Error(`${round.name} is cancelled.`);
  const change = planMotionsStatusChange(round, status, { ...dependencies, now });
  if (change.previousStatus === status && change.motions.length === 0 && change.round.startsAt === round.startsAt) {
    return change;
  }
  if (change.motions.length > 0) await dependencies.saveMotions(change.motions);
  await dependencies.saveRound(change.round);
  await dependencies.onMotionsStatusChanged?.(change);
  return change;
}

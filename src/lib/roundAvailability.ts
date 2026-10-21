import type { Adjudicator, Round, Team } from "@/types";

type AvailableParticipant = Pick<
  Team | Adjudicator,
  "checkedIn" | "roundAvailability" | "checkedInAt" | "roundAvailabilityAt"
>;

export function isAvailableForRound(
  participant: AvailableParticipant,
  round: Pick<Round, "id"> | string | null | undefined,
  expiresAfterHours?: number,
  now = Date.now()
): boolean {
  const roundId = typeof round === "string" ? round : round?.id;
  const roundValue = roundId ? participant.roundAvailability?.[roundId] : undefined;
  const value = roundValue ?? participant.checkedIn;
  if (value === false) return false;

  const checkedInAt = roundId
    ? participant.roundAvailabilityAt?.[roundId] ?? participant.checkedInAt
    : participant.checkedInAt;
  const expiryMilliseconds = typeof expiresAfterHours === "number" &&
    Number.isFinite(expiresAfterHours) &&
    expiresAfterHours > 0
    ? expiresAfterHours * 60 * 60 * 1000
    : undefined;
  if (!checkedInAt || expiryMilliseconds === undefined) return true;
  const checkedInTimestamp = Date.parse(checkedInAt);
  if (!Number.isFinite(checkedInTimestamp)) return false;
  return now - checkedInTimestamp < expiryMilliseconds;
}

export function setRoundAvailability<T extends AvailableParticipant>(
  participant: T,
  roundId: string,
  available: boolean
): T {
  return {
    ...participant,
    roundAvailability: {
      ...participant.roundAvailability,
      [roundId]: available,
    },
  };
}
import type { Adjudicator, Round, Team } from "@/types";

type AvailableParticipant = Pick<Team | Adjudicator, "checkedIn" | "roundAvailability">;

export function isAvailableForRound(
  participant: AvailableParticipant,
  round: Pick<Round, "id"> | string | null | undefined
): boolean {
  const roundId = typeof round === "string" ? round : round?.id;
  if (roundId && participant.roundAvailability?.[roundId] !== undefined) {
    return participant.roundAvailability[roundId];
  }
  return participant.checkedIn !== false;
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
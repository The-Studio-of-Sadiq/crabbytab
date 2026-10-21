import type { Round, TournamentPreferences } from "@/types";
import { isAvailableForRound } from "@/lib/roundAvailability";

/**
 * Participant self check-in from a private portal (Tabbycat's participant check-in). It is opt-in
 * (`allowSelfCheckIn`) and only ever applies to the current round, so a participant cannot change
 * their availability for past or future rounds.
 */

export interface SelfCheckInStatus {
  roundId: string;
  roundName: string;
  /** Whether the participant currently counts as available for the round. */
  available: boolean;
}

export interface SelfCheckInRequest {
  roundId: string;
  available: boolean;
}

/** The round participants check in for: the earliest round that is neither cancelled nor completed. */
export function currentCheckInRound(rounds: Round[]): Round | undefined {
  return [...rounds]
    .filter((round) => round.cancelled !== true && round.completed !== true)
    .sort((left, right) => left.seq - right.seq)[0];
}

export function parseSelfCheckInRequest(value: unknown): SelfCheckInRequest | null | "invalid" {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "invalid";
  const { roundId, available } = value as Record<string, unknown>;
  if (
    typeof roundId !== "string" ||
    roundId.length === 0 ||
    roundId.length > 128 ||
    roundId.includes("/") ||
    typeof available !== "boolean"
  ) {
    return "invalid";
  }
  return { roundId, available };
}

/** Why a check-in request must be refused, or null when it may be written. */
export function selfCheckInError(
  preferences: Pick<TournamentPreferences, "allowSelfCheckIn"> | undefined,
  rounds: Round[],
  request: SelfCheckInRequest
): string | null {
  if (preferences?.allowSelfCheckIn !== true) return "Self check-in is not enabled for this tournament.";
  const round = currentCheckInRound(rounds);
  if (!round) return "There is no round to check in for.";
  if (round.id !== request.roundId) return `Check-in is only open for ${round.name}.`;
  return null;
}

export function selfCheckInStatus(
  preferences: Pick<TournamentPreferences, "allowSelfCheckIn" | "checkInExpiresAfterHours"> | undefined,
  rounds: Round[],
  participant: Parameters<typeof isAvailableForRound>[0],
  now = Date.now()
): SelfCheckInStatus | null {
  if (preferences?.allowSelfCheckIn !== true) return null;
  const round = currentCheckInRound(rounds);
  if (!round) return null;
  return {
    roundId: round.id,
    roundName: round.name,
    available: isAvailableForRound(participant, round, preferences.checkInExpiresAfterHours, now),
  };
}

import type { Adjudicator, CheckInEvent, CheckInSource, Round, Speaker, Team, Venue } from "@/types";
import { isAvailableForRound } from "@/lib/roundAvailability";

/**
 * Check-in history and bulk check-ins (Tabbycat's check-in events, "check in everyone from the
 * previous round" and "check in breaking adjudicators"; docs/public-pages-and-notifications.md,
 * "Check-ins"). Every change of a team's, speaker's, adjudicator's or room's availability can be
 * recorded as an event on the record itself, newest last, so the history syncs with the record.
 */

/** Events kept per record; older ones are dropped. */
export const MAX_CHECK_IN_EVENTS = 50;

type WithHistory = { checkInHistory?: CheckInEvent[] };

export function appendCheckInEvent<T extends WithHistory>(record: T, event: CheckInEvent): T {
  return { ...record, checkInHistory: [...(record.checkInHistory ?? []), event].slice(-MAX_CHECK_IN_EVENTS) };
}

export function checkInEvent(input: {
  available: boolean;
  source: CheckInSource;
  roundId?: string;
  at?: string;
  by?: string;
}): CheckInEvent {
  return {
    at: input.at ?? new Date().toISOString(),
    available: input.available,
    source: input.source,
    ...(input.roundId ? { roundId: input.roundId } : {}),
    ...(input.by ? { by: input.by } : {}),
  };
}

type Participant = Team | Adjudicator;

/** A team's or adjudicator's availability for a round, with the event recorded. */
export function setParticipantAvailability<T extends Participant>(
  participant: T,
  round: Pick<Round, "id">,
  available: boolean,
  meta: { source: CheckInSource; by?: string; at?: string }
): T {
  const at = meta.at ?? new Date().toISOString();
  return appendCheckInEvent(
    {
      ...participant,
      roundAvailability: { ...participant.roundAvailability, [round.id]: available },
      roundAvailabilityAt: { ...participant.roundAvailabilityAt, [round.id]: at },
    },
    checkInEvent({ available, source: meta.source, roundId: round.id, at, by: meta.by })
  );
}

/** A room's check-in, with the event recorded. Rooms have no per-round availability. */
export function setVenueCheckIn(venue: Venue, checkedIn: boolean, meta: { source: CheckInSource; by?: string; at?: string }): Venue {
  return appendCheckInEvent({ ...venue, checkedIn }, checkInEvent({ available: checkedIn, source: meta.source, at: meta.at, by: meta.by }));
}

/** Whether a speaker is checked in for a round (speaker-level check-in). */
export function isSpeakerCheckedIn(speaker: Pick<Speaker, "roundAvailability">, roundId: string): boolean {
  return speaker.roundAvailability?.[roundId] === true;
}

/**
 * Checks one speaker in or out. When every speaker of the team is checked in, the team becomes
 * available for the round too (Tabbycat counts a team present when its speakers are); checking
 * a speaker out does not withdraw the team.
 */
export function setSpeakerCheckIn(
  team: Team,
  speakerId: string,
  round: Pick<Round, "id">,
  checkedIn: boolean,
  meta: { source: CheckInSource; by?: string; at?: string }
): Team {
  const at = meta.at ?? new Date().toISOString();
  let found = false;
  const speakers = team.speakers.map((speaker) => {
    if (speaker.id !== speakerId) return speaker;
    found = true;
    return appendCheckInEvent(
      { ...speaker, roundAvailability: { ...speaker.roundAvailability, [round.id]: checkedIn } },
      checkInEvent({ available: checkedIn, source: meta.source, roundId: round.id, at, by: meta.by })
    );
  });
  if (!found) throw new Error("That speaker is not in this team.");
  const next = { ...team, speakers };
  const allIn = speakers.length > 0 && speakers.every((speaker) => isSpeakerCheckedIn(speaker, round.id));
  return checkedIn && allIn && next.roundAvailability?.[round.id] !== true
    ? setParticipantAvailability(next, round, true, { ...meta, at })
    : next;
}

/** Speakers of the team checked in for the round. */
export function checkedInSpeakerCount(team: Pick<Team, "speakers">, roundId: string): number {
  return team.speakers.filter((speaker) => isSpeakerCheckedIn(speaker, roundId)).length;
}

/**
 * Bulk check-in from the previous round. CrabbyTab participants are present unless marked
 * otherwise, so this copies availability both ways: everyone with no explicit setting for `round`
 * whose availability there differs from `previous` gets the previous round's value. Returns the
 * updated records only.
 */
export function availabilityFromPreviousRound<T extends Participant>(
  participants: T[],
  previous: Pick<Round, "id">,
  round: Pick<Round, "id">,
  meta: { by?: string; expiresAfterHours?: number; at?: string; now?: number }
): T[] {
  return participants.flatMap((participant) => {
    if (participant.roundAvailability?.[round.id] !== undefined) return [];
    // The previous round's own record decides; check-in expiry does not apply to the past.
    const wasAvailable = isAvailableForRound(participant, previous);
    if (wasAvailable === isAvailableForRound(participant, round, meta.expiresAfterHours, meta.now)) return [];
    return [setParticipantAvailability(participant, round, wasAvailable, { source: "bulk", by: meta.by, at: meta.at })];
  });
}

/** Bulk check-in of breaking adjudicators (Tabbycat's "check in breaking adjudicators"). */
export function breakingAdjudicatorsAvailable(
  adjudicators: Adjudicator[],
  round: Pick<Round, "id">,
  meta: { by?: string; expiresAfterHours?: number; at?: string; now?: number }
): Adjudicator[] {
  return adjudicators
    .filter((adjudicator) => adjudicator.breaking === true && !isAvailableForRound(adjudicator, round, meta.expiresAfterHours, meta.now))
    .map((adjudicator) => setParticipantAvailability(adjudicator, round, true, { source: "bulk", by: meta.by, at: meta.at }));
}

/** The round before `round` in sequence (not cancelled), if any. */
export function previousRound<R extends Pick<Round, "id" | "seq" | "cancelled">>(rounds: R[], round: Pick<Round, "seq">): R | undefined {
  return rounds
    .filter((item) => !item.cancelled && item.seq < round.seq)
    .sort((left, right) => right.seq - left.seq)[0];
}

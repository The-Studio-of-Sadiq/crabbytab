import { expect } from "vitest";

import type { Round } from "@/types";
import { getEligibleTeamsForRound } from "@/lib/draw/generator";
import { drawErrors } from "@/lib/draw/validateDraw";
import { getPrivatePortalBallots, filterTeamVisibleDebates, sanitizeTeamPrivateDebate } from "@/lib/privatePortalBallots";
import { isAvailableForRound } from "@/lib/roundAvailability";
import type { TournamentHarness } from "./lifecycleHarness";
import { adjudicatorIdsInDebates, teamIdsInDebates } from "./tournamentFixtures";

const NOW = Date.parse("2026-10-01T10:00:00.000Z");

/**
 * Invariants every drawn round must keep: each checked-in, eligible team is in exactly one debate
 * or has a bye, nobody else is placed, no adjudicator sits on two panels, and the draw check finds
 * no hard-rule violation.
 */
export function expectValidRound(harness: TournamentHarness, roundId: string): void {
  const round = harness.round(roundId);
  const debates = harness.roundDebates(roundId);
  const placed = teamIdsInDebates(debates);
  expect(new Set(placed).size, `${round.name}: a team is in two debates`).toBe(placed.length);
  const expected = getEligibleTeamsForRound(harness.teams, round)
    .filter((team) => isAvailableForRound(team, round, harness.tournament.preferences.checkInExpiresAfterHours, NOW))
    .map((team) => team.id);
  expect([...placed].sort(), `${round.name}: placed teams`).toEqual([...expected].sort());
  const adjudicators = adjudicatorIdsInDebates(debates);
  expect(new Set(adjudicators).size, `${round.name}: an adjudicator is double-booked`).toBe(adjudicators.length);
  expect(drawErrors(harness.drawCheck(roundId)), `${round.name}: draw check`).toEqual([]);
}

/** What the public projection shows about one round. */
export function publicRound(harness: TournamentHarness, roundId: string) {
  const projection = harness.publicProjection();
  const debates = projection.collections.debates.filter((debate) => debate.roundId === roundId) as Array<Record<string, unknown>>;
  const ballots = projection.collections.ballots.filter((ballot) => ballot.roundId === roundId) as Array<Record<string, unknown>>;
  const round = projection.collections.rounds.find((item) => item.id === roundId) as Record<string, unknown> | undefined;
  return { projection, round, debates, ballots };
}

/** Result fields (points or speaker totals) anywhere in a public or private debate's team slots. */
export function slotResultFields(debate: Record<string, unknown>): string[] {
  const teams = (debate.teams ?? {}) as Record<string, Record<string, unknown> | undefined>;
  return Object.values(teams).flatMap((slot) =>
    ["points", "speakerScoreTotal"].filter((field) => slot !== undefined && slot[field] !== undefined)
  );
}

/** What a team's private portal shows for one round: visible debates (sanitised) and ballots. */
export function teamPortal(harness: TournamentHarness, teamId: string, roundId: string) {
  const roundsById = new Map<string, Round>(harness.rounds.map((round) => [round.id, round]));
  const own = harness.debates.filter(
    (debate) => debate.roundId === roundId && Object.values(debate.teams).some((slot) => slot?.teamId === teamId)
  );
  const debates = filterTeamVisibleDebates(own, roundsById).map((debate) =>
    sanitizeTeamPrivateDebate(debate, roundsById.get(debate.roundId), harness.tournament.preferences.publicResults !== false)
  );
  const ballots = getPrivatePortalBallots(
    harness.ballots.filter((ballot) => own.some((debate) => debate.id === ballot.debateId)),
    harness.rounds,
    "team",
    harness.tournament.preferences.publicResults !== false
  );
  return { debates, ballots };
}

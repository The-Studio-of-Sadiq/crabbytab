import type { BallotSubmission, Debate, Round, Team, Tournament } from "@/types";
import { calculateStandings } from "./calculator";

/**
 * The rounds standings "as of" a round count (Tabbycat's admin standings for a round): every
 * non-cancelled round up to and including that round's sequence. Without a round (or with one that
 * no longer exists or is cancelled), every non-cancelled round counts, as in the default standings.
 */
export function roundsCountedAsOf(rounds: Round[], asOfRoundId?: string | null): Round[] {
  const live = rounds.filter((round) => !round.cancelled);
  const asOf = asOfRoundId ? live.find((round) => round.id === asOfRoundId) : undefined;
  return asOf ? live.filter((round) => round.seq <= asOf.seq) : live;
}

/**
 * Standings computed from the rounds counted as of `asOfRoundId` only: debates and ballots of later
 * (or cancelled) rounds are left out entirely, so they cannot leak into any metric. The default
 * (no round) gives exactly the tournament-wide standings.
 */
export function calculateStandingsAsOf(
  tournament: Tournament,
  rounds: Round[],
  teams: Team[],
  debates: Debate[],
  ballots: BallotSubmission[],
  asOfRoundId?: string | null
): ReturnType<typeof calculateStandings> {
  const counted = roundsCountedAsOf(rounds, asOfRoundId);
  const countedIds = new Set(counted.map((round) => round.id));
  return calculateStandings(
    tournament,
    counted,
    teams,
    debates.filter((debate) => countedIds.has(debate.roundId)),
    ballots.filter((ballot) => countedIds.has(ballot.roundId))
  );
}

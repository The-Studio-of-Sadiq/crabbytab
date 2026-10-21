import type { BallotSubmission, Debate, DebateSide, Round, Tournament, TournamentPreferences } from "@/types";
import { isIndividualBallot } from "@/lib/ballots/individualBallots";
import {
  buildBallotResult,
  debateBallotRules,
  rulesSides,
  usesVotingBallots,
  type BallotEntry,
} from "@/lib/ballots/result";

/**
 * Tabbycat's `resaveballots`: re-saves every ballot so the stored team results (TeamScore) follow
 * the current scoring settings. CrabbyTab stores team totals, margins and voting aggregates on the
 * ballot when it is entered, so changing a setting that feeds them would otherwise leave existing
 * results (and every standing built on them) computed under the old setting.
 */

/** Settings whose change alters the stored totals of ballots already entered. */
export const STORED_TOTAL_PREFERENCES = [
  "teamScoreIncludesGhosts",
  "marginIncludesDissenters",
  "scoreAggregation",
] as const satisfies readonly (keyof TournamentPreferences)[];

export function changedTotalPreferences(
  previous: Partial<TournamentPreferences> | undefined,
  next: Partial<TournamentPreferences> | undefined
): (typeof STORED_TOTAL_PREFERENCES)[number][] {
  return STORED_TOTAL_PREFERENCES.filter(
    (key) => JSON.stringify(previous?.[key] ?? null) !== JSON.stringify(next?.[key] ?? null)
  );
}

export interface ResaveOutcome {
  /** Ballots whose stored scores changed, recalculated (only these need saving). */
  updated: BallotSubmission[];
  /** Of `updated`, the ids whose points or winner changed (not only totals or margins). */
  resultChangedIds: string[];
  /** Ballots left as they were, and why. */
  skipped: { ballotId: string; reason: string }[];
}

function storedRanks(ballot: BallotSubmission, sides: DebateSide[]): Partial<Record<DebateSide, number>> {
  const ranks: Partial<Record<DebateSide, number>> = {};
  for (const side of sides) {
    const score = ballot.teamScores?.[side];
    if (typeof score?.rank === "number") ranks[side] = score.rank;
    else if (sides.length === 2 && score) ranks[side] = score.win || score.points === 1 ? 1 : 2;
  }
  return ranks;
}

/**
 * Recalculates the stored team results of every live (not discarded) ballot under `tournament`'s
 * current settings. Ballots that hold no scores to total (forfeits, results-only ballots), an
 * adjudicator's own individual sheet, and ballots whose shape no longer fits the round's ballot
 * mode are skipped and reported.
 */
export function recomputeStoredBallots(
  ballots: readonly BallotSubmission[],
  context: {
    tournament: Pick<Tournament, "format" | "preferences">;
    rounds: readonly Round[];
    debates: readonly Debate[];
  }
): ResaveOutcome {
  const roundById = new Map(context.rounds.map((round) => [round.id, round]));
  const debateById = new Map(context.debates.map((debate) => [debate.id, debate]));
  const outcome: ResaveOutcome = { updated: [], resultChangedIds: [], skipped: [] };
  const skip = (ballot: BallotSubmission, reason: string) => outcome.skipped.push({ ballotId: ballot.id, reason });

  for (const ballot of ballots) {
    if (ballot.discarded) continue;
    if (ballot.forfeitSide || ballot.noSpeakerScores) continue;
    if (isIndividualBallot(ballot)) continue;
    const debate = debateById.get(ballot.debateId);
    const rules = debateBallotRules(context.tournament, roundById.get(ballot.roundId), debate, context.rounds);
    const sides = rulesSides(rules);
    const voting = usesVotingBallots(rules);
    const hasSheets = (ballot.sheets?.length ?? 0) > 0;
    if (voting !== hasSheets) {
      skip(ballot, voting ? "A voting round's ballot without scoresheets." : "Scoresheets on a consensus round's ballot.");
      continue;
    }
    const entry: BallotEntry = voting
      ? { speakerScores: {}, sheets: ballot.sheets, ...(ballot.selfSplit ? { selfSplit: true } : {}) }
      : { speakerScores: ballot.speakerScores, ranks: storedRanks(ballot, sides) };
    const teamIds = Object.fromEntries(sides.map((side) => [side, ballot.teamScores?.[side]?.teamId || debate?.teams?.[side]?.teamId || ""]));
    let result;
    try {
      result = buildBallotResult(entry, teamIds, ballot.chairId ?? debate?.adjudicators?.chairId, rules);
    } catch (error) {
      skip(ballot, error instanceof Error ? error.message : "The ballot could not be recalculated.");
      continue;
    }
    const next: BallotSubmission = {
      ...ballot,
      speakerScores: result.speakerScores,
      teamScores: result.teamScores,
      ...(result.sheets ? { sheets: result.sheets } : {}),
    };
    const same =
      JSON.stringify(next.speakerScores) === JSON.stringify(ballot.speakerScores) &&
      JSON.stringify(next.teamScores) === JSON.stringify(ballot.teamScores) &&
      JSON.stringify(next.sheets ?? null) === JSON.stringify(ballot.sheets ?? null);
    if (same) continue;
    outcome.updated.push(next);
    const resultChanged = sides.some((side) =>
      (next.teamScores[side]?.points ?? 0) !== (ballot.teamScores?.[side]?.points ?? 0) ||
      Boolean(next.teamScores[side]?.win) !== Boolean(ballot.teamScores?.[side]?.win)
    );
    if (resultChanged) outcome.resultChangedIds.push(ballot.id);
  }
  return outcome;
}

/** The debate's cached team results after its confirmed ballot was recalculated. */
export function debateWithBallotTotals(debate: Debate, ballot: BallotSubmission): Debate {
  const teams = { ...debate.teams };
  for (const [key, slot] of Object.entries(teams)) {
    const side = key as DebateSide;
    const score = ballot.teamScores?.[side];
    if (!slot?.teamId || !score) continue;
    teams[side] = { ...slot, points: score.points, speakerScoreTotal: score.totalSpeakerScore };
  }
  return { ...debate, teams };
}

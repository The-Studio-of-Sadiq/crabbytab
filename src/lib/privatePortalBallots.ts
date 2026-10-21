import type { BallotSubmission, Debate, DebateAdjudicatorSlot, Round } from "@/types";
import { isDrawPubliclyReleased, isDrawReleasedToTeams } from "@/lib/draw/drawStatus";

const HIDDEN_PANEL: DebateAdjudicatorSlot = {
  panellistIds: [],
  panellistNames: [],
  traineeIds: [],
  traineeNames: [],
};

/**
 * Whether a round's draw may be shown to teams on their private portal: a teams-only release
 * (Tabbycat "release draw (teams only)") or the full release. See src/lib/draw/drawStatus.ts.
 */
export function isDrawVisibleToTeams(round: Round | undefined): round is Round {
  return round !== undefined && round.cancelled !== true && isDrawReleasedToTeams(round);
}

/** Adjudicators see their allocation (and may submit ballots) only once the draw is fully released. */
export function isDrawVisibleToAdjudicators(round: Round | undefined): round is Round {
  return round !== undefined && round.cancelled !== true && isDrawPubliclyReleased(round);
}

/** Drops debates whose round draw has not been released to teams. */
export function filterTeamVisibleDebates<T extends Pick<Debate, "roundId">>(
  debates: Iterable<T>,
  roundsById: ReadonlyMap<string, Round>
): T[] {
  return [...debates].filter((debate) => isDrawVisibleToTeams(roundsById.get(debate.roundId)));
}

/** Drops debates whose round draw this kind of participant may not see yet. */
export function filterParticipantVisibleDebates<T extends Pick<Debate, "roundId">>(
  debates: Iterable<T>,
  roundsById: ReadonlyMap<string, Round>,
  actorType: "adjudicator" | "team"
): T[] {
  const visible = actorType === "team" ? isDrawVisibleToTeams : isDrawVisibleToAdjudicators;
  return [...debates].filter((debate) => visible(roundsById.get(debate.roundId)));
}

export function sanitizeTeamPrivateDebate(
  debate: Debate,
  round: Round | undefined,
  resultsEnabled = true
): Debate {
  const showResults =
    resultsEnabled && round?.resultsReleased === true && round.silent !== true;
  const showSpeakerScores = showResults && round?.teamSpeaksReleased === true;
  // A teams-only release never shows the panel (Tabbycat hides adjudicators until the full release).
  const showAdjudicators = isDrawVisibleToAdjudicators(round) && round.adjudicatorsRevealed === true;
  const showMotion = round?.motionsReleased === true;
  const { byeResult, motionId, motionText, adjudicators, ...safeDebate } = debate;

  return {
    ...safeDebate,
    ...(showResults && byeResult !== undefined ? { byeResult } : {}),
    ...(showMotion && motionId !== undefined ? { motionId } : {}),
    ...(showMotion && motionText !== undefined ? { motionText } : {}),
    adjudicators: showAdjudicators && adjudicators ? adjudicators : { ...HIDDEN_PANEL },
    resultStatus: showResults ? debate.resultStatus : "none",
    teams: Object.fromEntries(
      Object.entries(debate.teams || {}).map(([side, slot]) => {
        if (!slot) return [side, slot];
        const { points, speakerScoreTotal, ...safeSlot } = slot;
        return [side, {
          ...safeSlot,
          ...(showResults && points !== undefined ? { points } : {}),
          ...(showSpeakerScores && speakerScoreTotal !== undefined ? { speakerScoreTotal } : {}),
        }];
      })
    ) as Debate["teams"],
  };
}

export function getPrivatePortalBallots(
  ballots: BallotSubmission[],
  rounds: Round[],
  actorType: "adjudicator" | "team",
  resultsEnabled = true,
  /**
   * Tabbycat private_ballots_released: a team sees the full scoresheets (every adjudicator's
   * sheet and speaker scores) of its own debates once the round's results are released, even
   * before team speaks are.
   */
  privateBallotsReleased = false
): Array<Record<string, unknown>> {
  const roundsById = new Map(rounds.map((round) => [round.id, round]));
  const visibleBallots: Array<Record<string, unknown>> = [];

  for (const ballot of ballots) {
    if (actorType === "adjudicator") {
      visibleBallots.push({ ...ballot });
      continue;
    }

    const round = roundsById.get(ballot.roundId);
    if (
      !round ||
      !resultsEnabled ||
      round.resultsReleased !== true ||
      round.silent === true ||
      ballot.confirmed !== true ||
      ballot.discarded === true
    ) {
      continue;
    }

    const showSpeakerScores = round.teamSpeaksReleased === true || privateBallotsReleased;
    const teamScores = Object.fromEntries(
      Object.entries(ballot.teamScores || {}).map(([side, score]) => [
        side,
        showSpeakerScores
          ? score
          : {
              side: score.side,
              teamId: score.teamId,
              points: score.points,
              win: score.win,
              rank: score.rank,
            },
      ])
    );

    visibleBallots.push({
      id: ballot.id,
      tournamentId: ballot.tournamentId,
      roundId: ballot.roundId,
      debateId: ballot.debateId,
      version: ballot.version,
      confirmed: ballot.confirmed,
      discarded: ballot.discarded,
      timestamp: ballot.timestamp,
      ...(showSpeakerScores ? { speakerScores: ballot.speakerScores } : { speakerScores: {} }),
      teamScores,
      // Sheets name their adjudicators, so they need the panel to be public too.
      ...(privateBallotsReleased && round.adjudicatorsRevealed === true && Array.isArray(ballot.sheets) ? { sheets: ballot.sheets } : {}),
    });
  }
  return visibleBallots;
}

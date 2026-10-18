import type { BallotSubmission, Debate, DebateAdjudicatorSlot, Round } from "@/types";

const HIDDEN_PANEL: DebateAdjudicatorSlot = {
  panellistIds: [],
  panellistNames: [],
  traineeIds: [],
  traineeNames: [],
};

/**
 * Whether a round's draw may be shown to teams. Mirrors the public page,
 * which treats `confirmed` and `released` draws as published (see 0.11).
 */
export function isDrawVisibleToTeams(round: Round | undefined): round is Round {
  return (
    round !== undefined &&
    round.cancelled !== true &&
    (round.drawStatus === "confirmed" || round.drawStatus === "released")
  );
}

/** Drops debates whose round draw has not been published to teams. */
export function filterTeamVisibleDebates<T extends Pick<Debate, "roundId">>(
  debates: Iterable<T>,
  roundsById: ReadonlyMap<string, Round>
): T[] {
  return [...debates].filter((debate) => isDrawVisibleToTeams(roundsById.get(debate.roundId)));
}

export function sanitizeTeamPrivateDebate(
  debate: Debate,
  round: Round | undefined,
  resultsEnabled = true
): Debate {
  const showResults =
    resultsEnabled && round?.resultsReleased === true && round.silent !== true;
  const showSpeakerScores = showResults && round?.teamSpeaksReleased === true;
  const showAdjudicators = isDrawVisibleToTeams(round) && round.adjudicatorsRevealed === true;
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
  resultsEnabled = true
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

    const showSpeakerScores = round.teamSpeaksReleased === true;
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
    });
  }
  return visibleBallots;
}

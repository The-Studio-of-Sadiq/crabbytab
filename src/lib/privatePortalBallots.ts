import type { BallotSubmission, Debate, Round } from "@/types";

export function sanitizeTeamPrivateDebate(
  debate: Debate,
  round: Round | undefined,
  resultsEnabled = true
): Debate {
  const showResults =
    resultsEnabled && round?.resultsReleased === true && round.silent !== true;
  const showSpeakerScores = showResults && round?.teamSpeaksReleased === true;
  const { byeResult, ...safeDebate } = debate;

  return {
    ...safeDebate,
    ...(showResults && byeResult !== undefined ? { byeResult } : {}),
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

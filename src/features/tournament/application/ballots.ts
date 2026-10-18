import type {
  AuditCategory,
  BallotSubmission,
  Debate,
  DebateSide,
  Round,
} from "@/types";

export interface BallotAuditEvent {
  action: string;
  category: AuditCategory;
  summary: string;
  roundId?: string;
  debateId?: string;
  details?: Record<string, unknown>;
}

export interface BallotWorkflowDependencies {
  ballots: BallotSubmission[];
  debates: Debate[];
  rounds: Round[];
  adjudicators: Array<{ id: string; privateUrlKey?: string }>;
  repository: {
    saveBallots(ballots: BallotSubmission[]): void;
    saveDebates(debates: Debate[]): void;
  };
  updateRound(round: Round): Promise<void>;
  recordAuditEvent(event: BallotAuditEvent): Promise<void>;
  queuePrivateRecord(
    record: { collection: "ballots"; record: BallotSubmission },
    privateUrlKey?: string,
    passcode?: string
  ): Promise<void>;
}

export async function submitBallotCommand(
  ballot: BallotSubmission,
  privatePasscode: string | undefined,
  dependencies: BallotWorkflowDependencies
): Promise<void> {
  const existingIndex = dependencies.ballots.findIndex(
    (item) => item.id === ballot.id || (!ballot.id && item.debateId === ballot.debateId)
  );
  const finalBallot = {
    ...ballot,
    id: ballot.id || `ballot-${ballot.debateId}-${Date.now()}`,
  };
  const updatedBallots = existingIndex >= 0
    ? dependencies.ballots.map((item, index) => index === existingIndex ? finalBallot : item)
    : [...dependencies.ballots, finalBallot];
  dependencies.repository.saveBallots(updatedBallots);

  // Only a confirmed ballot changes the recorded result, so only it withdraws released results.
  const ballotRound = dependencies.rounds.find((round) => round.id === finalBallot.roundId);
  if (finalBallot.confirmed && (ballotRound?.resultsReleased || ballotRound?.teamSpeaksReleased)) {
    await dependencies.updateRound({
      ...ballotRound,
      resultsReleased: false,
      teamSpeaksReleased: false,
    });
  }

  const debate = dependencies.debates.find((item) => item.id === finalBallot.debateId);
  if (debate) {
    // A new unconfirmed version (e.g. awaiting a check) leaves an existing confirmed result in place.
    const hasOtherConfirmed = updatedBallots.some(
      (item) => item.debateId === debate.id && item.id !== finalBallot.id && item.confirmed && !item.discarded
    );
    const updatedDebate: Debate = {
      ...debate,
      resultStatus: finalBallot.confirmed || hasOtherConfirmed ? "confirmed" : "draft",
    };
    dependencies.repository.saveDebates(
      dependencies.debates.map((item) => item.id === debate.id ? updatedDebate : item)
    );
  }

  await dependencies.recordAuditEvent({
    action: "ballot.submitted",
    category: "ballot",
    summary: `Ballot v${finalBallot.version} submitted for debate`,
    roundId: finalBallot.roundId,
    debateId: finalBallot.debateId,
    details: {
      ballotId: finalBallot.id,
      version: finalBallot.version,
      submitterType: finalBallot.submitterType,
      confirmed: finalBallot.confirmed,
    },
  });

  if (!finalBallot.confirmed) return;
  await confirmBallotCommand(finalBallot.id, finalBallot.debateId, finalBallot, dependencies);
  if (privatePasscode) {
    await dependencies.queuePrivateRecord(
      { collection: "ballots", record: finalBallot },
      dependencies.adjudicators.find((item) => item.id === finalBallot.submitterId)?.privateUrlKey,
      privatePasscode
    );
  }
}

export async function confirmBallotCommand(
  ballotId: string,
  debateId: string,
  submittedBallot: BallotSubmission | undefined,
  dependencies: BallotWorkflowDependencies
): Promise<void> {
  const now = new Date().toISOString();
  const confirmedBallot = submittedBallot || dependencies.ballots.find(
    (item) => item.id === ballotId || item.debateId === debateId
  );
  const updatedBallots = dependencies.ballots.map((item) => {
    if (item.id === ballotId || (item.debateId === debateId && item.id === ballotId)) {
      return { ...item, confirmed: true, discarded: false, confirmedTimestamp: now };
    }
    if (item.debateId === debateId && item.id !== ballotId) {
      return { ...item, confirmed: false, discarded: true };
    }
    return item;
  });
  if (confirmedBallot && !updatedBallots.some((item) => item.id === ballotId)) {
    updatedBallots.push({
      ...confirmedBallot,
      confirmed: true,
      discarded: false,
      confirmedTimestamp: now,
    });
  }
  dependencies.repository.saveBallots(updatedBallots);

  const debate = dependencies.debates.find((item) => item.id === debateId);
  if (debate) {
    const updatedTeams = { ...debate.teams };
    if (confirmedBallot) {
      for (const [key, slot] of Object.entries(updatedTeams)) {
        const side = key as DebateSide;
        if (!slot?.teamId) continue;
        const teamScore = confirmedBallot.teamScores?.[side];
        const speakerScores = confirmedBallot.speakerScores?.[side] || [];
        const speakerTotal = speakerScores.reduce((sum, score) => sum + (score.score || 0), 0);
        updatedTeams[side] = {
          ...slot,
          points: teamScore ? teamScore.points : slot.points,
          speakerScoreTotal:
            speakerTotal || teamScore?.totalSpeakerScore || slot.speakerScoreTotal,
        };
      }
    }
    const updatedDebate: Debate = {
      ...debate,
      resultStatus: "confirmed",
      teams: updatedTeams,
    };
    dependencies.repository.saveDebates(
      dependencies.debates.map((item) => item.id === debateId ? updatedDebate : item)
    );
  }

  await dependencies.recordAuditEvent({
    action: "ballot.confirmed",
    category: "ballot",
    summary: "Ballot confirmed and results recorded",
    roundId: confirmedBallot?.roundId,
    debateId,
    details: {
      ballotId,
      version: confirmedBallot?.version,
      submitterType: confirmedBallot?.submitterType,
    },
  });
}
/**
 * Discards one ballot version. Discarding the confirmed version withdraws the debate's result (and
 * any released results for the round) until another version is confirmed.
 */
export async function discardBallotCommand(
  ballotId: string,
  discardedBy: string | undefined,
  dependencies: BallotWorkflowDependencies
): Promise<void> {
  const ballot = dependencies.ballots.find((item) => item.id === ballotId);
  if (!ballot || ballot.discarded) return;
  const now = new Date().toISOString();
  const updatedBallots = dependencies.ballots.map((item) =>
    item.id === ballotId
      ? { ...item, confirmed: false, discarded: true, discardedBy, discardedTimestamp: now }
      : item
  );
  dependencies.repository.saveBallots(updatedBallots);

  const debate = dependencies.debates.find((item) => item.id === ballot.debateId);
  if (debate && ballot.confirmed) {
    const remaining = updatedBallots.filter((item) => item.debateId === debate.id && !item.discarded);
    const teams = Object.fromEntries(
      Object.entries(debate.teams).map(([side, slot]) => [
        side,
        slot ? { ...slot, points: undefined, speakerScoreTotal: undefined } : slot,
      ])
    ) as Debate["teams"];
    dependencies.repository.saveDebates(
      dependencies.debates.map((item) =>
        item.id === debate.id
          ? { ...item, teams, resultStatus: remaining.length > 0 ? "draft" : "none" }
          : item
      )
    );
    const ballotRound = dependencies.rounds.find((round) => round.id === ballot.roundId);
    if (ballotRound?.resultsReleased || ballotRound?.teamSpeaksReleased) {
      await dependencies.updateRound({ ...ballotRound, resultsReleased: false, teamSpeaksReleased: false });
    }
  }

  await dependencies.recordAuditEvent({
    action: "ballot.discarded",
    category: "ballot",
    summary: `Ballot v${ballot.version} discarded`,
    roundId: ballot.roundId,
    debateId: ballot.debateId,
    details: { ballotId, version: ballot.version, wasConfirmed: ballot.confirmed },
  });
}

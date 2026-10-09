import type {
  AuditCategory,
  BallotSubmission,
  Debate,
  DrawType,
  FeedbackSubmission,
  Motion,
  Round,
} from "@/types";

export interface RoundAdministrationAuditEvent {
  action: string;
  category: AuditCategory;
  summary: string;
  roundId?: string;
  details?: Record<string, unknown>;
}

export interface PreliminaryRoundCountDependencies {
  rounds: Round[];
  debates: Debate[];
  tournamentId: string;
  drawRule: DrawType | "bracket";
  localRepository: {
    saveRounds(rounds: Round[]): void;
    saveDebates(debates: Debate[]): void;
    setActiveRound(update: (current: Round | null) => Round | null): void;
  };
  cloudRepository?: {
    saveRoundCountChanges(rounds: Round[], changedDebates: Debate[]): Promise<void>;
  };
  recordAuditEvent(event: RoundAdministrationAuditEvent): Promise<void>;
}

export async function setPreliminaryRoundCountCommand(
  count: number,
  dependencies: PreliminaryRoundCountDependencies
): Promise<void> {
  const { rounds, debates } = dependencies;
  const previousCount = rounds.filter((round) => round.stage === "preliminary" && !round.cancelled).length;
  const targetCount = Math.max(0, Math.min(20, Math.floor(count)));
  const updated = [...rounds];
  const activePrelims = updated
    .filter((round) => round.stage === "preliminary" && !round.cancelled)
    .sort((left, right) => left.seq - right.seq);

  if (targetCount < activePrelims.length) {
    activePrelims.slice(targetCount).forEach((round) => {
      const index = updated.findIndex((item) => item.id === round.id);
      updated[index] = { ...round, cancelled: true };
    });
  } else if (targetCount > activePrelims.length) {
    const cancelledPrelims = updated
      .filter((round) => round.stage === "preliminary" && round.cancelled)
      .sort((left, right) => left.seq - right.seq);
    const restoreCount = Math.min(targetCount - activePrelims.length, cancelledPrelims.length);
    cancelledPrelims.slice(0, restoreCount).forEach((round) => {
      const index = updated.findIndex((item) => item.id === round.id);
      updated[index] = { ...round, cancelled: false };
    });

    let preliminaryCount = activePrelims.length + restoreCount;
    while (preliminaryCount < targetCount) {
      const seq = Math.max(0, ...updated.map((round) => round.seq)) + 1;
      const id = `round-${dependencies.tournamentId}-${Date.now()}-${preliminaryCount + 1}`;
      updated.push({
        id,
        tournamentId: dependencies.tournamentId,
        seq,
        name: `Round ${preliminaryCount + 1}`,
        abbreviation: `R${preliminaryCount + 1}`,
        stage: "preliminary",
        drawType: preliminaryCount === 0 && dependencies.drawRule === "power_paired"
          ? "random"
          : dependencies.drawRule as DrawType,
        drawStatus: "none",
        feedbackWeight: 1,
        silent: false,
        motionsReleased: false,
        resultsReleased: false,
        completed: false,
        createdAt: new Date().toISOString(),
      });
      preliminaryCount += 1;
    }
  }

  const prelims = updated
    .filter((round) => round.stage === "preliminary" && !round.cancelled)
    .sort((left, right) => left.seq - right.seq);
  const eliminations = updated
    .filter((round) => round.stage === "elimination" && !round.cancelled)
    .sort((left, right) => left.seq - right.seq);
  const cancelled = updated.filter((round) => round.cancelled).sort((left, right) => left.seq - right.seq);
  const ordered = [...prelims, ...eliminations, ...cancelled].map((round, index) => ({
    ...round,
    seq: index + 1,
  }));
  const sequenceByRoundId = new Map(ordered.map((round) => [round.id, round.seq]));
  const updatedDebates = debates.map((debate) => ({
    ...debate,
    roundSeq: sequenceByRoundId.get(debate.roundId) ?? debate.roundSeq,
  }));
  const changedDebates = updatedDebates.filter(
    (debate, index) => debate.roundSeq !== debates[index].roundSeq
  );

  if (dependencies.cloudRepository) {
    await dependencies.cloudRepository.saveRoundCountChanges(ordered, changedDebates);
  }
  dependencies.localRepository.saveRounds(ordered);
  if (changedDebates.length > 0) {
    dependencies.localRepository.saveDebates(updatedDebates);
  }
  dependencies.localRepository.setActiveRound((current) => {
    const updatedActive = current && ordered.find((round) => round.id === current.id);
    if (updatedActive && !updatedActive.cancelled) return updatedActive;
    return [...prelims, ...eliminations].at(-1) || null;
  });

  if (previousCount !== targetCount) {
    await dependencies.recordAuditEvent({
      action: "rounds.preliminary_count_updated",
      category: "tournament",
      summary: `Preliminary round count changed from ${previousCount} to ${targetCount}`,
      details: { previousCount, count: targetCount },
    });
  }
}

export interface DeleteRoundDependencies {
  roundId: string;
  rounds: Round[];
  debates: Debate[];
  ballots: BallotSubmission[];
  feedback: FeedbackSubmission[];
  motions: Motion[];
  activeRound: Round | null;
  localRepository: {
    saveRounds(rounds: Round[]): void;
    saveDebates(debates: Debate[]): void;
    saveBallots(ballots: BallotSubmission[]): void;
    saveFeedback(feedback: FeedbackSubmission[]): void;
    saveMotions(motions: Motion[]): void;
    setActiveRound(round: Round | null): void;
  };
  cloudRepository?: {
    deleteRoundAndSaveChanges(changes: {
      roundId: string;
      deletedDebates: Debate[];
      deletedBallots: BallotSubmission[];
      deletedFeedback: FeedbackSubmission[];
      remainingRounds: Round[];
      updatedDebates: Debate[];
      changedMotions: Motion[];
    }): Promise<void>;
  };
  recordAuditEvent(event: RoundAdministrationAuditEvent): Promise<void>;
}

export async function deleteRoundCommand(dependencies: DeleteRoundDependencies): Promise<void> {
  const { roundId, rounds, debates, ballots, feedback, motions } = dependencies;
  const roundToDelete = rounds.find((round) => round.id === roundId);
  if (!roundToDelete) return;

  let preliminarySeq = 0;
  const remainingRounds = rounds
    .filter((round) => round.id !== roundId)
    .sort((left, right) => left.seq - right.seq)
    .map((round, index) => {
      let name = round.name;
      let abbreviation = round.abbreviation;
      if (round.stage === "preliminary") {
        preliminarySeq += 1;
        if (/^Round \d+$/.test(name)) name = `Round ${preliminarySeq}`;
        if (/^R\d+$/.test(abbreviation)) abbreviation = `R${preliminarySeq}`;
      }
      return { ...round, seq: index + 1, name, abbreviation };
    });
  const remainingRoundIds = new Set(remainingRounds.map((round) => round.id));
  const deletedDebates = debates.filter((debate) => debate.roundId === roundId);
  const deletedDebateIds = new Set(deletedDebates.map((debate) => debate.id));
  const deletedBallots = ballots.filter(
    (ballot) => ballot.roundId === roundId || deletedDebateIds.has(ballot.debateId)
  );
  const deletedFeedback = feedback.filter(
    (submission) => submission.roundId === roundId || deletedDebateIds.has(submission.debateId)
  );
  const oldDebateSeqById = new Map(debates.map((debate) => [debate.id, debate.roundSeq]));
  const updatedDebates = debates
    .filter((debate) => remainingRoundIds.has(debate.roundId))
    .map((debate) => ({
      ...debate,
      roundSeq: remainingRounds.find((round) => round.id === debate.roundId)?.seq ?? debate.roundSeq,
    }));
  const updatedMotions = motions.map((motion) => ({
    ...motion,
    rounds: (motion.rounds || []).filter((assignedRoundId) => assignedRoundId !== roundId),
  }));
  const changedMotions = updatedMotions.filter((motion, index) =>
    motions[index].rounds?.includes(roundId)
  );

  if (dependencies.cloudRepository) {
    await dependencies.cloudRepository.deleteRoundAndSaveChanges({
      roundId,
      deletedDebates,
      deletedBallots,
      deletedFeedback,
      remainingRounds,
      updatedDebates: updatedDebates.filter(
        (debate) => debate.roundSeq !== oldDebateSeqById.get(debate.id)
      ),
      changedMotions,
    });
  }

  dependencies.localRepository.saveRounds(remainingRounds);
  dependencies.localRepository.saveDebates(updatedDebates);
  dependencies.localRepository.saveBallots(
    ballots.filter((ballot) => !deletedBallots.some((removed) => removed.id === ballot.id))
  );
  dependencies.localRepository.saveFeedback(
    feedback.filter((submission) => !deletedFeedback.some((removed) => removed.id === submission.id))
  );
  dependencies.localRepository.saveMotions(updatedMotions);
  if (dependencies.activeRound?.id === roundId) {
    dependencies.localRepository.setActiveRound(
      remainingRounds.filter((round) => !round.cancelled).at(-1) || null
    );
  }
  await dependencies.recordAuditEvent({
    action: "round.deleted",
    category: "tournament",
    summary: `${roundToDelete.name} deleted`,
    roundId,
    details: {
      deletedDebateCount: deletedDebates.length,
      deletedBallotCount: deletedBallots.length,
      deletedFeedbackCount: deletedFeedback.length,
    },
  });
}
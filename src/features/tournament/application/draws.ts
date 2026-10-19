import type {
  AuditCategory,
  BallotSubmission,
  Debate,
  Institution,
  Motion,
  Round,
  Team,
  TeamStandingRow,
  Tournament,
  Venue,
} from "@/types";
import type { GenerateDrawParams } from "@/lib/draw/generator";
import { randomSeed } from "@/lib/draw/rng";
import { applyGuards, checkDrawGeneration, type RuleOverride } from "./stateGuards";

export interface DrawAuditEvent {
  action: string;
  category: AuditCategory;
  summary: string;
  roundId?: string;
  details?: Record<string, unknown>;
}

export interface GenerateDrawDependencies {
  tournament: Tournament | null;
  rounds: Round[];
  teams: Team[];
  institutions?: Institution[];
  venues: Venue[];
  debates: Debate[];
  /** Every ballot in the tournament; results attached to this round block regeneration. */
  ballots: BallotSubmission[];
  motions: Motion[];
  standings: TeamStandingRow[];
  /** `generateRoundDraw`, inline or in a Web Worker; the same params (and seed) give the same draw. */
  generateRoundDraw(params: GenerateDrawParams): Debate[] | Promise<Debate[]>;
  localRepository: {
    saveDebates(debates: Debate[]): void;
    saveBallots(ballots: BallotSubmission[]): void;
    /**
     * Queues the replaced debates for deletion on the next cloud upload. Each draw has its own
     * debate ids, so without this the cloud would keep the old draw next to the new one.
     */
    markDebatesRemoved(debateIds: string[]): void;
    saveRounds(rounds: Round[], activeRound: Round): void;
  };
  cloudRepository?: {
    replaceRoundDraw(
      roundId: string,
      removedDebates: Debate[],
      debates: Debate[],
      round: Round,
      discardedBallots: BallotSubmission[]
    ): Promise<void>;
  };
  recordAuditEvent(event: DrawAuditEvent): Promise<void>;
  /**
   * The working copy as it is now. Generation may run in a Web Worker while the organiser keeps
   * working, so the result is saved on top of the current records, not the ones it started from.
   */
  latest?(): { rounds: Round[]; debates: Debate[]; ballots: BallotSubmission[] };
}

/**
 * The round was edited (or regenerated) while its draw or allocation was being computed, so the
 * result would overwrite that edit. Nothing is saved.
 */
export class RoundChangedDuringComputeError extends Error {
  constructor(roundName: string) {
    super(`${roundName} was changed while this was being computed, so nothing was saved. Try again.`);
    this.name = "RoundChangedDuringComputeError";
  }
}

/** Whether a round, its debates or its ballots differ between two snapshots of the working copy. */
export function roundChangedBetween(
  roundId: string,
  before: { rounds?: Round[]; debates: Debate[]; ballots?: BallotSubmission[] },
  after: { rounds?: Round[]; debates: Debate[]; ballots?: BallotSubmission[] }
): boolean {
  const snapshot = (state: typeof before) => {
    const debates = state.debates.filter((debate) => debate.roundId === roundId);
    const debateIds = new Set(debates.map((debate) => debate.id));
    return JSON.stringify([
      state.rounds?.find((round) => round.id === roundId) ?? null,
      debates,
      (state.ballots || []).filter((ballot) => debateIds.has(ballot.debateId)),
    ]);
  };
  return snapshot(before) !== snapshot(after);
}

/** The draw is saved locally, but the immediate cloud replacement did not finish. */
export class DrawCloudSyncIncompleteError extends Error {
  constructor(readonly cause: unknown) {
    super(
      "The new draw is saved on this device, but updating the cloud copy did not finish. " +
      "Use \"Upload to cloud\" to complete it: the removed debates and discarded ballots are queued."
    );
    this.name = "DrawCloudSyncIncompleteError";
  }
}

export class DrawHasResultsError extends Error {
  constructor(readonly ballotCount: number, readonly debateCount: number) {
    super(
      `This round already has ${ballotCount} ballot(s) for ${debateCount} debate(s). ` +
      "Regenerating the draw would discard them; confirm that you want to discard these results first."
    );
    this.name = "DrawHasResultsError";
  }
}

/** Ballots (not yet discarded) attached to the current draw of a round. */
export function roundResults(
  roundId: string,
  debates: Pick<Debate, "id" | "roundId">[],
  ballots: BallotSubmission[]
): BallotSubmission[] {
  const debateIds = new Set(debates.filter((debate) => debate.roundId === roundId).map((debate) => debate.id));
  return ballots.filter((ballot) => debateIds.has(ballot.debateId) && !ballot.discarded);
}

/**
 * Each generation gets its own debate ids. The generator numbers rooms from 1, so without this a
 * regenerated draw would reuse ids, and a ballot recorded for the old matchup would be read as the
 * result of the new one.
 */
export function withGenerationIds<T extends Pick<Debate, "id">>(generated: T[], seed: number): T[] {
  const token = seed.toString(36);
  return generated.map((debate) => ({ ...debate, id: `${debate.id}-g${token}` }));
}

export async function generateDrawCommand(
  roundId: string,
  dependencies: GenerateDrawDependencies,
  options: { discardExistingResults?: boolean; override?: RuleOverride } = {}
): Promise<void> {
  const { tournament, rounds, teams, institutions = [], venues, debates, ballots, motions, standings } = dependencies;
  const round = rounds.find((item) => item.id === roundId);
  if (!round || !tournament) return;
  await applyGuards(checkDrawGeneration(round, { rounds, debates, ballots }), options.override, {
    action: "draw.generated",
    category: "draw",
    roundId,
    record: dependencies.recordAuditEvent,
  });

  const existingResults = roundResults(roundId, debates, ballots);
  if (existingResults.length > 0 && !options.discardExistingResults) {
    throw new DrawHasResultsError(
      existingResults.length,
      new Set(existingResults.map((ballot) => ballot.debateId)).size
    );
  }

  const previousRoundIds = new Set(
    rounds
      .filter((item) => !item.cancelled && item.seq < round.seq)
      .map((item) => item.id)
  );
  const pastDebates = debates.filter((debate) => previousRoundIds.has(debate.roundId));
  // Recorded on the round so this exact draw can be reproduced from the same inputs.
  const seed = randomSeed();
  const generated = withGenerationIds(await dependencies.generateRoundDraw({
    tournament,
    round,
    teams,
    institutions,
    venues,
    pastDebates,
    standings,
    seed,
  }), seed);

  const current = dependencies.latest?.() ?? { rounds, debates, ballots };
  if (roundChangedBetween(roundId, { rounds, debates, ballots }, current)) {
    throw new RoundChangedDuringComputeError(round.name);
  }

  const roundMotion = motions.find((motion) => motion.rounds?.includes(round.id));
  if (roundMotion) {
    generated.forEach((debate) => {
      debate.motionId = roundMotion.id;
      debate.motionText = roundMotion.text;
    });
  }

  const removedDebates = current.debates.filter((debate) => debate.roundId === roundId);
  const updatedDebates = [...current.debates.filter((debate) => debate.roundId !== roundId), ...generated];
  const updatedRound: Round = { ...round, drawStatus: "draft", adjudicatorsRevealed: false, drawSeed: seed };
  const updatedRounds = current.rounds.map((item) => item.id === round.id ? updatedRound : item);

  // Results of the replaced draw are kept as discarded versions, never re-attached to new matchups.
  const discardedTimestamp = new Date().toISOString();
  const discardedBallots = existingResults.map((ballot) => ({
    ...ballot,
    confirmed: false,
    discarded: true,
    discardedBy: "draw regenerated",
    discardedTimestamp,
  }));
  if (discardedBallots.length > 0) {
    const byId = new Map(discardedBallots.map((ballot) => [ballot.id, ballot]));
    dependencies.localRepository.saveBallots(current.ballots.map((ballot) => byId.get(ballot.id) ?? ballot));
  }
  dependencies.localRepository.saveDebates(updatedDebates);
  dependencies.localRepository.saveRounds(updatedRounds, updatedRound);
  if (removedDebates.length > 0) {
    dependencies.localRepository.markDebatesRemoved(removedDebates.map((debate) => debate.id));
  }
  // Local state is complete at this point, and the queued deletions plus the saved records let a
  // normal upload finish an interrupted cloud replacement. A cloud failure is therefore reported
  // as an incomplete sync, not as a failed draw.
  let cloudError: unknown;
  if (dependencies.cloudRepository) {
    try {
      await dependencies.cloudRepository.replaceRoundDraw(
        roundId,
        removedDebates,
        generated,
        updatedRound,
        discardedBallots
      );
    } catch (error) {
      cloudError = error;
    }
  }

  await dependencies.recordAuditEvent({
    action: "draw.generated",
    category: "draw",
    summary: `Generated ${round.name} draw`,
    roundId: round.id,
    details: {
      format: tournament.format,
      drawType: round.drawType,
      teamCount: new Set(generated.flatMap((debate) =>
        Object.values(debate.teams).map((slot) => slot.teamId)
      )).size,
      debateCount: generated.length,
      previousDebateCount: removedDebates.length,
      discardedBallotCount: existingResults.length,
      cloudSync: dependencies.cloudRepository ? (cloudError ? "incomplete" : "complete") : "local-only",
      pairingMethod: tournament.preferences?.pairingMethod ?? tournament.preferences?.drawRule,
      conflictAvoidance: tournament.preferences?.conflictAvoidance,
      sideAllocationRule: tournament.preferences?.sideAllocationRule,
      seed,
    },
  });
  if (cloudError) throw new DrawCloudSyncIncompleteError(cloudError);
}
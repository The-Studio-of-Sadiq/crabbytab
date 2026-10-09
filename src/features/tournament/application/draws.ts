import type { AuditCategory, Debate, Motion, Round, Team, TeamStandingRow, Tournament, Venue } from "@/types";
import type { generateRoundDraw } from "@/lib/draw/generator";

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
  venues: Venue[];
  debates: Debate[];
  motions: Motion[];
  standings: TeamStandingRow[];
  generateRoundDraw: typeof generateRoundDraw;
  localRepository: {
    saveDebates(debates: Debate[]): void;
    saveRounds(rounds: Round[], activeRound: Round): void;
  };
  cloudRepository?: {
    replaceRoundDraw(roundId: string, removedDebates: Debate[], debates: Debate[], round: Round): Promise<void>;
  };
  recordAuditEvent(event: DrawAuditEvent): Promise<void>;
}

export async function generateDrawCommand(
  roundId: string,
  dependencies: GenerateDrawDependencies
): Promise<void> {
  const { tournament, rounds, teams, venues, debates, motions, standings } = dependencies;
  const round = rounds.find((item) => item.id === roundId);
  if (!round || !tournament) return;

  const previousRoundIds = new Set(
    rounds
      .filter((item) => !item.cancelled && item.seq < round.seq)
      .map((item) => item.id)
  );
  const pastDebates = debates.filter((debate) => previousRoundIds.has(debate.roundId));
  const generated = dependencies.generateRoundDraw({
    tournament,
    round,
    teams,
    venues,
    pastDebates,
    standings,
  });

  const roundMotion = motions.find((motion) => motion.rounds?.includes(round.id));
  if (roundMotion) {
    generated.forEach((debate) => {
      debate.motionId = roundMotion.id;
      debate.motionText = roundMotion.text;
    });
  }

  const removedDebates = debates.filter((debate) => debate.roundId === roundId);
  const updatedDebates = [...debates.filter((debate) => debate.roundId !== roundId), ...generated];
  const updatedRound: Round = { ...round, drawStatus: "draft", adjudicatorsRevealed: false };
  const updatedRounds = rounds.map((item) => item.id === round.id ? updatedRound : item);

  dependencies.localRepository.saveDebates(updatedDebates);
  dependencies.localRepository.saveRounds(updatedRounds, updatedRound);
  if (dependencies.cloudRepository) {
    await dependencies.cloudRepository.replaceRoundDraw(roundId, removedDebates, generated, updatedRound);
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
      pairingMethod: tournament.preferences?.pairingMethod ?? tournament.preferences?.drawRule,
      conflictAvoidance: tournament.preferences?.conflictAvoidance,
      sideAllocationRule: tournament.preferences?.sideAllocationRule,
    },
  });
}
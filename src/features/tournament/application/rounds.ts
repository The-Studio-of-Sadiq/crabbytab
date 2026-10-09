import type { AuditCategory, DrawType, Round, RoundStage } from "@/types";

export interface CreateRoundRecordInput {
  tournamentId: string;
  roundSeq: number;
  name: string;
  abbr: string;
  stage: RoundStage;
  customDrawType?: DrawType;
  defaultDrawRule?: DrawType | "bracket";
}

export interface RoundLocalRepository {
  saveRounds(rounds: Round[], activeRound?: Round): void;
}

export interface RoundAuditEvent {
  action: string;
  category: AuditCategory;
  summary: string;
  roundId?: string;
  details?: Record<string, unknown>;
}

export interface RoundManagementDependencies {
  localRepository: RoundLocalRepository;
  recordAuditEvent(event: RoundAuditEvent): Promise<void>;
}

export interface RoundCloudRepository {
  saveRound(round: Round): Promise<void>;
}

export function createRoundRecord({
  tournamentId,
  roundSeq,
  name,
  abbr,
  stage,
  customDrawType,
  defaultDrawRule = "power_paired",
}: CreateRoundRecordInput): Round {
  const normalizedDefaultRule = defaultDrawRule === "bracket" ? "random" : defaultDrawRule;
  const mappedDrawType: DrawType =
    customDrawType ||
    (roundSeq === 1 && normalizedDefaultRule === "power_paired" ? "random" : (normalizedDefaultRule as DrawType));

  return {
    id: `round-${tournamentId}-${roundSeq}`,
    tournamentId,
    seq: roundSeq,
    name,
    abbreviation: abbr,
    stage,
    drawType: mappedDrawType,
    drawStatus: "none",
    feedbackWeight: 1.0,
    silent: false,
    motionsReleased: false,
    resultsReleased: false,
    teamSpeaksReleased: false,
    completed: false,
    createdAt: new Date().toISOString(),
  };
}

export async function createRoundCommand(
  input: CreateRoundRecordInput,
  rounds: Round[],
  dependencies: RoundManagementDependencies
): Promise<Round> {
  const round = createRoundRecord(input);
  dependencies.localRepository.saveRounds([...rounds, round], round);
  await dependencies.recordAuditEvent({
    action: "round.created",
    category: "tournament",
    summary: `${round.name} created`,
    roundId: round.id,
    details: {
      sequence: round.seq,
      stage: round.stage,
      drawType: round.drawType,
    },
  });
  return round;
}

export async function updateRoundCommand(
  round: Round,
  rounds: Round[],
  activeRound: Round | null,
  dependencies: RoundManagementDependencies & { cloudRepository?: RoundCloudRepository }
): Promise<void> {
  const previous = rounds.find((item) => item.id === round.id);
  if (dependencies.cloudRepository) {
    await dependencies.cloudRepository.saveRound(round);
  }

  const updatedRounds = rounds.map((item) => (item.id === round.id ? round : item));
  dependencies.localRepository.saveRounds(
    updatedRounds,
    activeRound?.id === round.id ? round : undefined
  );

  if (!previous) return;
  const changes = getRoundChangeSummary(previous, round);
  if (Object.keys(changes).length === 0) return;

  const drawStatusChanged = previous.drawStatus !== round.drawStatus;
  await dependencies.recordAuditEvent({
    action: drawStatusChanged ? "draw.status_changed" : "round.updated",
    category: drawStatusChanged ? "draw" : "tournament",
    summary: drawStatusChanged
      ? `${round.name} draw status changed to ${round.drawStatus}`
      : `${round.name} settings updated`,
    roundId: round.id,
    details: { changes },
  });
}

export function getRoundChangeSummary(previous: Round, next: Round) {
  const trackedFields = [
    "drawStatus",
    "adjudicatorsRevealed",
    "completed",
    "resultsReleased",
    "teamSpeaksReleased",
    "motionsReleased",
    "silent",
    "cancelled",
  ] as const;

  return Object.fromEntries(
    trackedFields
      .filter((field) => previous[field] !== next[field])
      .map((field) => [field, { from: previous[field], to: next[field] }])
  );
}

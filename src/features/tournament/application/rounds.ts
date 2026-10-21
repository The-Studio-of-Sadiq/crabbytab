import type { AuditCategory, BallotSubmission, Debate, DrawType, Round, RoundStage } from "@/types";
import { applyGuards, checkRoundUpdate, type DrawCheckIssue, type RuleOverride } from "./stateGuards";
import { slotNewPreliminaryRounds } from "./schedule";

export interface CreateRoundRecordInput {
  tournamentId: string;
  roundSeq: number;
  name: string;
  abbr: string;
  stage: RoundStage;
  customDrawType?: DrawType;
  defaultDrawRule?: DrawType | "bracket";
  /** Tabbycat prelim_panels (preliminaryPanelsOf): preliminary rounds per schedule slot. */
  preliminaryPanels?: number;
  /**
   * The new round's id. Absent: `round-<tournament>-<seq>` (fine for a tournament's first rounds;
   * createRoundCommand always passes a fresh id, see newRoundId).
   */
  id?: string;
}

/** Thrown when a round's stage and draw type do not fit together (Tabbycat Round.clean()). */
export class RoundValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoundValidationError";
  }
}

/**
 * Tabbycat Round.clean(): the "elimination" draw type is only for elimination rounds, where it is
 * mandatory. Returns the problem, or null when the pair is valid.
 */
export function roundStageDrawTypeProblem(stage: RoundStage, drawType: DrawType): string | null {
  if ((stage === "elimination") !== (drawType === "elimination")) {
    return 'The "Elimination" draw type is only for elimination rounds, where it is mandatory.';
  }
  return null;
}

/**
 * A fresh id for a new round. Round ids must never be derived from the sequence number alone:
 * deleting a round renumbers the later rounds but keeps their ids, so `round-<tournament>-<seq>`
 * could name a round that still exists (and overwrite its stored document) or one just deleted.
 */
export function newRoundId(tournamentId: string, roundSeq: number, existing: Iterable<Pick<Round, "id">>): string {
  const taken = new Set([...existing].map((round) => round.id));
  const random = () =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  let id = `round-${tournamentId}-${roundSeq}-${random()}`;
  while (taken.has(id)) id = `round-${tournamentId}-${roundSeq}-${random()}`;
  return id;
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

/** What updateRoundCommand needs to check a status change (release, completion, cancellation). */
export interface RoundGuardContext {
  debates: Debate[];
  ballots: BallotSubmission[];
  /** The draw check for a round (validateDraw), run only when its draw is being published. */
  drawIssues(round: Round): DrawCheckIssue[];
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
  id,
}: CreateRoundRecordInput): Round {
  const normalizedDefaultRule = defaultDrawRule === "bracket" ? "random" : defaultDrawRule;
  // An elimination round always uses the elimination draw (Tabbycat Round.clean()); the default
  // preliminary rule is never applied to it.
  const mappedDrawType: DrawType =
    customDrawType ||
    (stage === "elimination"
      ? "elimination"
      : roundSeq === 1 && normalizedDefaultRule === "power_paired"
        ? "random"
        : (normalizedDefaultRule as DrawType));
  const problem = roundStageDrawTypeProblem(stage, mappedDrawType);
  if (problem) throw new RoundValidationError(problem);

  return {
    id: id ?? `round-${tournamentId}-${roundSeq}`,
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
  // Tabbycat prelim_panels: a new preliminary round joins the last slot until it is full.
  const record = createRoundRecord({ ...input, id: input.id ?? newRoundId(input.tournamentId, input.roundSeq, rounds) });
  const [round] = slotNewPreliminaryRounds(rounds, [record], input.preliminaryPanels ?? 1, { renameDefaults: false });
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
  dependencies: RoundManagementDependencies & {
    cloudRepository?: RoundCloudRepository;
    guards: RoundGuardContext;
  },
  override?: RuleOverride
): Promise<void> {
  const previous = rounds.find((item) => item.id === round.id);
  assertStageMatchesDrawType(previous, round);
  if (previous) {
    const { debates, ballots, drawIssues } = dependencies.guards;
    await applyGuards(
      checkRoundUpdate(previous, round, { rounds, debates, ballots }, () => drawIssues(round)),
      override,
      { action: "round.updated", category: "tournament", roundId: round.id, record: dependencies.recordAuditEvent }
    );
  }
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

/**
 * Saves several changed rounds at once (e.g. grouping preliminary rounds into schedule slots), so
 * no change is lost to a stale round list. Every round is checked like updateRoundCommand, and
 * nothing is saved unless all of them pass.
 */
export async function updateRoundsCommand(
  changed: Round[],
  rounds: Round[],
  activeRound: Round | null,
  dependencies: RoundManagementDependencies & {
    cloudRepository?: RoundCloudRepository;
    guards: RoundGuardContext;
  },
  summary: string,
  override?: RuleOverride
): Promise<void> {
  if (changed.length === 0) return;
  const byId = new Map(changed.map((round) => [round.id, round]));
  const updatedRounds = rounds.map((item) => byId.get(item.id) ?? item);
  const { debates, ballots, drawIssues } = dependencies.guards;
  const violations = changed.flatMap((round) => {
    const previous = rounds.find((item) => item.id === round.id);
    if (!previous) throw new Error(`Cannot update round ${round.id}: it no longer exists.`);
    assertStageMatchesDrawType(previous, round);
    return checkRoundUpdate(previous, round, { rounds: updatedRounds, debates, ballots }, () => drawIssues(round));
  });
  await applyGuards(violations, override, {
    action: "rounds.updated",
    category: "tournament",
    record: dependencies.recordAuditEvent,
  });
  if (dependencies.cloudRepository) {
    for (const round of changed) await dependencies.cloudRepository.saveRound(round);
  }
  const active = activeRound ? byId.get(activeRound.id) : undefined;
  dependencies.localRepository.saveRounds(updatedRounds, active);
  await dependencies.recordAuditEvent({
    action: "rounds.updated",
    category: "tournament",
    summary,
    details: {
      rounds: changed.map((round) => ({
        roundId: round.id,
        changes: getRoundChangeSummary(rounds.find((item) => item.id === round.id)!, round),
      })),
    },
  });
}

/**
 * Refuses an update that leaves a round's stage and draw type inconsistent. Only checked when the
 * update changes either of them, so older rounds stored with a mismatch can still be edited
 * otherwise.
 */
function assertStageMatchesDrawType(previous: Round | undefined, next: Round): void {
  if (previous && previous.stage === next.stage && previous.drawType === next.drawType) return;
  const problem = roundStageDrawTypeProblem(next.stage, next.drawType);
  if (problem) throw new RoundValidationError(`${next.name}: ${problem}`);
}

export function getRoundChangeSummary(previous: Round, next: Round) {
  const trackedFields = [
    "drawStatus",
    "adjudicatorsRevealed",
    "completed",
    "resultsReleased",
    "teamSpeaksReleased",
    "motionsReleased",
    "motionsStatus",
    "scheduleGroup",
    "startsAt",
    "name",
    "abbreviation",
    "silent",
    "cancelled",
    "weight",
  ] as const;

  return Object.fromEntries(
    trackedFields
      .filter((field) => previous[field] !== next[field])
      .map((field) => [field, { from: previous[field], to: next[field] }])
  );
}

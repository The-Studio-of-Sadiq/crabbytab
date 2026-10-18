import type {
  Adjudicator,
  AuditCategory,
  BreakCategory,
  Debate,
  FeedbackSubmission,
  PanelSizingMode,
  Round,
  Team,
  TeamStandingRow,
  Tournament,
  Venue,
} from "@/types";
import {
  autoAllocateAdjudicators,
  buildPastAdjTeams,
  type IntelligentAllocationContext,
} from "@/lib/draw/allocator";
import { calculateScaledFeedbackScores } from "@/lib/feedback/scores";
import { allocateVenuesToDebates, applyAdjudicatorVenueRequirements } from "@/lib/draw/venueAllocator";
import { RoundChangedDuringComputeError, roundChangedBetween } from "./draws";

export interface AllocationAuditEvent {
  action: string;
  category: AuditCategory;
  summary: string;
  roundId?: string;
  debateId?: string;
  details?: Record<string, unknown>;
}

export interface AllocationDependencies {
  tournament: Tournament | null;
  rounds: Round[];
  teams: Team[];
  debates: Debate[];
  adjudicators: Adjudicator[];
  standings: TeamStandingRow[];
  breakCategories: BreakCategory[];
  feedback: FeedbackSubmission[];
  venues: Venue[];
  repository: { saveDebates(debates: Debate[]): void };
  cloudRepository?: { saveDebates(debates: Debate[]): Promise<void> };
  hideRevealedAdjudicators(roundIds: Set<string>): Promise<void>;
  recordAuditEvent(event: AllocationAuditEvent): Promise<void>;
  /** Runs `computeAutoAllocation` elsewhere (a Web Worker); inline when omitted. */
  computeAllocation?(input: AutoAllocationInput): Promise<AutoAllocationResult | null>;
  /** The debates as they are now (see GenerateDrawDependencies.latest). */
  latestDebates?(): Debate[];
}

/** The data auto-allocation reads: plain records only, so it can run in a Web Worker. */
export type AutoAllocationInput = Pick<
  AllocationDependencies,
  "tournament" | "rounds" | "teams" | "debates" | "adjudicators" | "standings" | "breakCategories" | "feedback" | "venues"
> & {
  roundId: string;
  panelSize: number;
  settings?: AutoAllocateSettings;
};

export interface AutoAllocationResult {
  /** The round's debates with their new panels (and venues, when adjudicators have requirements). */
  roundDebates: Debate[];
  /** The round's debates with their new panels only. */
  panelledDebates: Debate[];
  details: {
    panelSize: number;
    panelSizing: PanelSizingMode;
    preformedPanelCount: number;
    assignments: Array<{
      debateId: string;
      chairId?: string;
      panellistIds?: string[];
      traineeIds?: string[];
      conflicts?: string[];
    }>;
  };
}

function getPriorDebates(round: Round | undefined, input: Pick<AutoAllocationInput, "rounds" | "debates">): Debate[] {
  if (!round) return [];
  const earlierRoundIds = new Set(
    input.rounds
      .filter((item) => !item.cancelled && item.seq < round.seq)
      .map((item) => item.id)
  );
  return input.debates.filter((debate) => earlierRoundIds.has(debate.roundId));
}

export interface AutoAllocateSettings {
  /** Defaults to the tournament's panelSizingMode preference, then "fixed". */
  panelSizing?: PanelSizingMode;
}

/**
 * Computes the auto-allocation of one round without saving anything. Deterministic for the same
 * input; null when the round has no debates.
 */
export function computeAutoAllocation(input: AutoAllocationInput): AutoAllocationResult | null {
  const { roundId, panelSize, settings = {} } = input;
  const roundDebates = input.debates.filter((debate) => debate.roundId === roundId);
  const tournament = input.tournament;
  if (roundDebates.length === 0 || !tournament) return null;

  const round = input.rounds.find((item) => item.id === roundId);
  const teamsById = new Map(input.teams.map((team) => [team.id, team]));
  const pastDebates = getPriorDebates(round, input);
  const completedPrelimRounds = input.rounds.filter(
    (item) => item.stage === "preliminary" && !item.cancelled && item.completed
  ).length;
  const totalPrelimRounds = input.rounds.filter(
    (item) => item.stage === "preliminary" && !item.cancelled
  ).length;
  const intelligentContext: IntelligentAllocationContext = {
    allPastDebates: pastDebates,
    standings: input.standings,
    breakCategories: input.breakCategories,
    totalPrelimRounds,
    completedRounds: completedPrelimRounds,
    isBP: tournament.format === "bp",
    feedbackScores: calculateScaledFeedbackScores(
      input.feedback,
      input.debates,
      tournament.preferences
    ),
    feedbackWeight: round?.feedbackWeight,
    venuePriorities: new Map(input.venues.map((venue) => [venue.id, venue.priority])),
    preformedPanels: tournament.preferences?.usePreformedPanels ? round?.preformedPanels : undefined,
  };
  const effectivePanelSize = tournament.preferences?.noPanellistAdjs ? 1 : panelSize;
  const panelSizing = settings.panelSizing ?? tournament.preferences?.panelSizingMode ?? "fixed";
  // A zero penalty switches a constraint off; otherwise the configured weight is used as given.
  const conflictPenalty = tournament.preferences?.adjConflictPenalty ?? 1;
  const historyPenalty = tournament.preferences?.adjHistoryPenalty ?? 1;
  const allocations = autoAllocateAdjudicators(
    roundDebates,
    teamsById,
    input.adjudicators,
    buildPastAdjTeams(pastDebates),
    {
      panelSize: effectivePanelSize,
      panelSizing,
      balancePanels: true,
      panelStrengthStrategy: tournament.preferences?.adjudicatorPanelStrategy ?? "crabbytab_v1",
      respectInstitutionConflicts: conflictPenalty > 0,
      respectPersonalConflicts: conflictPenalty > 0,
      respectHistoryConflicts: historyPenalty > 0,
      preferences: tournament.preferences,
    },
    intelligentContext
  );

  const updatedRoundDebates = roundDebates.map((debate, index) => {
    const allocation = allocations[index];
    return {
      ...debate,
      adjudicators: {
        chairId: allocation?.chairId,
        chairName: allocation?.chairName,
        panellistIds: allocation?.panellistIds || [],
        panellistNames: allocation?.panellistNames || [],
        traineeIds: allocation?.traineeIds || [],
        traineeNames: allocation?.traineeNames || [],
      },
    };
  });
  const hasAdjudicatorVenueRequirements = input.adjudicators.some(
    (adjudicator) => adjudicator.venueRequirements &&
      Object.values(adjudicator.venueRequirements).some((value) => value !== undefined && value !== false)
  );
  const finalRoundDebates = hasAdjudicatorVenueRequirements
    ? (() => {
        const withRequirements = applyAdjudicatorVenueRequirements(
          updatedRoundDebates,
          input.adjudicators
        );
        const venueAssignments = allocateVenuesToDebates(withRequirements, input.venues);
        return withRequirements.map((debate) => {
          const venue = venueAssignments.get(debate.id);
          return venue ? { ...debate, venueId: venue.id, venueName: venue.name } : debate;
        });
      })()
    : updatedRoundDebates;
  return {
    roundDebates: finalRoundDebates,
    panelledDebates: updatedRoundDebates,
    details: {
      panelSize: effectivePanelSize,
      panelSizing,
      preformedPanelCount: intelligentContext.preformedPanels?.length ?? 0,
      assignments: allocations.map((allocation) => ({
        debateId: allocation.debateId,
        chairId: allocation.chairId,
        panellistIds: allocation.panellistIds,
        traineeIds: allocation.traineeIds,
        conflicts: allocation.conflicts,
      })),
    },
  };
}

export async function autoAllocateCommand(
  roundId: string,
  panelSize: number,
  dependencies: AllocationDependencies,
  settings: AutoAllocateSettings = {}
): Promise<void> {
  const input: AutoAllocationInput = {
    roundId,
    panelSize,
    settings,
    tournament: dependencies.tournament,
    rounds: dependencies.rounds,
    teams: dependencies.teams,
    debates: dependencies.debates,
    adjudicators: dependencies.adjudicators,
    standings: dependencies.standings,
    breakCategories: dependencies.breakCategories,
    feedback: dependencies.feedback,
    venues: dependencies.venues,
  };
  const result = dependencies.computeAllocation
    ? await dependencies.computeAllocation(input)
    : computeAutoAllocation(input);
  if (!result) return;
  const round = dependencies.rounds.find((item) => item.id === roundId);
  const currentDebates = dependencies.latestDebates?.() ?? dependencies.debates;
  if (roundChangedBetween(roundId, { debates: dependencies.debates }, { debates: currentDebates })) {
    throw new RoundChangedDuringComputeError(round?.name || "This round");
  }
  const finalRoundDebates = result.roundDebates;
  const updatedRoundDebates = result.panelledDebates;
  const updatedDebates = [
    ...currentDebates.filter((debate) => debate.roundId !== roundId),
    ...finalRoundDebates,
  ];

  dependencies.repository.saveDebates(updatedDebates);
  await dependencies.hideRevealedAdjudicators(new Set([roundId]));
  if (dependencies.cloudRepository) {
    await dependencies.cloudRepository.saveDebates(updatedRoundDebates);
  }
  await dependencies.recordAuditEvent({
    action: "adjudicators.allocated",
    category: "allocation",
    summary: `Allocated adjudicators for ${round?.name || "round"}`,
    roundId,
    details: {
      panelSize: result.details.panelSize,
      panelSizing: result.details.panelSizing,
      feedbackWeight: round?.feedbackWeight,
      preformedPanelCount: result.details.preformedPanelCount,
      debateCount: finalRoundDebates.length,
      adjudicatorCount: dependencies.adjudicators.length,
      assignments: result.details.assignments,
    },
  });
}

export async function updateDebateCommand(
  debate: Debate,
  debates: Debate[],
  dependencies: Pick<AllocationDependencies, "repository" | "hideRevealedAdjudicators" | "recordAuditEvent">
): Promise<void> {
  const previous = debates.find((item) => item.id === debate.id);
  dependencies.repository.saveDebates(
    debates.map((item) => item.id === debate.id ? debate : item)
  );
  if (previous && JSON.stringify(previous.adjudicators) !== JSON.stringify(debate.adjudicators)) {
    await dependencies.hideRevealedAdjudicators(new Set([debate.roundId]));
    await dependencies.recordAuditEvent({
      action: "adjudicators.manual_assignment_updated",
      category: "allocation",
      summary: `Adjudicator assignment changed for ${debate.id}`,
      roundId: debate.roundId,
      debateId: debate.id,
      details: { previous: previous.adjudicators, current: debate.adjudicators },
    });
  }
  if (previous && previous.venueId !== debate.venueId) {
    await dependencies.recordAuditEvent({
      action: "venue.assigned",
      category: "venue",
      summary: `Venue changed for ${debate.id}`,
      roundId: debate.roundId,
      debateId: debate.id,
      details: {
        previousVenueId: previous.venueId,
        venueId: debate.venueId,
        venueName: debate.venueName,
      },
    });
  }
}

export async function updateDebatesCommand(
  newDebates: Debate[],
  previousDebates: Debate[],
  dependencies: Pick<AllocationDependencies, "repository" | "cloudRepository" | "hideRevealedAdjudicators" | "recordAuditEvent">
): Promise<void> {
  dependencies.repository.saveDebates(newDebates);
  if (dependencies.cloudRepository) {
    await dependencies.cloudRepository.saveDebates(newDebates);
  }

  const previousById = new Map(previousDebates.map((debate) => [debate.id, debate]));
  const changedAssignments = newDebates.flatMap((debate) => {
    const previous = previousById.get(debate.id);
    if (!previous || JSON.stringify(previous.adjudicators) === JSON.stringify(debate.adjudicators)) return [];
    return [{
      debateId: debate.id,
      roundId: debate.roundId,
      previous: previous.adjudicators,
      current: debate.adjudicators,
    }];
  });
  if (changedAssignments.length === 0) return;

  await dependencies.hideRevealedAdjudicators(
    new Set(changedAssignments.map((assignment) => assignment.roundId))
  );
  await dependencies.recordAuditEvent({
    action: "adjudicators.manual_assignments_updated",
    category: "allocation",
    summary: `Manual adjudicator assignments changed in ${changedAssignments.length} debate(s)`,
    roundId: changedAssignments.length === 1 ? changedAssignments[0].roundId : undefined,
    debateId: changedAssignments.length === 1 ? changedAssignments[0].debateId : undefined,
    details: { assignments: changedAssignments },
  });
}
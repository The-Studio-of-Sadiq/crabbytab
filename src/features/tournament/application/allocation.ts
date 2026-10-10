import type {
  Adjudicator,
  AuditCategory,
  BreakCategory,
  Debate,
  FeedbackSubmission,
  Round,
  Team,
  TeamStandingRow,
  Tournament,
  Venue,
} from "@/types";
import {
  autoAllocateAdjudicators,
  buildPastAdjTeams,
  calculateAdjudicatorFeedbackScores,
  type IntelligentAllocationContext,
} from "@/lib/draw/allocator";
import { allocateVenuesToDebates, applyAdjudicatorVenueRequirements } from "@/lib/draw/venueAllocator";

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
}

function getPriorDebates(round: Round | undefined, dependencies: AllocationDependencies): Debate[] {
  if (!round) return [];
  const earlierRoundIds = new Set(
    dependencies.rounds
      .filter((item) => !item.cancelled && item.seq < round.seq)
      .map((item) => item.id)
  );
  return dependencies.debates.filter((debate) => earlierRoundIds.has(debate.roundId));
}

export async function autoAllocateCommand(
  roundId: string,
  panelSize: number,
  dependencies: AllocationDependencies
): Promise<void> {
  const roundDebates = dependencies.debates.filter((debate) => debate.roundId === roundId);
  const tournament = dependencies.tournament;
  if (roundDebates.length === 0 || !tournament) return;

  const round = dependencies.rounds.find((item) => item.id === roundId);
  const teamsById = new Map(dependencies.teams.map((team) => [team.id, team]));
  const pastDebates = getPriorDebates(round, dependencies);
  const completedPrelimRounds = dependencies.rounds.filter(
    (item) => item.stage === "preliminary" && !item.cancelled && item.completed
  ).length;
  const totalPrelimRounds = dependencies.rounds.filter(
    (item) => item.stage === "preliminary" && !item.cancelled
  ).length;
  const intelligentContext: IntelligentAllocationContext = {
    allPastDebates: pastDebates,
    standings: dependencies.standings,
    breakCategories: dependencies.breakCategories,
    totalPrelimRounds,
    completedRounds: completedPrelimRounds,
    isBP: tournament.format === "bp",
    feedbackScores: calculateAdjudicatorFeedbackScores(dependencies.feedback),
    venuePriorities: new Map(dependencies.venues.map((venue) => [venue.id, venue.priority])),
  };
  const effectivePanelSize = tournament.preferences?.noPanellistAdjs ? 1 : panelSize;
  const allocations = autoAllocateAdjudicators(
    roundDebates,
    teamsById,
    dependencies.adjudicators,
    buildPastAdjTeams(pastDebates),
    {
      panelSize: effectivePanelSize,
      balancePanels: true,
      panelStrengthStrategy: tournament.preferences?.adjudicatorPanelStrategy ?? "crabbytab_v1",
      respectInstitutionConflicts: true,
      respectPersonalConflicts: true,
      respectHistoryConflicts: true,
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
  const hasAdjudicatorVenueRequirements = dependencies.adjudicators.some(
    (adjudicator) => adjudicator.venueRequirements &&
      Object.values(adjudicator.venueRequirements).some((value) => value !== undefined && value !== false)
  );
  const finalRoundDebates = hasAdjudicatorVenueRequirements
    ? (() => {
        const withRequirements = applyAdjudicatorVenueRequirements(
          updatedRoundDebates,
          dependencies.adjudicators
        );
        const venueAssignments = allocateVenuesToDebates(withRequirements, dependencies.venues);
        return withRequirements.map((debate) => {
          const venue = venueAssignments.get(debate.id);
          return venue ? { ...debate, venueId: venue.id, venueName: venue.name } : debate;
        });
      })()
    : updatedRoundDebates;
  const updatedDebates = [
    ...dependencies.debates.filter((debate) => debate.roundId !== roundId),
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
      panelSize: effectivePanelSize,
      debateCount: finalRoundDebates.length,
      adjudicatorCount: dependencies.adjudicators.length,
      assignments: allocations.map((allocation) => ({
        debateId: allocation.debateId,
        chairId: allocation.chairId,
        panellistIds: allocation.panellistIds,
        traineeIds: allocation.traineeIds,
        conflicts: allocation.conflicts,
      })),
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
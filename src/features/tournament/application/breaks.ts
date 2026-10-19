import type {
  AuditCategory,
  BallotSubmission,
  BreakCategory,
  BreakQualificationRule,
  BreakTeamOverride,
  Debate,
  Round,
  Team,
  Tournament,
} from "@/types";
import { applyEliminationAdvancement, getAdvancingTeamIds } from "@/lib/draw/elimination";
import { getEligibleTeamsForRound } from "@/lib/draw/generator";
import {
  applyCategoryBreakStatus,
  snapshotBreak,
  type BreakCategoryResult,
} from "@/lib/breakqual/calculator";
import { buildBreakCategorySchedule, eliminationRoundCount, slugify, validateBreakSize } from "@/lib/setup/presets";
import {
  applyGuards,
  checkBreakCategoryDeletion,
  checkBreakGeneration,
  enforceGuards,
  type RuleOverride,
} from "./stateGuards";

export interface BreakAuditEvent {
  action: string;
  category: AuditCategory;
  summary: string;
  roundId?: string;
  details?: Record<string, unknown>;
}

export interface BreakDependencies {
  tournament: Tournament | null;
  rounds: Round[];
  teams: Team[];
  breakCategories: BreakCategory[];
  breakResults: BreakCategoryResult[];
  debates: Debate[];
  ballots: BallotSubmission[];
  localRepository: {
    saveBreakCategories(categories: BreakCategory[]): void;
    saveTeams(teams: Team[]): void;
    saveRounds(rounds: Round[]): void;
    setActiveRound(round: Round | null): void;
  };
  cloudRepository?: {
    saveBreakCategories(categories: BreakCategory[]): Promise<void>;
    saveGeneratedBreak(teams: Team[], rounds: Round[]): Promise<void>;
    saveEliminationAdvancement(teams: Team[], participatingTeamIds: Set<string>, round: Round): Promise<void>;
  };
  recordAuditEvent(event: BreakAuditEvent): Promise<void>;
}

export async function saveBreakCategoriesCommand(
  categories: BreakCategory[],
  dependencies: BreakDependencies
): Promise<void> {
  const previousById = new Map(dependencies.breakCategories.map((category) => [category.id, category]));
  // A category with a generated break, or used by a drawn elimination round, stays.
  enforceGuards(dependencies.breakCategories
    .filter((category) => !categories.some((next) => next.id === category.id))
    .flatMap((category) => checkBreakCategoryDeletion(category, dependencies.teams, dependencies.rounds)));
  dependencies.localRepository.saveBreakCategories(categories);
  if (dependencies.cloudRepository) {
    await dependencies.cloudRepository.saveBreakCategories(categories);
  }

  const changes: Record<string, unknown>[] = [];
  categories.forEach((category) => {
    const previous = previousById.get(category.id);
    if (!previous) {
      changes.push({
        type: "created",
        category: {
          categoryId: category.id,
          name: category.name,
          breakSize: category.breakSize,
          reserveSize: category.reserveSize,
          priority: category.priority,
          isGeneral: category.isGeneral,
        },
      });
      return;
    }
    if (
      previous.name !== category.name ||
      previous.breakSize !== category.breakSize ||
      previous.reserveSize !== category.reserveSize ||
      previous.priority !== category.priority ||
      previous.isGeneral !== category.isGeneral ||
      previous.maxPerInstitution !== category.maxPerInstitution ||
      previous.qualificationRule !== category.qualificationRule ||
      JSON.stringify(previous.teamOverrides ?? {}) !== JSON.stringify(category.teamOverrides ?? {})
    ) {
      changes.push({
        type: "updated",
        categoryId: category.id,
        previous: {
          name: previous.name,
          breakSize: previous.breakSize,
          reserveSize: previous.reserveSize,
          priority: previous.priority,
          isGeneral: previous.isGeneral,
          maxPerInstitution: previous.maxPerInstitution,
          qualificationRule: previous.qualificationRule,
          teamOverrides: previous.teamOverrides ?? {},
        },
        current: {
          name: category.name,
          breakSize: category.breakSize,
          reserveSize: category.reserveSize,
          priority: category.priority,
          isGeneral: category.isGeneral,
          maxPerInstitution: category.maxPerInstitution,
          qualificationRule: category.qualificationRule,
          teamOverrides: category.teamOverrides ?? {},
        },
      });
    }
  });
  const deleted = dependencies.breakCategories.filter(
    (category) => !categories.some((next) => next.id === category.id)
  );
  if (changes.length > 0 || deleted.length > 0) {
    await dependencies.recordAuditEvent({
      action: "break.categories_updated",
      category: "break",
      summary: "Break categories updated",
      details: {
        changes,
        deleted: deleted.map((category) => ({
          categoryId: category.id,
          name: category.name,
          breakSize: category.breakSize,
        })),
      },
    });
  }
}

export async function generateBreakCommand(
  categoryId: string,
  dependencies: BreakDependencies,
  override?: RuleOverride
): Promise<Round | null> {
  const { tournament, breakCategories, breakResults, rounds, teams } = dependencies;
  if (breakResults.length === 0 || !tournament) return null;
  const category = breakCategories.find((item) => item.id === categoryId);
  if (!category) return null;

  const teamsInDebate = tournament.preferences?.teamsInDebate || (tournament.format === "bp" ? 4 : 2);
  const maxBreakSize = Math.max(0, ...breakCategories.map((item) => item.breakSize));
  const roundCount = eliminationRoundCount(maxBreakSize, teamsInDebate);
  if (roundCount === 0) {
    throw new Error("No valid elimination-round sequence is configured for these break sizes.");
  }

  const eliminationRounds = rounds
    .filter((round) => round.stage === "elimination" && !round.cancelled)
    .sort((left, right) => left.seq - right.seq);
  if (eliminationRounds.length < roundCount) {
    throw new Error("The pre-created elimination rounds do not cover the configured break size.");
  }

  const schedule = buildBreakCategorySchedule(breakCategories, roundCount, teamsInDebate);
  const roundIndexById = new Map(eliminationRounds.map((round, index) => [round.id, index]));
  const updatedRounds = rounds.map((round) => {
    if (round.stage !== "elimination" || round.cancelled) return round;
    const index = roundIndexById.get(round.id);
    if (index === undefined) return round;
    const breakCategoryIds = index < roundCount ? schedule[index] : [];
    const unchanged = JSON.stringify(round.breakCategoryIds ?? []) === JSON.stringify(breakCategoryIds);
    // The guard below refuses to touch a started round, so only an unstarted round is reset.
    return {
      ...round,
      breakCategoryIds,
      eliminationAdvanced: unchanged ? round.eliminationAdvanced ?? false : false,
    };
  });
  await applyGuards(
    checkBreakGeneration(category, dependencies, updatedRounds),
    override,
    { action: "break.generated", category: "break", record: dependencies.recordAuditEvent }
  );
  const firstCategoryRound = updatedRounds.find(
    (round) => round.stage === "elimination" && round.breakCategoryIds?.includes(categoryId)
  );
  if (!firstCategoryRound) {
    throw new Error(`${category.name} does not fit the configured elimination-round sequence.`);
  }

  const categoryResult = breakResults.find((result) => result.category.id === categoryId);
  if (!categoryResult) {
    throw new Error(`The ${category.name} break has not been calculated yet.`);
  }
  // Only this category's statuses change; other categories keep their own generated break.
  const updatedTeams = applyCategoryBreakStatus(teams, categoryResult);
  const updatedCategories = breakCategories.map((item) =>
    item.id === categoryId
      ? { ...item, generatedBreak: snapshotBreak(categoryResult, new Date().toISOString()) }
      : item
  );
  dependencies.localRepository.saveTeams(updatedTeams);
  dependencies.localRepository.saveRounds(updatedRounds);
  dependencies.localRepository.saveBreakCategories(updatedCategories);
  dependencies.localRepository.setActiveRound(firstCategoryRound);
  if (dependencies.cloudRepository) {
    await dependencies.cloudRepository.saveGeneratedBreak(updatedTeams, updatedRounds);
    await dependencies.cloudRepository.saveBreakCategories(updatedCategories);
  }
  await dependencies.recordAuditEvent({
    action: "break.generated",
    category: "break",
    summary: `Generated ${category.name} break`,
    roundId: firstCategoryRound.id,
    details: {
      categoryId: category.id,
      categoryName: category.name,
      breakSize: category.breakSize,
      reserveSize: category.reserveSize,
      breakingTeamIds: categoryResult.breakingTeams.map((entry) => entry.team.id),
      reserveTeamIds: categoryResult.reserveTeams.map((entry) => entry.team.id),
      overrides: category.teamOverrides ?? {},
      eliminationRoundIds: updatedRounds
        .filter((round) => round.stage === "elimination" && !round.cancelled)
        .map((round) => round.id),
    },
  });
  return firstCategoryRound;
}

export async function proceedToNextEliminationRoundCommand(
  roundId: string,
  dependencies: BreakDependencies
): Promise<Round | null> {
  const { tournament, rounds, debates, teams, ballots } = dependencies;
  if (!tournament) return null;
  const round = rounds.find((item) => item.id === roundId && item.stage === "elimination");
  if (!round) throw new Error("Select an elimination round before proceeding.");
  if (round.eliminationAdvanced) {
    return rounds
      .filter((item) => item.stage === "elimination" && item.seq > round.seq && !item.cancelled)
      .sort((left, right) => left.seq - right.seq)
      .find((item) => !round.breakCategoryIds?.length || item.breakCategoryIds?.some((id) => round.breakCategoryIds!.includes(id))) || null;
  }

  const roundDebates = debates.filter((debate) => debate.roundId === round.id);
  if (roundDebates.length === 0) {
    throw new Error("Generate this elimination round's draw before proceeding.");
  }
  const expectedTeamIds = new Set(
    getEligibleTeamsForRound(teams, round)
      .filter((team) => team.checkedIn !== false)
      .map((team) => team.id)
  );
  const assignedTeamIds = new Set(
    roundDebates.flatMap((debate) => Object.values(debate.teams).map((slot) => slot?.teamId).filter(Boolean))
  );
  if ([...expectedTeamIds].some((teamId) => !assignedTeamIds.has(teamId))) {
    throw new Error("Every eligible team must be assigned to a debate before proceeding.");
  }

  const nextRound = rounds
    .filter((item) => item.stage === "elimination" && item.seq > round.seq && !item.cancelled)
    .sort((left, right) => left.seq - right.seq)
    .find((item) => !round.breakCategoryIds?.length || item.breakCategoryIds?.some((id) => round.breakCategoryIds!.includes(id))) || null;
  const isFinalRound = nextRound === null;
  const advancingTeamIds = getAdvancingTeamIds(roundDebates, ballots, tournament.format, isFinalRound);
  const participatingTeamIds = new Set(assignedTeamIds);
  if ([...participatingTeamIds].some((teamId) => !expectedTeamIds.has(teamId))) {
    throw new Error("This round contains a team that did not qualify for this elimination stage.");
  }

  const updatedTeams = applyEliminationAdvancement(teams, roundDebates, advancingTeamIds, round.id);
  const updatedRound = { ...round, eliminationAdvanced: true, completed: true };
  const updatedRounds = rounds.map((item) => item.id === round.id ? updatedRound : item);
  dependencies.localRepository.saveTeams(updatedTeams);
  dependencies.localRepository.saveRounds(updatedRounds);
  dependencies.localRepository.setActiveRound(nextRound || updatedRound);
  if (dependencies.cloudRepository) {
    await dependencies.cloudRepository.saveEliminationAdvancement(
      updatedTeams,
      participatingTeamIds,
      updatedRound
    );
  }
  await dependencies.recordAuditEvent({
    action: "elimination.round_advanced",
    category: "break",
    summary: `Advanced teams from ${round.name}`,
    roundId: round.id,
    details: {
      nextRoundId: nextRound?.id,
      isFinalRound,
      advancingTeamIds: [...advancingTeamIds],
      participatingTeamIds: [...participatingTeamIds],
    },
  });
  return nextRound;
}
export interface BreakCategoryDraft {
  name: string;
  breakSize: number;
  reserveSize: number;
  priority: number;
  isGeneral: boolean;
  maxPerInstitution: number;
  qualificationRule: BreakQualificationRule;
}

/** Returns an error message, or "" when the draft can be saved. */
export function validateBreakCategoryDraft(
  draft: BreakCategoryDraft,
  categories: BreakCategory[],
  teamsInDebate: 4 | 2,
  editingId?: string
): string {
  const name = draft.name.trim();
  if (!name) return "Every break category needs a name.";
  if (categories.some((category) => category.id !== editingId && category.name.trim().toLowerCase() === name.toLowerCase())) {
    return `There is already a break category called "${name}".`;
  }
  const sizeError = validateBreakSize(draft.breakSize, teamsInDebate);
  if (sizeError) return sizeError;
  if (!Number.isInteger(draft.reserveSize) || draft.reserveSize < 0) return "Reserve size must be 0 or more.";
  if (!Number.isInteger(draft.priority)) return "Priority must be a whole number.";
  if (!Number.isInteger(draft.maxPerInstitution) || draft.maxPerInstitution < 0) {
    return "The institution limit must be 0 (no limit) or more.";
  }
  return "";
}

/** Adds a category, or updates the one with `editingId`, keeping its id, overrides and generated break. */
export function upsertBreakCategory(
  categories: BreakCategory[],
  draft: BreakCategoryDraft,
  tournamentId: string,
  editingId?: string,
  createId: () => string = () => `bc-${Date.now()}`
): BreakCategory[] {
  const fields = {
    name: draft.name.trim(),
    breakSize: draft.breakSize,
    reserveSize: draft.reserveSize,
    priority: draft.priority,
    isGeneral: draft.isGeneral,
    maxPerInstitution: draft.maxPerInstitution > 0 ? draft.maxPerInstitution : undefined,
    qualificationRule: draft.qualificationRule,
  };
  if (editingId) {
    return categories.map((category) => (category.id === editingId ? { ...category, ...fields } : category));
  }
  const usedSlugs = new Set(categories.map((category) => category.slug));
  const baseSlug = slugify(fields.name) || `break-${categories.length + 1}`;
  let slug = baseSlug;
  for (let suffix = 2; usedSlugs.has(slug); suffix++) slug = `${baseSlug}-${suffix}`;
  return [
    ...categories,
    {
      id: createId(),
      tournamentId,
      slug,
      seq: Math.max(0, ...categories.map((category) => category.seq)) + 1,
      ...fields,
    },
  ];
}

/** Sets (or with `null`, clears) a team's manual break override in one category. */
export function withTeamOverride(
  categories: BreakCategory[],
  categoryId: string,
  teamId: string,
  override: BreakTeamOverride | null
): BreakCategory[] {
  return categories.map((category) => {
    if (category.id !== categoryId) return category;
    const teamOverrides = { ...(category.teamOverrides ?? {}) };
    if (override) teamOverrides[teamId] = override;
    else delete teamOverrides[teamId];
    return { ...category, teamOverrides };
  });
}

/** Returns why a category cannot be deleted, or "" when it can. */
export function getBreakCategoryDeletionBlocker(
  category: BreakCategory,
  teams: Team[],
  rounds: Round[]
): string {
  return checkBreakCategoryDeletion(category, teams, rounds).map((violation) => violation.message).join(" ");
}

import type {
  Adjudicator,
  AuditCategory,
  BallotSubmission,
  Debate,
  FeedbackSubmission,
  Institution,
  Motion,
  Team,
  Venue,
} from "@/types";
import {
  checkAdjudicatorDeletion,
  checkInstitutionDeletion,
  checkTeamDeletion,
  checkVenueDeletion,
  enforceGuards,
} from "./stateGuards";
import { scoreChangesBetween, withScoreHistory } from "@/lib/feedback/scoreHistory";

export interface EntityAuditEvent {
  action: string;
  category: AuditCategory;
  summary: string;
  details?: Record<string, unknown>;
}

export interface EntityCollectionRepository<T> {
  save(records: T[]): void;
}

export interface EntityCommandDependencies {
  tournamentId: string;
  institutions: Institution[];
  teams: Team[];
  adjudicators: Adjudicator[];
  venues: Venue[];
  motions: Motion[];
  /** Records that may reference a participant or venue; referenced ones cannot be deleted. */
  debates: Debate[];
  ballots: BallotSubmission[];
  feedback: FeedbackSubmission[];
  repositories: {
    institutions: EntityCollectionRepository<Institution>;
    teams: EntityCollectionRepository<Team>;
    adjudicators: EntityCollectionRepository<Adjudicator>;
    venues: EntityCollectionRepository<Venue>;
    motions: EntityCollectionRepository<Motion>;
  };
  recordAuditEvent(event: EntityAuditEvent): Promise<void>;
  createId(prefix: string): string;
  generatePrivateKey(prefix?: string): string;
  /** Who is editing, stamped on base/test score history entries. */
  currentActor?(): { id?: string; name?: string };
  now?(): string;
  cloudRepository?: {
    saveMotion(motion: Motion): Promise<void>;
  };
}

/** Records created and updated together, e.g. by a previewed CSV import. Ids are already assigned. */
export interface EntityBatch {
  institutionsCreated?: Institution[];
  institutionsUpdated?: Institution[];
  teamsCreated?: Team[];
  teamsUpdated?: Team[];
  adjudicatorsCreated?: Adjudicator[];
  adjudicatorsUpdated?: Adjudicator[];
}

export function createEntityId(prefix: string): string {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

export function createTournamentEntityCommands(dependencies: EntityCommandDependencies) {
  const {
    tournamentId,
    institutions,
    teams,
    adjudicators,
    venues,
    motions,
    debates,
    ballots,
    feedback,
    repositories,
    recordAuditEvent,
    createId,
    generatePrivateKey,
  } = dependencies;
  const scoreChangeContext = (reason?: string) => {
    const actor = dependencies.currentActor?.();
    return {
      timestamp: dependencies.now?.() ?? new Date().toISOString(),
      actorId: actor?.id,
      actorName: actor?.name,
      reason,
    };
  };
  // Audit events record score changes as entries of their own, not the whole history each time.
  const auditSafeAdjudicator = ({
    privateUrlKey: _privateUrlKey,
    privatePasscode: _privatePasscode,
    scoreHistory: _scoreHistory,
    ...safe
  }: Adjudicator) => safe;

  /** Returns the created records (with their new ids). */
  const addInstitutions = async (data: Omit<Institution, "id" | "tournamentId">[]): Promise<Institution[]> => {
    if (data.length === 0) return [];
    const created = data.map((item) => ({ ...item, id: createId("inst"), tournamentId }));
    repositories.institutions.save([...institutions, ...created]);
    for (const institution of created) {
      await recordAuditEvent({
        action: "institution.created",
        category: "tournament",
        summary: `Institution ${institution.name} added`,
        details: {
          institutionId: institution.id,
          name: institution.name,
          code: institution.code,
          region: institution.region,
        },
      });
    }
    return created;
  };

  const updateInstitution = async (institution: Institution) => {
    const previous = institutions.find((item) => item.id === institution.id);
    repositories.institutions.save(
      institutions.map((item) => (item.id === institution.id ? institution : item))
    );
    await recordAuditEvent({
      action: "institution.updated",
      category: "tournament",
      summary: `Institution ${institution.name} updated`,
      details: {
        institutionId: institution.id,
        previous: previous
          ? { name: previous.name, code: previous.code, region: previous.region }
          : undefined,
        current: { name: institution.name, code: institution.code, region: institution.region },
      },
    });
  };

  const deleteInstitution = async (institutionId: string) => {
    const deleted = institutions.find((item) => item.id === institutionId);
    if (deleted) enforceGuards(checkInstitutionDeletion(deleted, { debates, ballots, teams, adjudicators }));
    repositories.institutions.save(institutions.filter((item) => item.id !== institutionId));
    await recordAuditEvent({
      action: "institution.deleted",
      category: "tournament",
      summary: `Institution ${deleted?.name || institutionId} deleted`,
      details: { institutionId, name: deleted?.name },
    });
  };

  /** Returns the created records (with their new ids and private URL keys). */
  const addTeams = async (data: Omit<Team, "id" | "tournamentId">[]): Promise<Team[]> => {
    if (data.length === 0) return [];
    const created = data.map((item) => ({
      ...item,
      id: createId("team"),
      tournamentId,
      privateUrlKey: item.privateUrlKey || generatePrivateKey("team"),
      privatePasscode: item.privatePasscode || generatePrivateKey(),
    }));
    repositories.teams.save([...teams, ...created]);
    for (const team of created) {
      await recordAuditEvent({
        action: "team.created",
        category: "tournament",
        summary: `Team ${team.name} added`,
        details: {
          teamId: team.id,
          name: team.name,
          institutionId: team.institutionId,
          breakCategories: team.breakCategories,
          speakerCount: team.speakers.length,
        },
      });
    }
    return created;
  };

  const updateTeam = async (team: Team) => {
    const previous = teams.find((item) => item.id === team.id);
    repositories.teams.save(teams.map((item) => (item.id === team.id ? team : item)));
    await recordAuditEvent({
      action: "team.updated",
      category: "tournament",
      summary: `Team ${team.name} updated`,
      details: {
        teamId: team.id,
        previous: previous
          ? {
              name: previous.name,
              institutionId: previous.institutionId,
              breakCategories: previous.breakCategories,
              speakerCount: previous.speakers.length,
              checkedIn: previous.checkedIn,
            }
          : undefined,
        current: {
          name: team.name,
          institutionId: team.institutionId,
          breakCategories: team.breakCategories,
          speakerCount: team.speakers.length,
          checkedIn: team.checkedIn,
        },
      },
    });
  };

  const deleteTeam = async (teamId: string) => {
    const deleted = teams.find((item) => item.id === teamId);
    if (deleted) enforceGuards(checkTeamDeletion(deleted, { debates, ballots, feedback }));
    repositories.teams.save(teams.filter((item) => item.id !== teamId));
    await recordAuditEvent({
      action: "team.deleted",
      category: "tournament",
      summary: `Team ${deleted?.name || teamId} deleted`,
      details: { teamId, name: deleted?.name },
    });
  };

  /** Returns the created records (with their new ids and private URL keys). */
  const addAdjudicators = async (data: Omit<Adjudicator, "id" | "tournamentId">[]): Promise<Adjudicator[]> => {
    if (data.length === 0) return [];
    const created = data.map((item) => ({
      ...item,
      id: createId("adj"),
      tournamentId,
      privateUrlKey: item.privateUrlKey || generatePrivateKey("adj"),
      privatePasscode: item.privatePasscode || generatePrivateKey(),
    }));
    repositories.adjudicators.save([...adjudicators, ...created]);
    for (const adjudicator of created) {
      await recordAuditEvent({
        action: "adjudicator.created",
        category: "tournament",
        summary: `Adjudicator ${adjudicator.name} added`,
        details: {
          adjudicatorId: adjudicator.id,
          name: adjudicator.name,
          institutionId: adjudicator.institutionId,
          baseScore: adjudicator.baseScore,
          trainee: adjudicator.trainee,
          independent: adjudicator.independent,
        },
      });
    }
    return created;
  };

  /**
   * Saves one adjudicator. Base/test score changes are appended to its score history with
   * the editor, the time and the optional reason.
   */
  const updateAdjudicator = async (adjudicator: Adjudicator, options: { scoreChangeReason?: string } = {}) => {
    const previous = adjudicators.find((item) => item.id === adjudicator.id);
    const context = scoreChangeContext(options.scoreChangeReason);
    const saved = withScoreHistory(previous, adjudicator, context);
    repositories.adjudicators.save(
      adjudicators.map((item) => (item.id === adjudicator.id ? saved : item))
    );
    const scoreChanges = scoreChangesBetween(previous, adjudicator, context);
    await recordAuditEvent({
      action: "adjudicator.updated",
      category: "tournament",
      summary: `Adjudicator ${adjudicator.name} updated`,
      details: {
        adjudicatorId: adjudicator.id,
        previous: previous ? auditSafeAdjudicator(previous) : undefined,
        current: auditSafeAdjudicator(saved),
        ...(scoreChanges.length ? { scoreChanges } : {}),
      },
    });
  };

  /** Saves several adjudicators in one write so later changes cannot overwrite earlier ones. */
  const updateAdjudicators = async (changed: Adjudicator[]) => {
    if (changed.length === 0) return;
    const context = scoreChangeContext();
    const previousById = new Map(adjudicators.map((item) => [item.id, item]));
    const byId = new Map(changed.map((item) => [item.id, withScoreHistory(previousById.get(item.id), item, context)]));
    const previous = adjudicators.filter((item) => byId.has(item.id));
    repositories.adjudicators.save(adjudicators.map((item) => byId.get(item.id) ?? item));
    await recordAuditEvent({
      action: "adjudicators.updated",
      category: "tournament",
      summary: `${changed.length} adjudicator(s) updated`,
      details: {
        previous: previous.map(auditSafeAdjudicator),
        current: [...byId.values()].map(auditSafeAdjudicator),
      },
    });
  };

  const deleteAdjudicator = async (adjudicatorId: string) => {
    const deleted = adjudicators.find((item) => item.id === adjudicatorId);
    if (deleted) enforceGuards(checkAdjudicatorDeletion(deleted, { debates, ballots, feedback }));
    repositories.adjudicators.save(adjudicators.filter((item) => item.id !== adjudicatorId));
    await recordAuditEvent({
      action: "adjudicator.deleted",
      category: "tournament",
      summary: `Adjudicator ${deleted?.name || adjudicatorId} deleted`,
      details: { adjudicatorId, name: deleted?.name },
    });
  };

  const addVenues = async (data: Omit<Venue, "id" | "tournamentId">[]) => {
    if (data.length === 0) return;
    const created = data.map((item) => ({ ...item, id: createId("ven"), tournamentId }));
    repositories.venues.save([...venues, ...created]);
    for (const venue of created) {
      await recordAuditEvent({
        action: "venue.created",
        category: "venue",
        summary: `Venue ${venue.name} added`,
        details: {
          venueId: venue.id,
          name: venue.name,
          priority: venue.priority,
          category: venue.category,
          capacity: venue.capacity,
          accessible: venue.accessible,
          online: venue.online,
          nearTabRoom: venue.nearTabRoom,
        },
      });
    }
  };

  const updateVenue = async (venue: Venue) => {
    const previous = venues.find((item) => item.id === venue.id);
    repositories.venues.save(venues.map((item) => (item.id === venue.id ? venue : item)));
    const auditFields = ({
      name,
      priority,
      category,
      capacity,
      accessible,
      online,
      nearTabRoom,
      available,
      checkedIn,
    }: Venue) => ({ name, priority, category, capacity, accessible, online, nearTabRoom, available, checkedIn });
    await recordAuditEvent({
      action: "venue.updated",
      category: "venue",
      summary: `Venue ${venue.name} updated`,
      details: {
        venueId: venue.id,
        previous: previous ? auditFields(previous) : undefined,
        current: auditFields(venue),
      },
    });
  };

  const deleteVenue = async (venueId: string) => {
    const deleted = venues.find((item) => item.id === venueId);
    if (deleted) enforceGuards(checkVenueDeletion(deleted, { debates, ballots }));
    repositories.venues.save(venues.filter((item) => item.id !== venueId));
    await recordAuditEvent({
      action: "venue.deleted",
      category: "venue",
      summary: `Venue ${deleted?.name || venueId} deleted`,
      details: { venueId, name: deleted?.name },
    });
  };

  const addMotions = async (data: Omit<Motion, "id" | "tournamentId">[]) => {
    if (data.length === 0) return;
    const created = data.map((item) => ({ ...item, id: createId("motion"), tournamentId }));
    repositories.motions.save([...motions, ...created]);
    for (const motion of created) {
      await recordAuditEvent({
        action: "motion.created",
        category: "tournament",
        summary: "Motion added",
        details: {
          motionId: motion.id,
          reference: motion.reference,
          roundIds: motion.rounds,
          released: motion.released,
        },
      });
    }
  };

  const updateMotion = async (motion: Motion) => {
    const previous = motions.find((item) => item.id === motion.id);
    if (dependencies.cloudRepository) {
      await dependencies.cloudRepository.saveMotion(motion);
    }
    repositories.motions.save(motions.map((item) => (item.id === motion.id ? motion : item)));
    await recordAuditEvent({
      action: "motion.updated",
      category: "tournament",
      summary: "Motion updated",
      details: {
        motionId: motion.id,
        previous: previous
          ? { reference: previous.reference, rounds: previous.rounds, released: previous.released }
          : undefined,
        current: { reference: motion.reference, rounds: motion.rounds, released: motion.released },
      },
    });
  };

  const deleteMotion = async (motionId: string) => {
    const deleted = motions.find((item) => item.id === motionId);
    repositories.motions.save(motions.filter((item) => item.id !== motionId));
    await recordAuditEvent({
      action: "motion.deleted",
      category: "tournament",
      summary: "Motion deleted",
      details: { motionId, reference: deleted?.reference, roundIds: deleted?.rounds },
    });
  };

  /**
   * Saves a batch with one write per collection, so a large import cannot be half-applied by
   * later saves overwriting earlier ones, and records one audit event for the whole batch.
   * Updated records must exist; created ones must not.
   */
  const saveEntityBatch = async (batch: EntityBatch, source: string) => {
    const merge = <T extends { id: string }>(current: T[], created: T[] = [], updated: T[] = [], noun: string): T[] | undefined => {
      if (created.length === 0 && updated.length === 0) return undefined;
      const ids = new Set(current.map((item) => item.id));
      const missing = updated.find((item) => !ids.has(item.id));
      if (missing) throw new Error(`Cannot update ${noun} ${missing.id}: it no longer exists. Reload and preview the import again.`);
      const clash = created.find((item) => ids.has(item.id));
      if (clash) throw new Error(`Cannot create ${noun} ${clash.id}: the id is already used.`);
      const byId = new Map(updated.map((item) => [item.id, item]));
      return [...current.map((item) => byId.get(item.id) ?? item), ...created];
    };
    const nextInstitutions = merge(
      institutions,
      batch.institutionsCreated?.map((item) => ({ ...item, tournamentId })),
      batch.institutionsUpdated,
      "institution"
    );
    const nextTeams = merge(
      teams,
      batch.teamsCreated?.map((item) => ({
        ...item,
        tournamentId,
        privateUrlKey: item.privateUrlKey || generatePrivateKey("team"),
        privatePasscode: item.privatePasscode || generatePrivateKey(),
      })),
      batch.teamsUpdated,
      "team"
    );
    const nextAdjudicators = merge(
      adjudicators,
      batch.adjudicatorsCreated?.map((item) => ({
        ...item,
        tournamentId,
        privateUrlKey: item.privateUrlKey || generatePrivateKey("adj"),
        privatePasscode: item.privatePasscode || generatePrivateKey(),
      })),
      batch.adjudicatorsUpdated,
      "adjudicator"
    );
    if (!nextInstitutions && !nextTeams && !nextAdjudicators) return;
    if (nextInstitutions) repositories.institutions.save(nextInstitutions);
    if (nextTeams) repositories.teams.save(nextTeams);
    if (nextAdjudicators) repositories.adjudicators.save(nextAdjudicators);
    const ids = (items: { id: string }[] = []) => items.map((item) => item.id);
    const counts = (noun: string, created: unknown[] = [], updated: unknown[] = []) => [
      ...(created.length ? [`${created.length} ${noun}(s) added`] : []),
      ...(updated.length ? [`${updated.length} ${noun}(s) updated`] : []),
    ];
    await recordAuditEvent({
      action: "entities.batch_saved",
      category: "tournament",
      summary: `${source}: ${[
        ...counts("institution", batch.institutionsCreated, batch.institutionsUpdated),
        ...counts("team", batch.teamsCreated, batch.teamsUpdated),
        ...counts("adjudicator", batch.adjudicatorsCreated, batch.adjudicatorsUpdated),
      ].join(", ")}`,
      details: {
        source,
        institutionsCreated: ids(batch.institutionsCreated),
        institutionsUpdated: ids(batch.institutionsUpdated),
        teamsCreated: ids(batch.teamsCreated),
        teamsUpdated: ids(batch.teamsUpdated),
        adjudicatorsCreated: ids(batch.adjudicatorsCreated),
        adjudicatorsUpdated: ids(batch.adjudicatorsUpdated),
      },
    });
  };

  return {
    saveEntityBatch,
    addInstitutions,
    updateInstitution,
    deleteInstitution,
    addTeams,
    updateTeam,
    deleteTeam,
    addAdjudicators,
    updateAdjudicator,
    updateAdjudicators,
    deleteAdjudicator,
    addVenues,
    updateVenue,
    deleteVenue,
    addMotions,
    updateMotion,
    deleteMotion,
  };
}
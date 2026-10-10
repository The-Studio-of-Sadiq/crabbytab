import type {
  Adjudicator,
  AuditCategory,
  Institution,
  Motion,
  Team,
  Venue,
} from "@/types";

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
  cloudRepository?: {
    saveMotion(motion: Motion): Promise<void>;
  };
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
    repositories,
    recordAuditEvent,
    createId,
    generatePrivateKey,
  } = dependencies;

  const addInstitutions = async (data: Omit<Institution, "id" | "tournamentId">[]) => {
    if (data.length === 0) return;
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
    repositories.institutions.save(institutions.filter((item) => item.id !== institutionId));
    await recordAuditEvent({
      action: "institution.deleted",
      category: "tournament",
      summary: `Institution ${deleted?.name || institutionId} deleted`,
      details: { institutionId, name: deleted?.name },
    });
  };

  const addTeams = async (data: Omit<Team, "id" | "tournamentId">[]) => {
    if (data.length === 0) return;
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
    repositories.teams.save(teams.filter((item) => item.id !== teamId));
    await recordAuditEvent({
      action: "team.deleted",
      category: "tournament",
      summary: `Team ${deleted?.name || teamId} deleted`,
      details: { teamId, name: deleted?.name },
    });
  };

  const addAdjudicators = async (data: Omit<Adjudicator, "id" | "tournamentId">[]) => {
    if (data.length === 0) return;
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
  };

  const updateAdjudicator = async (adjudicator: Adjudicator) => {
    const previous = adjudicators.find((item) => item.id === adjudicator.id);
    repositories.adjudicators.save(
      adjudicators.map((item) => (item.id === adjudicator.id ? adjudicator : item))
    );
    const withoutPrivateAccess = ({
      privateUrlKey: _privateUrlKey,
      privatePasscode: _privatePasscode,
      ...safe
    }: Adjudicator) => safe;
    await recordAuditEvent({
      action: "adjudicator.updated",
      category: "tournament",
      summary: `Adjudicator ${adjudicator.name} updated`,
      details: {
        adjudicatorId: adjudicator.id,
        previous: previous ? withoutPrivateAccess(previous) : undefined,
        current: withoutPrivateAccess(adjudicator),
      },
    });
  };

  const deleteAdjudicator = async (adjudicatorId: string) => {
    const deleted = adjudicators.find((item) => item.id === adjudicatorId);
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

  return {
    addInstitutions,
    updateInstitution,
    deleteInstitution,
    addTeams,
    updateTeam,
    deleteTeam,
    addAdjudicators,
    updateAdjudicator,
    deleteAdjudicator,
    addVenues,
    updateVenue,
    deleteVenue,
    addMotions,
    updateMotion,
    deleteMotion,
  };
}
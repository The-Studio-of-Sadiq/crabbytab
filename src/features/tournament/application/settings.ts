import type { AuditCategory, BallotSubmission, Debate, Round, Tournament } from "@/types";
import { changedTotalPreferences, debateWithBallotTotals, recomputeStoredBallots } from "@/lib/ballots/resave";
import { describePreferenceProblems, preferenceChangeProblems } from "@/lib/setup/preferenceValidation";
import { applyGuards, checkSettingsChange, type RuleOverride } from "./stateGuards";

export interface TournamentSettingsAuditEvent {
  action: string;
  category: AuditCategory;
  summary: string;
  details?: Record<string, unknown>;
}

export async function saveTournamentCommand(
  tournament: Tournament,
  previous: Tournament | null,
  dependencies: {
    /** Entered ballots lock the settings that shape or score them (see stateGuards). */
    ballots: BallotSubmission[];
    /** Tells elimination ballots apart, which alone lock the elimination ballot mode. */
    rounds?: Round[];
    localRepository: { saveTournament(tournament: Tournament): void };
    cloudRepository?: { saveTournament(tournamentId: string, tournament: Tournament): Promise<void | boolean> };
    recordAuditEvent(event: TournamentSettingsAuditEvent): Promise<void>;
    warn(message: string, error: unknown): void;
    /**
     * Where recalculated ballots go (Tabbycat `resaveballots`): when a setting that feeds stored team
     * totals changes (ghost speeches, dissenters in margins, score aggregation), every entered ballot
     * is recalculated under the new setting. The change already needs the tab director's
     * confirmation (the "scoring changed after ballots" rule). Absent = ballots are left as stored.
     */
    resave?: {
      debates: Debate[];
      saveBallots(ballots: BallotSubmission[]): void;
      saveDebates(debates: Debate[]): void;
    };
  },
  override?: RuleOverride
): Promise<void> {
  // Every settings page and the REST API save through here, so one validation covers them all.
  // Only changed preferences are checked, so settings saved by older versions still save.
  if (previous) {
    const problems = preferenceChangeProblems(previous.preferences, tournament.preferences ?? {}, {
      format: tournament.format,
      ...(dependencies.rounds ? { rounds: dependencies.rounds } : {}),
    });
    if (problems.length > 0) throw new Error(describePreferenceProblems(problems));
  }
  await applyGuards(checkSettingsChange(previous, tournament, dependencies.ballots, dependencies.rounds), override, {
    action: "tournament.settings_updated",
    category: "tournament",
    record: dependencies.recordAuditEvent,
  });
  dependencies.localRepository.saveTournament(tournament);
  try {
    if (dependencies.cloudRepository) {
      await dependencies.cloudRepository.saveTournament(tournament.id, tournament);
    }
  } catch (error) {
    dependencies.warn("Firestore sync warning:", error);
  }
  if (previous && dependencies.resave) await resaveBallotsAfterSettingsChange(tournament, previous, dependencies, dependencies.resave);

  if (!previous || (
    previous.name === tournament.name &&
    previous.format === tournament.format &&
    JSON.stringify(previous.preferences) === JSON.stringify(tournament.preferences)
  )) {
    return;
  }

  const changedPreferenceKeys = Object.keys({
    ...previous.preferences,
    ...tournament.preferences,
  }).filter((key) =>
    JSON.stringify(previous.preferences[key as keyof typeof previous.preferences]) !==
    JSON.stringify(tournament.preferences[key as keyof typeof tournament.preferences])
  );
  await dependencies.recordAuditEvent({
    action: "tournament.settings_updated",
    category: "tournament",
    summary: "Tournament settings updated",
    details: {
      previousName: previous.name,
      name: tournament.name,
      previousFormat: previous.format,
      format: tournament.format,
      changedPreferenceKeys,
      previousPreferences: previous.preferences,
      preferences: tournament.preferences,
    },
  });
}

async function resaveBallotsAfterSettingsChange(
  tournament: Tournament,
  previous: Tournament,
  dependencies: { ballots: BallotSubmission[]; rounds?: Round[]; recordAuditEvent(event: TournamentSettingsAuditEvent): Promise<void> },
  resave: NonNullable<Parameters<typeof saveTournamentCommand>[2]["resave"]>
): Promise<void> {
  const changed = changedTotalPreferences(previous.preferences, tournament.preferences);
  if (changed.length === 0) return;
  const outcome = recomputeStoredBallots(dependencies.ballots, {
    tournament,
    rounds: dependencies.rounds ?? [],
    debates: resave.debates,
  });
  if (outcome.updated.length === 0 && outcome.skipped.length === 0) return;
  if (outcome.updated.length > 0) {
    const updatedById = new Map(outcome.updated.map((ballot) => [ballot.id, ballot]));
    resave.saveBallots(dependencies.ballots.map((ballot) => updatedById.get(ballot.id) ?? ballot));
    // Debates cache their confirmed result's team totals.
    const confirmedByDebate = new Map(
      outcome.updated.filter((ballot) => ballot.confirmed).map((ballot) => [ballot.debateId, ballot])
    );
    if (confirmedByDebate.size > 0) {
      resave.saveDebates(resave.debates.map((debate) => {
        const ballot = confirmedByDebate.get(debate.id);
        return ballot ? debateWithBallotTotals(debate, ballot) : debate;
      }));
    }
  }
  await dependencies.recordAuditEvent({
    action: "ballots.resaved",
    category: "tournament",
    summary: `Recalculated ${outcome.updated.length} ballot${outcome.updated.length === 1 ? "" : "s"} after a scoring settings change`,
    details: {
      changedPreferenceKeys: changed,
      ballotIds: outcome.updated.map((ballot) => ballot.id),
      resultChangedIds: outcome.resultChangedIds,
      skipped: outcome.skipped,
    },
  });
}

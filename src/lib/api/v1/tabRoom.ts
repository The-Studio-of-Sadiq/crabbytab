import { autoAllocateCommand, updateDebateCommand, updateDebatesCommand, type AllocationDependencies } from "@/features/tournament/application/allocation";
import {
  confirmBallotCommand,
  discardBallotCommand,
  submitBallotCommand,
  type BallotWorkflowDependencies,
} from "@/features/tournament/application/ballots";
import { clearBreakCommand, generateBreakCommand, saveBreakCategoriesCommand, type BreakDependencies } from "@/features/tournament/application/breaks";
import { generateDrawCommand } from "@/features/tournament/application/draws";
import { createTournamentEntityCommands } from "@/features/tournament/application/entities";
import { currentRounds } from "@/features/tournament/application/schedule";
import { feedbackVersionOptions } from "@/lib/feedback/versions";
import { addFeedbackCommand, deleteFeedbackCommand, reviewFeedbackCommand, type FeedbackReviewChange } from "@/features/tournament/application/feedback";
import { applyMotionReleaseSync, roundsNeedingMotionReleaseSync } from "@/features/tournament/application/motionRelease";
import { savePreformedPanelsCommand } from "@/features/tournament/application/preformedPanels";
import { deleteRoundCommand } from "@/features/tournament/application/roundAdministration";
import { createRoundCommand, updateRoundCommand, type CreateRoundRecordInput } from "@/features/tournament/application/rounds";
import { saveTournamentCommand } from "@/features/tournament/application/settings";
import type { RuleOverride } from "@/features/tournament/application/stateGuards";
import { calculateBreaks } from "@/lib/breakqual/calculator";
import { resolveTeamPrecedence } from "@/lib/standings/precedence";
import { questionsForFeedbackSource } from "@/lib/feedback/questions";
import { generateRoundDraw } from "@/lib/draw/generator";
import { validateDraw } from "@/lib/draw/validateDraw";
import { generatePrivateKey } from "@/lib/privateUrls";
import { calculateStandings } from "@/lib/standings/calculator";
import type {
  Adjudicator,
  BallotSubmission,
  BreakCategory,
  Debate,
  DrawType,
  FeedbackSubmission,
  Institution,
  Motion,
  PreformedPanel,
  Round,
  Team,
  Tournament,
  TournamentPreferences,
  Venue,
} from "@/types";
import { randomUUID } from "node:crypto";
import type { ApiCommandSession } from "./session";

/**
 * The tab room's commands, wired to an ApiCommandSession the way TournamentContext wires them to
 * React state (and test/lifecycleHarness.ts to arrays). Every API write goes through here, so
 * the API enforces the same tournament rules (stateGuards.ts) as the UI.
 *
 * Each method loads what its command reads. Commands whose guards look across the tournament
 * (round status changes, deletions, draws, breaks) load whole collections; that costs reads in
 * proportion to the tournament, which is acceptable for these infrequent operations.
 */
export class SessionTabRoom {
  /** `actorId` identifies the API token as the person doing tab-room work (double entry, ballots). */
  constructor(readonly session: ApiCommandSession, readonly actorId: string) {}

  private get tournament(): Tournament {
    return this.session.tournament;
  }

  createId(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  }

  /* Loading --------------------------------------------------------------- */

  async loadAll(...collections: Array<"rounds" | "teams" | "adjudicators" | "venues" | "motions" | "breakCategories" | "debates" | "ballots" | "feedback" | "institutions">) {
    await Promise.all(collections.map((collection) => this.session.all(collection)));
  }

  private standings(): ReturnType<typeof calculateStandings> {
    const rounds = this.session.view<Round>("rounds").filter((round) => !round.cancelled);
    const roundIds = new Set(rounds.map((round) => round.id));
    return calculateStandings(
      this.tournament,
      rounds,
      this.session.view<Team>("teams"),
      this.session.view<Debate>("debates").filter((debate) => roundIds.has(debate.roundId)),
      this.session.view<BallotSubmission>("ballots").filter((ballot) => roundIds.has(ballot.roundId))
    );
  }

  /* Tournament settings --------------------------------------------------- */

  async saveTournament(next: Tournament, override?: RuleOverride): Promise<void> {
    await this.loadAll("ballots", "rounds", "debates");
    await saveTournamentCommand(next, this.tournament, {
      ballots: this.session.view<BallotSubmission>("ballots"),
      rounds: this.session.view<Round>("rounds"),
      localRepository: { saveTournament: (tournament) => this.session.setTournament(tournament) },
      recordAuditEvent: this.session.recordAuditEvent,
      warn: (message, error) => console.warn(message, error),
      // A scoring change recalculates stored ballot and debate totals, as in the tab room.
      resave: {
        debates: this.session.view<Debate>("debates"),
        saveBallots: (items) => this.session.save("ballots", items),
        saveDebates: (items) => this.session.save("debates", items),
      },
    }, override);
  }

  /* Participants, venues, motions ---------------------------------------- */

  /** Entity commands over the loaded view. Call `loadForEntities` first with what the operation needs. */
  entities() {
    const session = this.session;
    const saver = <T extends { id: string }>(collection: "institutions" | "teams" | "adjudicators" | "venues" | "motions") => ({
      save: (records: T[]) => session.save(collection, records),
    });
    return createTournamentEntityCommands({
      tournamentId: this.tournament.id,
      institutions: session.view<Institution>("institutions"),
      teams: session.view<Team>("teams"),
      adjudicators: session.view<Adjudicator>("adjudicators"),
      venues: session.view<Venue>("venues"),
      motions: session.view<Motion>("motions"),
      debates: session.view<Debate>("debates"),
      ballots: session.view<BallotSubmission>("ballots"),
      feedback: session.view<FeedbackSubmission>("feedback"),
      repositories: {
        institutions: saver<Institution>("institutions"),
        teams: saver<Team>("teams"),
        adjudicators: saver<Adjudicator>("adjudicators"),
        venues: saver<Venue>("venues"),
        motions: saver<Motion>("motions"),
      },
      recordAuditEvent: session.recordAuditEvent,
      createId: (prefix) => this.createId(prefix),
      generatePrivateKey,
      currentActor: () => ({ name: "API" }),
      // Uses whatever rounds (and debates) the operation loaded; none loaded = no round stamp.
      currentRoundId: () =>
        currentRounds(session.view<Round>("rounds"), session.view<Debate>("debates"), session.view<BreakCategory>("breakCategories"))[0]?.id,
    });
  }

  /** Deletions are checked against every reference (debates, ballots, feedback, participants). */
  async loadReferences(): Promise<void> {
    await this.loadAll("debates", "ballots", "feedback", "teams", "adjudicators");
  }

  /** Keeps Round.motionsReleased in step with the motions' own release flags (as the UI does). */
  async syncMotionRelease(): Promise<void> {
    await this.loadAll("rounds", "motions");
    const rounds = this.session.view<Round>("rounds");
    const changed = roundsNeedingMotionReleaseSync(rounds, this.session.view<Motion>("motions"));
    if (changed.length > 0) this.session.save("rounds", applyMotionReleaseSync(rounds, changed));
  }

  /* Rounds ---------------------------------------------------------------- */

  private roundGuards() {
    return {
      debates: this.session.view<Debate>("debates"),
      ballots: this.session.view<BallotSubmission>("ballots"),
      drawIssues: (round: Round) => validateDraw({
        tournament: this.tournament,
        round,
        rounds: this.session.view<Round>("rounds"),
        debates: this.session.view<Debate>("debates"),
        teams: this.session.view<Team>("teams"),
        adjudicators: this.session.view<Adjudicator>("adjudicators"),
        venues: this.session.view<Venue>("venues"),
      }),
    };
  }

  async createRound(input: Omit<CreateRoundRecordInput, "tournamentId" | "roundSeq" | "defaultDrawRule">): Promise<Round> {
    await this.loadAll("rounds");
    const rounds = this.session.view<Round>("rounds");
    return createRoundCommand({
      ...input,
      tournamentId: this.tournament.id,
      // As in the UI: the next sequence number after every existing round.
      roundSeq: Math.max(0, ...rounds.map((round) => round.seq)) + 1,
      defaultDrawRule: this.tournament.preferences?.drawRule || "power_paired",
    }, rounds, {
      localRepository: { saveRounds: (next) => this.session.save("rounds", next) },
      recordAuditEvent: this.session.recordAuditEvent,
    });
  }

  async updateRound(round: Round, override?: RuleOverride): Promise<void> {
    await this.loadAll("rounds", "debates", "ballots", "teams", "adjudicators", "venues");
    await updateRoundCommand(round, this.session.view<Round>("rounds"), null, {
      localRepository: { saveRounds: (next) => this.session.save("rounds", next) },
      recordAuditEvent: this.session.recordAuditEvent,
      guards: this.roundGuards(),
    }, override);
  }

  async deleteRound(roundId: string, override?: RuleOverride): Promise<void> {
    await this.loadAll("rounds", "debates", "ballots", "feedback", "motions");
    await deleteRoundCommand({
      roundId,
      rounds: this.session.view<Round>("rounds"),
      debates: this.session.view<Debate>("debates"),
      ballots: this.session.view<BallotSubmission>("ballots"),
      feedback: this.session.view<FeedbackSubmission>("feedback"),
      motions: this.session.view<Motion>("motions"),
      activeRound: null,
      localRepository: {
        saveRounds: (rounds) => this.session.save("rounds", rounds),
        saveDebates: (debates) => this.session.save("debates", debates),
        saveBallots: (ballots) => this.session.save("ballots", ballots),
        saveFeedback: (feedback) => this.session.save("feedback", feedback),
        saveMotions: (motions) => this.session.save("motions", motions),
        setActiveRound: () => undefined,
      },
      recordAuditEvent: this.session.recordAuditEvent,
    }, override);
  }

  /* Draws and allocation -------------------------------------------------- */

  /**
   * `drawType` (persisted on the round, as a PATCH of its draw type would) and `drawOptions`
   * (overlaid on the tournament's draw preferences for this generation only, never saved) mirror
   * Tabbycat's generate-draw request. Both are recorded in the draw's audit event.
   */
  async generateDraw(roundId: string, options: {
    discardExistingResults?: boolean;
    override?: RuleOverride;
    drawType?: DrawType;
    drawOptions?: Partial<TournamentPreferences>;
  }): Promise<void> {
    await this.loadAll("rounds", "teams", "institutions", "venues", "debates", "ballots", "motions");
    const { drawType, drawOptions, ...commandOptions } = options;
    const hasOptions = drawOptions !== undefined && Object.keys(drawOptions).length > 0;
    const tournament: Tournament = hasOptions
      ? { ...this.tournament, preferences: { ...this.tournament.preferences, ...drawOptions } }
      : this.tournament;
    const rounds = this.session.view<Round>("rounds")
      .map((round) => (round.id === roundId && drawType ? { ...round, drawType } : round));
    await generateDrawCommand(roundId, {
      tournament,
      rounds,
      teams: this.session.view<Team>("teams"),
      institutions: this.session.view<Institution>("institutions"),
      venues: this.session.view<Venue>("venues"),
      debates: this.session.view<Debate>("debates"),
      ballots: this.session.view<BallotSubmission>("ballots"),
      motions: this.session.view<Motion>("motions"),
      standings: this.standings().teams,
      generateRoundDraw,
      localRepository: {
        saveDebates: (debates) => this.session.save("debates", debates),
        saveBallots: (ballots) => this.session.save("ballots", ballots),
        // The session soft-deletes the replaced debates itself (they drop out of the saved list).
        markDebatesRemoved: () => undefined,
        saveRounds: (next) => this.session.save("rounds", next),
      },
      recordAuditEvent: this.session.recordAuditEvent,
    }, {
      ...commandOptions,
      auditDetails: {
        ...(drawType ? { requestedDrawType: drawType } : {}),
        ...(hasOptions ? { requestedDrawOptions: drawOptions } : {}),
      },
    });
  }

  private hideRevealedAdjudicators = async (roundIds: Set<string>) => {
    for (const round of this.session.view<Round>("rounds")) {
      if (roundIds.has(round.id) && round.adjudicatorsRevealed) {
        await this.updateRound({ ...round, adjudicatorsRevealed: false });
      }
    }
  };

  private allocationDependencies(): AllocationDependencies {
    return {
      tournament: this.tournament,
      rounds: this.session.view<Round>("rounds"),
      teams: this.session.view<Team>("teams"),
      debates: this.session.view<Debate>("debates"),
      ballots: this.session.view<BallotSubmission>("ballots"),
      adjudicators: this.session.view<Adjudicator>("adjudicators"),
      standings: this.standings().teams,
      breakCategories: this.session.view<BreakCategory>("breakCategories"),
      feedback: this.session.view<FeedbackSubmission>("feedback"),
      venues: this.session.view<Venue>("venues"),
      repository: { saveDebates: (debates) => this.session.save("debates", debates) },
      hideRevealedAdjudicators: this.hideRevealedAdjudicators,
      recordAuditEvent: this.session.recordAuditEvent,
    };
  }

  async autoAllocate(roundId: string, panelSize: number, override?: RuleOverride): Promise<void> {
    await this.loadAll("rounds", "teams", "debates", "ballots", "adjudicators", "breakCategories", "feedback", "venues");
    await autoAllocateCommand(roundId, panelSize, this.allocationDependencies(), {}, override);
  }

  async updateDebate(debate: Debate, override?: RuleOverride): Promise<void> {
    await this.loadAll("rounds", "debates", "ballots", "teams", "adjudicators", "venues");
    await updateDebateCommand(debate, this.session.view<Debate>("debates"), this.allocationDependencies(), override);
  }

  /**
   * The draw editor's save (add, delete or re-team debates): `next` is the tournament's whole
   * debate list after the edit, as the draw page passes it.
   */
  async updateDebates(next: Debate[], override?: RuleOverride): Promise<void> {
    await this.loadAll("rounds", "debates", "ballots", "teams", "adjudicators", "venues");
    const dependencies = this.allocationDependencies();
    await updateDebatesCommand(next, this.session.view<Debate>("debates"), {
      rounds: dependencies.rounds,
      ballots: dependencies.ballots,
      repository: dependencies.repository,
      hideRevealedAdjudicators: dependencies.hideRevealedAdjudicators,
      recordAuditEvent: dependencies.recordAuditEvent,
    }, override);
  }

  async savePreformedPanels(roundId: string, panels: PreformedPanel[]): Promise<void> {
    await this.loadAll("rounds", "adjudicators", "debates", "ballots", "teams", "venues");
    await savePreformedPanelsCommand(roundId, panels, {
      rounds: this.session.view<Round>("rounds"),
      adjudicators: this.session.view<Adjudicator>("adjudicators"),
      updateRound: (round) => this.updateRound(round),
      recordAuditEvent: this.session.recordAuditEvent,
    });
  }

  /* Ballots --------------------------------------------------------------- */

  private ballotDependencies(): BallotWorkflowDependencies {
    return {
      ballots: this.session.view<BallotSubmission>("ballots"),
      debates: this.session.view<Debate>("debates"),
      rounds: this.session.view<Round>("rounds"),
      adjudicators: this.session.view<Adjudicator>("adjudicators"),
      repository: {
        saveBallots: (ballots) => this.session.save("ballots", ballots),
        saveDebates: (debates) => this.session.save("debates", debates),
      },
      updateRound: (round) => this.updateRound(round),
      recordAuditEvent: this.session.recordAuditEvent,
      // Double entry treats the token as one person: it cannot check and confirm its own entries
      // without an audited override, exactly like a tab-room user.
      checkPolicy: {
        doubleEntry: Boolean(this.tournament.preferences?.ballotDoubleEntry),
        actorId: this.actorId,
      },
      queuePrivateRecord: async () => undefined,
      confirmer: { name: "API token", id: this.actorId },
    };
  }

  private async loadForBallots(): Promise<void> {
    await this.loadAll("rounds", "debates", "ballots", "adjudicators", "teams", "venues");
  }

  async submitBallot(ballot: BallotSubmission, override?: RuleOverride): Promise<void> {
    await this.loadForBallots();
    await submitBallotCommand(ballot, undefined, this.ballotDependencies(), override);
  }

  async confirmBallot(ballotId: string, debateId: string, override?: RuleOverride): Promise<void> {
    await this.loadForBallots();
    await confirmBallotCommand(ballotId, debateId, undefined, this.ballotDependencies(), override);
  }

  async discardBallot(ballotId: string, discardedBy: string, override?: RuleOverride): Promise<void> {
    await this.loadForBallots();
    await discardBallotCommand(ballotId, discardedBy, this.ballotDependencies(), override);
  }

  /* Breaks ---------------------------------------------------------------- */

  private async breakDependencies(): Promise<BreakDependencies> {
    await this.loadAll("rounds", "teams", "breakCategories", "debates", "ballots");
    const teams = this.session.view<Team>("teams");
    const categories = this.session.view<BreakCategory>("breakCategories");
    return {
      tournament: this.tournament,
      rounds: this.session.view<Round>("rounds"),
      teams,
      breakCategories: categories,
      breakResults: calculateBreaks(categories, teams, this.standings().teams, this.tournament.format, resolveTeamPrecedence(this.tournament.format, this.tournament.preferences)),
      debates: this.session.view<Debate>("debates"),
      ballots: this.session.view<BallotSubmission>("ballots"),
      localRepository: {
        saveBreakCategories: (next) => this.session.save("breakCategories", next),
        saveTeams: (next) => this.session.save("teams", next),
        saveRounds: (next) => this.session.save("rounds", next),
        setActiveRound: () => undefined,
      },
      recordAuditEvent: this.session.recordAuditEvent,
    };
  }

  async saveBreakCategories(categories: BreakCategory[]): Promise<void> {
    await saveBreakCategoriesCommand(categories, await this.breakDependencies());
  }

  async clearBreak(categoryId: string): Promise<void> {
    await clearBreakCommand(categoryId, await this.breakDependencies());
  }

  async generateBreak(categoryId: string, override?: RuleOverride): Promise<Round | null> {
    return generateBreakCommand(categoryId, await this.breakDependencies(), override);
  }

  /* Feedback -------------------------------------------------------------- */

  async addFeedback(data: Omit<FeedbackSubmission, "id" | "tournamentId" | "timestamp">): Promise<string> {
    // Adding needs no existing feedback: the command appends, and `put` leaves unloaded records alone.
    let createdId: string | undefined;
    // The source's earlier feedback in this debate, so a repeat submission supersedes it.
    const earlier = data.debateId
      ? (await this.session.where<FeedbackSubmission>("feedback", [{ field: "debateId", op: "==", value: data.debateId }]))
          .filter((item) => item.sourceType === data.sourceType && item.sourceId === data.sourceId)
      : [];
    const round = data.roundId ? await this.session.one<Round>("rounds", data.roundId) : null;
    await addFeedbackCommand(data, {
      tournamentId: this.tournament.id,
      feedback: earlier,
      versionOptions: feedbackVersionOptions(this.tournament.preferences, round ?? undefined),
      // Answers are checked against the questions this kind of source is asked.
      questions: questionsForFeedbackSource(data.sourceType, this.tournament.preferences),
      teams: [],
      adjudicators: [],
      repository: {
        saveFeedback: (feedback) => {
          createdId = feedback[feedback.length - 1]?.id;
          this.session.put("feedback", feedback);
        },
      },
      queuePrivateRecord: async () => undefined,
      recordAuditEvent: this.session.recordAuditEvent,
      // The stored record and the audit event carry the same id.
      createId: () => this.createId("fb"),
    });
    if (!createdId) throw new Error("Feedback was not saved.");
    return createdId;
  }

  async deleteFeedback(feedbackId: string): Promise<void> {
    await this.session.byIds("feedback", [feedbackId]);
    await deleteFeedbackCommand(feedbackId, {
      feedback: this.session.view<FeedbackSubmission>("feedback"),
      // `save` drops the record from the loaded view, which the session soft-deletes.
      repository: { saveFeedback: (feedback) => this.session.save("feedback", feedback) },
      recordAuditEvent: this.session.recordAuditEvent,
    });
  }

  async reviewFeedback(feedbackId: string, change: FeedbackReviewChange): Promise<void> {
    await this.session.byIds("feedback", [feedbackId]);
    await reviewFeedbackCommand(feedbackId, change, {
      feedback: this.session.view<FeedbackSubmission>("feedback"),
      repository: { saveFeedback: (feedback) => this.session.put("feedback", feedback) },
      recordAuditEvent: this.session.recordAuditEvent,
    });
  }
}

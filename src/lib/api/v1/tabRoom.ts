import { autoAllocateCommand, updateDebateCommand, type AllocationDependencies } from "@/features/tournament/application/allocation";
import {
  confirmBallotCommand,
  discardBallotCommand,
  submitBallotCommand,
  type BallotWorkflowDependencies,
} from "@/features/tournament/application/ballots";
import { generateBreakCommand, saveBreakCategoriesCommand, type BreakDependencies } from "@/features/tournament/application/breaks";
import { generateDrawCommand } from "@/features/tournament/application/draws";
import { createTournamentEntityCommands } from "@/features/tournament/application/entities";
import { addFeedbackCommand, reviewFeedbackCommand, type FeedbackReviewChange } from "@/features/tournament/application/feedback";
import { applyMotionReleaseSync, roundsNeedingMotionReleaseSync } from "@/features/tournament/application/motionRelease";
import { savePreformedPanelsCommand } from "@/features/tournament/application/preformedPanels";
import { deleteRoundCommand } from "@/features/tournament/application/roundAdministration";
import { createRoundCommand, updateRoundCommand, type CreateRoundRecordInput } from "@/features/tournament/application/rounds";
import { saveTournamentCommand } from "@/features/tournament/application/settings";
import type { RuleOverride } from "@/features/tournament/application/stateGuards";
import { calculateBreaks } from "@/lib/breakqual/calculator";
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
  FeedbackSubmission,
  Institution,
  Motion,
  PreformedPanel,
  Round,
  Team,
  Tournament,
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
    await this.loadAll("ballots", "rounds");
    await saveTournamentCommand(next, this.tournament, {
      ballots: this.session.view<BallotSubmission>("ballots"),
      rounds: this.session.view<Round>("rounds"),
      localRepository: { saveTournament: (tournament) => this.session.setTournament(tournament) },
      recordAuditEvent: this.session.recordAuditEvent,
      warn: (message, error) => console.warn(message, error),
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

  async generateDraw(roundId: string, options: { discardExistingResults?: boolean; override?: RuleOverride }): Promise<void> {
    await this.loadAll("rounds", "teams", "institutions", "venues", "debates", "ballots", "motions");
    await generateDrawCommand(roundId, {
      tournament: this.tournament,
      rounds: this.session.view<Round>("rounds"),
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
        saveRounds: (rounds) => this.session.save("rounds", rounds),
      },
      recordAuditEvent: this.session.recordAuditEvent,
    }, options);
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
      breakResults: calculateBreaks(categories, teams, this.standings().teams, this.tournament.format),
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

  async generateBreak(categoryId: string, override?: RuleOverride): Promise<Round | null> {
    return generateBreakCommand(categoryId, await this.breakDependencies(), override);
  }

  /* Feedback -------------------------------------------------------------- */

  async addFeedback(data: Omit<FeedbackSubmission, "id" | "tournamentId" | "timestamp">): Promise<string> {
    // Adding needs no existing feedback: the command appends, and `put` leaves unloaded records alone.
    let createdId: string | undefined;
    await addFeedbackCommand(data, {
      tournamentId: this.tournament.id,
      feedback: [],
      // Answers are checked against the questions this kind of source is asked.
      questions: questionsForFeedbackSource(data.sourceType, this.tournament.preferences),
      teams: [],
      adjudicators: [],
      repository: {
        saveFeedback: (feedback) => {
          const created = feedback.map((item) => ({ ...item, id: this.createId("fb") }));
          createdId = created[created.length - 1]?.id;
          this.session.put("feedback", created);
        },
      },
      queuePrivateRecord: async () => undefined,
      recordAuditEvent: this.session.recordAuditEvent,
    });
    if (!createdId) throw new Error("Feedback was not saved.");
    return createdId;
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

import type {
  Adjudicator,
  BallotSubmission,
  BreakCategory,
  Debate,
  FeedbackSubmission,
  Institution,
  Motion,
  Round,
  Team,
  Tournament,
  Venue,
} from "@/types";
import { CLOUD_COLLECTIONS, type CloudCollectionName, type CloudRecord } from "@/features/tournament/collections";
import type { CloudDeletionMap, DivergedRecord, SyncBaseline } from "@/features/tournament/application/cloudSync";
import {
  autoAllocateCommand,
  updateDebateCommand,
  type AllocationDependencies,
} from "@/features/tournament/application/allocation";
import {
  confirmBallotCommand,
  discardBallotCommand,
  submitBallotCommand,
  type BallotWorkflowDependencies,
} from "@/features/tournament/application/ballots";
import {
  generateBreakCommand,
  proceedToNextEliminationRoundCommand,
  saveBreakCategoriesCommand,
  type BreakDependencies,
} from "@/features/tournament/application/breaks";
import { generateDrawCommand, type GenerateDrawDependencies } from "@/features/tournament/application/draws";
import { setRoundCompletion } from "@/features/tournament/application/roundAdministration";
import {
  createRoundCommand,
  updateRoundCommand,
  type CreateRoundRecordInput,
} from "@/features/tournament/application/rounds";
import { calculateBreaks } from "@/lib/breakqual/calculator";
import { generateRoundDraw } from "@/lib/draw/generator";
import { validateDraw, type DrawIssue } from "@/lib/draw/validateDraw";
import { buildPublicProjection, type PublicSourceData, type SourceRecord } from "@/lib/publicView/projection";
import { calculateStandings } from "@/lib/standings/calculator";

export interface AuditRecord {
  action: string;
  timestamp?: string;
  summary: string;
  roundId?: string;
  details?: Record<string, unknown>;
}

/**
 * The tab room in memory: the same application commands TournamentContext calls, wired to plain
 * arrays instead of React state and localStorage. Each command reads the current state when it is
 * called, as the React context does after a re-render, and writes back through the repositories.
 */
export class TournamentHarness {
  rounds: Round[] = [];
  teams: Team[] = [];
  adjudicators: Adjudicator[] = [];
  institutions: Institution[] = [];
  venues: Venue[] = [];
  motions: Motion[] = [];
  breakCategories: BreakCategory[] = [];
  debates: Debate[] = [];
  ballots: BallotSubmission[] = [];
  feedback: FeedbackSubmission[] = [];
  audit: AuditRecord[] = [];
  tombstones: CloudDeletionMap = {};
  /** Records restored from a backup that the next upload writes over the cloud copy. */
  overwrites: CloudDeletionMap = {};
  /** Each record as this device last synced it, and records changed both here and in the cloud. */
  syncBaseline: SyncBaseline = {};
  divergedRecords: DivergedRecord[] = [];
  activeRound: Round | null = null;
  /** The immediate cloud draw replacement (AUTOMATIC_CLOUD_WRITES); absent means local-only. */
  drawCloudRepository?: GenerateDrawDependencies["cloudRepository"];
  /** Distinguishes audit event ids recorded on different devices. */
  deviceId = "device";

  constructor(public tournament: Tournament, private readonly drawSeed: (round: Round) => number) {}

  private recordAuditEvent = async (event: AuditRecord) => {
    this.audit.push({ ...event, timestamp: new Date().toISOString() });
  };

  /* Queries ----------------------------------------------------------------- */

  standings() {
    const active = this.rounds.filter((round) => !round.cancelled);
    const activeIds = new Set(active.map((round) => round.id));
    return calculateStandings(
      this.tournament,
      active,
      this.teams,
      this.debates.filter((debate) => activeIds.has(debate.roundId)),
      this.ballots.filter((ballot) => activeIds.has(ballot.roundId))
    );
  }

  breakResults() {
    return calculateBreaks(this.breakCategories, this.teams, this.standings().teams, this.tournament.format);
  }

  round(id: string): Round {
    const round = this.rounds.find((item) => item.id === id);
    if (!round) throw new Error(`No round ${id}`);
    return round;
  }

  roundDebates(roundId: string): Debate[] {
    return this.debates.filter((debate) => debate.roundId === roundId).sort((a, b) => a.roomRank - b.roomRank);
  }

  liveBallots(debateId: string): BallotSubmission[] {
    return this.ballots.filter((ballot) => ballot.debateId === debateId && !ballot.discarded);
  }

  drawCheck(roundId: string, now = Date.parse("2026-10-01T10:00:00.000Z")): DrawIssue[] {
    return validateDraw({
      tournament: this.tournament,
      round: this.round(roundId),
      rounds: this.rounds,
      debates: this.debates,
      teams: this.teams,
      adjudicators: this.adjudicators,
      venues: this.venues,
      now,
    });
  }

  collections(): Record<CloudCollectionName, CloudRecord[]> {
    const asRecords = <T extends { id: string }>(items: T[]) => items.map((item) => ({ ...item })) as unknown as CloudRecord[];
    return {
      rounds: asRecords(this.rounds),
      teams: asRecords(this.teams),
      adjudicators: asRecords(this.adjudicators),
      venues: asRecords(this.venues),
      motions: asRecords(this.motions),
      breakCategories: asRecords(this.breakCategories),
      debates: asRecords(this.debates),
      ballots: asRecords(this.ballots),
      feedback: asRecords(this.feedback),
      institutions: asRecords(this.institutions),
      auditEvents: this.audit.map((event, index) => ({ id: `audit-${this.deviceId}-${index}`, ...event })) as unknown as CloudRecord[],
    };
  }

  /** Replaces every collection, as applyCollectionsLocally does after a restore or download. */
  load(tournament: Tournament, collections: Record<CloudCollectionName, CloudRecord[]>): void {
    this.tournament = tournament;
    const as = <T>(name: CloudCollectionName) => collections[name] as unknown as T[];
    this.rounds = as<Round>("rounds");
    this.teams = as<Team>("teams");
    this.adjudicators = as<Adjudicator>("adjudicators");
    this.venues = as<Venue>("venues");
    this.motions = as<Motion>("motions");
    this.breakCategories = as<BreakCategory>("breakCategories");
    this.debates = as<Debate>("debates");
    this.ballots = as<BallotSubmission>("ballots");
    this.feedback = as<FeedbackSubmission>("feedback");
    this.institutions = as<Institution>("institutions");
  }

  publicProjection() {
    const source = Object.fromEntries(
      CLOUD_COLLECTIONS.filter((name) => name !== "auditEvents" && name !== "feedback").map((name) => [name, this.collections()[name]])
    ) as unknown as PublicSourceData;
    return buildPublicProjection(this.tournament as unknown as SourceRecord, source);
  }

  /* Rounds ------------------------------------------------------------------ */

  private roundDependencies() {
    return {
      localRepository: {
        saveRounds: (rounds: Round[], active?: Round) => {
          this.rounds = rounds;
          if (active) this.activeRound = active;
        },
      },
      recordAuditEvent: this.recordAuditEvent,
    };
  }

  async createRound(input: Omit<CreateRoundRecordInput, "tournamentId">): Promise<Round> {
    return createRoundCommand({ ...input, tournamentId: this.tournament.id }, this.rounds, this.roundDependencies());
  }

  async updateRound(round: Round): Promise<void> {
    await updateRoundCommand(round, this.rounds, this.activeRound, this.roundDependencies());
  }

  async patchRound(roundId: string, patch: Partial<Round>): Promise<Round> {
    const updated = { ...this.round(roundId), ...patch };
    await this.updateRound(updated);
    return updated;
  }

  async completeRound(roundId: string): Promise<void> {
    await this.updateRound(setRoundCompletion(this.round(roundId), true, this.debates, this.ballots));
  }

  setPreferences(patch: Partial<Tournament["preferences"]>): void {
    this.tournament = { ...this.tournament, preferences: { ...this.tournament.preferences, ...patch } };
  }

  /* Draws ------------------------------------------------------------------- */

  async generateDraw(roundId: string, options: { discardExistingResults?: boolean } = {}): Promise<Debate[]> {
    const round = this.round(roundId);
    await generateDrawCommand(roundId, {
      tournament: this.tournament,
      rounds: this.rounds,
      teams: this.teams,
      institutions: this.institutions,
      venues: this.venues,
      debates: this.debates,
      ballots: this.ballots,
      motions: this.motions,
      standings: this.standings().teams,
      // A fixed seed per round keeps the whole lifecycle reproducible.
      generateRoundDraw: (params) => generateRoundDraw({ ...params, seed: this.drawSeed(round) }),
      localRepository: {
        saveDebates: (debates) => { this.debates = debates; },
        saveBallots: (ballots) => { this.ballots = ballots; },
        markDebatesRemoved: (ids) => {
          this.tombstones = { ...this.tombstones, debates: [...new Set([...(this.tombstones.debates ?? []), ...ids])] };
        },
        saveRounds: (rounds, active) => {
          this.rounds = rounds;
          this.activeRound = active;
        },
      },
      cloudRepository: this.drawCloudRepository,
      recordAuditEvent: this.recordAuditEvent,
    }, options);
    return this.roundDebates(roundId);
  }

  private hideRevealedAdjudicators = async (roundIds: Set<string>) => {
    for (const round of this.rounds) {
      if (roundIds.has(round.id) && round.adjudicatorsRevealed) {
        await this.updateRound({ ...round, adjudicatorsRevealed: false });
      }
    }
  };

  private allocationDependencies(): AllocationDependencies {
    return {
      tournament: this.tournament,
      rounds: this.rounds,
      teams: this.teams,
      debates: this.debates,
      adjudicators: this.adjudicators,
      standings: this.standings().teams,
      breakCategories: this.breakCategories,
      feedback: this.feedback,
      venues: this.venues,
      repository: { saveDebates: (debates) => { this.debates = debates; } },
      hideRevealedAdjudicators: this.hideRevealedAdjudicators,
      recordAuditEvent: this.recordAuditEvent,
    };
  }

  async allocate(roundId: string, panelSize: number): Promise<Debate[]> {
    await autoAllocateCommand(roundId, panelSize, this.allocationDependencies());
    return this.roundDebates(roundId);
  }

  async updateDebate(debate: Debate): Promise<void> {
    await updateDebateCommand(debate, this.debates, this.allocationDependencies());
  }

  /* Ballots ----------------------------------------------------------------- */

  private ballotDependencies(): BallotWorkflowDependencies {
    return {
      ballots: this.ballots,
      debates: this.debates,
      rounds: this.rounds,
      adjudicators: this.adjudicators,
      repository: {
        saveBallots: (ballots) => { this.ballots = ballots; },
        saveDebates: (debates) => { this.debates = debates; },
      },
      updateRound: (round) => this.updateRound(round),
      recordAuditEvent: this.recordAuditEvent,
      queuePrivateRecord: async () => {},
    };
  }

  async submitBallot(ballot: BallotSubmission): Promise<void> {
    await submitBallotCommand(ballot, undefined, this.ballotDependencies());
  }

  async confirmBallot(ballotId: string, debateId: string): Promise<void> {
    await confirmBallotCommand(ballotId, debateId, undefined, this.ballotDependencies());
  }

  async discardBallot(ballotId: string): Promise<void> {
    await discardBallotCommand(ballotId, "tab director", this.ballotDependencies());
  }

  /* Breaks ------------------------------------------------------------------ */

  private breakDependencies(): BreakDependencies {
    return {
      tournament: this.tournament,
      rounds: this.rounds,
      teams: this.teams,
      breakCategories: this.breakCategories,
      breakResults: this.breakResults(),
      debates: this.debates,
      ballots: this.ballots,
      localRepository: {
        saveBreakCategories: (categories) => { this.breakCategories = categories; },
        saveTeams: (teams) => { this.teams = teams; },
        saveRounds: (rounds) => { this.rounds = rounds; },
        setActiveRound: (round) => { this.activeRound = round; },
      },
      recordAuditEvent: this.recordAuditEvent,
    };
  }

  async saveBreakCategories(categories: BreakCategory[]): Promise<void> {
    await saveBreakCategoriesCommand(categories, this.breakDependencies());
  }

  async generateBreak(categoryId: string): Promise<Round | null> {
    return generateBreakCommand(categoryId, this.breakDependencies());
  }

  async advanceElimination(roundId: string): Promise<Round | null> {
    return proceedToNextEliminationRoundCommand(roundId, this.breakDependencies());
  }
}

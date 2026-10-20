export type TournamentFormat = "bp" | "uadc" | "australs" | "wsdc" | "custom_2team";

export type TeamMetricId =
  | "wins"
  | "points"
  | "speaks_sum"
  | "speaks_avg"
  | "speaks_ind_avg"
  | "speaks_stddev"
  | "margin_sum"
  | "margin_avg"
  | "draw_strength_wins"
  /** Tabbycat's draw_strength: the sum of opponents' (round-weighted) points. Equals opponents' wins in two-team formats. */
  | "draw_strength"
  | "draw_strength_speaks"
  /** Mean standings rank of the team's opponents. Lower is a harder draw. Display only (Tabbycat: extra_only). */
  | "draw_strength_rank"
  | "firsts"
  | "seconds"
  | "thirds"
  | "pullups"
  /** Debates the team was in where some team was pulled up (Tabbycat's pullup_debates). */
  | "pullup_debates"
  /** Who-beat-whom: points earned against the one other team tied on every earlier metric. May repeat. */
  | "wbw"
  /** Adjudicator votes carried (voting ballots), normalised to a panel of three as in Tabbycat. */
  | "num_adjs"
  /** Debates in which the team had an iron-person (duplicate) speech. Fewer ranks higher. */
  | "num_iron";

export type SpeakerMetricId =
  | "speaks_sum"
  | "speaks_avg"
  | "speaks_stddev"
  | "speaks_trimmed_mean"
  | "speeches_count"
  | "reply_sum"
  | "reply_avg"
  | "reply_stddev"
  | "reply_count"
  /** The speaker's team's results (Tabbycat's speaker team_points, team_wins, firsts/seconds/thirds, num_adjs). */
  | "team_points"
  | "team_wins"
  | "firsts"
  | "seconds"
  | "thirds"
  | "num_adjs";

export type OddBracketMethod =
  | "pullup_top"
  | "pullup_bottom"
  | "pullup_middle"
  | "pullup_random"
  | "intermediate"
  | "intermediate_bubble"
  /** Preallocated sides only: excess teams form one intermediate bracket filled from below. */
  | "intermediate1"
  /** Preallocated sides only: like intermediate1, but each lower bracket fills its own intermediate bracket. */
  | "intermediate2"
  /** min_cost_with_pullups only: pull up the team whose opponents had the lowest mean rank. */
  | "pullup_lowest_ds_rank"
  /** min_cost_with_pullups only: the least pulled-up team, then pullup_lowest_ds_rank. */
  | "pullup_lowest_ds_rank_npulls";

export type PairingMethod = "slide" | "fold" | "adjacent" | "random" | "fold_top_adjacent_rest";

/**
 * "min_cost": Tabbycat's "graph" (minimum-cost matching per bracket, pull-ups chosen first).
 * "min_cost_with_pullups": Tabbycat's "graph_one" (one matching over the whole field that also
 * chooses the pull-ups).
 */
export type ConflictAvoidance = "off" | "one_up_one_down" | "min_cost" | "min_cost_with_pullups";

export type PullupRestriction =
  | "none"
  | "least_pulled"
  | "lowest_draw_strength_speaks"
  | "lowest_draw_strength_wins";

export type BPPullupDistribution = "anywhere" | "top" | "bottom";
/** "simple": the number of times the team has already been in that position (Tabbycat's "simple"). */
export type BPPositionCost = "simple" | "renyi_entropy" | "sum_squared_deviations";
/**
 * "hungarian": Hungarian algorithm on a cost matrix pre-shuffled with the draw's seed (Tabbycat's
 * hungarian_preshuffled, WUDC-compliant). "hungarian_unshuffled": the same without the shuffle, so
 * equal-cost alternatives are settled by team order (Tabbycat's "hungarian"; not WUDC-compliant).
 */
export type BPAssignmentMethod = "hungarian" | "hungarian_unshuffled" | "random";
export type ByeTeamResults = "absent" | "win";
export type ByeTeamSelectionMethod = "none" | "lowest_ranked" | "random";
export type AdjudicatorPanelStrategy = "crabbytab_v1" | "panel_average";
/**
 * Tabbycat's answer types: text (t), long text (tl), integer box (i), float box (f), integer
 * scale (is), yes/no dropdown (bs), checkbox (bc), select one (ss), select many (ms).
 * "scale" is the pre-wave-3 "number in range" type: any number between min and max.
 */
export type FeedbackQuestionType =
  | "text"
  | "textarea"
  | "scale"
  | "yes_no"
  | "select_one"
  | "select_many"
  | "integer"
  | "float"
  | "checkbox"
  | "integer_scale";
export type FeedbackAnswer = string | number | boolean | string[] | null;
/** Pre-wave-3 preset; see FeedbackPathConfig and src/lib/feedback/paths.ts for how it maps. */
export type FeedbackPath = "chairs_to_panel" | "two_way" | "everyone";
/** Which adjudicators a team gives feedback on: the chair only, or every adjudicator on the panel. */
export type TeamFeedbackTargets = "chair" | "all_adjudicators" | "none";
/** Who gives feedback on whom (Tabbycat's feedback_from_teams and feedback_paths, made explicit). */
export interface FeedbackPathConfig {
  teams: TeamFeedbackTargets;
  chairOnPanellists: boolean;
  chairOnTrainees: boolean;
  panellistsOnChair: boolean;
  traineesOnChair: boolean;
  /** Every adjudicator (trainees included) on every other adjudicator; implies the four above. */
  adjudicatorsOnEachOther: boolean;
  /** Teams and adjudicators may also rate teams. Never expected, never counted in adjudicator scores. */
  onTeams: boolean;
}
/** Who gave feedback: a team, or an adjudicator in the role they held in that debate. */
export type FeedbackSourceRole = "team" | "chair" | "panellist" | "trainee";
/** The role the rated adjudicator held in that debate. */
export type FeedbackTargetRole = "chair" | "panellist" | "trainee";
export type FeedbackWeightKey = `${FeedbackSourceRole}_on_${FeedbackTargetRole}`;
/** "fixed": every debate gets the same panel size; "by_priority": odd panels grow in priority order. */
export type PanelSizingMode = "fixed" | "by_priority";
export type BreakQualificationRule =
  | "standard"
  | "aida_1996"
  | "aida_2016_australs"
  | "aida_2016_easters"
  /** AIDA 2019 Australs (open): AIDA 2016 Australs with an institution cap of 3, +1 per 8 teams beyond a 16-team break. */
  | "aida_2019_australs_open";

export interface FeedbackQuestion {
  id: string;
  label: string;
  type: FeedbackQuestionType;
  required: boolean;
  options?: string[];
  /** Bounds for scale and integer_scale (required) and integer/float boxes (optional). */
  min?: number;
  max?: number;
}

/** One change to an adjudicator's base or test score, newest last. */
export interface AdjudicatorScoreChange {
  field: "baseScore" | "testScore";
  /** Undefined: there was no test score (or it was cleared). */
  previous?: number;
  value?: number;
  timestamp: string;
  actorId?: string;
  actorName?: string;
  reason?: string;
}

export interface TournamentPreferences {
  teamsInDebate: 4 | 2;
  substantiveSpeakers: number; // 2 for BP, 3 for UADC/Australs/WSDC
  replyScoresEnabled: boolean; // true for Australs/WSDC/UADC, false for BP
  minSpeakerScore: number; // typically 50 or 65 (default 70)
  maxSpeakerScore: number; // typically 90 or 100 (default 80)
  stepSpeakerScore: number; // typically 0.5 or 1
  minReplyScore: number; // typically 30 or 35
  maxReplyScore: number; // typically 45 or 50
  /** "bracket" is a legacy value; round creation treats it as "random". */
  drawRule: "power_paired" | "random" | "round_robin" | "bracket";
  /**
   * "preallocated": two-team only; sides come from Round.preallocatedSides.
   * "manual_ballot": two-team only; the draw pairs teams without sides and each debate's ballot
   * records which team took which side (Tabbycat's "manual-ballot"). See lib/draw/manualSides.ts.
   */
  sideAllocationRule: "balanced" | "random" | "preallocated" | "manual_ballot";
  ballotDoubleEntry: boolean;
  publicDraw: boolean;
  publicResults: boolean;
  publicStandings: boolean;
  publicMotions: boolean;
  feedbackEnabled: boolean;
  feedbackMinScore: number;
  feedbackMaxScore: number;
  feedbackQuestions?: FeedbackQuestion[];
  teamFeedbackQuestions?: FeedbackQuestion[];
  adjudicatorFeedbackQuestions?: FeedbackQuestion[];
  feedbackPath?: "chairs_to_panel" | "two_way" | "everyone";
  /** Explicit paths; absent -> derived from feedbackPath. */
  feedbackPaths?: FeedbackPathConfig;
  /** Paths in elimination rounds; absent -> same as feedbackPaths. */
  eliminationFeedbackPaths?: FeedbackPathConfig;
  feedbackInEliminationRounds?: boolean;
  checkInExpiresAfterHours?: number;
  publicCheckInStatus?: boolean;
  /**
   * UI language for public pages and private portals when the viewer has not picked one
   * (a code from LOCALES in src/lib/i18n/config.ts). Absent = follow each viewer's browser.
   */
  publicLanguage?: string;
  /** Up to 8 metric ids, most important first. Empty/absent -> format default. */
  teamStandingsPrecedence?: TeamMetricId[];
  /** Shown on the standings page but not used to rank. */
  teamStandingsExtra?: TeamMetricId[];
  speakerStandingsPrecedence?: SpeakerMetricId[];
  speakerStandingsExtra?: SpeakerMetricId[];
  /**
   * Scores dropped from EACH end (highest and lowest) for speaks_trimmed_mean, as Tabbycat's
   * "trimmed mean (high-low drop)". Absent = 1. Before wave 2 this dropped only the lowest N.
   */
  speakerTrim?: number;
  /**
   * Tabbycat's "speeches missable for standings eligibility": a speaker who missed more
   * substantive speeches than this is listed but unranked. Absent or negative = no limit.
   */
  standingsMissedDebates?: number;
  /** As standingsMissedDebates, for reply speeches on the replies tab. */
  standingsMissedReplies?: number;

  /** Two-team draw generation options (C2). BP keeps its own cost-based pairing. */
  oddBracketMethod?: OddBracketMethod;
  pairingMethod?: PairingMethod;
  conflictAvoidance?: ConflictAvoidance;
  pullupRestriction?: PullupRestriction;
  /** Overrides the hardcoded 1000/200 clash penalties used by the BP draw. */
  repeatMatchupPenalty?: number;
  institutionClashPenalty?: number;

  /** Tabbycat Draw Rules */
  minAdjScoreToVote?: number; // default 1.5
  adjConflictPenalty?: number; // default 1000000
  adjHistoryPenalty?: number; // default 10000
  importanceMismatchPenalty?: number; // default 10000000
  /** How voting adjudicator strength is matched to debate priority. */
  adjudicatorPanelStrategy?: AdjudicatorPanelStrategy;
  usePreformedPanels?: boolean;
  /** How auto-allocation sizes voting panels. Absent -> "fixed". */
  panelSizingMode?: PanelSizingMode;
  /** Multiplier per feedback source/target pair when averaging feedback. Absent keys weigh 1. */
  feedbackSourceWeights?: Partial<Record<FeedbackWeightKey, number>>;
  skipAdjCheckins?: boolean;
  noPanellistAdjs?: boolean;
  noTraineeAdjs?: boolean;

  teamInstitutionPenalty?: number; // default 1
  teamHistoryPenalty?: number; // default 1000
  avoidSameInstitution?: boolean; // default true
  avoidTeamHistory?: boolean; // default true
  previouslySawPullupPenalty?: number; // default 0

  sideBalancePenalty?: number; // default 0
  pairingDeviationPenalty?: number; // default 0
  maxTimesPerSide?: number; // default 5
  maxAllowedSideImbalance?: number; // default 0
  pullupPenalty?: number; // default 0
  /**
   * @deprecated Never implemented: stored by older versions but read by nothing. Concurrent
   * rounds / schedule slots are tracked as a wave 5 roadmap item. Kept so saved settings still load.
   */
  preliminaryPanelsPerScheduleSlot?: number;

  bpPullupDistribution?: BPPullupDistribution; // "anywhere"
  bpPositionCost?: BPPositionCost; // "renyi_entropy"
  renyiOrder?: number; // default 1.0
  bpPositionCostExponent?: number; // default 4.0
  bpAssignmentMethod?: BPAssignmentMethod; // "hungarian"

  byeTeamResults?: ByeTeamResults; // "absent"
  byeTeamSelectionMethod?: ByeTeamSelectionMethod; // "none"

  /** Tabbycat Scoring & Ballots Features */
  marginIncludesDissenters?: boolean; // If checked, a team's winning margin includes dissenting adjudicators
  ballotIntroExplanation?: string; // Any explanatory text needed to introduce the ballot form, e.g. speaker scale
  teamScoreIncludesGhosts?: boolean; // If checked, all speaker scores, including for duplicate speeches, will be counted for team scores
  /** Two-team formats only: one scoresheet per voting adjudicator, majority decides. BP is always consensus. */
  ballotMode?: BallotMode;
  /** Ballot mode for elimination rounds. Absent = same as ballotMode. Read through ballotModeFor(). */
  eliminationBallotMode?: BallotMode;
  /** With ballotDoubleEntry: "review" = a second person reviews and confirms; "blind" = a second person re-enters without seeing the first entry. */
  ballotCheckMode?: BallotCheckMode;
  /** Staff access (w45): data-entry staff access level. Absent = "all_areas". */
  assistantAccess?: AssistantAccessLevel;
  /**
   * Voting ballots: every voting adjudicator submits their own scoresheet through their private
   * URL and the latest sheet of each is merged into one voting ballot (Tabbycat `individual_ballots`).
   */
  individualBallots?: boolean;
  /** Absent = "chair". See PrivateBallotConfirmation. */
  privateBallotConfirmation?: PrivateBallotConfirmation;
  /** Allow a team with the lower total speaker score to be awarded the win (consensus ballots only). */
  allowLowPointWins?: boolean;
  /** Record which motion each team vetoed. */
  enableMotionVetoes?: boolean;
  /** Allow two-team debates to be recorded as forfeits. */
  enableForfeits?: boolean;

  /** Public tab releases: full standings over completed preliminary rounds. Absent = unreleased. */
  releaseTeamTab?: boolean;
  releaseSpeakerTab?: boolean;
  releaseRepliesTab?: boolean;
  /** Break categories whose generated break is shown on the public page. */
  releasedBreakCategoryIds?: string[];
  /** Public participants list (every team with its speakers, every adjudicator). Absent = hidden. */
  publicParticipants?: boolean;
  /** Public institutions list. Absent = hidden. */
  publicInstitutionsList?: boolean;
  /** Public adjudication core list (adjudicators flagged `adjCore`). Absent = hidden. */
  publicAdjudicatorCore?: boolean;
  /** Public breaking adjudicators list (adjudicators flagged `breaking`). Absent = hidden. */
  publicBreakingAdjudicators?: boolean;

  /** Automatic notifications (opt-in). Sent only after the data is published to the cloud copy. */
  notifyDrawReleased?: boolean;
  notifyBallotReceipt?: boolean;
  notifyTeamPoints?: boolean;
  /** Teams and adjudicators may mark themselves available for the current round from their private portal. */
  allowSelfCheckIn?: boolean;
  /** Speaker categories (ESL, novice, ...), like Tabbycat's SpeakerCategory. See lib/speakerCategories. */
  speakerCategories?: SpeakerCategory[];
}

export interface SpeakerCategory {
  id: string;
  name: string;
  slug: string;
  seq: number;
  /** Shown as its own speaker tab on the public page once the speaker tab is released. */
  public: boolean;
  /** Public category tab shows at most this many ranks; absent or 0 = no limit. */
  limit?: number;
}

export interface Tournament {
  id: string;
  name: string;
  nameLower?: string; // lowercase name, used for prefix search on the tournaments hub
  shortName: string;
  slug: string;
  format: TournamentFormat;
  seq?: number;
  active: boolean;
  ownerId: string;
  ownerEmail?: string;
  admins: Record<string, boolean>;
  preferences: TournamentPreferences;
  createdAt: string;
  updatedAt: string;
  migratedAt?: string;
  syncVersion?: number;
}

export type AuditCategory =
  | "tournament"
  | "draw"
  | "allocation"
  | "ballot"
  | "standings"
  | "break"
  | "feedback"
  | "email"
  | "venue";

export interface AuditEvent {
  id: string;
  tournamentId: string;
  timestamp: string;
  sequence?: number;
  previousHash?: string;
  hash?: string;
  actorId?: string;
  actorName?: string;
  actorType: "user" | "system" | "public";
  action: string;
  category: AuditCategory;
  roundId?: string;
  debateId?: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface PublicAuditEvent {
  sequence: number;
  timestamp: string;
  category: AuditCategory;
  action: string;
  summary: string;
  previousHash: string;
  hash: string;
}

export type RoundStage = "preliminary" | "elimination";
/** "seeded": two-team only; one bracket ordered by Team.seed (higher is stronger), as Tabbycat. */
export type DrawType = "random" | "power_paired" | "round_robin" | "elimination" | "manual" | "seeded";
export type DrawStatus = "none" | "draft" | "confirmed" | "released";

export interface Round {
  id: string;
  tournamentId: string;
  seq: number;
  name: string;
  abbreviation: string;
  stage: RoundStage;
  drawType: DrawType;
  drawStatus: DrawStatus;
  adjudicatorsRevealed?: boolean;
  feedbackWeight: number;
  silent: boolean;
  motionsReleased: boolean;
  resultsReleased: boolean;
  teamSpeaksReleased?: boolean;
  breakCategoryIds?: string[];
  eliminationAdvanced?: boolean;
  cancelled?: boolean;
  divisionId?: string;
  completed: boolean;
  createdAt: string;
  feedbackEnabled?: boolean;
  /** Panels formed before the draw, allocated to debates as units. */
  preformedPanels?: PreformedPanel[];
  /** Team id -> side, used when sideAllocationRule is "preallocated" (two-team formats). */
  preallocatedSides?: Record<string, TwoTeamSide>;
  /** Seed of the draw generator's random source for the current draw; regenerating with it reproduces the draw. */
  drawSeed?: number;
}

export interface PreformedPanel {
  id: string;
  chairId?: string;
  panellistIds: string[];
  traineeIds: string[];
  /** 0-10, like Debate.importance: higher panels go to higher-priority debates. */
  importance: number;
}

export interface Institution {
  id: string;
  tournamentId: string;
  name: string;
  code: string;
  region?: string;
  venueRequirements?: VenueRequirements;
}

export interface VenueRequirements {
  category?: string;
  minimumCapacity?: number;
  accessible?: boolean;
  online?: boolean;
  nearTabRoom?: boolean;
}

export interface Speaker {
  id: string;
  name: string;
  email?: string;
  gender?: string;
  /** Overrides the institution region for diversity displays. */
  region?: string;
  /**
   * Speaker category ids. Older data and imports hold names or slugs ("esl"); readers resolve
   * every entry with resolveSpeakerCategoryRef, so both keep working.
   */
  categories?: string[];
  /** Swing teams: the registered speaker this swing speaker stands in for, if any. */
  swingSourceSpeakerId?: string;
}

export interface Team {
  id: string;
  tournamentId: string;
  name: string;
  breakStatus?: "breaking" | "eliminated";
  breakCategoryIds?: string[];
  eliminatedInRoundId?: string;
  codeName?: string;
  divisionId?: string;
  divisionName?: string;
  institutionId?: string;
  institutionName?: string;
  speakers: Speaker[];
  breakCategories: string[]; // IDs of eligible break categories
  /** Legacy team-wide speaker category labels, used for speakers without their own `categories`. */
  speakerCategories: string[];
  /** Institutions whose adjudicators must not judge this team (Tabbycat's team–institution conflicts). */
  institutionConflictIds?: string[];
  seed?: number;
  emoji?: string;
  checkedIn?: boolean;
  checkedInAt?: string;
  roundAvailability?: Record<string, boolean>;
  roundAvailabilityAt?: Record<string, string>;
  venueRequirements?: VenueRequirements;
  privateUrlKey?: string; // Secret key for team's private URL
  privatePasscode?: string; // Separate passcode required to access the private portal
  /**
   * A swing (composite) team formed to fill a room. It is drawn only in `swingRoundIds`, its
   * results count for its opponents, and it is left out of team and speaker standings and breaks.
   */
  isSwing?: boolean;
  /** Rounds a swing team is drawn in. */
  swingRoundIds?: string[];
}

export interface AdjudicatorConflict {
  institutionId?: string;
  teamId?: string;
  adjudicatorId?: string;
  type: "institution" | "personal" | "history";
}

export interface Adjudicator {
  id: string;
  tournamentId: string;
  name: string;
  email?: string;
  institutionId?: string;
  institutionName?: string;
  baseScore: number; // e.g., 1 to 10 or 1 to 5 scale (default 5.0)
  testScore?: number;
  /** Every base/test score change, oldest first. Organiser-only, like the scores themselves. */
  scoreHistory?: AdjudicatorScoreChange[];
  trainee: boolean;
  independent: boolean;
  checkedIn?: boolean;
  checkedInAt?: string;
  roundAvailability?: Record<string, boolean>;
  roundAvailabilityAt?: Record<string, string>;
  conflicts: AdjudicatorConflict[];
  gender?: string;
  /** Overrides the institution region for diversity displays. */
  region?: string;
  preformedPanelId?: string;
  /** Member of the adjudication core (shown on the public adjudication core list when released). */
  adjCore?: boolean;
  /** Breaking adjudicator (shown on the public breaking adjudicators list when released). */
  breaking?: boolean;
  venueRequirements?: VenueRequirements;
  privateUrlKey?: string; // Secret key for adjudicator's private URL
  privatePasscode?: string; // Separate passcode required to access the private portal
}

export interface Venue {
  id: string;
  tournamentId: string;
  name: string;
  priority: number; // higher = better room
  category?: string;
  capacity?: number;
  accessible?: boolean;
  online?: boolean;
  nearTabRoom?: boolean;
  available?: boolean;
  checkedIn?: boolean;
}

// BP Debate Sides: OG (Opening Gov), OO (Opening Opp), CG (Closing Gov), CO (Closing Opp)
// 2-team Sides: AFF (Affirmative/Gov), NEG (Negative/Opp)
export type BPSide = "OG" | "OO" | "CG" | "CO";
export type TwoTeamSide = "AFF" | "NEG";
export type DebateSide = BPSide | TwoTeamSide;

export interface DebateTeamSlot {
  teamId: string;
  teamName: string;
  side: DebateSide;
  points?: number; // 3, 2, 1, 0 for BP; 1 or 0 for 2-team
  speakerScoreTotal?: number;
  /** Set by the draw generator when this team was moved up from a lower bracket to fill a room. */
  pulledUp?: boolean;
  /** Elimination rounds: bracket position (break seed, then inherited from the room the team advanced from). */
  bracketPosition?: number;
}

export interface DebateAdjudicatorSlot {
  chairId?: string;
  chairName?: string;
  panellistIds: string[];
  panellistNames: string[];
  traineeIds: string[];
  traineeNames: string[];
}

export type DebateResultStatus = "none" | "draft" | "confirmed";

export interface Debate {
  id: string;
  tournamentId: string;
  roundId: string;
  roundSeq: number;
  byeTeamId?: string;
  byeResult?: ByeTeamResults;
  breakCategoryId?: string;
  venueId?: string;
  venueName?: string;
  requiredVenueCategory?: string;
  requiredVenueCapacity?: number;
  requiresAccessibleVenue?: boolean;
  requiresOnlineVenue?: boolean;
  requiresNearTabRoom?: boolean;
  bracket: number; // e.g., 6 points bracket in round 3
  roomRank: number;
  importance: number;
  resultStatus: DebateResultStatus;
  /**
   * With the "manual_ballot" side rule (flag "manual_ballot_sides"), false until a confirmed
   * ballot records which team took which side; the slots' sides are only the draw's order until
   * then. Other debates do not read it.
   */
  sidesConfirmed: boolean;
  flags: string[];
  teams: Record<DebateSide, DebateTeamSlot>;
  adjudicators: DebateAdjudicatorSlot;
  motionId?: string;
  motionText?: string;
  postponed?: boolean;
  postponedReason?: string;
}

export interface SpeakerScoreEntry {
  speakerId: string;
  speakerName: string;
  position: number; // 1, 2, 3 (and 4 for reply if applicable)
  score: number;
  /** A duplicate (iron-person) speech: excluded from speaker standings, and from team totals unless teamScoreIncludesGhosts. */
  ghost?: boolean;
}

export interface TeamScoreEntry {
  side: DebateSide;
  teamId: string;
  points: number; // BP: 1st=3, 2nd=2, 3rd=1, 4th=0. 2-Team: Win=1, Loss=0
  totalSpeakerScore: number;
  win?: boolean;
  margin?: number;
  rank?: number; // 1, 2, 3, 4 for BP
  /** Voting ballots: adjudicator votes this team received. */
  votes?: number;
  /** This team forfeited the debate. */
  forfeit?: boolean;
}

export type BallotMode = "consensus" | "voting";
export type BallotCheckMode = "review" | "blind";
/** Tabbycat's `assistant_access`: what data-entry staff may reach (see lib/staffPermissions.ts). */
export type AssistantAccessLevel = "all_areas" | "results_draw" | "results_only" | "none";
/**
 * Who confirms ballots submitted through private URLs: "chair" (a chair's ballot, or a complete
 * merge of individual ballots, counts at once; CrabbyTab's default and Tabbycat's "bypass double
 * checking" for private URLs) or "tab_room" (they wait for the tab room, Tabbycat's default).
 */
export type PrivateBallotConfirmation = "chair" | "tab_room";

/** One voting adjudicator's scoresheet within a voting ballot. */
export interface AdjudicatorSheet {
  adjudicatorId: string;
  adjudicatorName?: string;
  speakerScores: Record<DebateSide, SpeakerScoreEntry[]>;
}

export interface BallotSubmission {
  id: string;
  tournamentId: string;
  roundId: string;
  debateId: string;
  version: number;
  confirmed: boolean;
  discarded: boolean;
  submitterType: "tabroom" | "public" | "judge";
  submitterId?: string;
  submitterName?: string;
  motionId?: string;
  motionText?: string;
  speakerScores: Record<DebateSide, SpeakerScoreEntry[]>;
  teamScores: Record<DebateSide, TeamScoreEntry>;
  chairId?: string;
  timestamp: string;
  confirmedBy?: string;
  confirmedTimestamp?: string;
  /** Voting ballots: the individual scoresheets. Top-level scores hold the aggregated result. */
  sheets?: AdjudicatorSheet[];
  /** Motion id vetoed by each side. */
  vetoes?: Partial<Record<DebateSide, string>>;
  /** Side that forfeited; a forfeit ballot carries no speaker scores. */
  forfeitSide?: DebateSide;
  /** Individual ballots: one voting adjudicator's own scoresheet, submitted through their private URL. */
  singleAdjudicator?: boolean;
  /** A voting ballot merged from these individual ballots (ids). */
  mergedFromIds?: string[];
  /** Account id of the person who confirmed it, when confirmed by data-entry staff on the server. */
  confirmedById?: string;
  /** Blind double entry: the version this entry was checked against. */
  checksVersion?: number;
  discardedBy?: string;
  discardedTimestamp?: string;
}

export interface Motion {
  id: string;
  tournamentId: string;
  text: string;
  reference?: string; // e.g. "Round 1: Education"
  infoSlide?: string;
  rounds: string[]; // IDs of rounds this motion is allocated to
  seq?: number;
  released: boolean;
}

/**
 * Receipt of one printed paper ballot sheet in the tab room. The id is derived from the sheet
 * (see ballotIntake.ts), so scanning the same sheet on two devices records one receipt.
 */
export interface BallotIntakeRecord {
  id: string;
  tournamentId: string;
  roundId: string;
  debateId: string;
  /** The sheet's code, without the round prefix (see `ballotSheetCode`). */
  sheetCode: string;
  /** Voting ballots: the adjudicator whose sheet this is. Absent for a debate's single sheet. */
  adjudicatorId?: string;
  receivedAt: string;
  receivedBy?: string;
  receivedByName?: string;
}

export interface FeedbackSubmission {
  id: string;
  tournamentId: string;
  roundId: string;
  debateId: string;
  targetType?: "adjudicator" | "team";
  targetAdjudicatorId?: string;
  targetAdjudicatorName?: string;
  targetTeamId?: string;
  targetTeamName?: string;
  sourceType: "team" | "adjudicator";
  sourceId: string;
  sourceName: string;
  score: number; // 1 to 10 (or 1 to 5)
  agreeWithDecision?: boolean;
  comments?: string;
  answers?: Record<string, FeedbackAnswer>;
  confirmed: boolean;
  /** Kept on record but excluded from adjudicator scores. */
  ignored?: boolean;
  timestamp: string;
}

export interface BreakCategory {
  id: string;
  tournamentId: string;
  name: string; // e.g. "Open", "ESL", "Novice"
  slug: string;
  seq: number;
  breakSize: number; // e.g. 16 for Octo-finals, 8 for Quarter-finals, 4 for Semi-finals
  reserveSize: number;
  isGeneral: boolean;
  priority: number;
  /** Maximum breaking and reserve teams selected from one institution. */
  maxPerInstitution?: number;
  qualificationRule?: BreakQualificationRule;
  /** Manual break decisions for this category, keyed by team id. */
  teamOverrides?: Record<string, BreakTeamOverride>;
  /** The break as it was when it was last generated for this category. */
  generatedBreak?: GeneratedBreak;
  /** Eligibility derived from speaker categories, applied on request from the Break page. */
  speakerCategoryRule?: SpeakerCategoryEligibilityRule;
}

export interface SpeakerCategoryEligibilityRule {
  speakerCategoryId: string;
  /** Speakers who must be in the category; absent = every speaker on the team. */
  minimumSpeakers?: number;
}

/**
 * "include" forces a team into the break (it still cannot break in two
 * categories); every other value excludes the team, like Tabbycat's remarks.
 */
export type BreakTeamOverride =
  | "include"
  | "ineligible"
  | "withdrawn"
  | "different_break"
  | "disqualified"
  | "lost_coin_toss";

export interface GeneratedBreak {
  /** Breaking teams in seed order. */
  breakingTeamIds: string[];
  reserveTeamIds: string[];
  generatedAt: string;
}

export interface TeamStandingRow {
  rank: number;
  teamId: string;
  teamName: string;
  institutionCode?: string;
  breakCategories: string[];
  points: number; // Total team points
  totalSpeakerScore: number;
  averageSpeakerScore: number;
  margins?: number; // Total margin
  firstPlaces?: number; // BP 1st place count
  secondPlaces?: number; // BP 2nd place count
  thirdPlaces?: number; // BP 3rd place count
  fourthPlaces?: number; // BP 4th place count
  wins?: number; // 2-team wins
  losses?: number; // 2-team losses
  roundResults: {
    roundSeq: number;
    side: DebateSide;
    points: number;
    speakerScore: number;
    /** A bye awarded as a win; speakerScore is 0 and no speeches were given. */
    bye?: boolean;
    rank?: number;
    win?: boolean;
    opponentNames?: string[];
    opponentTeamIds?: string[];
    pulledUp?: boolean;
  }[];
  /** Every team metric, keyed by id, computed regardless of which are used for ranking. */
  metrics: Record<TeamMetricId, number>;
  /**
   * Who-beat-whom value for each "wbw" in the precedence, in order: points earned against the
   * one other team tied on every earlier metric, or null ("n/a") when not exactly two are tied.
   */
  whoBeatWhom?: (number | null)[];
}

export interface SpeakerStandingRow {
  rank: number;
  speakerId: string;
  speakerName: string;
  teamId: string;
  teamName: string;
  institutionCode?: string;
  categories: string[];
  totalScore: number;
  averageScore: number;
  speechesCount: number;
  trimmedScore?: number; // dropping lowest if configured
  /** Missed more speeches than the standings eligibility limit allows: listed, but not ranked (rank 0). */
  ineligible?: boolean;
  scoresByRound: {
    roundSeq: number;
    score: number;
    position: number;
  }[];
  metrics: Record<SpeakerMetricId, number>;
}

export interface AdjudicatorStandingRow {
  adjudicatorId: string;
  name: string;
  institutionCode?: string;
  baseScore: number;
  feedbackScoreAverage: number;
  feedbackCount: number;
  debatesCount: number;
  chairCount: number;
}

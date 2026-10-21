/**
 * "poly" is Tabbycat's `teams_in_debate` set to anything other than 2 or 4 (its Public Speaking
 * preset uses 6): `preferences.teamsInDebate` teams per room, positions P1…PN (see lib/debateSides).
 */
export type TournamentFormat = "bp" | "uadc" | "australs" | "wsdc" | "custom_2team" | "poly";

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
  | "num_adjs"
  /** Sum of the speaker's speech ranks within debates (speakerRanks). Lower ranks higher. */
  | "srank";

/**
 * A standings metric value. null means "no value" (Tabbycat's null): the metric aggregates
 * results the team or speaker does not have yet. It is distinct from 0 and ranks below every value.
 */
export type MetricValue = number | null;

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
/** Tabbycat's score_aggregation_function: how a panel's scores for one speech are combined. */
export type ScoreAggregation = "mean" | "median";
/** Tabbycat's speakers_in_ballots: when ballots ask for speaker scores. */
export type SpeakersInBallots = "always" | "prelim" | "never";
/** Tabbycat's speaker_ranks: whether ballots rank the speeches in a debate. */
export type SpeakerRanksMode = "none" | "any" | "high-points";
/**
 * Tabbycat's winners_in_ballots: "none" = the higher total wins; "high-points" = the winner is
 * declared but must have the higher total; "tied-points" = declared, may also break a tie;
 * "low-points" = declared, overrides the scores.
 */
export type WinnerDeclaration = "none" | "high-points" | "tied-points" | "low-points";
/** Tabbycat's side_names for two-team formats. */
export type SideNames = "aff-neg" | "gov-opp" | "prop-opp" | "pro-con" | "appellant-respondent" | "1-2" | "pl-def";
/** Which speeches a score criterion applies to (Tabbycat ScoreCriterion.speech_type). */
export type ScoreCriterionSpeechType = "all" | "substantive" | "reply";

/**
 * A weighted part of a speaker score (Tabbycat ScoreCriterion). When a tournament defines
 * criteria, adjudicators score each criterion and the speaker score is Σ weight × criterion score.
 */
export interface ScoreCriterion {
  id: string;
  name: string;
  seq: number;
  speechType: ScoreCriterionSpeechType;
  weight: number;
  minScore: number;
  maxScore: number;
  step: number;
  /** Optional criteria may be left blank; a blank counts as 0. */
  required: boolean;
}
export type ByeTeamSelectionMethod = "none" | "lowest_ranked" | "random";
/**
 * "tabbycat_voting" / "tabbycat_consensus": Tabbycat's Hungarian allocators (see
 * lib/draw/tabbycatHungarian.ts); they ignore panel size and panel sizing.
 */
export type AdjudicatorPanelStrategy = "crabbytab_v1" | "panel_average" | "tabbycat_voting" | "tabbycat_consensus";
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
/**
 * Which adjudicators a team gives feedback on (Tabbycat `feedback_from_teams`), as allowed / expected:
 * - "chair": the chair / the chair (CrabbyTab's original "orallist" approximation);
 * - "orallist": voting adjudicators, with a prompt to pick the orallist / one submission;
 * - "voting_allowed": voting adjudicators / one submission (the orallist);
 * - "all_allowed": every adjudicator incl. trainees / one submission (the orallist);
 * - "all_voting": voting adjudicators / each of them;
 * - "all_adjudicators": every adjudicator / each of them;
 * - "none".
 */
export type TeamFeedbackTargets =
  | "chair"
  | "orallist"
  | "voting_allowed"
  | "all_allowed"
  | "all_voting"
  | "all_adjudicators"
  | "none";
/** Who gives feedback on whom (Tabbycat's feedback_from_teams and feedback_paths, made explicit). */
export interface FeedbackPathConfig {
  teams: TeamFeedbackTargets;
  chairOnPanellists: boolean;
  chairOnTrainees: boolean;
  panellistsOnChair: boolean;
  traineesOnChair: boolean;
  /** Every adjudicator (trainees included) on every other adjudicator; implies the four above. */
  adjudicatorsOnEachOther: boolean;
  /** Panellists on each other, trainees excluded (Tabbycat "with-p-on-p"). Absent = false. */
  panellistsOnEachOther?: boolean;
  /** Teams and adjudicators may also rate teams. Never expected, never counted in adjudicator scores. */
  onTeams: boolean;
}
/** Who gave feedback: a team, or an adjudicator in the role they held in that debate. */
export type FeedbackSourceRole = "team" | "chair" | "panellist" | "trainee";
/** The role the rated adjudicator held in that debate. */
export type FeedbackTargetRole = "chair" | "panellist" | "trainee";
export type FeedbackWeightKey = `${FeedbackSourceRole}_on_${FeedbackTargetRole}`;
/** See Round.roundRobinAlgorithm. */
export type RoundRobinAlgorithm = "berger_seed";
/** See TournamentPreferences.eliminationSideRule. */
export type EliminationSideRule = "by_seed" | "random";
/** See TournamentPreferences.preformedPanelPlacement. */
export type PreformedPanelPlacement = "optimise" | "direct";
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
  /** The tournament's current round when the score was set (Tabbycat AdjudicatorBaseScoreHistory.round); absent before any round or in older entries. */
  roundId?: string;
  /** Undefined: there was no test score (or it was cleared). */
  previous?: number;
  value?: number;
  timestamp: string;
  actorId?: string;
  actorName?: string;
  reason?: string;
}

export interface TournamentPreferences {
  /**
   * Which Tabbycat name teams with a `reference` show (lib/teamNames.ts): "long" (absent;
   * "Victoria 1") or "short" ("VUW 1"). Teams without a reference keep their typed name.
   */
  teamNameDisplay?: "long" | "short";
  /**
   * Teams per debate: 4 for BP, 2 for two-team formats, and for the "poly" format any positive
   * whole number other than 2 and 4 (Tabbycat `teams_in_debate`). Read through teamsInDebateFor().
   */
  teamsInDebate: number;
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
  /** Feedback (w45): score step, e.g. 0.5 (Tabbycat `adj_score_step`). Absent = 1. */
  feedbackScoreStep?: number;
  /** Shown above every feedback form (Tabbycat `feedback_introduction`). Plain text. */
  feedbackIntroduction?: string;
  /** Count and show feedback no path expected (Tabbycat `show_unexpected_feedback`). Absent = true. */
  showUnexpectedFeedback?: boolean;
  /** "Important" feedback differs from the adjudicator's base score by more than this. Absent = 2. */
  feedbackImportantThreshold?: number;
  checkInExpiresAfterHours?: number;
  publicCheckInStatus?: boolean;
  /**
   * Tabbycat `show_seed_in_importer`: whether the team CSV import and the team registration form
   * ask for a seed, as a number or as a title (Unseeded / Free / Half / Full seed = 0–3; see
   * src/lib/teamSeeds.ts). Absent = "off".
   */
  teamSeedMode?: TeamSeedMode;
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
  /**
   * How preformed panels are matched to debates. "optimise" (absent): a Hungarian assignment by
   * importance, conflicts and history. "direct": the i-th panel by room rank goes to the debate
   * with the i-th room rank, without optimisation (Tabbycat's direct preformed allocator).
   */
  preformedPanelPlacement?: PreformedPanelPlacement;
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
   * @deprecated Never read: replaced by `preliminaryPanels`, into which normalizePreferences
   * moves a stored value (see src/features/tournament/application/schedule.ts).
   */
  preliminaryPanelsPerScheduleSlot?: number;

  bpPullupDistribution?: BPPullupDistribution; // "anywhere"
  bpPositionCost?: BPPositionCost; // "renyi_entropy"
  renyiOrder?: number; // default 1.0
  bpPositionCostExponent?: number; // default 4.0
  bpAssignmentMethod?: BPAssignmentMethod; // "hungarian"

  byeTeamResults?: ByeTeamResults; // "absent"
  byeTeamSelectionMethod?: ByeTeamSelectionMethod; // "none"
  /**
   * Sides in elimination rounds. "by_seed" (absent): the higher seed takes the first side
   * (AFF / OG) and sides are confirmed. "random": sides are drawn at random with the draw's seed
   * and left unconfirmed, as Tabbycat; in two-team formats each ballot records the sides taken.
   */
  eliminationSideRule?: EliminationSideRule;

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
  /**
   * Tabbycat `participant_ballots` "private-urls" (on) / "off": adjudicators may submit ballots
   * through their private URLs. Absent = on. Enforced by the private sync route.
   */
  privateUrlBallots?: boolean;
  /**
   * Tabbycat `participant_feedback` "private-urls" (on) / other: participants may submit feedback
   * through their private URLs. Absent = on. Enforced by `checkParticipantFeedback`.
   */
  privateUrlFeedback?: boolean;
  /**
   * Tabbycat `allow_self_split_ballots`: a solo adjudicator on a voting ballot may declare their
   * decision a 2:1 split (Karl Popper rules). Absent = off. See lib/ballots/result selfSplitAllowed.
   */
  allowSelfSplitBallots?: boolean;
  /**
   * @deprecated Superseded by winnersInBallots ("low-points"). Still read when winnersInBallots is
   * absent, and kept in step with it on save, so older settings and clients behave the same.
   */
  allowLowPointWins?: boolean;
  /** How a debate's winner is decided; absent = from allowLowPointWins. See ballots/ballotRules. */
  winnersInBallots?: WinnerDeclaration;
  /** How a voting panel's scores for one speech are combined. Absent = "mean". */
  scoreAggregation?: ScoreAggregation;
  /** When ballots ask for speaker scores. Absent = "always". */
  speakersInBallots?: SpeakersInBallots;
  /** Speech ranks on consensus ballots. Absent = "none". */
  speakerRanks?: SpeakerRanksMode;
  /** Weighted score criteria; empty or absent = speakers get a single score. */
  scoreCriteria?: ScoreCriterion[];
  /** Largest allowed winning margin on one scoresheet; 0 or absent = no limit. */
  maximumMargin?: number;
  /** Step for reply scores. Absent = half the substantive step (CrabbyTab's earlier rule). */
  stepReplyScore?: number;
  /** The reply speaker must have given a substantive speech in the debate. Absent = true. */
  requireSubstantiveForReply?: boolean;
  /** Names for the two sides in two-team formats. Absent = "aff-neg". */
  sideNames?: SideNames;
  /** Ballots record the motion debated, and motions are managed per round. Absent = true. */
  enableMotions?: boolean;
  /** Record which motion each team vetoed. */
  enableMotionVetoes?: boolean;
  /**
   * Tabbycat `enable_motion_reuse`: motions can be reused from one round to another (the round's
   * "reuse motion" and "copy from the previous round" controls). Absent = on (CrabbyTab always
   * offered reuse); Tabbycat's default is off.
   */
  enableMotionReuse?: boolean;
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
  /** Email (w45): motions of a round to its speakers and adjudicators once released. */
  notifyMotionsReleased?: boolean;
  /** Email (w45): a confirmed result to the debate's adjudicators (Tabbycat "ballot confirmed"). */
  notifyBallotConfirmed?: boolean;
  /** Teams and adjudicators may mark themselves available for the current round from their private portal. */
  allowSelfCheckIn?: boolean;
  /** Printed ballots (w45): where to return scoresheets / feedback forms (Tabbycat score_return_location); empty or "TBA" hides. */
  ballotReturnLocation?: string;
  feedbackReturnLocation?: string;
  /** Printed scoresheets ask adjudicators to circle the digits of each score (Tabbycat ballots_confirm_digits). */
  ballotsConfirmDigits?: boolean;
  /** Printed scoresheets leave the motion blank (Tabbycat ballots_hide_motions). */
  ballotsHideMotions?: boolean;
  /** Speaker categories (ESL, novice, ...), like Tabbycat's SpeakerCategory. See lib/speakerCategories. */
  speakerCategories?: SpeakerCategory[];

  /*
   * Public site (Tabbycat's public_features / tab_release / ui_options). Resolved with defaults by
   * getPublicSiteSettings (src/lib/publicFeatures.ts); every field is optional so saved settings load.
   */
  /** Tabbycat `public_draw`. Absent: "all" unless the legacy `publicDraw` is false. */
  publicDrawMode?: PublicDrawMode;
  /**
   * Tabbycat "set current round": the round public pages ("current round" draw mode, projector)
   * and portals treat as current, with its concurrent rounds. Absent (or naming a deleted or
   * cancelled round) = derived: the latest publicly released draw. Never makes a draw public by
   * itself; see currentDrawRoundIds() in src/lib/publicFeatures.ts.
   */
  currentRoundId?: string;
  /** Tabbycat `public_record`: public team and adjudicator record pages. Absent = on. */
  publicRecordPages?: boolean;
  /** Tabbycat `adjudicators_tab_released` / `adjudicators_tab_shows`. Absent = unreleased / "final". */
  releaseAdjudicatorTab?: boolean;
  adjudicatorTabShows?: AdjudicatorTabShows;
  /** Tabbycat `ballots_released`: public scoresheets for rounds whose results are public. */
  releaseBallots?: boolean;
  /** Tabbycat `private_ballots_released`: a team's own scoresheets on its private URL. */
  releasePrivateBallots?: boolean;
  /** Tabbycat `team/speaker/replies_tab_limit`: show only the top N ranks; absent or 0 = all. */
  teamTabLimit?: number;
  speakerTabLimit?: number;
  repliesTabLimit?: number;
  /** Tabbycat `break_category_tabs_released`: a team tab per break category. */
  releaseBreakCategoryTabs?: boolean;
  /**
   * Tabbycat `speaker_category_tabs_released`: a speaker tab per public speaker category. Absent =
   * follows `releaseSpeakerTab` (CrabbyTab's behaviour before this setting).
   */
  releaseSpeakerCategoryTabs?: boolean;
  /**
   * Tabbycat `all_results_released`: results of every completed round, silent and elimination
   * rounds included, become public. Intended for after the tournament. Absent = off.
   */
  releaseAllResults?: boolean;
  /** Tabbycat `show_unaccredited`: an "Always trainee" column on adjudicator tables. Absent = off. */
  showUnaccredited?: boolean;
  /** Tabbycat `public_break_metrics_to_show`: -1 (absent) = all precedence metrics, 0 = none. */
  publicBreakMetrics?: number;
  /** Tabbycat `public_break_categories`: break eligibility on the participants page. */
  publicBreakCategories?: boolean;
  /** Tabbycat `public_side_allocations`: the pre-allocated sides page. */
  publicSideAllocations?: boolean;
  /** Public elimination bracket built from released elimination draws. */
  publicBracket?: boolean;
  /** Tabbycat `public_diversity`. */
  publicDiversity?: boolean;
  /** Motion veto counts on the public motions page (needs `enableMotionVetoes`). */
  publicVetoStatistics?: boolean;
  /** Tabbycat `feedback_progress`: who has not submitted the feedback they owe. */
  publicFeedbackProgress?: boolean;
  /** Tabbycat `show_team_institutions` / `show_adjudicator_institutions`. Absent = shown. */
  showTeamInstitutions?: boolean;
  showAdjudicatorInstitutions?: boolean;
  /** Tabbycat `team_code_names` / `participant_code_names`. Absent = "off". */
  teamCodeNames?: TeamCodeNameMode;
  participantCodeNames?: ParticipantCodeNameMode;
  /** Tabbycat `show_emoji` / `show_speakers_in_draw` (absent = shown) / `show_splitting_adjudicators`. */
  showEmoji?: boolean;
  showSpeakersInDraw?: boolean;
  showSplittingAdjudicators?: boolean;
  /** Tabbycat `search_engine_indexing`. Absent = "all". */
  searchEngineIndexing?: SearchEngineIndexing;
  /** Tabbycat `welcome_message` / `tournament_staff`, shown as plain text on the public page. */
  welcomeMessage?: string;
  tournamentStaff?: string;
  /** Tabbycat `public_motions_order`. Absent = "forward" (CrabbyTab's order before this setting). */
  publicMotionsOrder?: PublicMotionsOrder;
  /**
   * Tabbycat `motion_tab_released`: the public motion statistics. Absent = follows `publicMotions`
   * (CrabbyTab's behaviour before this setting); true releases them even without the motions page.
   */
  motionTabReleased?: boolean;
  /** Tabbycat `show_motions_in_results`: the debated motion on public results and record pages. Absent = off. */
  showMotionsInResults?: boolean;
  /** Tabbycat `participant_ballots` / `participant_feedback` = "public": forms without a private URL. */
  publicBallotForm?: boolean;
  publicFeedbackForm?: boolean;
  /**
   * Tabbycat `public_use_password`. The password itself is kept server-side
   * (`serverOnly/publicForms`), never in these preferences, which are public.
   */
  publicFormsUsePassword?: boolean;

  /**
   * Room categories with display options (Tabbycat VenueCategory). A room belongs to the category
   * named by Venue.category; categories without an entry here display with defaults.
   */
  venueCategories?: VenueCategoryInfo[];
  /** Hours a room check-in stays valid (Tabbycat checkin_window_venues). Absent or 0 = never expires. */
  venueCheckInExpiresAfterHours?: number;

  /** Rounds, schedule and motions (w45). See docs/rounds-schedule-and-motions.md. */
  /**
   * Tabbycat's prelim_panels: preliminary rounds per schedule slot (parallel panels A/B). Used when
   * grouping preliminary rounds into slots; absent = 1 (every round its own slot).
   */
  preliminaryPanels?: number;
  /** Minutes from motion release to the round's start (Tabbycat preparation_time). Absent or negative = off. */
  preparationTime?: number;
  /** Public schedule page and iCalendar feed. Absent = hidden. */
  publicSchedule?: boolean;
  /** Tournament schedule (Tabbycat ScheduleEvent), oldest first. */
  scheduleEvents?: ScheduleEvent[];
  /** Ballots record each team's ranked motion preferences (Tabbycat DebateTeamMotionPreference). */
  enableMotionPreferences?: boolean;
}

/** Tabbycat's ScheduleEvent types. */
export type ScheduleEventType =
  | "check_in"
  | "briefing"
  | "draw"
  | "preparation"
  | "debate"
  | "adjudication"
  | "rest"
  | "break_announcement"
  | "awards"
  | "other";

export interface ScheduleEvent {
  id: string;
  type: ScheduleEventType;
  /** Optional custom title; without one the round name and event type are shown. */
  title?: string;
  /** ISO date-time. */
  startTime: string;
  endTime?: string;
  roundId?: string;
}

/** Display options of a room category (matched to Venue.category by name, ignoring case). */
export interface VenueCategoryInfo {
  name: string;
  /** Predicate after "This room", e.g. "has step-free access". Always shown on admin pages. */
  description?: string;
  /** Show the category name before ("prefix") or after ("suffix") room names in the draw. */
  displayInName?: "none" | "prefix" | "suffix";
  /** Show the description in the room's tooltip on public pages. */
  publicTooltip?: boolean;
}

/**
 * A soft, ranked room preference (Tabbycat VenueConstraint): the subject's debates should be in a
 * room of this category. Higher priority wins over lower; unmet constraints are reported, never
 * enforced. Hard needs (step-free access, capacity) belong in VenueRequirements instead.
 */
export interface VenueConstraint {
  category: string;
  priority: number;
}

export type PublicDrawMode = "off" | "current" | "all";
export type AdjudicatorTabShows = "test" | "final" | "all";
export type TeamCodeNameMode = "off" | "all-tooltips" | "admin-tooltips-code" | "admin-tooltips-real" | "everywhere";
export type ParticipantCodeNameMode = "off" | "everywhere";
export type SearchEngineIndexing = "all" | "homepage-only" | "none";
export type PublicMotionsOrder = "forward" | "reverse";

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
/**
 * "seeded": one bracket ordered by Team.seed (higher is stronger), as Tabbycat.
 * "round_robin": teams ordered by Team.seed (two-team: Berger schedule; BP: Tabbycat's preset tables).
 */
export type DrawType = "random" | "power_paired" | "round_robin" | "elimination" | "manual" | "seeded";

/** How team seeds are asked for (Tabbycat `show_seed_in_importer`). */
export type TeamSeedMode = "off" | "numeric" | "title";
/**
 * Stored draw status. "confirmed" and "released" both mean the public release (CrabbyTab's original
 * meaning, kept for existing data and the API); "locked" is Tabbycat's confirmed-but-unreleased
 * stage and "teams_released" Tabbycat's teams-only release. Read through drawStageOf() in
 * src/lib/draw/drawStatus.ts.
 */
export type DrawStatus = "none" | "draft" | "locked" | "teams_released" | "confirmed" | "released";
/** Tabbycat's Round.motions_status: info slides can be shown before the motions themselves. */
export type MotionsStatus = "not_released" | "info_slides_released" | "motions_released";

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
  /**
   * Derived: true exactly when the round's motions are released (motionsStatusOf(round) is
   * "motions_released"). Portals, assistants and the public projection read this flag.
   */
  motionsReleased: boolean;
  /** Absent on older rounds: read through motionsStatusOf() in motionRelease.ts. */
  motionsStatus?: MotionsStatus;
  /**
   * Rounds sharing a schedule group run at the same time (parallel panels, Tabbycat
   * schedule_group). Absent = seq. Read through scheduleGroupOf() in schedule.ts.
   */
  scheduleGroup?: number;
  /** When the round starts (ISO date-time); set by hand or by preparation time on motion release. */
  startsAt?: string;
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
  /**
   * Two-team round robin: the schedule the round's draw was generated with. "berger_seed" is
   * Tabbycat's Berger schedule in seed order. Absent on a drawn round-robin round = the legacy
   * rotation in stored team order (drawn before Berger/seed ordering existed); a cycle begun
   * with it keeps it, so the schedule never changes mid-cycle (see legacyRoundRobinInProgress).
   */
  roundRobinAlgorithm?: RoundRobinAlgorithm;
  /** Tabbycat Round.weight: team points earned in this round count this many times. Absent = 1. */
  weight?: number;
}

export interface PreformedPanel {
  id: string;
  chairId?: string;
  panellistIds: string[];
  traineeIds: string[];
  /** 0-10, like Debate.importance: higher panels go to higher-priority debates. */
  importance: number;
  /** Anticipated-draw annotations (Tabbycat PreformedPanel); informational, set by "create from anticipated draw". */
  roomRank?: number;
  /** Lowest bracket this panel's room might be. */
  bracketMin?: number;
  /** Highest bracket this panel's room might be. */
  bracketMax?: number;
  /** Teams in the room that may still be live for the open break. */
  liveness?: number;
}

/** How a check-in was made (check-in history; lib/checkins/history.ts). */
export type CheckInSource = "tab" | "scan" | "bulk" | "self";

/** One change of availability or check-in, newest last on the record. */
export interface CheckInEvent {
  at: string;
  /** Absent for rooms, which are checked in without a round. */
  roundId?: string;
  available: boolean;
  source: CheckInSource;
  /** Who made it (staff name or email); absent for self check-in. */
  by?: string;
}

export interface Institution {
  id: string;
  tournamentId: string;
  name: string;
  code: string;
  region?: string;
  venueRequirements?: VenueRequirements;
  /** Soft room preferences for every team of this institution. */
  venueConstraints?: VenueConstraint[];
  /**
   * Coaches / representatives (Tabbycat Coach): people of the institution who are not speakers or
   * adjudicators. Organiser-only (never on public pages or in assistant copies); they receive
   * custom emails sent to the "Institution coaches" group.
   */
  coaches?: Coach[];
}

export interface Coach {
  id: string;
  name: string;
  email?: string;
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
  /** Tabbycat Person.last_name: stored family name, used for "last names" code names. Absent = last word of `name`. */
  lastName?: string;
  /** Tabbycat Person.pronoun (e.g. "she/her"); can be pre-printed on ballots. */
  pronoun?: string;
  email?: string;
  gender?: string;
  /** Overrides the institution region for diversity displays. */
  region?: string;
  /**
   * Speaker category ids. Older data and imports hold names or slugs ("esl"); readers resolve
   * every entry with resolveSpeakerCategoryRef, so both keep working.
   */
  categories?: string[];
  /** Contact phone (international format), from registration. Organiser-only. */
  phone?: string;
  /** Speaker-level check-in per round (Tabbycat checks speakers in individually). */
  roundAvailability?: Record<string, boolean>;
  checkInHistory?: CheckInEvent[];
  /** Tabbycat Person.anonymous: name (and team) redacted on public pages. */
  anonymous?: boolean;
  /** Tabbycat Person.code_name, shown publicly when `participantCodeNames` is "everywhere". */
  codeName?: string;
  /**
   * Optional per-speaker private URL (Tabbycat Person.url_key), alongside the team's URL. The
   * speaker's URL opens their team's portal and acts only for that team. Organiser-only: removed
   * from assistant copies and never returned by participant or public routes.
   */
  privateUrlKey?: string;
  /** Passcode for the speaker's private URL (as for team and adjudicator URLs). */
  privatePasscode?: string;
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
  checkInHistory?: CheckInEvent[];
  venueRequirements?: VenueRequirements;
  /** Soft room preferences (Tabbycat venue constraints). */
  venueConstraints?: VenueConstraint[];
  privateUrlKey?: string; // Secret key for team's private URL
  privatePasscode?: string; // Separate passcode required to access the private portal
  /**
   * Index of the speakers' private URL keys (`speakers[].privateUrlKey`), so the server can find a
   * team by a speaker key with one `array-contains` query. Written with the keys; a key listed
   * here but no longer on a speaker opens nothing.
   */
  speakerUrlKeys?: string[];
  /**
   * A swing (composite) team formed to fill a room. It is drawn only in `swingRoundIds`, its
   * results count for its opponents, and it is left out of team and speaker standings and breaks.
   */
  isSwing?: boolean;
  /** Rounds a swing team is drawn in. */
  swingRoundIds?: string[];
  /**
   * Tabbycat Team.reference ("1", "A"): the name without the institution. Set only for teams named
   * the Tabbycat way (lib/teamNames.ts); then `name` is derived from it. Absent = `name` as typed.
   */
  reference?: string;
  /** Tabbycat Team.short_reference: the reference in the short name, when different. */
  shortReference?: string;
  /** Tabbycat Team.use_institution_prefix: names read "Institution reference". */
  useInstitutionPrefix?: boolean;
  /** Derived (Tabbycat long_name): institution name + reference. Kept with `reference`. */
  longName?: string;
  /** Derived (Tabbycat short_name): institution code + short reference. Kept with `reference`. */
  shortName?: string;
  /**
   * Tabbycat Team.type "composite": speakers from more than one institution. Unlike a swing team
   * it is a normal team (standings, breaks); its other institutions count as its own for
   * adjudicator conflicts and same-institution draw avoidance.
   */
  isComposite?: boolean;
  /** The composite team's other institutions (besides `institutionId`). */
  compositeInstitutionIds?: string[];
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
  /** Tabbycat Person.last_name. Absent = last word of `name`. */
  lastName?: string;
  /** Tabbycat Person.pronoun (e.g. "they/them"); can be pre-printed on ballots. */
  pronoun?: string;
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
  checkInHistory?: CheckInEvent[];
  conflicts: AdjudicatorConflict[];
  gender?: string;
  /** Overrides the institution region for diversity displays. */
  region?: string;
  /** Contact phone (international format), from registration. Organiser-only. */
  phone?: string;
  preformedPanelId?: string;
  /** Member of the adjudication core (shown on the public adjudication core list when released). */
  adjCore?: boolean;
  /** Breaking adjudicator (shown on the public breaking adjudicators list when released). */
  breaking?: boolean;
  /**
   * Tabbycat Adjudicator.is_tester: tests other adjudicators (members of the adjudication core
   * always do). An adjudicator counts as tested in a round when a tester sat on their panel.
   */
  isTester?: boolean;
  /** Tabbycat Person.anonymous: name redacted on public pages. */
  anonymous?: boolean;
  /** Tabbycat Person.code_name, shown publicly when `participantCodeNames` is "everywhere". */
  codeName?: string;
  venueRequirements?: VenueRequirements;
  /** Soft room preferences (Tabbycat venue constraints). */
  venueConstraints?: VenueConstraint[];
  privateUrlKey?: string; // Secret key for adjudicator's private URL
  privatePasscode?: string; // Separate passcode required to access the private portal
}

export interface Venue {
  id: string;
  tournamentId: string;
  name: string;
  priority: number; // higher = better room
  /** First (or only) room category; older data has only this. Read both through venueCategoryNames. */
  category?: string;
  /** Every room category (Tabbycat VenueCategory is many-to-many), including `category`. */
  categories?: string[];
  capacity?: number;
  accessible?: boolean;
  online?: boolean;
  nearTabRoom?: boolean;
  /** Default availability; a per-round entry in roundAvailability overrides it. */
  available?: boolean;
  /** Round id -> available in that round (Tabbycat round availability for rooms). */
  roundAvailability?: Record<string, boolean>;
  checkedIn?: boolean;
  checkInHistory?: CheckInEvent[];
  /** When the room was last checked in; with venueCheckInExpiresAfterHours the check-in lapses. */
  checkedInAt?: string;
  /** Map or meeting link (online rooms), shown with the room in the draw, portals and emails. */
  url?: string;
}

// BP Debate Sides: OG (Opening Gov), OO (Opening Opp), CG (Closing Gov), CO (Closing Opp)
// 2-team Sides: AFF (Affirmative/Gov), NEG (Negative/Opp)
export type BPSide = "OG" | "OO" | "CG" | "CO";
export type TwoTeamSide = "AFF" | "NEG";
/** Positions in a "poly" debate (N teams per room): P1 … PN, Tabbycat sides 0 … N-1. */
export type PolySide = `P${number}`;
export type DebateSide = BPSide | TwoTeamSide | PolySide;

export interface DebateTeamSlot {
  teamId: string;
  teamName: string;
  side: DebateSide;
  points?: number; // 3, 2, 1, 0 for BP; 1 or 0 for 2-team
  speakerScoreTotal?: number;
  /** Set by the draw generator when this team was moved up from a lower bracket to fill a room. */
  pulledUp?: boolean;
  /**
   * Tabbycat's team draw flags set by the draw generator (DebateTeam.flags): bub_up_hist,
   * bub_up_inst, bub_up_accom, bub_dn_hist, bub_dn_inst, bub_dn_accom, no_bub_updn.
   */
  flags?: string[];
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
  /** When this debate is scheduled to start (ISO date-time), if it differs from the round's start. */
  scheduledTime?: string;
}

export interface SpeakerScoreEntry {
  speakerId: string;
  speakerName: string;
  position: number; // 1, 2, 3 (and 4 for reply if applicable)
  score: number;
  /** A duplicate (iron-person) speech: excluded from speaker standings, and from team totals unless teamScoreIncludesGhosts. */
  ghost?: boolean;
  /** Speech rank within the debate (1 = best), when the tournament ranks speeches. */
  rank?: number;
  /** Score per criterion id, when the tournament uses score criteria; `score` is their weighted sum. */
  criteria?: Record<string, number>;
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
  /** The side this adjudicator declared the winner, when winnersInBallots is not "none" or the ballot has no scores. */
  declaredWinner?: DebateSide;
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
  /** Each side's ranked motion preferences, most preferred first (enableMotionPreferences). */
  motionPreferences?: Partial<Record<DebateSide, string[]>>;
  /** Side that forfeited; a forfeit ballot carries no speaker scores. */
  forfeitSide?: DebateSide;
  /**
   * A results-only ballot (speakersInBallots): ranks or winners without speaker scores. Team
   * totals are recorded as 0 but mean "no score", and standings leave them out.
   */
  noSpeakerScores?: boolean;
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
  /**
   * Voting ballot of a solo adjudicator who declared a 2:1 split (allowSelfSplitBallots): the
   * winner is recorded with 2 votes and the loser with 1, out of 3.
   */
  selfSplit?: boolean;
}

export interface Motion {
  id: string;
  tournamentId: string;
  text: string;
  reference?: string; // e.g. "Round 1: Education"
  infoSlide?: string;
  rounds: string[]; // IDs of rounds this motion is allocated to
  seq?: number;
  /** Order within each assigned round (Tabbycat RoundMotion.seq), keyed by round id; absent -> seq. */
  roundSeq?: Record<string, number>;
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
  /**
   * Public tab limit for this category (Tabbycat's BreakCategory.limit): the public break category
   * team tab shows only teams ranked this high or better. Absent or 0 = no limit.
   */
  limit?: number;
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
  /**
   * Every team metric, keyed by id, computed regardless of which are used for ranking. null = no
   * value (Tabbycat's null): an aggregate over results the team does not have yet, such as
   * speaks_sum or speaks_stddev before its first scored debate. It is not 0, and ranks last.
   */
  metrics: Record<TeamMetricId, MetricValue>;
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
  /** Every speaker metric by id; null = no value (no speeches yet), as for team metrics. */
  metrics: Record<SpeakerMetricId, MetricValue>;
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

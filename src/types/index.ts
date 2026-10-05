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
  | "draw_strength_speaks"
  | "firsts"
  | "seconds"
  | "thirds"
  | "pullups";

export type SpeakerMetricId =
  | "speaks_sum"
  | "speaks_avg"
  | "speaks_stddev"
  | "speaks_trimmed_mean"
  | "speeches_count"
  | "reply_sum"
  | "reply_avg";

export type OddBracketMethod =
  | "pullup_top"
  | "pullup_bottom"
  | "pullup_middle"
  | "pullup_random"
  | "intermediate"
  | "intermediate_bubble";

export type PairingMethod = "slide" | "fold" | "adjacent" | "random" | "fold_top_adjacent_rest";

export type ConflictAvoidance = "off" | "one_up_one_down" | "min_cost";

export type PullupRestriction =
  | "none"
  | "least_pulled"
  | "lowest_draw_strength_speaks"
  | "lowest_draw_strength_wins";

export type BPPullupDistribution = "anywhere" | "top" | "bottom";
export type BPPositionCost = "renyi_entropy" | "sum_squared_deviations";
export type BPAssignmentMethod = "hungarian" | "random";
export type ByeTeamResults = "absent" | "win";
export type ByeTeamSelectionMethod = "none" | "lowest_ranked" | "random";

export interface TournamentPreferences {
  teamsInDebate: 4 | 2;
  substantiveSpeakers: number; // 2 for BP, 3 for UADC/Australs/WSDC
  replyScoresEnabled: boolean; // true for Australs/WSDC/UADC, false for BP
  minSpeakerScore: number; // typically 50 or 65 (default 70)
  maxSpeakerScore: number; // typically 90 or 100 (default 80)
  stepSpeakerScore: number; // typically 0.5 or 1
  minReplyScore: number; // typically 30 or 35
  maxReplyScore: number; // typically 45 or 50
  drawRule: "power_paired" | "random" | "round_robin" | "bracket";
  sideAllocationRule: "balanced" | "random";
  ballotDoubleEntry: boolean;
  publicDraw: boolean;
  publicResults: boolean;
  publicStandings: boolean;
  publicMotions: boolean;
  feedbackEnabled: boolean;
  feedbackMinScore: number;
  feedbackMaxScore: number;
  /** Up to 8 metric ids, most important first. Empty/absent -> format default. */
  teamStandingsPrecedence?: TeamMetricId[];
  /** Shown on the standings page but not used to rank. */
  teamStandingsExtra?: TeamMetricId[];
  speakerStandingsPrecedence?: SpeakerMetricId[];
  speakerStandingsExtra?: SpeakerMetricId[];
  /** Number of lowest speaker scores dropped from speaks_trimmed_mean. */
  speakerTrim?: number;

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
  preliminaryPanelsPerScheduleSlot?: number; // default 1

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
}

export type RoundStage = "preliminary" | "elimination";
export type DrawType = "random" | "power_paired" | "round_robin" | "elimination" | "manual";
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
  feedbackWeight: number;
  silent: boolean;
  motionsReleased: boolean;
  resultsReleased: boolean;
  teamSpeaksReleased?: boolean;
  breakCategoryIds?: string[];
  eliminationAdvanced?: boolean;
  cancelled?: boolean;
  completed: boolean;
  createdAt: string;
}

export interface Institution {
  id: string;
  tournamentId: string;
  name: string;
  code: string;
  region?: string;
}

export interface Speaker {
  id: string;
  name: string;
  email?: string;
  categories?: string[]; // e.g. ["esl", "novice"]
}

export interface Team {
  id: string;
  tournamentId: string;
  name: string;
  breakStatus?: "breaking" | "eliminated";
  breakCategoryIds?: string[];
  eliminatedInRoundId?: string;
  codeName?: string;
  institutionId?: string;
  institutionName?: string;
  speakers: Speaker[];
  breakCategories: string[]; // IDs of eligible break categories
  speakerCategories: string[]; // e.g. ["esl", "novice"]
  seed?: number;
  emoji?: string;
  checkedIn?: boolean;
  privateUrlKey?: string; // Secret key for team's private URL
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
  trainee: boolean;
  independent: boolean;
  checkedIn?: boolean;
  conflicts: AdjudicatorConflict[];
  gender?: string;
  privateUrlKey?: string; // Secret key for adjudicator's private URL
}

export interface Venue {
  id: string;
  tournamentId: string;
  name: string;
  priority: number; // higher = better room
  category?: string;
  available?: boolean;
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
  bracket: number; // e.g., 6 points bracket in round 3
  roomRank: number;
  importance: number;
  resultStatus: DebateResultStatus;
  sidesConfirmed: boolean;
  flags: string[];
  teams: Record<DebateSide, DebateTeamSlot>;
  adjudicators: DebateAdjudicatorSlot;
  motionId?: string;
  motionText?: string;
}

export interface SpeakerScoreEntry {
  speakerId: string;
  speakerName: string;
  position: number; // 1, 2, 3 (and 4 for reply if applicable)
  score: number;
}

export interface TeamScoreEntry {
  side: DebateSide;
  teamId: string;
  points: number; // BP: 1st=3, 2nd=2, 3rd=1, 4th=0. 2-Team: Win=1, Loss=0
  totalSpeakerScore: number;
  win?: boolean;
  margin?: number;
  rank?: number; // 1, 2, 3, 4 for BP
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

export interface FeedbackSubmission {
  id: string;
  tournamentId: string;
  roundId: string;
  debateId: string;
  targetAdjudicatorId: string;
  targetAdjudicatorName: string;
  sourceType: "team" | "adjudicator";
  sourceId: string;
  sourceName: string;
  score: number; // 1 to 10 (or 1 to 5)
  agreeWithDecision?: boolean;
  comments?: string;
  answers?: Record<string, any>;
  confirmed: boolean;
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
    rank?: number;
    win?: boolean;
    opponentNames?: string[];
    opponentTeamIds?: string[];
    pulledUp?: boolean;
  }[];
  /** Every team metric, keyed by id, computed regardless of which are used for ranking. */
  metrics: Record<TeamMetricId, number>;
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

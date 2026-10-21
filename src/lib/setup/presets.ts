import type {
  ScoreCriterion,
  BreakCategory,
  DrawType,
  Round,
  TeamMetricId,
  TournamentFormat,
  TournamentPreferences,
} from "@/types";
import { DEFAULT_POLY_TEAMS_IN_DEBATE, isPolyFormat } from "@/lib/debateSides";

/* -------------------------------------------------------------------------- */
/* Formats                                                                    */
/* -------------------------------------------------------------------------- */

export interface FormatPreset {
  id: TournamentFormat;
  label: string;
  blurb: string;
  /** 4 for BP, 2 for two-team formats; the poly format's default (the wizard asks for the count). */
  teamsInDebate: number;
  substantiveSpeakers: number;
  replyScoresEnabled: boolean;
  /** The speaker-score scale this format conventionally uses. */
  scores: ScoreScale;
}

export interface ScoreScale {
  minSpeakerScore: number;
  maxSpeakerScore: number;
  stepSpeakerScore: number;
  minReplyScore: number;
  maxReplyScore: number;
}

export const FORMAT_PRESETS: FormatPreset[] = [
  {
    id: "bp",
    label: "British Parliamentary (BP)",
    blurb: "4 teams per room, 2 speakers per team, no reply speeches.",
    teamsInDebate: 4,
    substantiveSpeakers: 2,
    replyScoresEnabled: false,
    // WUDC scale. Reply scores are unused in BP; the range only keeps the settings valid.
    scores: { minSpeakerScore: 50, maxSpeakerScore: 100, stepSpeakerScore: 1, minReplyScore: 25, maxReplyScore: 50 },
  },
  {
    id: "uadc",
    label: "Asian Parliamentary (UADC)",
    blurb: "2 teams per room, 3 speakers plus a reply speech.",
    teamsInDebate: 2,
    substantiveSpeakers: 3,
    replyScoresEnabled: true,
    scores: { minSpeakerScore: 70, maxSpeakerScore: 80, stepSpeakerScore: 1, minReplyScore: 35, maxReplyScore: 40 },
  },
  {
    id: "australs",
    label: "Australs",
    blurb: "2 teams per room, 3 speakers plus a reply speech.",
    teamsInDebate: 2,
    substantiveSpeakers: 3,
    replyScoresEnabled: true,
    scores: { minSpeakerScore: 70, maxSpeakerScore: 80, stepSpeakerScore: 1, minReplyScore: 35, maxReplyScore: 40 },
  },
  {
    id: "wsdc",
    label: "World Schools (WSDC)",
    blurb: "2 teams per room, 3 speakers plus a reply speech.",
    teamsInDebate: 2,
    substantiveSpeakers: 3,
    replyScoresEnabled: true,
    // WSDC scale: substantive 60-80, reply 30-40 in half points.
    scores: { minSpeakerScore: 60, maxSpeakerScore: 80, stepSpeakerScore: 1, minReplyScore: 30, maxReplyScore: 40 },
  },
  {
    id: "custom_2team",
    label: "Custom two-team format",
    blurb: "2 teams per room. Set the speaker count and scoring yourself.",
    teamsInDebate: 2,
    substantiveSpeakers: 3,
    replyScoresEnabled: true,
    scores: { minSpeakerScore: 68, maxSpeakerScore: 84, stepSpeakerScore: 1, minReplyScore: 34, maxReplyScore: 42 },
  },
  {
    // Tabbycat's teams_in_debate other than 2 or 4, as its Public Speaking preset (6 per room).
    id: "poly",
    label: "N teams per room (public speaking)",
    blurb: "Any number of teams per room other than 2 or 4, ranked on speaker scores. Random or manual draws only.",
    teamsInDebate: DEFAULT_POLY_TEAMS_IN_DEBATE,
    substantiveSpeakers: 1,
    replyScoresEnabled: false,
    // Tabbycat's Public Speaking scale. Reply scores are unused; the range only keeps the settings valid.
    scores: { minSpeakerScore: 50, maxSpeakerScore: 99, stepSpeakerScore: 1, minReplyScore: 25, maxReplyScore: 50 },
  },
];

export function getFormatPreset(format: TournamentFormat): FormatPreset {
  return FORMAT_PRESETS.find((f) => f.id === format) ?? FORMAT_PRESETS[0];
}

/** Score range for a format with no convention of its own (the custom two-team format). */
export const SCORE_DEFAULTS: ScoreScale = {
  minSpeakerScore: 68,
  maxSpeakerScore: 84,
  stepSpeakerScore: 1,
  minReplyScore: 34,
  maxReplyScore: 42,
};

/** The conventional score scale for a format; every format previously got 68-84 regardless. */
export function scoreDefaultsFor(format: TournamentFormat): ScoreScale {
  return { ...getFormatPreset(format).scores };
}

/* -------------------------------------------------------------------------- */
/* Tabbycat rule presets                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A Tabbycat preference preset (tabbycat/options/presets.py, v2.12.1): a format, its speaker and
 * score settings, and the preference bundle the preset sets. Tabbycat applies only the
 * preferences a preset lists, so `preferences` holds only those that CrabbyTab supports, mapped
 * to CrabbyTab's names. `unsupported` lists what the Tabbycat preset sets that CrabbyTab cannot.
 */
export interface RulesPreset {
  id: string;
  label: string;
  /** Tabbycat's name for the preset. */
  tabbycatName: string;
  blurb: string;
  format: TournamentFormat;
  substantiveSpeakers: number;
  replyScoresEnabled: boolean;
  scores: ScoreScale;
  preferences: Partial<TournamentPreferences>;
  /**
   * A preset's apply action on the rounds (Tabbycat APDA `seed_first_prelim_draw`): the draw type
   * of the first preliminary round, applied when the wizard builds the rounds.
   */
  firstPrelimDrawType?: Extract<DrawType, "seeded">;
  unsupported: string[];
}

/** AustralsPreferences: also the base of the Easters, NZ Easters, Joynt, UADC and WSDC presets. */
const AUSTRALS_BUNDLE: Partial<TournamentPreferences> = {
  avoidSameInstitution: true,
  avoidTeamHistory: true,
  oddBracketMethod: "intermediate_bubble",
  sideAllocationRule: "balanced",
  pairingMethod: "slide",
  conflictAvoidance: "one_up_one_down",
  ballotMode: "voting",
  eliminationBallotMode: "voting",
  enableMotionVetoes: true,
  standingsMissedDebates: 2,
  teamStandingsPrecedence: ["wins", "speaks_sum"],
  speakerStandingsPrecedence: ["speaks_avg"],
  speakerStandingsExtra: ["speaks_stddev", "speeches_count"],
  stepReplyScore: 0.5,
  maximumMargin: 0,
  sideNames: "aff-neg",
  enableMotions: true,
  // ui_options: team institutions hidden, adjudicator institutions shown.
  showTeamInstitutions: false,
  showAdjudicatorInstitutions: true,
};

/** Tabbycat's WSDC score criteria (WSDCPreferences.score_criteria): weight 1, step 0.5. */
const WSDC_SCORE_CRITERIA: ScoreCriterion[] = (
  [
    ["Style", "substantive", 24, 32, true],
    ["Content", "substantive", 24, 32, true],
    ["Strategy", "substantive", 12, 16, true],
    ["POIs", "substantive", -2, 2, false],
    ["Style", "reply", 12, 16, true],
    ["Content", "reply", 12, 16, true],
    ["Strategy", "reply", 6, 8, true],
  ] as const
).map(([name, speechType, minScore, maxScore, required], index) => ({
  id: `wsdc-${speechType}-${name.toLowerCase()}`,
  name,
  seq: index + 1,
  speechType,
  weight: 1,
  minScore,
  maxScore,
  step: 0.5,
  required,
}));

/** Tabbycat's NZ Easters and Joynt Scroll team precedence, with who-beat-whom after each metric. */
const WBW_PRECEDENCE: TeamMetricId[] = ["wins", "wbw", "speaks_sum", "wbw", "draw_strength", "wbw"];

export const RULES_PRESETS: RulesPreset[] = [
  {
    id: "australs",
    label: "Australs",
    tabbycatName: "Australs Rules",
    blurb: "3 vs 3 with replies, chosen motions, intermediate brackets, one-up-one-down. AIDA rules.",
    format: "australs",
    substantiveSpeakers: 3,
    replyScoresEnabled: true,
    scores: { minSpeakerScore: 70, maxSpeakerScore: 80, stepSpeakerScore: 1, minReplyScore: 35, maxReplyScore: 40 },
    preferences: { ...AUSTRALS_BUNDLE },
    unsupported: [],
  },
  {
    id: "bp",
    label: "British Parliamentary",
    tabbycatName: "British Parliamentary Rules",
    blurb: "2 vs 2 vs 2 vs 2. WUDC rules.",
    format: "bp",
    substantiveSpeakers: 2,
    replyScoresEnabled: false,
    scores: { minSpeakerScore: 50, maxSpeakerScore: 100, stepSpeakerScore: 1, minReplyScore: 25, maxReplyScore: 50 },
    preferences: {
      teamScoreIncludesGhosts: true,
      ballotMode: "consensus",
      eliminationBallotMode: "consensus",
      speakersInBallots: "prelim",
      enableMotions: false,
      enableMotionVetoes: false,
      avoidSameInstitution: false,
      avoidTeamHistory: false,
      bpPullupDistribution: "anywhere",
      bpPositionCost: "renyi_entropy",
      renyiOrder: 1,
      bpPositionCostExponent: 4,
      bpAssignmentMethod: "hungarian",
      pullupPenalty: 100000,
      teamStandingsPrecedence: ["points", "speaks_sum", "firsts", "seconds", "draw_strength"],
      speakerStandingsPrecedence: ["speaks_sum"],
      speakerStandingsExtra: ["speaks_avg", "speaks_stddev"],
      preparationTime: 15,
      // standings_missed_debates -1: speakers always ranked.
      standingsMissedDebates: -1,
      feedbackMaxScore: 10,
      showTeamInstitutions: false,
      showAdjudicatorInstitutions: true,
    },
    unsupported: [],
  },
  {
    id: "canadian",
    label: "Canadian Parliamentary",
    tabbycatName: "Canadian Parliamentary Rules",
    blurb: "2 vs 2 with replies (unscored) and POIs. May need regional adjustments.",
    format: "custom_2team",
    substantiveSpeakers: 2,
    replyScoresEnabled: false,
    scores: { minSpeakerScore: 50, maxSpeakerScore: 100, stepSpeakerScore: 1, minReplyScore: 25, maxReplyScore: 50 },
    preferences: {
      ballotMode: "consensus",
      eliminationBallotMode: "consensus",
      sideNames: "gov-opp",
      enableMotions: false,
      enableMotionVetoes: false,
      avoidSameInstitution: false,
      avoidTeamHistory: false,
      oddBracketMethod: "pullup_top",
      sideAllocationRule: "balanced",
      pairingMethod: "fold",
      conflictAvoidance: "off",
    },
    unsupported: [],
  },
  {
    id: "australian_easters",
    label: "Australian Easters",
    tabbycatName: "Australian Easters Rules",
    blurb: "3 vs 3 without replies, set motions, novices, intermediate bubbles, one-up-one-down. AIDA rules.",
    format: "australs",
    substantiveSpeakers: 3,
    replyScoresEnabled: false,
    scores: { minSpeakerScore: 70, maxSpeakerScore: 80, stepSpeakerScore: 1, minReplyScore: 35, maxReplyScore: 40 },
    preferences: { ...AUSTRALS_BUNDLE, ballotMode: "consensus", eliminationBallotMode: "voting", maximumMargin: 15 },
    unsupported: [],
  },
  {
    id: "nz_easters",
    label: "NZ Easters (2 vs 2 Impromptu)",
    tabbycatName: "2 vs 2 Impromptu",
    blurb: "2 vs 2 with replies, chosen motions, chosen sides and novice statuses.",
    format: "custom_2team",
    substantiveSpeakers: 2,
    replyScoresEnabled: true,
    scores: { minSpeakerScore: 60, maxSpeakerScore: 80, stepSpeakerScore: 1, minReplyScore: 30, maxReplyScore: 40 },
    preferences: {
      ...AUSTRALS_BUNDLE,
      teamStandingsPrecedence: WBW_PRECEDENCE,
      oddBracketMethod: "intermediate",
      pairingMethod: "fold",
      conflictAvoidance: "off",
      avoidSameInstitution: false,
      avoidTeamHistory: false,
      sideAllocationRule: "manual_ballot",
    },
    unsupported: [],
  },
  {
    id: "joynt",
    label: "Joynt Scroll (3 vs 3 Prepared)",
    tabbycatName: "3 vs 3 Prepared",
    blurb: "3 vs 3 with preallocated sides, publicly displayed sides and motions, and novice statuses.",
    format: "custom_2team",
    substantiveSpeakers: 3,
    replyScoresEnabled: true,
    scores: { minSpeakerScore: 60, maxSpeakerScore: 80, stepSpeakerScore: 1, minReplyScore: 30, maxReplyScore: 40 },
    preferences: {
      ...AUSTRALS_BUNDLE,
      enableMotions: false,
      enableMotionVetoes: false,
      sideAllocationRule: "preallocated",
      oddBracketMethod: "intermediate2",
      pairingMethod: "fold",
      conflictAvoidance: "off",
      avoidSameInstitution: false,
      avoidTeamHistory: false,
      teamStandingsPrecedence: WBW_PRECEDENCE,
      publicSideAllocations: true,
    },
    unsupported: [],
  },
  {
    id: "uadc",
    label: "UADC",
    tabbycatName: "UADC Rules",
    blurb: "3 vs 3 with replies, chosen motions, and all adjudicators can receive feedback from teams.",
    format: "uadc",
    substantiveSpeakers: 3,
    replyScoresEnabled: true,
    // Tabbycat's UADC preset (Handbook 2.8.2) uses 67-83; CrabbyTab's plain UADC format keeps 70-80.
    scores: { minSpeakerScore: 67, maxSpeakerScore: 83, stepSpeakerScore: 1, minReplyScore: 33.5, maxReplyScore: 41.5 },
    preferences: {
      ...AUSTRALS_BUNDLE,
      marginIncludesDissenters: false,
      sideNames: "gov-opp",
      avoidSameInstitution: false,
      avoidTeamHistory: true,
      teamStandingsPrecedence: ["wins", "speaks_sum", "margin_avg"],
      feedbackMinScore: 1,
      feedbackMaxScore: 10,
      // feedback_from_teams "all-adjs" with Tabbycat's default adjudicator paths ("with-p-on-c").
      feedbackPaths: {
        teams: "all_adjudicators",
        chairOnPanellists: true,
        chairOnTrainees: true,
        panellistsOnChair: true,
        traineesOnChair: false,
        adjudicatorsOnEachOther: false,
        onTeams: false,
      },
      publicFeedbackProgress: true,
    },
    unsupported: [],
  },
  {
    id: "wsdc",
    label: "World Schools (WSDC)",
    tabbycatName: "WSDC Rules",
    blurb: "3 vs 3 with replies, single motions, prop/opp sides, and all adjudicators can receive feedback from teams.",
    format: "wsdc",
    substantiveSpeakers: 3,
    replyScoresEnabled: true,
    scores: { minSpeakerScore: 60, maxSpeakerScore: 80, stepSpeakerScore: 0.5, minReplyScore: 30, maxReplyScore: 40 },
    preferences: {
      ...AUSTRALS_BUNDLE,
      marginIncludesDissenters: true,
      enableMotions: false,
      enableMotionVetoes: false,
      sideNames: "prop-opp",
      scoreCriteria: WSDC_SCORE_CRITERIA,
      avoidSameInstitution: false,
      avoidTeamHistory: true,
      pairingMethod: "random",
      oddBracketMethod: "pullup_top",
      maxTimesPerSide: 5,
      sideAllocationRule: "balanced",
      conflictAvoidance: "min_cost_with_pullups",
      pullupRestriction: "lowest_draw_strength_wins",
      teamStandingsPrecedence: ["wins", "num_adjs", "speaks_avg"],
      speakerStandingsPrecedence: ["speaks_avg"],
      showTeamInstitutions: false,
      showAdjudicatorInstitutions: false,
    },
    unsupported: [],
  },
  {
    id: "apda",
    label: "APDA",
    tabbycatName: "APDA Rules",
    blurb: "2 vs 2 with speech ranks, declared winners and byes.",
    format: "custom_2team",
    substantiveSpeakers: 2,
    replyScoresEnabled: false,
    // Reply scores are unused; the range only keeps the settings valid.
    scores: { minSpeakerScore: 15, maxSpeakerScore: 40, stepSpeakerScore: 1, minReplyScore: 15, maxReplyScore: 40 },
    preferences: {
      enableMotions: false,
      enableMotionVetoes: false,
      oddBracketMethod: "pullup_bottom",
      teamInstitutionPenalty: 1000,
      teamHistoryPenalty: 100000,
      pairingMethod: "fold",
      pullupRestriction: "least_pulled",
      byeTeamResults: "win",
      byeTeamSelectionMethod: "lowest_ranked",
      conflictAvoidance: "min_cost",
      previouslySawPullupPenalty: 10000,
      sideBalancePenalty: 100,
      pairingDeviationPenalty: 1,
      ballotMode: "consensus",
      eliminationBallotMode: "consensus",
      winnersInBallots: "tied-points",
      speakersInBallots: "prelim",
      sideNames: "gov-opp",
      speakerRanks: "any",
      speakerStandingsPrecedence: ["speaks_avg", "srank", "speaks_trimmed_mean"],
      // ui_options show_seed_in_importer "title".
      teamSeedMode: "title",
    },
    firstPrelimDrawType: "seeded",
    unsupported: [],
  },
  {
    id: "karl_popper",
    label: "Karl Popper (Czechia)",
    tabbycatName: "Karl Popper (Czechia)",
    blurb: "3 vs 3 with no reply speeches, median scoring, self-split ballots, and a penalty-weighted draw.",
    format: "custom_2team",
    substantiveSpeakers: 3,
    replyScoresEnabled: false,
    // Reply scores are unused; the range only keeps the settings valid.
    scores: { minSpeakerScore: 50, maxSpeakerScore: 100, stepSpeakerScore: 1, minReplyScore: 25, maxReplyScore: 50 },
    preferences: {
      marginIncludesDissenters: true,
      scoreAggregation: "median",
      sideNames: "aff-neg",
      ballotMode: "voting",
      eliminationBallotMode: "voting",
      requireSubstantiveForReply: false,
      winnersInBallots: "high-points",
      preparationTime: 60,
      enableForfeits: true,
      enableMotions: false,
      enableMotionVetoes: false,
      enableMotionReuse: true,
      // Draw rules: penalty-weighted, as with APDA (Tabbycat "graph" is CrabbyTab's min_cost).
      oddBracketMethod: "pullup_top",
      pairingMethod: "adjacent",
      conflictAvoidance: "min_cost",
      pullupRestriction: "lowest_draw_strength_wins",
      pullupPenalty: 100,
      byeTeamResults: "win",
      byeTeamSelectionMethod: "lowest_ranked",
      minAdjScoreToVote: 1,
      adjConflictPenalty: 10000,
      adjHistoryPenalty: 1,
      importanceMismatchPenalty: 10,
      teamInstitutionPenalty: 100,
      teamHistoryPenalty: 10000,
      previouslySawPullupPenalty: 100,
      sideBalancePenalty: 10000,
      standingsMissedDebates: 2,
      teamStandingsPrecedence: ["wins", "num_adjs", "wbw", "speaks_sum", "draw_strength"],
      teamStandingsExtra: ["speaks_ind_avg"],
      feedbackMaxScore: 6,
      // Tabbycat feedback_paths "no-adjs" and feedback_from_teams "all-adjs".
      feedbackPaths: {
        teams: "all_adjudicators",
        chairOnPanellists: false,
        chairOnTrainees: false,
        panellistsOnChair: false,
        traineesOnChair: false,
        adjudicatorsOnEachOther: false,
        onTeams: false,
      },
      privateUrlBallots: true,
      // participant_feedback "public": the public feedback form, not private URLs.
      privateUrlFeedback: false,
      publicFeedbackForm: true,
      showUnaccredited: true,
      allowSelfCheckIn: true,
      individualBallots: true,
      allowSelfSplitBallots: true,
      publicParticipants: true,
      publicInstitutionsList: true,
      publicDrawMode: "current",
      publicMotions: true,
      publicRecordPages: false,
      showTeamInstitutions: false,
      showAdjudicatorInstitutions: true,
    },
    unsupported: [],
  },
  {
    // Tabbycat's PublicSpeaking preset. Its apply action (every preliminary draw random) is the
    // random draw rule here; Tabbycat's poly formats have only random and manual draws.
    id: "public_speaking",
    label: "Public Speaking",
    tabbycatName: "Public Speaking",
    blurb: "Arbitrary number of teams per room, one speech each, no team points.",
    format: "poly",
    substantiveSpeakers: 1,
    replyScoresEnabled: false,
    // Reply scores are unused; the range only keeps the settings valid.
    scores: { minSpeakerScore: 50, maxSpeakerScore: 99, stepSpeakerScore: 1, minReplyScore: 25, maxReplyScore: 50 },
    preferences: {
      teamsInDebate: 6,
      drawRule: "random",
      maximumMargin: 0,
      // Tabbycat: "Disables win/rank calculations": voting ballots record scores only.
      marginIncludesDissenters: true,
      ballotMode: "voting",
      eliminationBallotMode: "voting",
      speakersInBallots: "prelim",
      sideNames: "1-2",
      enableMotionVetoes: false,
      enableMotions: false,
      avoidSameInstitution: false,
      avoidTeamHistory: false,
      teamStandingsPrecedence: ["speaks_avg"],
    },
    unsupported: [],
  },
];

/**
 * Tabbycat presets CrabbyTab does not offer, and why. "Japan BP" is not a Tabbycat preset;
 * Japanese BP tournaments use the British Parliamentary preset.
 */
export const UNSUPPORTED_TABBYCAT_PRESETS: Record<string, string> = {};

/* -------------------------------------------------------------------------- */
/* Tabbycat's hidden presets                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Tabbycat's PublicInformation preset ("Public Information Options", offered when a tournament is
 * created): the current round's draw, break categories, results, motions and team standings public.
 */
export const PUBLIC_INFORMATION_PREFERENCES: Partial<TournamentPreferences> = {
  publicDraw: true,
  publicDrawMode: "current",
  publicBreakCategories: true,
  publicResults: true,
  publicMotions: true,
  publicStandings: true,
};

/**
 * Tabbycat's TabRelease preset ("Tab Release Options"): every tab, the motion tab, scoresheets and
 * all results public, with the breaks of every category and the breaking adjudicators; the
 * running-tournament pages (check-ins, team standings, draw, break categories) switched off.
 */
export function tabReleasePreferences(breakCategoryIds: readonly string[]): Partial<TournamentPreferences> {
  return {
    releaseTeamTab: true,
    releaseSpeakerTab: true,
    motionTabReleased: true,
    releaseBallots: true,
    releaseAllResults: true,
    publicDiversity: true,
    publicResults: true,
    // public_breaking_teams: the break of every category.
    releasedBreakCategoryIds: [...new Set(breakCategoryIds)].sort(),
    publicBreakingAdjudicators: true,
    publicCheckInStatus: false,
    publicStandings: false,
    publicDraw: false,
    publicDrawMode: "off",
    publicBreakCategories: false,
  };
}

/**
 * Tabbycat's participant data entry choice when a tournament is created (its PrivateURLs and
 * PublicForms presets; "default" applies neither, keeping CrabbyTab's defaults or the rules
 * preset's choice). "tab_staff" is Tabbycat's "Disabled (tab staff only)".
 */
export type ParticipantDataEntry = "default" | "private_urls" | "public_forms" | "tab_staff";

export function participantDataEntryPreferences(choice: ParticipantDataEntry): Partial<TournamentPreferences> {
  switch (choice) {
    case "private_urls":
      return { privateUrlBallots: true, privateUrlFeedback: true, publicBallotForm: false, publicFeedbackForm: false };
    case "public_forms":
      return { privateUrlBallots: false, privateUrlFeedback: false, publicBallotForm: true, publicFeedbackForm: true };
    case "tab_staff":
      return { privateUrlBallots: false, privateUrlFeedback: false, publicBallotForm: false, publicFeedbackForm: false };
    default:
      return {};
  }
}

/**
 * Tabbycat's RoundRobinTwoTeam / RoundRobinBP presets: pairings come from the schedule, so history
 * and institution avoidance are off, and teams are imported with numeric seeds.
 */
export const ROUND_ROBIN_PREFERENCES: Partial<TournamentPreferences> = {
  avoidTeamHistory: false,
  avoidSameInstitution: false,
  teamSeedMode: "numeric",
};

export function getRulesPreset(id: string | undefined): RulesPreset | undefined {
  return RULES_PRESETS.find((preset) => preset.id === id);
}

/** Every preference a rules preset sets: team and speaker counts, the score scale and its bundle. */
export function rulesPresetPreferences(preset: RulesPreset): Partial<TournamentPreferences> {
  return {
    teamsInDebate: preset.format === "bp" ? 4 : isPolyFormat(preset.format) ? DEFAULT_POLY_TEAMS_IN_DEBATE : 2,
    substantiveSpeakers: preset.substantiveSpeakers,
    replyScoresEnabled: preset.replyScoresEnabled,
    ...preset.scores,
    ...preset.preferences,
  };
}

/* -------------------------------------------------------------------------- */
/* Slugs                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Slugs that would collide with app routes, so a tournament could never be
 * opened at its own URL: every top-level folder of `src/app` (presets.test.ts
 * keeps the list in step), the shared-view segments (`public`, `display`,
 * `private`) and Next.js's own `_next`.
 */
export const RESERVED_SLUGS = new Set([
  // Top-level app routes (src/app/*).
  "account",
  "api",
  "forgot-password",
  "invite",
  "login",
  "register",
  "tournaments",
  // Shared-view segments under a tournament (lib/tournamentRoutes.ts).
  "public",
  "display",
  "private",
  // Framework and older reserved names.
  "_next",
  "new",
  "admin",
]);

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Returns an error message, or "" when the slug is acceptable. */
export function validateSlug(slug: string): string {
  if (slug.length < 3) return "The URL slug must be at least 3 characters.";
  if (slug.length > 40) return "The URL slug must be 40 characters or fewer.";
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return "Use only lowercase letters, numbers and single hyphens.";
  }
  if (RESERVED_SLUGS.has(slug)) return `"${slug}" is reserved. Please choose another slug.`;
  return "";
}

/* -------------------------------------------------------------------------- */
/* Break sizes and elimination rounds                                         */
/* -------------------------------------------------------------------------- */

export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

/**
 * Number of elimination rounds needed to reduce `breakSize` teams to a winner.
 * BP rooms hold 4 teams and 2 advance, so 4 teams is already a final.
 * Two-team formats halve the field every round.
 *
 * Break sizes that do not halve cleanly (e.g. 12 or 24) start with a partial
 * elimination round in which the top seeds get byes, so they need one extra
 * round. BP breaks must be even, since two teams advance from each room.
 *
 * Other team counts (the poly format) have no elimination draw in Tabbycat, so no elimination
 * rounds are planned: their elimination rounds are added by hand and drawn manually.
 */
export function eliminationRoundCount(breakSize: number, teamsInDebate: number): number {
  if (teamsInDebate !== 2 && teamsInDebate !== 4) return 0;
  if (!Number.isInteger(breakSize) || breakSize < teamsInDebate) return 0;
  if (teamsInDebate === 4) {
    if (breakSize % 2 !== 0) return 0;
    return Math.ceil(Math.log2(breakSize / 4)) + 1;
  }
  return Math.ceil(Math.log2(breakSize));
}

/** Returns an error message, or "" when `breakSize` can be run as an elimination bracket. */
export function validateBreakSize(breakSize: number, teamsInDebate: number): string {
  if (teamsInDebate !== 2 && teamsInDebate !== 4) {
    // Tabbycat checks no break size for other team counts (no elimination draw is generated).
    return Number.isInteger(breakSize) && breakSize >= 1 ? "" : "Break sizes must be at least 1 team.";
  }
  if (eliminationRoundCount(breakSize, teamsInDebate) > 0) return "";
  return teamsInDebate === 4
    ? "BP break sizes must be an even number of at least 4 teams."
    : "Break sizes must be at least 2 teams.";
}

export function buildBreakCategorySchedule(
  categories: BreakCategory[],
  totalEliminationRounds: number,
  teamsInDebate: number
): string[][] {
  return Array.from({ length: totalEliminationRounds }, (_, roundIndex) =>
    categories
      .filter((category) => {
        const categoryRounds = eliminationRoundCount(category.breakSize, teamsInDebate);
        return categoryRounds > 0 && roundIndex >= totalEliminationRounds - categoryRounds;
      })
      .map((category) => category.id)
  );
}

const ELIMINATION_LABELS = [
  { name: "Grand Final", abbr: "GF" },
  { name: "Semifinals", abbr: "SF" },
  { name: "Quarterfinals", abbr: "QF" },
  { name: "Octofinals", abbr: "OF" },
  { name: "Double Octofinals", abbr: "DOF" },
  { name: "Triple Octofinals", abbr: "TOF" },
];

/** Labels in playing order (earliest elimination round first). */
export function eliminationRoundLabels(count: number): { name: string; abbr: string }[] {
  const labels: { name: string; abbr: string }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    labels.push(
      ELIMINATION_LABELS[i] ?? { name: `Elimination ${count - i}`, abbr: `E${count - i}` }
    );
  }
  return labels;
}

/* -------------------------------------------------------------------------- */
/* Builders                                                                   */
/* -------------------------------------------------------------------------- */

export type PrelimDrawRule = Extract<DrawType, "power_paired" | "random" | "round_robin">;

/**
 * Builds the preliminary and elimination rounds. IDs follow the same pattern
 * as `createRound` in TournamentContext so the rest of the app treats them
 * identically to hand-made rounds.
 */
export function buildRounds(opts: {
  tournamentId: string;
  prelimRounds: number;
  maxBreakSize: number;
  teamsInDebate: number;
  drawRule: PrelimDrawRule;
  /** A rules preset's draw type for the first preliminary round (APDA: seeded). */
  firstPrelimDrawType?: RulesPreset["firstPrelimDrawType"];
}): Round[] {
  const { tournamentId, prelimRounds, maxBreakSize, teamsInDebate, drawRule, firstPrelimDrawType } = opts;
  if (teamsInDebate !== 2 && teamsInDebate !== 4 && drawRule !== "random") {
    // Tabbycat draws other team counts only at random (or by hand).
    throw new Error(`Debates with ${teamsInDebate} teams can only use random draws.`);
  }
  const now = new Date().toISOString();
  const rounds: Round[] = [];

  const base = (seq: number) => ({
    id: `round-${tournamentId}-${seq}`,
    tournamentId,
    seq,
    feedbackWeight: 1.0,
    silent: false,
    motionsReleased: false,
    resultsReleased: false,
    completed: false,
    drawStatus: "none" as const,
    createdAt: now,
  });

  for (let i = 1; i <= prelimRounds; i++) {
    rounds.push({
      ...base(i),
      name: `Round ${i}`,
      abbreviation: `R${i}`,
      stage: "preliminary",
      // Power pairing needs standings, so the first round is random (or the preset's draw type).
      drawType: i === 1 && drawRule === "power_paired" ? firstPrelimDrawType ?? "random" : drawRule,
    });
  }

  const elimLabels = eliminationRoundLabels(eliminationRoundCount(maxBreakSize, teamsInDebate));
  elimLabels.forEach((label, idx) => {
    rounds.push({
      ...base(prelimRounds + idx + 1),
      name: label.name,
      abbreviation: label.abbr,
      stage: "elimination",
      drawType: "elimination",
    });
  });

  return rounds;
}

export interface BreakDraft {
  key: string;
  name: string;
  breakSize: number;
  reserveSize: number;
  isGeneral: boolean;
}

export function buildBreakCategories(
  tournamentId: string,
  drafts: BreakDraft[]
): BreakCategory[] {
  const used = new Set<string>();
  return drafts.map((d, idx) => {
    let slug = slugify(d.name) || `break-${idx + 1}`;
    while (used.has(slug)) slug = `${slug}-${idx + 1}`;
    used.add(slug);
    return {
      id: `bc-${slug}-${tournamentId}`,
      tournamentId,
      name: d.name.trim(),
      slug,
      seq: idx + 1,
      breakSize: d.breakSize,
      reserveSize: d.reserveSize,
      isGeneral: d.isGeneral,
      priority: d.isGeneral ? 10 : Math.max(1, 9 - idx),
    };
  });
}

export function defaultPreferences(
  format: TournamentFormat
): TournamentPreferences {
  const preset = getFormatPreset(format);
  return {
    teamsInDebate: preset.teamsInDebate,
    substantiveSpeakers: preset.substantiveSpeakers,
    replyScoresEnabled: preset.replyScoresEnabled,
    ...preset.scores,
    drawRule: "power_paired",
    sideAllocationRule: "balanced",
    ballotDoubleEntry: false,
    publicDraw: true,
    publicResults: true,
    publicStandings: true,
    publicMotions: true,
    feedbackEnabled: true,
    feedbackMinScore: 1,
    feedbackMaxScore: 10,
    // Tabbycat's default for every format (scoring__teamscore_includes_ghosts). Stored explicitly so
    // tournaments created before this default keep the old `false` fallback in result.ts.
    teamScoreIncludesGhosts: true,
    // Tabbycat's disable_ballot_confirms is off by default: private-URL ballots wait for the tab
    // room. Stored explicitly, so tournaments without the field keep the old "chair" behaviour.
    privateBallotConfirmation: "tab_room",
  };
}

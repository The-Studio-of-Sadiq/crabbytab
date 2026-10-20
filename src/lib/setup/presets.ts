import type {
  BreakCategory,
  DrawType,
  Round,
  TeamMetricId,
  TournamentFormat,
  TournamentPreferences,
} from "@/types";

/* -------------------------------------------------------------------------- */
/* Formats                                                                    */
/* -------------------------------------------------------------------------- */

export interface FormatPreset {
  id: TournamentFormat;
  label: string;
  blurb: string;
  teamsInDebate: 4 | 2;
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
};

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
    unsupported: ["Reply score step of 0.5", "Hiding team institutions"],
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
    },
    unsupported: [
      "Speaker scores only in preliminary rounds",
      "15-minute preparation time",
    ],
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
      enableMotionVetoes: false,
      avoidSameInstitution: false,
      avoidTeamHistory: false,
      oddBracketMethod: "pullup_top",
      sideAllocationRule: "balanced",
      pairingMethod: "fold",
      conflictAvoidance: "off",
    },
    unsupported: ["Government/Opposition side names"],
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
    preferences: { ...AUSTRALS_BUNDLE, ballotMode: "consensus", eliminationBallotMode: "voting" },
    unsupported: ["Maximum margin of 15"],
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
      enableMotionVetoes: false,
      sideAllocationRule: "preallocated",
      oddBracketMethod: "intermediate2",
      pairingMethod: "fold",
      conflictAvoidance: "off",
      avoidSameInstitution: false,
      avoidTeamHistory: false,
      teamStandingsPrecedence: WBW_PRECEDENCE,
    },
    unsupported: ["Turning motions off", "Public side-allocations page"],
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
      avoidSameInstitution: false,
      avoidTeamHistory: true,
      teamStandingsPrecedence: ["wins", "speaks_sum", "margin_avg"],
      feedbackMinScore: 1,
      feedbackMaxScore: 10,
    },
    unsupported: ["Government/Opposition side names", "Feedback from teams on every adjudicator", "Public feedback progress"],
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
      enableMotionVetoes: false,
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
    },
    unsupported: [
      "Style/Content/Strategy score criteria",
      "Proposition/Opposition side names",
    ],
  },
];

/**
 * Tabbycat presets CrabbyTab does not offer, and why. "Japan BP" is not a Tabbycat preset;
 * Japanese BP tournaments use the British Parliamentary preset.
 */
export const UNSUPPORTED_TABBYCAT_PRESETS: Record<string, string> = {
  "APDA Rules": "needs speech ranks and separate winner selection on ballots",
  "Public Speaking": "needs six teams per room with one speaker each",
  "Karl Popper (Czechia)": "needs median score aggregation and self-split ballots",
};

export function getRulesPreset(id: string | undefined): RulesPreset | undefined {
  return RULES_PRESETS.find((preset) => preset.id === id);
}

/** Every preference a rules preset sets: team and speaker counts, the score scale and its bundle. */
export function rulesPresetPreferences(preset: RulesPreset): Partial<TournamentPreferences> {
  return {
    teamsInDebate: preset.format === "bp" ? 4 : 2,
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
 * opened at its own URL.
 */
export const RESERVED_SLUGS = new Set([
  "login",
  "register",
  "forgot-password",
  "tournaments",
  "new",
  "api",
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
 */
export function eliminationRoundCount(breakSize: number, teamsInDebate: 4 | 2): number {
  if (!Number.isInteger(breakSize) || breakSize < teamsInDebate) return 0;
  if (teamsInDebate === 4) {
    if (breakSize % 2 !== 0) return 0;
    return Math.ceil(Math.log2(breakSize / 4)) + 1;
  }
  return Math.ceil(Math.log2(breakSize));
}

/** Returns an error message, or "" when `breakSize` can be run as an elimination bracket. */
export function validateBreakSize(breakSize: number, teamsInDebate: 4 | 2): string {
  if (eliminationRoundCount(breakSize, teamsInDebate) > 0) return "";
  return teamsInDebate === 4
    ? "BP break sizes must be an even number of at least 4 teams."
    : "Break sizes must be at least 2 teams.";
}

export function buildBreakCategorySchedule(
  categories: BreakCategory[],
  totalEliminationRounds: number,
  teamsInDebate: 4 | 2
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
  teamsInDebate: 4 | 2;
  drawRule: PrelimDrawRule;
}): Round[] {
  const { tournamentId, prelimRounds, maxBreakSize, teamsInDebate, drawRule } = opts;
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
      // Power pairing needs standings, so the first round is random.
      drawType: i === 1 && drawRule === "power_paired" ? "random" : drawRule,
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
  };
}

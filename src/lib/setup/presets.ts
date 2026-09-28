import type {
  BreakCategory,
  DrawType,
  Round,
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
}

export const FORMAT_PRESETS: FormatPreset[] = [
  {
    id: "bp",
    label: "British Parliamentary (BP)",
    blurb: "4 teams per room, 2 speakers per team, no reply speeches.",
    teamsInDebate: 4,
    substantiveSpeakers: 2,
    replyScoresEnabled: false,
  },
  {
    id: "uadc",
    label: "Asian Parliamentary (UADC)",
    blurb: "2 teams per room, 3 speakers plus a reply speech.",
    teamsInDebate: 2,
    substantiveSpeakers: 3,
    replyScoresEnabled: true,
  },
  {
    id: "australs",
    label: "Australs",
    blurb: "2 teams per room, 3 speakers plus a reply speech.",
    teamsInDebate: 2,
    substantiveSpeakers: 3,
    replyScoresEnabled: true,
  },
  {
    id: "wsdc",
    label: "World Schools (WSDC)",
    blurb: "2 teams per room, 3 speakers plus a reply speech.",
    teamsInDebate: 2,
    substantiveSpeakers: 3,
    replyScoresEnabled: true,
  },
  {
    id: "custom_2team",
    label: "Custom two-team format",
    blurb: "2 teams per room. Set the speaker count and scoring yourself.",
    teamsInDebate: 2,
    substantiveSpeakers: 3,
    replyScoresEnabled: true,
  },
];

export function getFormatPreset(format: TournamentFormat): FormatPreset {
  return FORMAT_PRESETS.find((f) => f.id === format) ?? FORMAT_PRESETS[0];
}

/** Same score ranges the app already used when a tournament was created. */
export const SCORE_DEFAULTS = {
  minSpeakerScore: 68,
  maxSpeakerScore: 84,
  stepSpeakerScore: 1,
  minReplyScore: 34,
  maxReplyScore: 42,
};

/* -------------------------------------------------------------------------- */
/* Slugs                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Slugs that would collide with app routes (or the demo), so a tournament
 * could never be opened at its own URL.
 */
export const RESERVED_SLUGS = new Set([
  "login",
  "register",
  "forgot-password",
  "tournaments",
  "new",
  "api",
  "admin",
  "wudc-demo",
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
 */
export function eliminationRoundCount(breakSize: number, teamsInDebate: 4 | 2): number {
  if (!isPowerOfTwo(breakSize) || breakSize < teamsInDebate) return 0;
  const log = Math.log2(breakSize);
  return teamsInDebate === 4 ? log - 1 : log;
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
    ...SCORE_DEFAULTS,
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

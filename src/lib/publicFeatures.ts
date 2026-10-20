import type {
  AdjudicatorTabShows,
  ParticipantCodeNameMode,
  PublicDrawMode,
  PublicMotionsOrder,
  Round,
  SearchEngineIndexing,
  TeamCodeNameMode,
  TournamentPreferences,
} from "@/types";

/**
 * Public-site settings (Tabbycat's public_features, tab_release and ui_options sections) resolved
 * with their defaults. The projection (src/lib/publicView/projection.ts) enforces them when it
 * builds the public view; public pages read the same values to decide what to render.
 */
export interface PublicSiteSettings {
  drawMode: PublicDrawMode;
  recordPages: boolean;
  adjudicatorTab: boolean;
  adjudicatorTabShows: AdjudicatorTabShows;
  ballots: boolean;
  privateBallots: boolean;
  teamTabLimit: number;
  speakerTabLimit: number;
  repliesTabLimit: number;
  breakCategoryTabs: boolean;
  /** -1 = every precedence metric, 0 = none, n = the first n. */
  breakMetrics: number;
  breakCategoriesOnParticipants: boolean;
  sideAllocations: boolean;
  bracket: boolean;
  diversity: boolean;
  vetoStatistics: boolean;
  feedbackProgress: boolean;
  showTeamInstitutions: boolean;
  showAdjudicatorInstitutions: boolean;
  teamCodeNames: TeamCodeNameMode;
  participantCodeNames: ParticipantCodeNameMode;
  showEmoji: boolean;
  showSpeakersInDraw: boolean;
  showSplittingAdjudicators: boolean;
  searchEngineIndexing: SearchEngineIndexing;
  welcomeMessage: string;
  tournamentStaff: string;
  motionsOrder: PublicMotionsOrder;
  ballotForm: boolean;
  feedbackForm: boolean;
  formsUsePassword: boolean;
}

const DRAW_MODES: readonly PublicDrawMode[] = ["off", "current", "all"];
const ADJUDICATOR_TAB_SHOWS: readonly AdjudicatorTabShows[] = ["test", "final", "all"];
const TEAM_CODE_NAME_MODES: readonly TeamCodeNameMode[] = [
  "off",
  "all-tooltips",
  "admin-tooltips-code",
  "admin-tooltips-real",
  "everywhere",
];
const PARTICIPANT_CODE_NAME_MODES: readonly ParticipantCodeNameMode[] = ["off", "everywhere"];
const INDEXING_MODES: readonly SearchEngineIndexing[] = ["all", "homepage-only", "none"];
const MOTIONS_ORDERS: readonly PublicMotionsOrder[] = ["forward", "reverse"];

/** Longest welcome message / staff credit kept (plain text). */
export const PUBLIC_TEXT_MAX_LENGTH = 5000;

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** A non-negative whole number; anything else (absent, negative, NaN) means "no limit" (0). */
function limit(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, PUBLIC_TEXT_MAX_LENGTH) : "";
}

export function getPublicSiteSettings(preferences?: Partial<TournamentPreferences> | null): PublicSiteSettings {
  const prefs = preferences ?? {};
  const breakMetrics =
    typeof prefs.publicBreakMetrics === "number" && Number.isFinite(prefs.publicBreakMetrics) && prefs.publicBreakMetrics >= 0
      ? Math.floor(prefs.publicBreakMetrics)
      : -1;
  return {
    // The legacy boolean switched the whole draw page; it still turns the draw off.
    drawMode: oneOf(prefs.publicDrawMode, DRAW_MODES, prefs.publicDraw === false ? "off" : "all"),
    recordPages: prefs.publicRecordPages !== false,
    adjudicatorTab: prefs.releaseAdjudicatorTab === true,
    adjudicatorTabShows: oneOf(prefs.adjudicatorTabShows, ADJUDICATOR_TAB_SHOWS, "final"),
    ballots: prefs.releaseBallots === true,
    privateBallots: prefs.releasePrivateBallots === true,
    teamTabLimit: limit(prefs.teamTabLimit),
    speakerTabLimit: limit(prefs.speakerTabLimit),
    repliesTabLimit: limit(prefs.repliesTabLimit),
    breakCategoryTabs: prefs.releaseBreakCategoryTabs === true,
    breakMetrics,
    breakCategoriesOnParticipants: prefs.publicBreakCategories === true,
    sideAllocations: prefs.publicSideAllocations === true,
    bracket: prefs.publicBracket === true,
    diversity: prefs.publicDiversity === true,
    vetoStatistics: prefs.publicVetoStatistics === true && prefs.enableMotionVetoes === true,
    feedbackProgress: prefs.publicFeedbackProgress === true,
    showTeamInstitutions: prefs.showTeamInstitutions !== false,
    showAdjudicatorInstitutions: prefs.showAdjudicatorInstitutions !== false,
    teamCodeNames: oneOf(prefs.teamCodeNames, TEAM_CODE_NAME_MODES, "off"),
    participantCodeNames: oneOf(prefs.participantCodeNames, PARTICIPANT_CODE_NAME_MODES, "off"),
    showEmoji: prefs.showEmoji !== false,
    showSpeakersInDraw: prefs.showSpeakersInDraw !== false,
    showSplittingAdjudicators: prefs.showSplittingAdjudicators === true,
    searchEngineIndexing: oneOf(prefs.searchEngineIndexing, INDEXING_MODES, "all"),
    welcomeMessage: text(prefs.welcomeMessage),
    tournamentStaff: text(prefs.tournamentStaff),
    motionsOrder: oneOf(prefs.publicMotionsOrder, MOTIONS_ORDERS, "forward"),
    ballotForm: prefs.publicBallotForm === true,
    feedbackForm: prefs.publicFeedbackForm === true,
    formsUsePassword: prefs.publicFormsUsePassword === true,
  };
}

/** Whether the public sees team code names instead of real names (every mode but off / all-tooltips). */
export function publicUsesTeamCodeNames(mode: TeamCodeNameMode): boolean {
  return mode === "admin-tooltips-code" || mode === "admin-tooltips-real" || mode === "everywhere";
}

/**
 * The round "current round only" shows: the latest non-cancelled round whose draw is confirmed or
 * released. CrabbyTab has no separate "current round" marker, so the newest published draw is it.
 */
export function currentDrawRoundId(
  rounds: Array<Pick<Round, "id" | "seq" | "cancelled" | "drawStatus">>
): string | undefined {
  return [...rounds]
    .filter((round) => round.cancelled !== true && (round.drawStatus === "confirmed" || round.drawStatus === "released"))
    .sort((left, right) => right.seq - left.seq)[0]?.id;
}

/** Whether a round's draw is on the public draw page under the draw mode. */
export function isRoundDrawPublic(
  round: Pick<Round, "id" | "drawStatus" | "cancelled">,
  mode: PublicDrawMode,
  currentRoundId: string | undefined
): boolean {
  if (mode === "off" || round.cancelled === true) return false;
  if (round.drawStatus !== "confirmed" && round.drawStatus !== "released") return false;
  return mode === "all" || round.id === currentRoundId;
}

/** Robots directives for a public page; `homepage` is the tournament's public landing page. */
export function robotsForPublicPage(mode: SearchEngineIndexing, homepage: boolean): { index: boolean; follow: boolean } {
  const index = mode === "all" || (mode === "homepage-only" && homepage);
  return { index, follow: index };
}

/**
 * Public motions by round (Tabbycat `public_motions_order`): forward lists the earliest round
 * first. Within a round, and for motions without a round (listed last going forward), motions keep
 * their `seq` order, then id, so the order is stable.
 */
export function orderPublicMotions<T extends { id: string; seq?: number; rounds?: string[] }>(
  motions: T[],
  order: PublicMotionsOrder,
  roundSeqById: ReadonlyMap<string, number> = new Map()
): T[] {
  const roundSeq = (motion: T) =>
    Math.min(...(motion.rounds ?? []).map((id) => roundSeqById.get(id) ?? Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY);
  const bySeq = (left: T, right: T) => (left.seq ?? 0) - (right.seq ?? 0) || left.id.localeCompare(right.id);
  return [...motions].sort((left, right) => {
    const leftRound = roundSeq(left);
    const rightRound = roundSeq(right);
    if (leftRound !== rightRound) {
      // Infinity - Infinity is NaN, so unassigned motions are compared explicitly.
      if (leftRound === Number.POSITIVE_INFINITY) return 1;
      if (rightRound === Number.POSITIVE_INFINITY) return -1;
      return order === "reverse" ? rightRound - leftRound : leftRound - rightRound;
    }
    return bySeq(left, right);
  });
}

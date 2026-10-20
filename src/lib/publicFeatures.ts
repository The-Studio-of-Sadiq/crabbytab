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
import { isDrawPubliclyReleased } from "@/lib/draw/drawStatus";
import { scheduleGroupOf } from "@/features/tournament/application/schedule";

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
  /** The public motions page (`publicMotions`, absent = on). */
  motionsPage: boolean;
  /** Public motion statistics (Tabbycat `motion_tab_released`); absent = follows the motions page. */
  motionTab: boolean;
  /** The debated motion on public results and record pages (Tabbycat `show_motions_in_results`). */
  motionsInResults: boolean;
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
    motionsPage: prefs.publicMotions !== false,
    motionTab: typeof prefs.motionTabReleased === "boolean" ? prefs.motionTabReleased : prefs.publicMotions !== false,
    motionsInResults: prefs.showMotionsInResults === true,
    ballotForm: prefs.publicBallotForm === true,
    feedbackForm: prefs.publicFeedbackForm === true,
    formsUsePassword: prefs.publicFormsUsePassword === true,
  };
}

/** Whether the public sees team code names instead of real names (every mode but off / all-tooltips). */
export function publicUsesTeamCodeNames(mode: TeamCodeNameMode): boolean {
  return mode === "admin-tooltips-code" || mode === "admin-tooltips-real" || mode === "everywhere";
}

type CurrentRoundCandidate = Pick<Round, "id" | "seq" | "cancelled" | "drawStatus" | "stage" | "scheduleGroup">;

/**
 * The tournament's explicit current round (Tabbycat "set current round", stored as
 * `preferences.currentRoundId`), when it names a round that exists and is not cancelled.
 */
export function explicitCurrentRound<T extends Pick<Round, "id" | "cancelled">>(
  rounds: T[],
  currentRoundId: string | undefined | null
): T | undefined {
  if (typeof currentRoundId !== "string" || currentRoundId.length === 0) return undefined;
  return rounds.find((round) => round.id === currentRoundId && round.cancelled !== true);
}

/**
 * The round "current round only" shows. With an explicit current round set (and still live), that
 * round; otherwise the latest non-cancelled round whose draw is publicly released (CrabbyTab's
 * original derivation).
 */
export function currentDrawRoundId(
  rounds: Array<Pick<Round, "id" | "seq" | "cancelled" | "drawStatus">>,
  currentRoundId?: string | null
): string | undefined {
  const explicit = explicitCurrentRound(rounds, currentRoundId);
  if (explicit) return explicit.id;
  return [...rounds]
    .filter((round) => round.cancelled !== true && isDrawPubliclyReleased(round))
    .sort((left, right) => right.seq - left.seq)[0]?.id;
}

/**
 * Every current round. An explicit current round brings the other live rounds of its schedule slot
 * and stage (concurrent rounds, Tabbycat current_rounds); the derived current round is one round,
 * as before explicit current rounds existed.
 */
export function currentDrawRoundIds(
  rounds: CurrentRoundCandidate[],
  currentRoundId?: string | null
): Set<string> {
  const explicit = explicitCurrentRound(rounds, currentRoundId);
  if (explicit) {
    const slot = scheduleGroupOf(explicit);
    return new Set(
      rounds
        .filter((round) =>
          round.cancelled !== true &&
          (round.id === explicit.id || (round.stage === explicit.stage && scheduleGroupOf(round) === slot))
        )
        .map((round) => round.id)
    );
  }
  const derived = currentDrawRoundId(rounds);
  return new Set(derived ? [derived] : []);
}

/**
 * The round a shared view (public pages) opens on: the explicit current round when it is among the
 * rounds this view can see, else the latest round with something public (released draw, results or
 * panel), as before explicit current rounds existed.
 */
export function sharedViewCurrentRound<T extends Pick<Round, "id" | "seq" | "cancelled" | "drawStatus" | "resultsReleased" | "adjudicatorsRevealed">>(
  rounds: T[],
  currentRoundId?: string | null
): T | undefined {
  return explicitCurrentRound(rounds, currentRoundId) ?? [...rounds]
    .filter((round) =>
      round.cancelled !== true &&
      (isDrawPubliclyReleased(round) || round.resultsReleased === true || round.adjudicatorsRevealed === true)
    )
    .sort((left, right) => right.seq - left.seq)[0];
}

/**
 * The round a private portal opens on, among the participant's own visible rounds: the explicit
 * current round when the participant has a debate in it, else their latest round.
 */
export function portalCurrentRound<T extends Pick<Round, "id" | "seq" | "cancelled">>(
  rounds: T[],
  currentRoundId?: string | null
): T | undefined {
  return explicitCurrentRound(rounds, currentRoundId) ??
    [...rounds].filter((round) => round.cancelled !== true).sort((left, right) => right.seq - left.seq)[0];
}

/**
 * Whether a round's draw is on the public draw page under the draw mode. Only the full release is
 * public: a confirmed (locked) or teams-only draw never is.
 */
export function isRoundDrawPublic(
  round: Pick<Round, "id" | "drawStatus" | "cancelled">,
  mode: PublicDrawMode,
  current: string | undefined | ReadonlySet<string>
): boolean {
  if (mode === "off" || round.cancelled === true) return false;
  if (!isDrawPubliclyReleased(round)) return false;
  if (mode === "all") return true;
  return typeof current === "string" || current === undefined ? round.id === current : current.has(round.id);
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

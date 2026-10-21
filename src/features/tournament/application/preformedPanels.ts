import { teamsInDebateFor } from "@/lib/debateSides";
import type {
  Adjudicator,
  AuditCategory,
  BallotSubmission,
  BreakCategory,
  Debate,
  FeedbackSubmission,
  PreformedPanel,
  Round,
  Team,
  Tournament,
} from "@/types";
import { calculateStandings } from "@/lib/standings/calculator";
import { ballotModeFor } from "@/lib/ballots/result";
import { calculateScaledFeedbackScores } from "@/lib/feedback/scores";
import {
  allocateAdjudicatorsToPreformedPanels,
  type PreformedPanelFillResult,
} from "@/lib/draw/allocator";
import type { TabbycatHungarianMode } from "@/lib/draw/tabbycatHungarian";
import { concurrentBookings, isEarlierScheduleSlot } from "./schedule";
import {
  calculateAnticipatedDraw,
  importanceByBracket,
  openLiveThresholds,
  type AnticipatedRoom,
  type LiveThresholds,
} from "@/lib/draw/anticipatedDraw";

export type PanelRole = "chair" | "panellist" | "trainee";

export function emptyPreformedPanel(id: string, importance = 0): PreformedPanel {
  return { id, panellistIds: [], traineeIds: [], importance };
}

export function panelMemberIds(panel: PreformedPanel): string[] {
  return [panel.chairId, ...panel.panellistIds, ...panel.traineeIds].filter((id): id is string => Boolean(id));
}

function withoutAdjudicator(panel: PreformedPanel, adjudicatorId: string): PreformedPanel {
  return {
    ...panel,
    chairId: panel.chairId === adjudicatorId ? undefined : panel.chairId,
    panellistIds: panel.panellistIds.filter((id) => id !== adjudicatorId),
    traineeIds: panel.traineeIds.filter((id) => id !== adjudicatorId),
  };
}

/** Removes an adjudicator from every panel. */
export function removeFromPanels(panels: PreformedPanel[], adjudicatorId: string): PreformedPanel[] {
  return panels.map((panel) => withoutAdjudicator(panel, adjudicatorId));
}

/**
 * Seats an adjudicator in one panel and role, removing them from wherever they were.
 * A displaced chair becomes a panellist of the same panel.
 */
export function assignToPanel(
  panels: PreformedPanel[],
  panelId: string,
  adjudicatorId: string,
  role: PanelRole
): PreformedPanel[] {
  return removeFromPanels(panels, adjudicatorId).map((panel) => {
    if (panel.id !== panelId) return panel;
    if (role === "chair") {
      return {
        ...panel,
        chairId: adjudicatorId,
        panellistIds: panel.chairId ? [...panel.panellistIds, panel.chairId] : panel.panellistIds,
      };
    }
    if (role === "panellist") return { ...panel, panellistIds: [...panel.panellistIds, adjudicatorId] };
    return { ...panel, traineeIds: [...panel.traineeIds, adjudicatorId] };
  });
}

/**
 * Builds panels from the CSV preformed_panel_id groups. The strongest non-trainee in a
 * group chairs; trainees stay trainees. Groups are ordered by their id.
 */
export function panelsFromPreformedIds(adjudicators: Adjudicator[]): PreformedPanel[] {
  const groups = new Map<string, Adjudicator[]>();
  for (const adjudicator of adjudicators) {
    const groupId = adjudicator.preformedPanelId?.trim();
    if (!groupId) continue;
    groups.set(groupId, [...(groups.get(groupId) ?? []), adjudicator]);
  }
  return [...groups.keys()].sort((a, b) => a.localeCompare(b)).map((groupId) => {
    const members = groups.get(groupId)!;
    const voters = members
      .filter((member) => !member.trainee)
      .sort((a, b) => b.baseScore - a.baseScore || a.name.localeCompare(b.name));
    return {
      id: `csv-${groupId}`,
      chairId: voters[0]?.id,
      panellistIds: voters.slice(1).map((member) => member.id),
      traineeIds: members.filter((member) => member.trainee).map((member) => member.id),
      importance: 0,
    };
  });
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

function bitLength(value: number): number {
  return value <= 0 ? 0 : Math.floor(Math.log2(value)) + 1;
}

/**
 * Teams expected in an elimination round of a break of `breakSize`, after `earlierRounds`
 * elimination rounds of the same category (Tabbycat adjallocation/preformed/anticipated.py): a
 * two-team partial break first debates its partial round (2 × (break − half the next power of
 * two)); later rounds, and BP, halve from the largest power of two in the break. A partial
 * elimination (two-team break not a power of two, BP 6 × 2^n) counts from its second round.
 */
export function anticipatedEliminationTeamCount(breakSize: number, earlierRounds: number, teamsPerDebate: number): number {
  if (breakSize <= 1) return 0;
  const partialTwoTeam = teamsPerDebate === 2 && !isPowerOfTwo(breakSize);
  const partialBp = teamsPerDebate === 4 && isPowerOfTwo(Math.floor(breakSize / 6));
  let previous = earlierRounds;
  if (previous > 0 && (partialTwoTeam || partialBp)) previous -= 1;
  if (previous === 0 && teamsPerDebate === 2) {
    const secondRoundTeams = 2 ** bitLength(breakSize - 1) / 2;
    return (breakSize - secondRoundTeams) * 2;
  }
  const shift = bitLength(breakSize) - 1 - previous;
  return shift < 0 ? 0 : 2 ** shift;
}

export interface AnticipationSource {
  tournament: Tournament;
  rounds: Round[];
  teams: Team[];
  debates: Debate[];
  ballots: BallotSubmission[];
  breakCategories: BreakCategory[];
}

export interface Anticipation {
  rooms: AnticipatedRoom[];
  thresholds: LiveThresholds | null;
  /** Why the rooms carry no bracket range (first round, no previous draw, elimination round). */
  notice?: string;
}

/**
 * The anticipated draw for `round` from the previous preliminary round's draw and the points teams
 * had before it (confirmed ballots only). Swing teams are not counted for the team total.
 */
export function anticipateRound(round: Round, source: AnticipationSource): Anticipation {
  const teamsPerDebate = teamsInDebateFor(source.tournament);
  const live = source.rounds.filter((item) => !item.cancelled);
  const prelims = live.filter((item) => item.stage === "preliminary");
  const open = source.breakCategories.find((category) => category.isGeneral);
  const regularTeams = source.teams.filter((team) => !team.isSwing);
  const thresholds =
    round.stage === "preliminary" && open
      ? openLiveThresholds({
          // Tabbycat's liveness is BP's for four teams and the two-team one otherwise.
          teamsPerDebate: teamsPerDebate === 4 ? 4 : 2,
          roundSeq: round.seq,
          breakSize: open.breakSize,
          totalTeams: regularTeams.length,
          totalPrelimRounds: prelims.length,
        })
      : null;

  if (round.stage === "elimination") {
    const category = source.breakCategories.find((item) => round.breakCategoryIds?.includes(item.id)) ?? open;
    const earlierEliminationRounds = category
      ? live.filter(
          (item) => item.stage === "elimination" && item.seq < round.seq && item.breakCategoryIds?.includes(category.id)
        ).length
      : 0;
    return {
      rooms: calculateAnticipatedDraw({
        teamsPerDebate,
        pointsBefore: new Map(),
        teamCount: category
          ? anticipatedEliminationTeamCount(category.breakSize, earlierEliminationRounds, teamsPerDebate)
          : regularTeams.length,
      }),
      thresholds: null,
      notice: "Elimination round: every room is equally live, so panels are not annotated with brackets.",
    };
  }
  const previous = prelims.filter((item) => item.seq < round.seq).sort((a, b) => b.seq - a.seq)[0];
  const previousDebates = previous
    ? source.debates
        .filter((debate) => debate.roundId === previous.id && !debate.byeTeamId && !debate.postponed)
        .sort((a, b) => a.roomRank - b.roomRank)
    : [];
  if (!previous || previousDebates.length === 0) {
    return {
      rooms: calculateAnticipatedDraw({ teamsPerDebate, pointsBefore: new Map(), teamCount: regularTeams.length }),
      thresholds,
      notice: previous
        ? "The previous round has no draw yet, so panels are not annotated with brackets and liveness."
        : "This is the first round, so panels are not annotated with brackets and liveness.",
    };
  }

  const earlierIds = new Set(prelims.filter((item) => item.seq < previous.seq).map((item) => item.id));
  const standings = calculateStandings(
    source.tournament,
    source.rounds.filter((item) => earlierIds.has(item.id)),
    source.teams,
    source.debates.filter((debate) => earlierIds.has(debate.roundId)),
    source.ballots
  );
  const pointsBefore = new Map(standings.teams.map((row) => [row.teamId, row.points]));
  return {
    rooms: calculateAnticipatedDraw({
      teamsPerDebate,
      previousDebates: previousDebates.map((debate) => Object.values(debate.teams).map((slot) => slot.teamId)),
      // Tabbycat: points available in the previous round are multiples of its weight.
      previousRoundWeight: previous.weight ?? 1,
      pointsBefore,
      teamCount: regularTeams.length,
      thresholds,
    }),
    thresholds,
  };
}

/**
 * Tabbycat "create preformed panels": one panel per anticipated room. A panel that already has the
 * room's rank keeps its members and importance and gets the new bracket range and liveness; other
 * rooms get a new empty panel. Panels without a room rank are kept as they are.
 */
export function panelsFromAnticipatedDraw(
  existing: PreformedPanel[],
  rooms: AnticipatedRoom[],
  newId: () => string
): PreformedPanel[] {
  const byRank = new Map(
    existing.filter((panel) => panel.roomRank !== undefined).map((panel) => [panel.roomRank!, panel])
  );
  const annotated = rooms.map((room) => ({
    ...(byRank.get(room.roomRank) ?? emptyPreformedPanel(newId())),
    roomRank: room.roomRank,
    bracketMin: room.bracketMin,
    bracketMax: room.bracketMax,
    liveness: room.liveness,
  }));
  const roomRanks = new Set(rooms.map((room) => room.roomRank));
  const kept = existing.filter((panel) => panel.roomRank === undefined || !roomRanks.has(panel.roomRank));
  return [...annotated, ...kept];
}

/**
 * Tabbycat's automatic panel importance. "bracket": by the middle of each panel's bracket range in
 * four levels. "liveness": panels with a possibly live team get 10 (Tabbycat 1), panels whose lowest
 * bracket is already safe 7 (Tabbycat 0), the rest 0 (Tabbycat -2), as importanceByBracket maps levels.
 */
export function prioritisePanels(
  panels: PreformedPanel[],
  method: "bracket" | "liveness",
  thresholds?: LiveThresholds | null
): PreformedPanel[] {
  if (method === "bracket") {
    const levels = importanceByBracket(panels, (panel) => ((panel.bracketMin ?? 0) + (panel.bracketMax ?? 0)) / 2);
    return panels.map((panel) => ({ ...panel, importance: levels.get(panel) ?? panel.importance }));
  }
  if (!thresholds) throw new Error("Panel liveness needs an open break category with a break size.");
  return panels.map((panel) => ({
    ...panel,
    importance: (panel.liveness ?? 0) > 0 ? 10 : (panel.bracketMin ?? 0) >= thresholds.safe ? 7 : 0,
  }));
}

/** Problems that would make a set of panels unusable; empty when they can be saved. */
export function validatePreformedPanels(
  panels: PreformedPanel[],
  adjudicators: Array<Pick<Adjudicator, "id" | "name" | "trainee">>
): string[] {
  const errors: string[] = [];
  const byId = new Map(adjudicators.map((adjudicator) => [adjudicator.id, adjudicator]));
  const seenIn = new Map<string, number>();
  const ids = new Set<string>();

  panels.forEach((panel, index) => {
    const label = `Panel ${index + 1}`;
    if (ids.has(panel.id)) errors.push(`${label} has a duplicate id.`);
    ids.add(panel.id);
    if (!Number.isFinite(panel.importance) || panel.importance < 0 || panel.importance > 10) {
      errors.push(`${label}: importance must be between 0 and 10.`);
    }
    // An empty panel (e.g. one room of an anticipated draw not filled yet) is allowed; allocation skips it.
    if (!panel.chairId && panelMemberIds(panel).length > 0) errors.push(`${label} needs a chair.`);
    for (const id of panelMemberIds(panel)) {
      const adjudicator = byId.get(id);
      if (!adjudicator) {
        errors.push(`${label} includes an adjudicator who no longer exists.`);
        continue;
      }
      const earlier = seenIn.get(id);
      if (earlier !== undefined) {
        errors.push(`${adjudicator.name} is in Panel ${earlier + 1} and ${label}.`);
      } else {
        seenIn.set(id, index);
      }
    }
    for (const id of [panel.chairId, ...panel.panellistIds]) {
      const adjudicator = id ? byId.get(id) : undefined;
      if (adjudicator?.trainee) errors.push(`${label}: ${adjudicator.name} is a trainee and cannot vote.`);
    }
  });
  return errors;
}

export interface PreformedPanelDependencies {
  rounds: Round[];
  adjudicators: Adjudicator[];
  updateRound(round: Round): Promise<void>;
  recordAuditEvent(event: {
    action: string;
    category: AuditCategory;
    summary: string;
    roundId?: string;
    details?: Record<string, unknown>;
  }): Promise<void>;
}

/** Validates and stores a round's preformed panels. Throws with every problem when invalid. */
export async function savePreformedPanelsCommand(
  roundId: string,
  panels: PreformedPanel[],
  dependencies: PreformedPanelDependencies
): Promise<void> {
  const round = dependencies.rounds.find((item) => item.id === roundId);
  if (!round) throw new Error("That round no longer exists.");
  const errors = validatePreformedPanels(panels, dependencies.adjudicators);
  if (errors.length > 0) throw new Error(errors.join(" "));

  await dependencies.updateRound({ ...round, preformedPanels: panels });
  await dependencies.recordAuditEvent({
    action: "adjudicators.preformed_panels_saved",
    category: "allocation",
    summary: `Saved ${panels.length} preformed panel(s) for ${round.name}`,
    roundId,
    details: { panels },
  });
}

/**
 * Which of Tabbycat's allocators fills panels: the Tabbycat strategy chosen for the tournament, or
 * (for CrabbyTab's own strategies) the one Tabbycat picks from the ballots: voting when there is
 * one ballot per adjudicator, else consensus.
 */
export function panelFillMode(round: Round, tournament: Tournament): TabbycatHungarianMode {
  const strategy = tournament.preferences?.adjudicatorPanelStrategy;
  if (strategy === "tabbycat_voting") return "voting";
  if (strategy === "tabbycat_consensus") return "consensus";
  return ballotModeFor(round, tournament) === "voting" ? "voting" : "consensus";
}

/**
 * Tabbycat's "auto-allocate adjudicators to preformed panels" for `round`: returns the panels with
 * their members replaced (not saved: the panel page saves after review) and Tabbycat's warnings.
 * Adjudicators already used by a concurrent round are not available. Throws
 * AdjudicatorAllocationError when there is nothing to fill or nobody to fill it with.
 */
export function autoFillPreformedPanels(
  round: Round,
  panels: PreformedPanel[],
  source: {
    tournament: Tournament;
    rounds: Round[];
    debates: Debate[];
    adjudicators: Adjudicator[];
    feedback: FeedbackSubmission[];
  }
): PreformedPanelFillResult {
  const booked = concurrentBookings(round, source.rounds, source.debates);
  const earlier = new Set(
    source.rounds.filter((item) => !item.cancelled && isEarlierScheduleSlot(item, round)).map((item) => item.id)
  );
  return allocateAdjudicatorsToPreformedPanels(
    panels,
    source.adjudicators.filter((adjudicator) => !booked.has(`adjudicator:${adjudicator.id}`)),
    {
      mode: panelFillMode(round, source.tournament),
      roundId: round.id,
      preferences: source.tournament.preferences,
      feedbackScores: calculateScaledFeedbackScores(source.feedback, source.debates, source.tournament.preferences),
      feedbackWeight: round.feedbackWeight,
      pastDebates: source.debates.filter((debate) => earlier.has(debate.roundId)),
    }
  );
}

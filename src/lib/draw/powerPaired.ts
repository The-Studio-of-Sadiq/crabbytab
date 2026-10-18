import { Team, TeamStandingRow, DebateSide, BPPullupDistribution, BPPositionCost, BPAssignmentMethod } from "@/types";
import { solveHungarian } from "./hungarian";
import { MatchupHistory } from "./history";
import { Rng, shuffle } from "./rng";
import { BP_SIDES, computeBPSideCost, describeSideLimits, violatesSideLimits } from "./sideAllocator";

export type { MatchupHistory };

export interface PairedDebateDraft {
  bracket: number;
  teams: Team[];
  teamsWithSides: Record<DebateSide, Team>;
  /** Teams in this room with fewer points/wins than the room's best team. */
  pulledUpTeamIds?: string[];
}

export interface BPDrawOptions {
  /** Penalty × the team's previous pull-ups, added when it is placed above its points bracket (Tabbycat's pullup_penalty). */
  pullupPenalty?: number;
  bpPullupDistribution?: BPPullupDistribution;
  bpPositionCost?: BPPositionCost;
  renyiOrder?: number;
  bpPositionCostExponent?: number;
  bpAssignmentMethod?: BPAssignmentMethod;
  /** "random" sides assign positions at random within the bracket constraints. */
  sideRule?: "balanced" | "random";
  maxTimesPerSide?: number;
  maxAllowedSideImbalance?: number;
}

/** One BP room: the bracket it belongs to and the point values allowed in it. */
export interface BPRoomSpec {
  level: number;
  allowed: Set<number>;
}

/**
 * Tabbycat's _define_rooms_anywhere: walk the point values from the top,
 * completing each bracket with just enough teams from the brackets below to
 * make a multiple of four. Pulled-up teams may land in any room of the
 * bracket they are pulled into. If a whole lower bracket is needed it merges.
 */
function defineBrackets(points: number[]): { level: number; counts: Map<number, number> }[] {
  const counts = new Map<number, number>();
  points.forEach((p) => counts.set(p, (counts.get(p) ?? 0) + 1));
  const brackets: { level: number; counts: Map<number, number> }[] = [];

  let current = new Map<number, number>();
  let level: number | null = null;
  let size = 0;
  let pullupsNeeded = 0;
  for (const p of [...counts.keys()].sort((a, b) => b - a)) {
    let available = counts.get(p)!;
    if (pullupsNeeded < available) {
      if (pullupsNeeded > 0) {
        current.set(p, pullupsNeeded);
        available -= pullupsNeeded;
        size += pullupsNeeded;
      }
      if (size > 0) brackets.push({ level: level!, counts: current });
      current = new Map();
      level = null;
      size = 0;
    }
    if (available > 0) {
      current.set(p, (current.get(p) ?? 0) + available);
      if (level === null) level = p;
    }
    size += available;
    pullupsNeeded = (4 - (size % 4)) % 4;
  }
  if (size > 0) brackets.push({ level: level!, counts: current });
  return brackets;
}

/**
 * Lists the rooms of a BP power-paired draw, highest bracket first.
 *
 * - anywhere (WUDC): every room in a bracket accepts every point value in it.
 * - top / bottom: the teams from below a bracket's own points are confined to
 *   its top (or bottom) ceil(k/4) rooms, k being how many there are; the other
 *   rooms take only the bracket's own teams. "bottom" is Tabbycat's one_room
 *   option for a single bracket boundary.
 */
export function defineBPRooms(points: number[], distribution: BPPullupDistribution = "anywhere"): BPRoomSpec[] {
  const rooms: BPRoomSpec[] = [];
  for (const { level, counts } of defineBrackets(points)) {
    const size = [...counts.values()].reduce((sum, c) => sum + c, 0);
    const roomCount = size / 4;
    const all = new Set(counts.keys());
    if (distribution === "anywhere") {
      for (let r = 0; r < roomCount; r++) rooms.push({ level, allowed: all });
      continue;
    }
    const fromBelow = size - (counts.get(level) ?? 0);
    const mixedRooms = Math.ceil(fromBelow / 4);
    for (let r = 0; r < roomCount; r++) {
      const mixed = distribution === "top" ? r < mixedRooms : r >= roomCount - mixedRooms;
      rooms.push({ level, allowed: mixed ? all : new Set([level]) });
    }
  }
  return rooms;
}

/**
 * BP power-paired draw (Tabbycat's BPHungarianDrawGenerator): one assignment
 * of every team to a (room, position) slot, solved with the Hungarian
 * algorithm. A team may only go into rooms whose bracket allows its points
 * (see defineBPRooms); within that, each slot costs the team's position cost
 * for that position raised to the exponent, plus pullupPenalty × prior
 * pull-ups when the room's bracket is above the team's points.
 *
 * The cost matrix is pre-shuffled with `rng` (Tabbycat's
 * "hungarian_preshuffled", the WUDC-compliant option), so equal-cost
 * alternatives are chosen at random but reproducibly for a given seed.
 * `bpAssignmentMethod: "random"` (or random sides) drops the position cost and
 * places teams at random within their brackets.
 *
 * Side limits (maxTimesPerSide, maxAllowedSideImbalance) are hard: a slot that
 * would break one is forbidden, and the draw fails with an error if every
 * assignment breaks one. Unlike the two-team draw, the BP draw ignores
 * history and institution clashes, as Tabbycat and the WUDC rules do.
 */
export function generatePowerPairedDraw(
  teams: Team[],
  standings: TeamStandingRow[],
  history: MatchupHistory,
  options: BPDrawOptions = {},
  rng: Rng = Math.random
): PairedDebateDraft[] {
  if (teams.length === 0 || teams.length % 4 !== 0) {
    throw new Error(`Number of teams (${teams.length}) must be a non-zero multiple of 4 for BP format.`);
  }

  const standingMap = new Map(standings.map((s) => [s.teamId, s]));
  const pointsOf = (team: Team) => standingMap.get(team.id)?.points ?? 0;
  const priorPullups = (team: Team) =>
    history.pullups?.get(team.id) ?? standingMap.get(team.id)?.metrics?.pullups ?? 0;

  const rooms = defineBPRooms(teams.map(pointsOf), options.bpPullupDistribution ?? "anywhere");
  const randomPositions = options.sideRule === "random" || options.bpAssignmentMethod === "random";
  const pullupPenalty = options.pullupPenalty ?? 0;

  const allowed: boolean[][] = [];
  const finite: number[][] = teams.map((team) => {
    const sides = history.sides.get(team.id) ?? [];
    const points = pointsOf(team);
    const allowedRow: boolean[] = [];
    const row: number[] = [];
    for (const room of rooms) {
      for (const side of BP_SIDES) {
        const ok = room.allowed.has(points) && !violatesSideLimits(sides, side, BP_SIDES, options);
        allowedRow.push(ok);
        if (!ok) {
          row.push(0);
          continue;
        }
        const position = randomPositions ? 0 : computeBPSideCost(sides, side, options);
        const pullup = points < room.level ? priorPullups(team) * pullupPenalty : 0;
        row.push(position + pullup);
      }
    }
    allowed.push(allowedRow);
    return row;
  });

  // Larger than any sum of allowed costs, so a disallowed slot is only used when unavoidable.
  const disallowed = finite.reduce((sum, row) => sum + Math.max(0, ...row), 0) + 1;
  const n = teams.length;
  const rowOrder = shuffle([...Array(n).keys()], rng);
  const colOrder = shuffle([...Array(n).keys()], rng);
  const matrix = rowOrder.map((i) => colOrder.map((j) => (allowed[i][j] ? finite[i][j] : disallowed)));
  const solution = solveHungarian(matrix);

  const slots: (Team | undefined)[] = new Array(n);
  solution.forEach((col, row) => {
    const teamIndex = rowOrder[row];
    const slot = colOrder[col];
    if (!allowed[teamIndex][slot]) {
      throw new Error(
        `No BP draw keeps every team within the configured side limits (${describeSideLimits(options)}). Raise or clear these limits, or draw this round manually.`
      );
    }
    slots[slot] = teams[teamIndex];
  });

  return rooms.map((room, r) => {
    const teamsWithSides = {} as Record<DebateSide, Team>;
    BP_SIDES.forEach((side, s) => {
      teamsWithSides[side] = slots[r * 4 + s]!;
    });
    const roomTeams = BP_SIDES.map((side) => teamsWithSides[side]);
    const top = Math.max(...roomTeams.map(pointsOf));
    return {
      bracket: room.level,
      teams: roomTeams,
      teamsWithSides,
      pulledUpTeamIds: roomTeams.filter((team) => pointsOf(team) < top).map((team) => team.id),
    };
  });
}

/**
 * Anticipated draw for preformed panels (Tabbycat `adjallocation/preformed/anticipated.py`) and
 * the open-category live thresholds it needs (Tabbycat `breakqual/liveness.py`, general category).
 *
 * Before a round is drawn, the tab room forms panels for the rooms it expects: each room's
 * minimum and maximum possible bracket and how many teams in it may still be live for the open
 * break. Rooms are computed from the previous round's draw: every team's points before that
 * round plus every possible result of it, sorted and cut into rooms.
 */

export interface AnticipatedRoom {
  /** 1-based, highest room first. */
  roomRank: number;
  bracketMin: number;
  bracketMax: number;
  /** Teams in the room that may still be live for the open break. */
  liveness: number;
}

export interface LiveThresholds {
  /** A team on at least this many points is safe. */
  safe: number;
  /** A team on at most this many points is dead. */
  dead: number;
}

function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return Math.round(result);
}

function accumulate(values: number[]): number[] {
  let total = 0;
  return values.map((value) => (total += value));
}

/** Row `rounds` of the quadrinomial-coefficient triangle (OEIS A008287). */
export function bpCoefficients(rounds: number): number[] {
  const coefficient = (m: number, k: number) => {
    let sum = 0;
    for (let i = 0; i <= Math.floor(k / 2); i++) sum += comb(m, i) * comb(m, k - 2 * i);
    return sum;
  };
  const half = Array.from({ length: Math.ceil((3 * rounds + 1) / 2) }, (_, k) => coefficient(rounds, k));
  if (rounds === 0) return half;
  return rounds % 2 === 1 ? [...half, ...[...half].reverse()] : [...half, ...half.slice(0, -1).reverse()];
}

/**
 * Open-category live thresholds before round `roundSeq` (Tabbycat liveness_twoteam / liveness_bp
 * with is_general). Null when the break size or team count makes them meaningless.
 */
export function openLiveThresholds(input: {
  teamsPerDebate: 2 | 4;
  roundSeq: number;
  breakSize: number;
  totalTeams: number;
  totalPrelimRounds: number;
}): LiveThresholds | null {
  const { teamsPerDebate, roundSeq, breakSize, totalTeams, totalPrelimRounds: rounds } = input;
  if (breakSize <= 1 || totalTeams === 0) return null;
  if (totalTeams < breakSize) return teamsPerDebate === 4 ? { safe: -1, dead: -1 } : { safe: 0, dead: -1 };

  const coefficients =
    teamsPerDebate === 4 ? bpCoefficients(rounds) : Array.from({ length: rounds + 1 }, (_, i) => comb(rounds, i));
  const denominator = teamsPerDebate === 4 ? 4 ** rounds : 2 ** rounds;
  const originals = coefficients.map((coefficient) => (totalTeams / denominator) * coefficient);
  const sumUp = accumulate(originals.map(Math.ceil));
  const sumDown = accumulate(originals.map(Math.floor));
  const maxPoints = teamsPerDebate === 4 ? rounds * 3 : rounds;
  const pointsToGo = (rounds - roundSeq + 1) * (teamsPerDebate === 4 ? 3 : 1);
  const firstAbove = (sums: number[]) => {
    const index = sums.findIndex((value) => value > breakSize);
    return index < 0 ? maxPoints + 1 : index;
  };
  const safe = maxPoints - (firstAbove(sumUp) - 1);
  const highestNonBreaking = maxPoints - firstAbove(sumDown);
  return { safe, dead: highestNonBreaking - pointsToGo - 1 };
}

export function isLive(thresholds: LiveThresholds, points: number): boolean {
  return points < thresholds.safe && points > thresholds.dead;
}

/** Every ordering of `values` (rooms have at most four teams). */
function permutations(values: number[]): number[][] {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((rest) => [value, ...rest])
  );
}

export interface AnticipatedDrawInput {
  /** Teams per room (Tabbycat nteamsindebate): 2, 4, or any count of the poly format. */
  teamsPerDebate: number;
  /**
   * The previous round's debates (team ids per room, in room order). Absent or empty when this is
   * the first round, the previous round has no draw yet, or this is an elimination round.
   */
  previousDebates?: string[][];
  /** Points each team had before the previous round (missing teams count 0). */
  pointsBefore: Map<string, number>;
  /** Number of teams expected in the round when there is no previous draw. */
  teamCount: number;
  /** Points multiplier of the previous round (Tabbycat round weight). Defaults to 1. */
  previousRoundWeight?: number;
  thresholds?: LiveThresholds | null;
}

export function calculateAnticipatedDraw(input: AnticipatedDrawInput): AnticipatedRoom[] {
  const size = input.teamsPerDebate;
  const previous = (input.previousDebates ?? []).filter((teams) => teams.length > 0);
  // Tabbycat brute-forces every finishing order of a mixed room; past 8 teams per room (40,320
  // orders) that is too slow for the browser, so such rooms get no bracket range, as a first round.
  if (previous.length === 0 || size > 8) {
    return Array.from({ length: Math.floor(input.teamCount / size) }, (_, index) => ({
      roomRank: index + 1,
      bracketMin: 0,
      bracketMax: 0,
      liveness: 0,
    }));
  }

  const weight = input.previousRoundWeight ?? 1;
  const available = Array.from({ length: size }, (_, i) => weight * i);
  const lowers: number[] = [];
  const uppers: number[] = [];
  for (const teams of previous) {
    const now = teams.map((teamId) => input.pointsBefore.get(teamId) ?? 0);
    const highest = Math.max(...now);
    const lowest = Math.min(...now);
    if (highest - lowest <= 1) {
      // Single-bracket rooms (or one pull-up level): the closed form Tabbycat proves.
      for (const points of available) {
        lowers.push(lowest + points);
        uppers.push(highest + points);
      }
    } else {
      const outcomes = permutations(available).map((result) =>
        now.map((points, index) => points + result[index]).sort((a, b) => b - a)
      );
      for (let position = 0; position < now.length; position++) {
        const column = outcomes.map((outcome) => outcome[position]);
        lowers.push(Math.min(...column));
        uppers.push(Math.max(...column));
      }
    }
  }

  const descending = (values: number[]) => [...values].sort((a, b) => b - a);
  const sortedLowers = descending(lowers);
  const sortedUppers = descending(uppers);
  const rooms = Math.floor(sortedLowers.length / size);
  return Array.from({ length: rooms }, (_, room) => {
    const slice = (values: number[]) => values.slice(room * size, (room + 1) * size);
    const lowerSlice = slice(sortedLowers);
    const upperSlice = slice(sortedUppers);
    const thresholds = input.thresholds;
    const liveness = thresholds
      ? lowerSlice.filter((points, index) => isLive(thresholds, points) || isLive(thresholds, upperSlice[index])).length
      : 0;
    return {
      roomRank: room + 1,
      bracketMin: Math.max(...lowerSlice),
      bracketMax: Math.max(...upperSlice),
      liveness,
    };
  });
}

/**
 * Tabbycat's "prioritise by bracket" for preformed panels: rooms sorted by bracket are split into
 * four importance levels (here 10, 7, 3, 0 on CrabbyTab's 0-10 scale, for Tabbycat's 1, 0, -1, -2);
 * rooms on the same bracket share a level.
 */
/** Python's round(): halves go to the even neighbour. */
function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction !== 0.5) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
}

export function importanceByBracket<T>(items: T[], bracketOf: (item: T) => number): Map<T, number> {
  const levels = [10, 7, 3, 0];
  const sorted = [...items].sort((a, b) => bracketOf(b) - bracketOf(a));
  const result = new Map<T, number>();
  const quarter = items.length / 4;
  let level = 0;
  let boundary = roundHalfEven(quarter);
  let placed = 0;
  let index = 0;
  while (index < sorted.length) {
    const bracket = bracketOf(sorted[index]);
    while (index < sorted.length && bracketOf(sorted[index]) === bracket) {
      result.set(sorted[index], levels[Math.min(level, levels.length - 1)]);
      index++;
      placed++;
    }
    if (placed >= boundary) {
      level++;
      boundary = roundHalfEven((level + 1) * quarter);
    }
  }
  return result;
}

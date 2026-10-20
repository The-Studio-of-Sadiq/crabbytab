import { Team, DebateSide, Round } from "@/types";
import { allocateSidesForDebate, BP_SIDES, describeSideLimits, SideAllocationOptions, violatesSideLimits } from "./sideAllocator";
import { Rng } from "./rng";

/**
 * Whether a two-team round-robin cycle was begun with the legacy rotation: an earlier preliminary
 * round-robin round has a draw but no `roundRobinAlgorithm` marker. Its later rounds must keep that
 * rotation, because switching schedules mid-cycle can repeat pairings.
 */
export function legacyRoundRobinInProgress(
  round: Pick<Round, "id">,
  earlierRounds: Pick<Round, "id" | "stage" | "drawType" | "drawStatus" | "cancelled" | "roundRobinAlgorithm">[],
  drawnRoundIds: ReadonlySet<string>
): boolean {
  return earlierRounds.some((item) =>
    item.id !== round.id &&
    !item.cancelled &&
    item.stage === "preliminary" &&
    item.drawType === "round_robin" &&
    (item.drawStatus !== "none" || drawnRoundIds.has(item.id)) &&
    item.roundRobinAlgorithm === undefined
  );
}

/**
 * CrabbyTab's rotation before the Berger/seed schedule: the circle method over the teams in the
 * order given (stored order), the first fixed and the rest rotated clockwise by index − 1, room i
 * pairing position i with position n − 1 − i. Kept only for cycles already begun with it; an index
 * past N − 1 is still an error rather than a wrap.
 */
export function legacyRotationPairings(teams: Team[], rrseq: number): [Team, Team][] {
  const n = teams.length;
  if (n < 2 || n % 2 !== 0) {
    throw new Error(`Round-robin requires an even number of teams (at least 2) with no byes in the draw, got ${n}.`);
  }
  if (!Number.isInteger(rrseq) || rrseq < 1 || rrseq > n - 1) {
    throw new Error(
      `This round's position in the round-robin schedule (${rrseq}) is not valid for ${n} teams (expected between 1 and ${n - 1}). A full round robin of ${n} teams has ${n - 1} rounds.`
    );
  }
  const rotating = teams.slice(1);
  const offset = rrseq - 1;
  const order = [teams[0], ...rotating.map((_, i) => rotating[(i - offset + rotating.length) % rotating.length])];
  return Array.from({ length: n / 2 }, (_, i) => [order[i], order[n - 1 - i]] as [Team, Team]);
}

export interface RoundRobinMatchup {
  bracket: number;
  teamsWithSides: Record<DebateSide, Team>;
}

function hasSeed(team: Team): boolean {
  return typeof team.seed === "number" && Number.isFinite(team.seed);
}

function listNames(teams: Team[]): string {
  return `${teams.slice(0, 5).map((team) => team.name).join(", ")}${teams.length > 5 ? ", ..." : ""}`;
}

/**
 * Orders teams for a round-robin schedule as Tabbycat's RoundRobinDrawManager: by seed ascending
 * (seed 1 first), equal seeds by team id. Every team needs a seed, so the schedule does not depend
 * on the order teams happen to be stored in.
 */
export function orderForRoundRobin(teams: Team[]): Team[] {
  const unseeded = teams.filter((team) => !hasSeed(team));
  if (unseeded.length > 0) {
    throw new Error(
      `Every team must have a seed for round-robin draws. Assign seeds before generating the draw. Missing: ${listNames(unseeded)}.`
    );
  }
  return [...teams].sort((a, b) => (a.seed as number) - (b.seed as number) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Tabbycat's berger_pairings_for_round: one round of the Berger (circle) schedule. `teams` is
 * the seed-ordered field; `rrseq` is the 1-based round index (1..N-1). The first team stays
 * fixed and the rest rotate by rrseq-1; an index outside 1..N-1 is an error, never wrapped.
 */
export function bergerPairings(teams: Team[], rrseq: number): [Team, Team][] {
  const n = teams.length;
  if (n < 2 || n % 2 !== 0) {
    throw new Error(`Round-robin requires an even number of teams (at least 2) with no byes in the draw, got ${n}.`);
  }
  const maxRound = n - 1;
  if (!Number.isInteger(rrseq) || rrseq < 1 || rrseq > maxRound) {
    throw new Error(
      `This round's position in the round-robin schedule (${rrseq}) is not valid for ${n} teams (expected between 1 and ${maxRound}). A full round robin of ${n} teams has ${maxRound} rounds.`
    );
  }
  const fixed = teams[0];
  const rotating = teams.slice(1);
  const k = rrseq - 1;
  const state = [...rotating.slice(k), ...rotating.slice(0, k)];
  const m = state.length;
  const pairs: [Team, Team][] = [[fixed, state[0]]];
  for (let i = 1; i <= Math.floor(m / 2); i++) {
    pairs.push([state[i], state[m - i]]);
  }
  return pairs;
}

/**
 * Two-team round robin (Tabbycat's TwoTeamRoundRobinDrawGenerator): teams ordered by seed, the
 * Berger round for `roundIndex`, then sides allocated by the side rule. Room ranks follow the
 * schedule order.
 */
export function generateRoundRobinDraw(
  teams: Team[],
  roundIndex: number,
  sideHistories: Map<string, DebateSide[]>,
  format: string,
  sideRule: "balanced" | "random" = "balanced",
  sideOptions?: SideAllocationOptions,
  rng: Rng = Math.random,
  /** Continue a cycle begun with the legacy rotation (see legacyRoundRobinInProgress). */
  legacyRotation = false
): RoundRobinMatchup[] {
  const pairs = legacyRotation ? legacyRotationPairings(teams, roundIndex) : bergerPairings(orderForRoundRobin(teams), roundIndex);
  return pairs.map(([a, b]) => ({
    bracket: 0,
    teamsWithSides: allocateSidesForDebate([a, b], sideHistories, format, sideRule, sideOptions, rng),
  }));
}

/**
 * Tabbycat's curated BP round-robin schedules (draw/generator/data/bp_round_robin.py), keyed by
 * team count. Each round lists its rooms; each room lists four seed numbers in OG, OO, CG, CO order.
 */
export const BP_ROUND_ROBIN_TABLES: Readonly<Record<number, readonly (readonly (readonly number[])[])[]>> = {
  16: [
    [[12, 14, 1, 7], [11, 13, 2, 8], [10, 16, 3, 5], [9, 15, 4, 6]],
    [[8, 10, 15, 1], [7, 9, 16, 2], [6, 12, 13, 3], [5, 11, 14, 4]],
    [[16, 1, 6, 11], [15, 2, 5, 12], [14, 3, 8, 9], [13, 4, 7, 10]],
    [[1, 5, 9, 13], [2, 6, 10, 14], [3, 7, 11, 15], [4, 8, 12, 16]],
    [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]],
  ],
  28: [
    [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20], [21, 22, 23, 24], [25, 26, 27, 28]],
    [[2, 7, 21, 26], [16, 1, 8, 17], [20, 28, 24, 14], [12, 23, 19, 5], [6, 10, 13, 25], [11, 4, 18, 27], [3, 15, 9, 22]],
    [[2, 20, 15, 5], [14, 7, 25, 11], [9, 18, 8, 21], [26, 23, 1, 6], [4, 16, 24, 12], [28, 17, 22, 13], [19, 27, 3, 10]],
    [[18, 14, 6, 2], [7, 12, 22, 20], [24, 5, 27, 1], [10, 28, 15, 8], [23, 9, 4, 13], [25, 19, 21, 16], [17, 3, 11, 26]],
    [[28, 9, 19, 2], [7, 24, 10, 18], [6, 20, 16, 3], [5, 25, 4, 22], [27, 23, 14, 17], [1, 11, 21, 15], [12, 8, 13, 26]],
    [[2, 10, 23, 16], [15, 7, 17, 4], [1, 12, 28, 18], [22, 6, 11, 19], [8, 24, 25, 3], [13, 27, 20, 21], [26, 14, 5, 9]],
    [[27, 8, 2, 22], [19, 13, 1, 7], [23, 25, 18, 15], [9, 17, 11, 24], [16, 6, 5, 28], [3, 21, 12, 14], [10, 20, 26, 4]],
    [[24, 2, 13, 11], [28, 3, 7, 23], [8, 4, 14, 19], [20, 1, 25, 9], [6, 15, 12, 27], [21, 5, 17, 10], [22, 26, 16, 18]],
    [[17, 12, 2, 25], [27, 16, 9, 7], [11, 8, 20, 23], [18, 13, 5, 3], [14, 22, 10, 1], [4, 21, 28, 6], [15, 19, 26, 24]],
  ],
};

/**
 * BP round robin (Tabbycat's BPRoundRobinDrawGenerator): the room list for `roundIndex` from the
 * preset table for this many teams, seats taken from the table. Only the team counts Tabbycat
 * has tables for are supported, and the teams' seeds must be exactly 1..N. Unlike Tabbycat, the
 * side limits (maxTimesPerSide, maxAllowedSideImbalance) stay hard: a table seat that would break
 * one is reported as an error instead of being drawn.
 */
export function generateBPRoundRobinDraw(
  teams: Team[],
  roundIndex: number,
  sideHistories: Map<string, DebateSide[]>,
  sideOptions: Pick<SideAllocationOptions, "maxTimesPerSide" | "maxAllowedSideImbalance"> = {}
): RoundRobinMatchup[] {
  const n = teams.length;
  const tables = BP_ROUND_ROBIN_TABLES[n];
  if (!tables) {
    const supported = Object.keys(BP_ROUND_ROBIN_TABLES).join(", ");
    throw new Error(
      `British Parliamentary round-robin draws are only available for ${supported} teams (this round has ${n}).`
    );
  }
  if (!Number.isInteger(roundIndex) || roundIndex < 1 || roundIndex > tables.length) {
    throw new Error(
      `This round's position in the round-robin schedule (${roundIndex}) is not valid: expected between 1 and ${tables.length} for ${n} teams.`
    );
  }
  const unseeded = teams.filter((team) => !hasSeed(team));
  if (unseeded.length > 0) {
    throw new Error(`Every team must have a seed for round-robin draws. Missing: ${listNames(unseeded)}.`);
  }
  const bySeed = new Map<number, Team>();
  for (const team of teams) {
    const seed = team.seed as number;
    if (!Number.isInteger(seed) || seed < 1 || seed > n || bySeed.has(seed)) {
      throw new Error(`Team seeds must be the whole numbers 1 through ${n}, each used once, for a BP round robin (${team.name} has ${seed}).`);
    }
    bySeed.set(seed, team);
  }

  return tables[roundIndex - 1].map((room) => {
    const teamsWithSides = {} as Record<DebateSide, Team>;
    room.forEach((seed, seat) => {
      const team = bySeed.get(seed)!;
      const side = BP_SIDES[seat];
      if (violatesSideLimits(sideHistories.get(team.id) ?? [], side, BP_SIDES, sideOptions)) {
        throw new Error(
          `The BP round-robin schedule puts ${team.name} in ${side}, which breaks the configured side limits (${describeSideLimits(sideOptions)}). Raise or clear these limits, or draw this round manually.`
        );
      }
      teamsWithSides[side] = team;
    });
    return { bracket: 0, teamsWithSides };
  });
}

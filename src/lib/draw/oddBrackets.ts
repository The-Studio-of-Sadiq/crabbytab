import type { OddBracketMethod, PullupRestriction, Team } from "@/types";
import { Rng, randomInt } from "./rng";

/** A team plus the stats needed to pick who gets pulled up. */
export interface RankedTeamStats {
  team: Team;
  /** Number of past rounds in which this team was pulled up. */
  pullups: number;
  drawStrengthWins: number;
  drawStrengthSpeaks: number;
}

/** Teams sharing a win count, best-ranked first. */
export interface WinBracket {
  wins: number;
  teams: RankedTeamStats[];
}

export interface ResolvedGroup {
  /** Bracket label. Intermediate brackets sit between two win counts (e.g. 1.5). */
  bracket: number;
  /** Best-ranked first; teams moved up from lower brackets follow the bracket's own teams. */
  teams: Team[];
  /** Ids of teams moved here from a lower bracket. */
  pulledUp: string[];
  /**
   * Tabbycat's per-team draw flags set while resolving odd brackets (bub_up_hist, bub_up_inst,
   * bub_up_accom, bub_dn_*, no_bub_updn), by team id.
   */
  teamFlags?: Record<string, string[]>;
}

/**
 * Whether two teams should not meet. A truthy result is a clash: "hist" for a history clash,
 * "inst" (or true) for an institution clash; Tabbycat checks the institution first.
 */
export type ConflictCheck = (a: Team, b: Team) => boolean | "inst" | "hist";

/**
 * Narrows a lower bracket's candidates before the pull-up position is chosen,
 * as Tabbycat's pullup_restriction: keep only the teams with the fewest
 * pull-ups so far, or the lowest draw strength by wins or by speaks.
 */
export function applyPullupRestriction(
  candidates: RankedTeamStats[],
  restriction: PullupRestriction
): RankedTeamStats[] {
  if (candidates.length === 0 || restriction === "none") return candidates;

  const key: (t: RankedTeamStats) => number =
    restriction === "least_pulled"
      ? (t) => t.pullups
      : restriction === "lowest_draw_strength_speaks"
        ? (t) => t.drawStrengthSpeaks
        : (t) => t.drawStrengthWins;

  const min = Math.min(...candidates.map(key));
  return candidates.filter((t) => key(t) === min);
}

/** Index of the team to pull up among `x` eligible teams (Tabbycat's _pullup_* position functions). */
function pullupIndex(method: OddBracketMethod, x: number, rng: Rng): number {
  switch (method) {
    case "pullup_bottom":
      return x - 1;
    case "pullup_middle":
      // Odd count: the exact middle. Even count: one of the two middle teams at random.
      return Math.floor(x / 2) - (x % 2 === 0 ? randomInt(rng, 2) : 0);
    case "pullup_random":
      return randomInt(rng, x);
    default:
      return 0;
  }
}

/**
 * Tabbycat refuses intermediate brackets unless the first standings metric is a whole number for
 * every team (powerpair.py: "Intermediate brackets require the first team standings metric to be
 * an integer"). Throws with Tabbycat's message when it is not.
 */
export function assertIntegerBracketsForIntermediate(method: OddBracketMethod, values: number[]): void {
  if (!method.startsWith("intermediate")) return;
  const nonInteger = values.filter((value) => !Number.isInteger(value)).length;
  if (nonInteger > 0) {
    throw new Error(
      `${nonInteger} out of ${values.length} teams have a noninteger first metric in the team standings. ` +
        "Intermediate brackets require the first team standings metric to be an integer (typically points or wins)."
    );
  }
}

/**
 * Turns win-brackets (highest first, each ranked best-first) into evenly-sized
 * groups, following Tabbycat's BasePowerPairedDrawGenerator:
 *
 * - pullup_top/bottom/middle/random: an odd bracket takes one team from the
 *   next bracket down (after `restriction` narrows the candidates). Taking a
 *   team can make that bracket odd in turn; it is resolved when reached.
 * - intermediate: the bottom team of an odd bracket and the top team of the
 *   next bracket down form an intermediate bracket labelled the lower bracket
 *   + 0.5 (Tabbycat `points+0.5`, also when a points level in between is empty).
 * - intermediate_bubble: intermediate, then each intermediate debate with a
 *   conflict tries swapping its higher team with the bottom team of the
 *   bracket labelled half a point above ("bubble up"), else its lower team with
 *   the top team of the bracket half a point below ("bubble down"), accepting a
 *   swap only if the new pairing is conflict-free. Never both, and nothing else
 *   is checked, as in Tabbycat. When the brackets are not consecutive, there is
 *   no bracket half a point above, so only bubbling down is possible (as
 *   Tabbycat). The swaps are flagged on the teams as Tabbycat does
 *   (bub_up_hist/inst, bub_up_accom, bub_dn_*, no_bub_updn).
 *
 * Pull-up restrictions apply only to the pullup_* methods, as in Tabbycat.
 * Throws when the bottom bracket is still odd (only possible with an odd
 * number of teams).
 */
export function resolveOddBrackets(
  brackets: WinBracket[],
  method: OddBracketMethod,
  restriction: PullupRestriction,
  rng: Rng = Math.random,
  conflict: ConflictCheck = () => false
): ResolvedGroup[] {
  if (method === "intermediate1" || method === "intermediate2") {
    throw new Error(
      `The "${method}" odd bracket method only works with preallocated sides. Choose another odd bracket method or switch side allocation to preallocated.`
    );
  }
  const work = brackets
    .filter((bracket) => bracket.teams.length > 0)
    .map((bracket) => ({ key: bracket.wins, teams: [...bracket.teams], pulledUp: [] as string[] }));

  if (method === "intermediate" || method === "intermediate_bubble") {
    return resolveIntermediate(work, method === "intermediate_bubble" ? conflict : null);
  }

  let needsPullup: (typeof work)[number] | null = null;
  for (const bracket of work) {
    if (needsPullup) {
      const eligible = applyPullupRestriction(bracket.teams, restriction);
      const picked = eligible[pullupIndex(method, eligible.length, rng)];
      bracket.teams = bracket.teams.filter((t) => t !== picked);
      needsPullup.teams.push(picked);
      needsPullup.pulledUp.push(picked.team.id);
      needsPullup = null;
    }
    if (bracket.teams.length % 2 !== 0) needsPullup = bracket;
  }
  if (needsPullup) {
    throw new Error(
      `The bottom bracket (${needsPullup.key} wins) has an odd number of teams and there is no bracket below it to pull up from.`
    );
  }
  return work
    .filter((bracket) => bracket.teams.length > 0)
    .map((bracket) => ({ bracket: bracket.key, teams: bracket.teams.map((t) => t.team), pulledUp: bracket.pulledUp }));
}

function resolveIntermediate(
  work: { key: number; teams: RankedTeamStats[] }[],
  conflict: ConflictCheck | null
): ResolvedGroup[] {
  const groups: { key: number; teams: Team[]; intermediate?: boolean }[] = [];
  let oddTeam: { key: number; team: Team } | null = null;
  for (const bracket of work) {
    const teams = bracket.teams.map((t) => t.team);
    if (oddTeam) {
      // Tabbycat labels the intermediate bracket the lower bracket + 0.5.
      groups.push({ key: bracket.key + 0.5, teams: [oddTeam.team, teams.shift()!], intermediate: true });
      oddTeam = null;
    }
    if (teams.length % 2 !== 0) oddTeam = { key: bracket.key, team: teams.pop()! };
    if (teams.length > 0) groups.push({ key: bracket.key, teams });
  }
  if (oddTeam) {
    throw new Error(
      `The bottom bracket (${oddTeam.key} wins) has an odd number of teams and there is no bracket below it to pull up from.`
    );
  }

  const teamFlags: Record<string, string[]> = {};
  const flag = (team: Team, value: string) => {
    (teamFlags[team.id] ??= []).push(value);
  };
  if (conflict) {
    // Tabbycat looks up the brackets labelled half a point above and below the intermediate one.
    const regular = (key: number) => groups.find((group) => !group.intermediate && group.key === key);
    groups.forEach((group) => {
      if (!group.intermediate) return;
      const [higher, lower] = group.teams;
      const clash = conflict(higher, lower);
      if (!clash) return;
      const kind = clash === "hist" ? "hist" : "inst";

      const above = regular(group.key + 0.5);
      if (above) {
        const swap = above.teams[above.teams.length - 1];
        if (!conflict(swap, lower)) {
          flag(higher, `bub_up_${kind}`);
          flag(swap, "bub_up_accom");
          group.teams[0] = swap;
          above.teams[above.teams.length - 1] = higher;
          return;
        }
      }
      const below = regular(group.key - 0.5);
      if (below) {
        const swap = below.teams[0];
        if (!conflict(swap, higher)) {
          flag(lower, `bub_dn_${kind}`);
          flag(swap, "bub_dn_accom");
          group.teams[1] = swap;
          below.teams[0] = lower;
          return;
        }
      }
      flag(higher, "no_bub_updn");
    });
  }

  return groups.map((group) => ({
    bracket: group.key,
    teams: group.teams,
    pulledUp: [],
    ...(group.teams.some((team) => teamFlags[team.id])
      ? { teamFlags: Object.fromEntries(group.teams.filter((team) => teamFlags[team.id]).map((team) => [team.id, teamFlags[team.id]])) }
      : {}),
  }));
}

/** A bracket with preallocated sides: both lists ranked best-first. */
export interface SidedBracket {
  wins: number;
  aff: RankedTeamStats[];
  neg: RankedTeamStats[];
}

export interface SidedGroup {
  bracket: number;
  aff: Team[];
  neg: Team[];
}

/**
 * Odd-bracket resolution when sides are preallocated (Tabbycat's
 * PowerPairedWithAllocatedSidesDrawGenerator): a bracket is "odd" when it has
 * more teams on one side than the other.
 *
 * - pullup_top/bottom/random: the surplus is filled by pulling up teams
 *   allocated to the short side from the next bracket(s) down, taking as many
 *   brackets as needed. pullup_middle is not supported (Tabbycat has none).
 *   Unlike Tabbycat, the pull-up restriction also applies here, falling back
 *   to the whole side list when too few teams satisfy it.
 * - intermediate1: the excess teams start an intermediate bracket just below
 *   their bracket, filled from the top of the short side of the brackets
 *   below; at most one intermediate bracket between two brackets.
 * - intermediate2: like intermediate1, but each lower bracket that
 *   contributes teams forms its own intermediate bracket, so several can sit
 *   between two brackets, each with a single pairing of win counts.
 */
export function resolveOddBracketsWithSides(
  brackets: SidedBracket[],
  method: OddBracketMethod,
  restriction: PullupRestriction,
  rng: Rng = Math.random
): SidedGroup[] {
  switch (method) {
    case "pullup_top":
    case "pullup_bottom":
    case "pullup_random":
      return pullupWithSides(brackets, method, restriction, rng);
    case "intermediate1":
      return intermediateWithSides(brackets, false);
    case "intermediate2":
      return intermediateWithSides(brackets, true);
    default:
      throw new Error(
        `The "${method}" odd bracket method is not available with preallocated sides. Use pull up from top, bottom or at random, or intermediate brackets 1 or 2.`
      );
  }
}

function pullupWithSides(
  brackets: SidedBracket[],
  method: "pullup_top" | "pullup_bottom" | "pullup_random",
  restriction: PullupRestriction,
  rng: Rng
): SidedGroup[] {
  const work = brackets.map((b) => ({ wins: b.wins, aff: [...b.aff], neg: [...b.neg] }));
  let needed: { target: RankedTeamStats[]; side: "aff" | "neg"; count: number }[] = [];

  for (const pool of work) {
    const stillNeeded: typeof needed = [];
    for (const need of needed) {
      const available = pool[need.side];
      let picked: RankedTeamStats[];
      if (available.length < need.count) {
        picked = [...available];
        stillNeeded.push({ ...need, count: need.count - available.length });
      } else {
        const eligible = applyPullupRestriction(available, restriction);
        const candidates = eligible.length >= need.count ? eligible : available;
        if (method === "pullup_top") picked = candidates.slice(0, need.count);
        else if (method === "pullup_bottom") picked = candidates.slice(candidates.length - need.count);
        else {
          const pool = [...candidates];
          picked = [];
          for (let i = 0; i < need.count; i++) picked.push(pool.splice(randomInt(rng, pool.length), 1)[0]);
        }
      }
      pool[need.side] = available.filter((t) => !picked.includes(t));
      need.target.push(...picked);
    }
    const surplus = pool.aff.length - pool.neg.length;
    if (surplus > 0) stillNeeded.push({ target: pool.neg, side: "neg", count: surplus });
    else if (surplus < 0) stillNeeded.push({ target: pool.aff, side: "aff", count: -surplus });
    needed = stillNeeded;
  }
  if (needed.length > 0) {
    throw new Error(
      "There are not enough teams allocated to each side to fill every bracket. Check that the preallocated sides give equal numbers of affirmative and negative teams."
    );
  }
  return work
    .filter((b) => b.aff.length > 0)
    .map((b) => ({ bracket: b.wins, aff: b.aff.map((t) => t.team), neg: b.neg.map((t) => t.team) }));
}

function intermediateWithSides(brackets: SidedBracket[], separatePerBracket: boolean): SidedGroup[] {
  const done: SidedGroup[] = [];
  // Unfilled intermediate brackets, keyed by the bracket whose excess started them.
  let unfilled: { key: number; aff: Team[]; neg: Team[]; parts: { aff: Team[]; neg: Team[] }[] }[] = [];

  for (const bracket of brackets) {
    const pool = { aff: bracket.aff.map((t) => t.team), neg: bracket.neg.map((t) => t.team) };
    const remaining: typeof unfilled = [];
    for (const open of unfilled) {
      const short: "aff" | "neg" = open.aff.length > open.neg.length ? "neg" : "aff";
      const excess: "aff" | "neg" = short === "aff" ? "neg" : "aff";
      const count = Math.min(Math.abs(open.aff.length - open.neg.length), pool[short].length);
      const taken = pool[short].splice(0, count);
      if (separatePerBracket) {
        if (count > 0) {
          const part = { aff: [] as Team[], neg: [] as Team[] };
          part[short] = taken;
          part[excess] = open[excess].splice(0, count);
          open.parts.push(part);
        }
      } else {
        open[short].push(...taken);
      }
      const filled = separatePerBracket ? open[excess].length === 0 : open.aff.length === open.neg.length;
      if (!filled) {
        remaining.push(open);
      } else if (separatePerBracket) {
        open.parts.forEach((part, i) => {
          done.push({ bracket: open.key - (i + 1) / (open.parts.length + 1), ...part });
        });
      } else {
        done.push({ bracket: open.key - 0.5, aff: open.aff, neg: open.neg });
      }
    }

    const n = Math.min(pool.aff.length, pool.neg.length);
    if (n > 0) done.push({ bracket: bracket.wins, aff: pool.aff.slice(0, n), neg: pool.neg.slice(0, n) });
    if (pool.aff.length !== pool.neg.length) {
      remaining.push({ key: bracket.wins, aff: pool.aff.slice(n), neg: pool.neg.slice(n), parts: [] });
    }
    unfilled = remaining;
  }
  if (unfilled.length > 0) {
    throw new Error(
      "There are still unfilled intermediate brackets. Check that the preallocated sides give equal numbers of affirmative and negative teams."
    );
  }
  return done.sort((a, b) => b.bracket - a.bracket);
}

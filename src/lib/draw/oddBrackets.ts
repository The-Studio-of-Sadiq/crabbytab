import type { OddBracketMethod, PullupRestriction, Team } from "@/types";

/** A team plus the stats needed to pick who gets pulled up. */
export interface RankedTeamStats {
  team: Team;
  /** Number of past rounds in which this team was pulled up (from TeamStandingRow.metrics.pullups). */
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
  /** The win-bracket this room counts as. Intermediate rooms sit half a bracket below the higher one. */
  bracket: number;
  teams: Team[];
  /** Ids of teams moved here from a lower bracket. */
  pulledUp: string[];
}

/** Narrows a lower bracket's candidates before pullup_top/bottom/middle/random picks a position among them. */
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

/** Picks one team from an (already-restricted) candidate list by ranked position. */
function pickByPosition(
  candidates: RankedTeamStats[],
  position: "top" | "bottom" | "middle" | "random"
): RankedTeamStats {
  switch (position) {
    case "top":
      return candidates[0];
    case "bottom":
      return candidates[candidates.length - 1];
    case "middle":
      return candidates[Math.floor((candidates.length - 1) / 2)];
    case "random":
      return candidates[Math.floor(Math.random() * candidates.length)];
  }
}

function positionFor(method: OddBracketMethod): "top" | "bottom" | "middle" | "random" {
  switch (method) {
    case "pullup_bottom":
      return "bottom";
    case "pullup_middle":
      return "middle";
    case "pullup_random":
      return "random";
    default:
      return "top"; // pullup_top, and the default pick for intermediate
  }
}

function removeTeam(bracket: WinBracket, teamId: string): void {
  bracket.teams = bracket.teams.filter((t) => t.team.id !== teamId);
}

/** The nearest bracket after `i` that still has teams in it (brackets can be legitimately empty). */
function nextNonEmpty(work: WinBracket[], i: number): WinBracket | undefined {
  for (let j = i + 1; j < work.length; j++) {
    if (work[j].teams.length > 0) return work[j];
  }
  return undefined;
}

/**
 * Turns win-brackets (each possibly an odd size, since rooms hold 2 teams)
 * into evenly-sized groups by pulling teams up between adjacent brackets as
 * needed. Each returned group is a whole bracket's worth of teams (2, 4, 6,
 * ...) -- pass it to `pairTeams` to split it into actual rooms of 2.
 * Brackets must be ordered highest wins first; each bracket's `teams` must
 * already be ranked best-first.
 *
 * A cascades: pulling a team out of a bracket can leave *that* bracket odd,
 * which is resolved when the loop reaches it. Because the total number of
 * teams is even, this always terminates with everyone placed.
 */
export function resolveOddBrackets(
  brackets: WinBracket[],
  method: OddBracketMethod,
  restriction: PullupRestriction
): ResolvedGroup[] {
  const work = brackets.map((b) => ({ wins: b.wins, teams: [...b.teams] }));
  const groups: ResolvedGroup[] = [];

  for (let i = 0; i < work.length; i++) {
    const here = work[i];
    if (here.teams.length === 0) continue;

    if (here.teams.length % 2 === 0) {
      groups.push({ bracket: here.wins, teams: here.teams.map((t) => t.team), pulledUp: [] });
      continue;
    }

    const below = nextNonEmpty(work, i);

    if (method === "intermediate" || method === "intermediate_bubble") {
      const leftover = here.teams[here.teams.length - 1];
      const rest = here.teams.slice(0, -1);
      if (rest.length > 0) groups.push({ bracket: here.wins, teams: rest.map((t) => t.team), pulledUp: [] });

      if (!below || below.teams.length === 0) {
        // Nothing below to pull from: the leftover has no bracket-mate this round.
        groups.push({ bracket: here.wins - 0.5, teams: [leftover.team], pulledUp: [] });
        continue;
      }
      const pool =
        method === "intermediate_bubble" ? applyPullupRestriction(below.teams, restriction) : [below.teams[0]];
      const picked = pickByPosition(pool, "top");
      removeTeam(below, picked.team.id);
      groups.push({ bracket: here.wins - 0.5, teams: [leftover.team, picked.team], pulledUp: [picked.team.id] });
      continue;
    }

    // pullup_top / pullup_bottom / pullup_middle / pullup_random
    if (!below || below.teams.length === 0) {
      throw new Error(
        `The bottom bracket (${here.wins} wins) has an odd number of teams and there is no bracket below it to pull up from.`
      );
    }
    const pool = applyPullupRestriction(below.teams, restriction);
    const picked = pickByPosition(pool, positionFor(method));
    removeTeam(below, picked.team.id);
    groups.push({
      bracket: here.wins,
      teams: [...here.teams.map((t) => t.team), picked.team],
      pulledUp: [picked.team.id],
    });
  }

  return groups;
}

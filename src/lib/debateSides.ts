import type { BPSide, Debate, DebateSide, PolySide, TournamentFormat, TournamentPreferences, TwoTeamSide } from "@/types";

/**
 * Which sides (positions) a debate has, for every format. Tabbycat stores a side as a number
 * 0 … teams_in_debate-1; CrabbyTab stores codes: AFF/NEG for two-team formats, OG/OO/CG/CO for BP,
 * and P1 … PN for the "poly" format (Tabbycat's `teams_in_debate` other than 2 or 4, as in its
 * Public Speaking preset). Code that lists a debate's sides should go through this module, so two-team
 * and BP tournaments keep their codes and poly tournaments get theirs.
 */

export const BP_SIDES: BPSide[] = ["OG", "OO", "CG", "CO"];
export const TWO_TEAM_SIDES: TwoTeamSide[] = ["AFF", "NEG"];

/** Teams per room of the poly format when a tournament has no valid count (Tabbycat's Public Speaking preset). */
export const DEFAULT_POLY_TEAMS_IN_DEBATE = 6;

type FormatSource = { format: TournamentFormat | string; preferences?: Partial<Pick<TournamentPreferences, "teamsInDebate">> | null };

export function isPolyFormat(format: TournamentFormat | string | undefined | null): boolean {
  return format === "poly";
}

/** True for team counts the poly format accepts: whole numbers of at least 1, other than 2 (two-team) and 4 (BP). */
export function isValidPolyTeamCount(count: unknown): count is number {
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 1 && count !== 2 && count !== 4;
}

/** An error message for a poly team count, or "" when it is valid. */
export function validatePolyTeamsInDebate(count: unknown): string {
  if (isValidPolyTeamCount(count)) return "";
  if (count === 2) return "Two teams per debate is a two-team format; choose a two-team format instead.";
  if (count === 4) return "Four teams per debate is British Parliamentary; choose the BP format instead.";
  return "Teams per debate must be a whole number of at least 1.";
}

/** Teams per debate (Tabbycat `teams_in_debate`): 4 for BP, 2 for two-team formats, the stored count for poly. */
export function teamsInDebateFor(source: FormatSource | null | undefined): number {
  if (!source) return 2;
  if (source.format === "bp") return 4;
  if (isPolyFormat(source.format)) {
    const count = source.preferences?.teamsInDebate;
    return isValidPolyTeamCount(count) ? count : DEFAULT_POLY_TEAMS_IN_DEBATE;
  }
  return 2;
}

/** The poly position code for 0-based Tabbycat side `index`: 0 → "P1". */
export function polySide(index: number): PolySide {
  return `P${index + 1}`;
}

const POLY_SIDE = /^P([1-9]\d*)$/;

export function isPolySide(side: unknown): side is PolySide {
  return typeof side === "string" && POLY_SIDE.test(side);
}

/** The 1-based number of a poly position ("P3" → 3), or 0 for any other code. */
export function polySideNumber(side: string): number {
  const match = POLY_SIDE.exec(side);
  return match ? Number(match[1]) : 0;
}

/** The first `count` poly positions. */
export function polySides(count: number): PolySide[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, index) => polySide(index));
}

/** Every side of a full room in this format, in Tabbycat's side order. */
export function sidesForFormat(format: TournamentFormat | string, teamsInDebate?: number): DebateSide[] {
  if (format === "bp") return BP_SIDES;
  if (isPolyFormat(format)) return polySides(teamsInDebateFor({ format, preferences: { teamsInDebate } }));
  return TWO_TEAM_SIDES;
}

/** Every side of a full room in this tournament. */
export function tournamentSides(source: FormatSource): DebateSide[] {
  return sidesForFormat(source.format, teamsInDebateFor(source));
}

/** True when `side` is one of the format's side codes (any poly position for poly). */
export function isSideOfFormat(side: unknown, format: TournamentFormat | string): side is DebateSide {
  if (format === "bp") return (BP_SIDES as string[]).includes(side as string);
  if (isPolyFormat(format)) return isPolySide(side);
  return (TWO_TEAM_SIDES as string[]).includes(side as string);
}

/** Orders side codes as Tabbycat numbers them (AFF, NEG; OG, OO, CG, CO; P1, P2, …). */
export function compareSides(a: string, b: string): number {
  const rank = (side: string) => {
    const two = (TWO_TEAM_SIDES as string[]).indexOf(side);
    if (two >= 0) return two;
    const bp = (BP_SIDES as string[]).indexOf(side);
    if (bp >= 0) return bp;
    const poly = polySideNumber(side);
    return poly > 0 ? poly - 1 : Number.MAX_SAFE_INTEGER;
  };
  return rank(a) - rank(b) || a.localeCompare(b);
}

/**
 * The sides a debate actually has. A poly room can hold fewer teams than the format's count (a
 * random draw puts the remainder in the last room, as Tabbycat's), so its sides are its own
 * positions; two-team and BP debates always use the format's sides.
 */
export function debateSides(
  debate: Pick<Debate, "teams"> | null | undefined,
  source: FormatSource
): DebateSide[] {
  if (!isPolyFormat(source.format)) return tournamentSides(source);
  // Positions holding a team; an empty slot left by the draw editor is not a side of the debate.
  const teams: Partial<Debate["teams"]> = debate?.teams || {};
  const own = Object.keys(teams)
    .filter((side): side is PolySide => isPolySide(side) && Boolean(teams[side as PolySide]?.teamId))
    .sort(compareSides);
  return own.length > 0 ? own : tournamentSides(source);
}

/** True for formats with two teams per debate (every format except BP and poly). */
export function isTwoTeamFormat(format: TournamentFormat | string | undefined | null): boolean {
  return format !== "bp" && !isPolyFormat(format);
}

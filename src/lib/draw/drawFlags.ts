import type { Debate, DebateSide, Round, Team, TeamStandingRow } from "@/types";
import { buildMatchupHistory, getEligibleTeamsForRound } from "./generator";
import { sameInstitution } from "./history";
import { sidesPending } from "./manualSides";
import { BP_SIDES, TWO_TEAM_SIDES } from "./sideAllocator";
import { earlierDebates, validateDraw, type DrawIssue, type ValidateDrawInput } from "./validateDraw";

/**
 * What the draw editor shows next to each debate and team, as Tabbycat's draw editor does:
 * rematches (and when), institution clashes, side history and imbalance, pull-ups, bracket and
 * room rank, plus the draw check's issues for the debate. Pure: derived from the same inputs as
 * `validateDraw`, with earlier rounds' sides taken from confirmed ballots where sides were chosen
 * on the ballot.
 */

export type TeamFlagKind =
  | "rematch"
  | "institution"
  | "side_history"
  | "side_imbalance"
  | "pulled_up"
  | "pullup_history"
  | "swing";

export interface TeamFlag {
  kind: TeamFlagKind;
  /** "warning" flags something the draw tries to avoid; "info" is context. */
  severity: "warning" | "info";
  /** A few characters for the badge, e.g. "AFF ×3" or "Met R2". */
  label: string;
  /** The full explanation, for hover, focus and screen readers. */
  detail: string;
}

export interface DebateFlags {
  debateId: string;
  bracket: number;
  roomRank: number;
  sidesPending: boolean;
  /** Flags per team id placed in the debate. */
  teams: Record<string, TeamFlag[]>;
  /** The draw check's issues that involve this debate. */
  issues: DrawIssue[];
}

export interface DrawFlagsInput extends ValidateDrawInput {
  /** Current standings, for team points in the details view. */
  standings?: TeamStandingRow[];
}

function roundLabels(rounds: Round[] | undefined): (debate: Pick<Debate, "roundId" | "roundSeq">) => string {
  const byId = new Map((rounds ?? []).map((round) => [round.id, round.abbreviation || `R${round.seq}`]));
  return (debate) => byId.get(debate.roundId) ?? `R${debate.roundSeq}`;
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  const suffix = value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th";
  return `${value}${suffix}`;
}

function slotsOf(debate: Debate): Array<[DebateSide, Debate["teams"][DebateSide]]> {
  return (Object.entries(debate.teams || {}) as Array<[DebateSide, Debate["teams"][DebateSide] | undefined]>)
    .filter((entry): entry is [DebateSide, Debate["teams"][DebateSide]] => Boolean(entry[1]?.teamId));
}

/** Rounds (labels, oldest first) in which each pair of teams met, keyed "a|b" with a < b. */
function meetingRounds(debates: Debate[], label: (debate: Debate) => string): Map<string, string[]> {
  const meetings = new Map<string, string[]>();
  const ordered = [...debates].sort((a, b) => a.roundSeq - b.roundSeq);
  for (const debate of ordered) {
    if (debate.postponed || debate.byeTeamId) continue;
    const ids = slotsOf(debate).map(([, slot]) => slot.teamId);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = [ids[i], ids[j]].sort().join("|");
        meetings.set(key, [...(meetings.get(key) ?? []), label(debate)]);
      }
    }
  }
  return meetings;
}

/** Counts of each side in a history, in the format's side order. */
export function sideCounts(history: DebateSide[], sides: readonly DebateSide[]): Record<string, number> {
  const counts = Object.fromEntries(sides.map((side) => [side, 0])) as Record<string, number>;
  for (const side of history) if (side in counts) counts[side] += 1;
  return counts;
}

function formatCounts(counts: Record<string, number>, sides: readonly DebateSide[]): string {
  return sides.map((side) => `${side} ×${counts[side]}`).join(", ");
}

/**
 * Side imbalance after this round: the current side's count against the least-used side. Two-team
 * formats flag a gap of 2 or more (Tabbycat highlights "imbalanced" teams the same way); a
 * configured larger allowed imbalance raises the threshold.
 */
function imbalanceAfter(
  history: DebateSide[],
  side: DebateSide,
  sides: readonly DebateSide[],
  allowedImbalance: number
): { count: number; gap: number } | null {
  const counts = sideCounts([...history, side], sides);
  const gap = counts[side] - Math.min(...sides.map((item) => counts[item]));
  return gap > Math.max(1, allowedImbalance) ? { count: counts[side], gap } : null;
}

export function computeDrawFlags(input: DrawFlagsInput): Map<string, DebateFlags> {
  const { tournament, round, teams } = input;
  const isBP = tournament.format === "bp";
  const sides = isBP ? BP_SIDES : TWO_TEAM_SIDES;
  const label = roundLabels(input.rounds);
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const name = (teamId: string) => teamsById.get(teamId)?.name ?? teamId;
  const past = earlierDebates(input);
  const history = buildMatchupHistory(past);
  const meetings = meetingRounds(past, label);
  const issues = validateDraw(input);
  const allowedImbalance = tournament.preferences?.maxAllowedSideImbalance ?? 0;
  const result = new Map<string, DebateFlags>();

  for (const debate of input.debates.filter((item) => item.roundId === round.id)) {
    const pending = sidesPending(debate);
    const entry: DebateFlags = {
      debateId: debate.id,
      bracket: debate.bracket,
      roomRank: debate.roomRank,
      sidesPending: pending,
      teams: {},
      issues: issues.filter((issue) => issue.debateIds.includes(debate.id)),
    };
    result.set(debate.id, entry);
    if (debate.byeTeamId) continue;
    const slots = slotsOf(debate);
    for (const [side, slot] of slots) {
      const flags: TeamFlag[] = [];
      const team = teamsById.get(slot.teamId);
      if (team?.isSwing) {
        flags.push({ kind: "swing", severity: "info", label: "Swing", detail: `${team.name} is a swing team: it is not ranked in the tab.` });
      }
      for (const [, other] of slots) {
        if (other.teamId === slot.teamId) continue;
        const met = meetings.get([slot.teamId, other.teamId].sort().join("|"));
        if (met?.length) {
          flags.push({
            kind: "rematch",
            severity: "warning",
            label: `Met ${met.join(", ")}`,
            detail: `${name(slot.teamId)} already met ${name(other.teamId)} in ${list(met)}.`,
          });
        }
        const otherTeam = teamsById.get(other.teamId);
        if (team && otherTeam && sameInstitution(team, otherTeam)) {
          flags.push({
            kind: "institution",
            severity: "warning",
            label: "Same institution",
            detail: `${team.name} and ${otherTeam.name} are both from ${team.institutionName || "the same institution"}.`,
          });
        }
      }
      const pastSides = history.sides.get(slot.teamId) ?? [];
      if (pastSides.length > 0) {
        flags.push({
          kind: "side_history",
          severity: "info",
          label: formatCounts(sideCounts(pastSides, sides), sides),
          detail: `${name(slot.teamId)}'s sides so far: ${formatCounts(sideCounts(pastSides, sides), sides)}.`,
        });
      }
      const imbalance = pending || round.stage !== "preliminary"
        ? null
        : imbalanceAfter(pastSides, side, sides, allowedImbalance);
      if (imbalance) {
        flags.push({
          kind: "side_imbalance",
          severity: "warning",
          label: `${side} ×${imbalance.count}`,
          detail: `${name(slot.teamId)} would be ${side} for the ${ordinal(imbalance.count)} time, ` +
            `${imbalance.gap} more than its least-used side.`,
        });
      }
      if (slot.pulledUp) {
        flags.push({
          kind: "pulled_up",
          severity: "warning",
          label: "Pulled up",
          detail: `${name(slot.teamId)} was pulled up into this ${debate.bracket}-point bracket.`,
        });
      }
      const pullups = history.pullups?.get(slot.teamId) ?? 0;
      if (pullups > 0) {
        flags.push({
          kind: "pullup_history",
          severity: "info",
          label: `Pulled up ×${pullups} before`,
          detail: `${name(slot.teamId)} was pulled up in ${pullups} earlier round${pullups === 1 ? "" : "s"}.`,
        });
      }
      entry.teams[slot.teamId] = flags;
    }
  }
  return result;
}

/* Draw details ------------------------------------------------------------------------------- */

export type RoundSide = DebateSide | "bye" | "tbc";

export interface TeamDrawDetails {
  teamId: string;
  teamName: string;
  institutionName?: string;
  isSwing: boolean;
  /** Team points from the current standings (absent when no standings are given or the team is unranked). */
  points?: number;
  /** This round's placement: null when the team is not placed. */
  current: { debateId: string; room: string; side: RoundSide; opponents: string[]; pulledUp: boolean } | null;
  /** Earlier rounds, oldest first: the side taken, "bye", "tbc" (sides not yet recorded) or null (did not debate). */
  sidesByRound: { roundLabel: string; side: RoundSide | null }[];
  sideCounts: Record<string, number>;
  opponents: { teamId: string; teamName: string; rounds: string[] }[];
  pullups: number;
}

/**
 * Per team: previous opponents, sides by round, pull-ups and points, for checking a draw before
 * it is released. Lists the teams eligible for the round plus any other team placed in it.
 */
export function buildDrawDetails(input: DrawFlagsInput): TeamDrawDetails[] {
  const { tournament, round, teams } = input;
  const sides = tournament.format === "bp" ? BP_SIDES : TWO_TEAM_SIDES;
  const label = roundLabels(input.rounds);
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const name = (teamId: string) => teamsById.get(teamId)?.name ?? teamId;
  const past = earlierDebates(input);
  const history = buildMatchupHistory(past);
  const pointsById = new Map((input.standings ?? []).map((row) => [row.teamId, row.points]));
  const earlierRounds = input.rounds
    ? input.rounds.filter((item) => !item.cancelled && item.seq < round.seq).sort((a, b) => a.seq - b.seq)
    : [...new Map(past.map((debate) => [debate.roundId, { id: debate.roundId, seq: debate.roundSeq }])).values()]
        .sort((a, b) => a.seq - b.seq);

  const sideInRound = new Map<string, Map<string, RoundSide>>();
  const opponents = new Map<string, Map<string, string[]>>();
  for (const debate of [...past].sort((a, b) => a.roundSeq - b.roundSeq)) {
    if (debate.postponed) continue;
    const perRound = (teamId: string) => {
      if (!sideInRound.has(teamId)) sideInRound.set(teamId, new Map());
      return sideInRound.get(teamId)!;
    };
    if (debate.byeTeamId) {
      perRound(debate.byeTeamId).set(debate.roundId, "bye");
      continue;
    }
    const pending = sidesPending(debate);
    const slots = slotsOf(debate);
    for (const [side, slot] of slots) {
      perRound(slot.teamId).set(debate.roundId, pending ? "tbc" : side);
      const met = opponents.get(slot.teamId) ?? new Map<string, string[]>();
      for (const [, other] of slots) {
        if (other.teamId !== slot.teamId) met.set(other.teamId, [...(met.get(other.teamId) ?? []), label(debate)]);
      }
      opponents.set(slot.teamId, met);
    }
  }

  const roundDebates = input.debates.filter((debate) => debate.roundId === round.id);
  const current = new Map<string, TeamDrawDetails["current"]>();
  for (const debate of roundDebates) {
    if (debate.byeTeamId) {
      current.set(debate.byeTeamId, { debateId: debate.id, room: "Bye", side: "bye", opponents: [], pulledUp: false });
      continue;
    }
    const pending = sidesPending(debate);
    const slots = slotsOf(debate);
    for (const [side, slot] of slots) {
      current.set(slot.teamId, {
        debateId: debate.id,
        room: debate.venueName || `Room ${debate.roomRank}`,
        side: pending ? "tbc" : side,
        opponents: slots.filter(([, other]) => other.teamId !== slot.teamId).map(([, other]) => name(other.teamId)),
        pulledUp: Boolean(slot.pulledUp),
      });
    }
  }

  const listed = new Set([...getEligibleTeamsForRound(teams, round).map((team) => team.id), ...current.keys()]);
  const rows: TeamDrawDetails[] = [...listed].map((teamId) => {
    const team = teamsById.get(teamId) as Team | undefined;
    return {
      teamId,
      teamName: name(teamId),
      institutionName: team?.institutionName,
      isSwing: Boolean(team?.isSwing),
      points: pointsById.get(teamId),
      current: current.get(teamId) ?? null,
      sidesByRound: earlierRounds.map((item) => ({
        roundLabel: label({ roundId: item.id, roundSeq: item.seq }),
        side: sideInRound.get(teamId)?.get(item.id) ?? null,
      })),
      sideCounts: sideCounts(history.sides.get(teamId) ?? [], sides),
      opponents: [...(opponents.get(teamId) ?? new Map<string, string[]>()).entries()].map(([opponentId, rounds]) => ({
        teamId: opponentId,
        teamName: name(opponentId),
        rounds,
      })),
      pullups: history.pullups?.get(teamId) ?? 0,
    };
  });
  return rows.sort((a, b) => (b.points ?? -1) - (a.points ?? -1) || a.teamName.localeCompare(b.teamName));
}

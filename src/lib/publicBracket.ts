import type { BallotSubmission, Debate, DebateSide, Round, Team } from "@/types";

export interface BracketTeam {
  side: DebateSide;
  teamId: string;
  name: string;
  team?: Team;
  /** Bracket position (break seed, inherited by the winner of each room). */
  seed?: number;
  /** Advanced from this room; only known once the round's results are public. */
  advanced: boolean;
}

export interface BracketMatch {
  debateId: string;
  venueName?: string;
  teams: BracketTeam[];
}

export interface BracketRound {
  id: string;
  name: string;
  seq: number;
  matches: BracketMatch[];
}

const BP_ORDER: DebateSide[] = ["OG", "OO", "CG", "CO"];
const TWO_TEAM_ORDER: DebateSide[] = ["AFF", "NEG"];

function latestBallots(ballots: BallotSubmission[]): Map<string, BallotSubmission> {
  const byDebate = new Map<string, BallotSubmission>();
  for (const ballot of ballots) {
    if (ballot.confirmed !== true || ballot.discarded === true) continue;
    const current = byDebate.get(ballot.debateId);
    if (!current || (ballot.version ?? 0) > (current.version ?? 0)) byDebate.set(ballot.debateId, ballot);
  }
  return byDebate;
}

/**
 * The public elimination bracket: one column per elimination round whose draw is public, rooms
 * ordered by their best bracket position. A team advances from a two-team room by winning and from
 * a BP room by finishing in the top two (two-point or better), as recorded on the public ballot.
 */
export function bracketRounds(
  rounds: Round[],
  debates: Debate[],
  ballots: BallotSubmission[],
  teamsById: Map<string, Team>,
  isBP: boolean
): BracketRound[] {
  const ballotByDebate = latestBallots(ballots);
  const order = isBP ? BP_ORDER : TWO_TEAM_ORDER;
  return rounds
    .filter((round) => {
      const drawPublic = (round as Round & { drawPublic?: boolean }).drawPublic;
      return (
        round.stage === "elimination" &&
        round.cancelled !== true &&
        (drawPublic ?? (round.drawStatus === "confirmed" || round.drawStatus === "released"))
      );
    })
    .sort((left, right) => left.seq - right.seq)
    .map((round) => {
      const matches = debates
        .filter((debate) => debate.roundId === round.id)
        .map((debate): BracketMatch & { order: number; roomRank: number } => {
          const ballot = ballotByDebate.get(debate.id);
          const teams = order
            .map((side) => ({ side, slot: debate.teams?.[side] }))
            .filter((entry): entry is { side: DebateSide; slot: NonNullable<typeof entry.slot> } => Boolean(entry.slot?.teamId))
            .map(({ side, slot }) => {
              const score = ballot?.teamScores?.[side];
              const advanced = Boolean(score && (isBP ? score.points >= 2 : score.win === true));
              return {
                side,
                teamId: slot.teamId,
                name: slot.teamName ?? teamsById.get(slot.teamId)?.name ?? "",
                team: teamsById.get(slot.teamId),
                ...(slot.bracketPosition !== undefined ? { seed: slot.bracketPosition } : {}),
                advanced,
              };
            });
          const seeds = teams.map((team) => team.seed ?? Number.MAX_SAFE_INTEGER);
          return {
            debateId: debate.id,
            ...(debate.venueName ? { venueName: debate.venueName } : {}),
            teams,
            order: Math.min(...seeds, Number.MAX_SAFE_INTEGER),
            roomRank: debate.roomRank ?? Number.MAX_SAFE_INTEGER,
          };
        })
        .sort((left, right) => left.order - right.order || left.roomRank - right.roomRank || left.debateId.localeCompare(right.debateId))
        .map(({ order: _order, roomRank: _roomRank, ...match }) => match);
      return { id: round.id, name: round.name, seq: round.seq, matches };
    })
    .filter((round) => round.matches.length > 0);
}

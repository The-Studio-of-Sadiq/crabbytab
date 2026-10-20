import type { BallotSubmission, Debate, DebateSide, Motion, Round } from "@/types";

/**
 * Public record pages (Tabbycat `public_record`): a team's or adjudicator's debates in rounds whose
 * draw or results are public. Built only from the public projection, so they show nothing the
 * draw and results pages do not.
 */

export interface TeamRecordRow {
  roundId: string;
  roundName: string;
  roundSeq: number;
  debateId: string;
  side: DebateSide;
  venueName?: string;
  opponents: Array<{ teamId: string; name: string }>;
  /** Present once the round's results are public. */
  result?: { win?: boolean; points: number; rank?: number };
  /** Present once the round's speaker scores are public. */
  speakerScoreTotal?: number;
  /** With results, when motions are shown in results. */
  motion?: PublicDebateMotion;
}

export interface AdjudicatorRecordRow {
  roundId: string;
  roundName: string;
  roundSeq: number;
  debateId: string;
  role: "chair" | "panellist" | "trainee";
  venueName?: string;
  teams: Array<{ side: DebateSide; teamId: string; name: string }>;
  /** Once the round's results are public, when motions are shown in results. */
  motion?: PublicDebateMotion;
}

/** The motion a debate was held on, as shown on public results and record pages. */
export interface PublicDebateMotion {
  id: string;
  reference?: string;
  text: string;
}

type MotionLike = Pick<Motion, "id" | "text" | "reference" | "rounds" | "released">;

/**
 * Which released motion a debate was held on (Tabbycat `show_motions_in_results`): the confirmed
 * ballot's motion (motion selection), else the debate's, else the round's only released motion.
 * Only released motions with text count, so an unreleased motion is never shown.
 */
export function debateMotion(
  debate: Pick<Debate, "roundId" | "motionId">,
  ballot: Pick<BallotSubmission, "motionId"> | undefined,
  motions: MotionLike[]
): PublicDebateMotion | undefined {
  const released = motions.filter((motion) => motion.released === true && Boolean(motion.text?.trim()));
  const byId = new Map(released.map((motion) => [motion.id, motion]));
  const roundMotions = released.filter((motion) => motion.rounds?.includes(debate.roundId));
  const motion =
    (ballot?.motionId ? byId.get(ballot.motionId) : undefined) ??
    (debate.motionId ? byId.get(debate.motionId) : undefined) ??
    (roundMotions.length === 1 ? roundMotions[0] : undefined);
  return motion ? { id: motion.id, text: motion.text, ...(motion.reference ? { reference: motion.reference } : {}) } : undefined;
}

function latestBallot(ballots: BallotSubmission[], debateId: string): BallotSubmission | undefined {
  return ballots
    .filter((ballot) => ballot.debateId === debateId && ballot.confirmed === true && ballot.discarded !== true)
    .sort((left, right) => (right.version ?? 0) - (left.version ?? 0))[0];
}

function roundsById(rounds: Round[]): Map<string, Round> {
  return new Map(rounds.filter((round) => round.cancelled !== true).map((round) => [round.id, round]));
}

/** Pass `motions` to show the debated motion with released results (Tabbycat `show_motions_in_results`). */
export function teamRecord(
  teamId: string,
  rounds: Round[],
  debates: Debate[],
  ballots: BallotSubmission[],
  motions?: MotionLike[]
): TeamRecordRow[] {
  const byId = roundsById(rounds);
  const rows: TeamRecordRow[] = [];
  for (const debate of debates) {
    const round = byId.get(debate.roundId);
    if (!round) continue;
    const entries = Object.entries(debate.teams ?? {}) as Array<[DebateSide, Debate["teams"][DebateSide]]>;
    const own = entries.find(([, slot]) => slot?.teamId === teamId);
    if (!own) continue;
    const [side, slot] = own;
    const ballot = round.resultsReleased ? latestBallot(ballots, debate.id) : undefined;
    const score = ballot?.teamScores?.[side];
    const motion = motions && round.resultsReleased ? debateMotion(debate, ballot, motions) : undefined;
    rows.push({
      roundId: round.id,
      roundName: round.name,
      roundSeq: round.seq,
      debateId: debate.id,
      side,
      ...(debate.venueName ? { venueName: debate.venueName } : {}),
      opponents: entries
        .filter(([, other]) => other?.teamId && other.teamId !== teamId)
        .map(([, other]) => ({ teamId: other!.teamId, name: other!.teamName ?? "" })),
      ...(score ? { result: { ...(score.win !== undefined ? { win: score.win } : {}), points: score.points, ...(score.rank !== undefined ? { rank: score.rank } : {}) } } : {}),
      ...(round.teamSpeaksReleased && slot?.speakerScoreTotal !== undefined ? { speakerScoreTotal: slot.speakerScoreTotal } : {}),
      ...(motion ? { motion } : {}),
    });
  }
  return rows.sort((left, right) => left.roundSeq - right.roundSeq || left.debateId.localeCompare(right.debateId));
}

/** Pass `ballots` and `motions` to show the debated motion with released results. */
export function adjudicatorRecord(
  adjudicatorId: string,
  rounds: Round[],
  debates: Debate[],
  motionsInResults?: { ballots: BallotSubmission[]; motions: MotionLike[] }
): AdjudicatorRecordRow[] {
  const byId = roundsById(rounds);
  const rows: AdjudicatorRecordRow[] = [];
  for (const debate of debates) {
    const round = byId.get(debate.roundId);
    if (!round || round.adjudicatorsRevealed !== true) continue;
    const panel = debate.adjudicators;
    const role = panel?.chairId === adjudicatorId
      ? "chair"
      : panel?.panellistIds?.includes(adjudicatorId)
        ? "panellist"
        : panel?.traineeIds?.includes(adjudicatorId)
          ? "trainee"
          : undefined;
    if (!role) continue;
    const motion = motionsInResults && round.resultsReleased
      ? debateMotion(debate, latestBallot(motionsInResults.ballots, debate.id), motionsInResults.motions)
      : undefined;
    rows.push({
      roundId: round.id,
      roundName: round.name,
      roundSeq: round.seq,
      debateId: debate.id,
      role,
      ...(debate.venueName ? { venueName: debate.venueName } : {}),
      teams: (Object.entries(debate.teams ?? {}) as Array<[DebateSide, Debate["teams"][DebateSide]]>)
        .filter(([, slot]) => slot?.teamId)
        .map(([side, slot]) => ({ side, teamId: slot!.teamId, name: slot!.teamName ?? "" })),
      ...(motion ? { motion } : {}),
    });
  }
  return rows.sort((left, right) => left.roundSeq - right.roundSeq || left.debateId.localeCompare(right.debateId));
}

/** Path of a public record page. */
export function publicRecordPath(slug: string, kind: "team" | "adjudicator", id: string): string {
  return `/${encodeURIComponent(slug)}/public/${kind}/${encodeURIComponent(id)}`;
}

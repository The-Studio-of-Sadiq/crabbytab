import type { BallotSubmission, Debate, DebateSide, DebateTeamSlot } from "@/types";

/**
 * Tabbycat's "manual-ballot" side allocation. The draw pairs teams but does not fix sides: each
 * debate is marked with MANUAL_SIDES_FLAG and `sidesConfirmed: false`, and the slots' sides are
 * only the order the draw listed the teams in. The ballot records which team took which side
 * (`teamScores[side].teamId`); confirming it rearranges the debate and sets `sidesConfirmed`.
 *
 * Only debates carrying the flag are affected, so draws made under other side rules (whose
 * `sidesConfirmed` was never meaningful) keep their sides.
 */
export const MANUAL_SIDES_FLAG = "manual_ballot_sides";

type SidedDebate = Pick<Debate, "teams" | "flags" | "sidesConfirmed" | "byeTeamId">;

/** True when the debate's sides are chosen on its ballot (whether or not one was confirmed yet). */
export function sidesChosenOnBallot(debate: Pick<Debate, "flags" | "byeTeamId">): boolean {
  return !debate.byeTeamId && (debate.flags ?? []).includes(MANUAL_SIDES_FLAG);
}

/** True when the debate's sides are still to be recorded on its ballot. */
export function sidesPending(debate: SidedDebate): boolean {
  return sidesChosenOnBallot(debate) && debate.sidesConfirmed !== true;
}

function placedTeamIds(debate: Pick<Debate, "teams">): string[] {
  return Object.values(debate.teams || {})
    .map((slot) => slot?.teamId)
    .filter((id): id is string => Boolean(id));
}

/** Side -> team id as recorded on a ballot. */
export function ballotSideAssignment(ballot: Pick<BallotSubmission, "teamScores">): Partial<Record<DebateSide, string>> {
  const assignment: Partial<Record<DebateSide, string>> = {};
  for (const [side, score] of Object.entries(ballot.teamScores || {})) {
    if (score?.teamId) assignment[side as DebateSide] = score.teamId;
  }
  return assignment;
}

/** Whether `assignment` puts exactly the debate's teams on its sides, each once. */
export function isSidePermutation(
  debate: Pick<Debate, "teams">,
  assignment: Partial<Record<DebateSide, string>>
): boolean {
  const sides = Object.keys(debate.teams || {}) as DebateSide[];
  const placed = placedTeamIds(debate).sort();
  const assigned = sides.map((side) => assignment[side]).filter((id): id is string => Boolean(id));
  if (assigned.length !== sides.length || placed.length !== sides.length) return false;
  if (Object.keys(assignment).some((side) => !sides.includes(side as DebateSide))) return false;
  return JSON.stringify([...assigned].sort()) === JSON.stringify(placed);
}

/**
 * The debate with its teams moved to the given sides. Each slot keeps its team's own details
 * (pull-up, bracket position); scores recorded on the slots are dropped because they belong to
 * a side. Throws when the assignment is not a rearrangement of the debate's teams.
 */
export function arrangeDebateSides<T extends Pick<Debate, "teams">>(
  debate: T,
  assignment: Partial<Record<DebateSide, string>>
): T {
  if (!isSidePermutation(debate, assignment)) {
    throw new Error("The recorded sides must place each team of the debate exactly once.");
  }
  const slotByTeam = new Map<string, DebateTeamSlot>();
  for (const slot of Object.values(debate.teams)) if (slot?.teamId) slotByTeam.set(slot.teamId, slot);
  const teams = {} as Debate["teams"];
  for (const side of Object.keys(debate.teams) as DebateSide[]) {
    const { points: _points, speakerScoreTotal: _total, ...slot } = slotByTeam.get(assignment[side]!)!;
    teams[side] = { ...slot, side };
  }
  return { ...debate, teams };
}

/** A two-team debate with its teams' sides exchanged (keeps every other field). */
export function swapTwoTeamSides<T extends Pick<Debate, "teams">>(debate: T): T {
  const aff = debate.teams.AFF?.teamId;
  const neg = debate.teams.NEG?.teamId;
  if (!aff || !neg) return debate;
  return arrangeDebateSides(debate, { AFF: neg, NEG: aff });
}

/**
 * The debate as the ballot recorded it: for a debate whose sides are chosen on the ballot and a
 * ballot that places its teams, the teams on the ballot's sides with `sidesConfirmed: true` (a
 * corrected ballot version may change sides an earlier confirmed version recorded). Anything else
 * is returned unchanged.
 */
export function applyBallotSides<T extends Debate>(debate: T, ballot: Pick<BallotSubmission, "teamScores">): T {
  if (!sidesChosenOnBallot(debate)) return debate;
  const assignment = ballotSideAssignment(ballot);
  if (!isSidePermutation(debate, assignment)) return debate;
  return { ...arrangeDebateSides(debate, assignment), sidesConfirmed: true };
}

/**
 * Debates with the sides recorded by their confirmed ballots. Used where sides matter (side
 * history, standings, advancement) so a confirmed ballot counts even before the debate record
 * itself was rearranged (e.g. a chair's portal ballot that reached this device by sync).
 */
export function resolveRecordedSides<T extends Debate>(debates: T[], ballots: BallotSubmission[]): T[] {
  if (!debates.some(sidesChosenOnBallot)) return debates;
  const confirmed = new Map<string, BallotSubmission>();
  for (const ballot of ballots) {
    if (ballot.confirmed && !ballot.discarded) confirmed.set(ballot.debateId, ballot);
  }
  return debates.map((debate) => {
    const ballot = confirmed.get(debate.id);
    return ballot ? applyBallotSides(debate, ballot) : debate;
  });
}

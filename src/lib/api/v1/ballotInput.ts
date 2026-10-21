import { roundMotions, nextBallotVersion } from "@/features/tournament/application/ballotEntry";
import {
  buildBallotResult,
  debateBallotRules,
  rulesSides,
  validateBallotEntry,
  type BallotEntry,
  type BallotRules,
} from "@/lib/ballots/result";
import { arrangeDebateSides, isSidePermutation, sidesChosenOnBallot } from "@/lib/draw/manualSides";
import { votingAdjudicatorIds } from "@/lib/ballots/individualBallots";
import type { BallotSubmission, Debate, DebateSide, Motion, Round, Team, Tournament } from "@/types";
import { ApiError } from "./errors";

/**
 * Turns an API ballot (the same entry the tab-room ballot form produces: speeches per side,
 * optional BP ranks, voting sheets, forfeit, motion, vetoes) into a BallotSubmission, using the
 * form's own validation and result builder (lib/ballots/result.ts). Team points, wins, margins
 * and voting majorities are always computed, never taken from the client.
 */
export interface BallotInput {
  entry: BallotEntry;
  /** Manual-ballot sides only: the team that took each side. */
  sides?: Partial<Record<DebateSide, string>>;
  confirmed: boolean;
  /** Blind double entry: the version this entry checks. */
  checksVersion?: number;
}

export interface BallotBuildContext {
  tournament: Tournament;
  round: Round;
  debate: Debate;
  teams: Team[];
  motions: Motion[];
  /** Every round: a poly ballot for the last round advances one team instead of two. */
  rounds?: Round[];
  existingBallots: BallotSubmission[];
  submitter: { id: string; name: string };
  now: Date;
  createId(prefix: string): string;
}

export function buildApiBallot(input: BallotInput, context: BallotBuildContext): BallotSubmission {
  const { tournament, round, teams, motions, now } = context;
  let debate = context.debate;
  if (debate.byeTeamId) throw new ApiError(409, "conflict", "A bye has no ballot.");
  if (sidesChosenOnBallot(debate)) {
    if (!input.sides) {
      throw new ApiError(422, "validation_failed", "Sides are chosen on the ballot in this debate: send `sides` (team id per side).");
    }
    if (!isSidePermutation(debate, input.sides)) {
      throw new ApiError(422, "validation_failed", "`sides` must assign this debate's teams to its sides.");
    }
    debate = arrangeDebateSides(debate, input.sides);
  } else if (input.sides) {
    throw new ApiError(422, "validation_failed", "Sides were set by the draw; omit `sides`.");
  }

  const rules: BallotRules = debateBallotRules(tournament, round, debate, context.rounds);
  const sides = rulesSides(rules);
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const rosters = Object.fromEntries(sides.map((side) => [side, teamsById.get(debate.teams?.[side]?.teamId ?? "")?.speakers ?? []]));
  const teamIds = Object.fromEntries(sides.map((side) => [side, debate.teams?.[side]?.teamId ?? ""]));
  const available = roundMotions(motions, round.id);
  const errors = validateBallotEntry(input.entry, {
    ...rules,
    rosters,
    roundMotionIds: available.map((motion) => motion.id),
    votingAdjudicatorCount: votingAdjudicatorIds(debate).length,
  });
  if (errors.length > 0) {
    throw new ApiError(422, "validation_failed", "The ballot is not valid.", {
      issues: errors.map((message) => ({ path: "entry", message })),
    });
  }
  const chairId = debate.adjudicators?.chairId;
  const result = buildBallotResult(input.entry, teamIds, chairId, rules);
  const version = nextBallotVersion(context.existingBallots, debate.id);
  const motion = motions.find((item) => item.id === input.entry.motionId);
  const vetoes = Object.fromEntries(Object.entries(input.entry.vetoes ?? {}).filter(([, motionId]) => Boolean(motionId)));
  const timestamp = now.toISOString();
  return {
    id: context.createId(`ballot-${debate.id}-v${version}`),
    tournamentId: tournament.id,
    roundId: debate.roundId,
    debateId: debate.id,
    version,
    confirmed: input.confirmed,
    discarded: false,
    submitterType: "tabroom",
    submitterId: context.submitter.id,
    submitterName: context.submitter.name,
    ...(input.entry.motionId ? { motionId: input.entry.motionId, motionText: motion?.text ?? debate.motionText } : {}),
    speakerScores: result.speakerScores,
    teamScores: result.teamScores,
    ...(result.sheets ? { sheets: result.sheets } : {}),
    ...(Object.keys(vetoes).length > 0 ? { vetoes } : {}),
    ...(input.entry.forfeitSide ? { forfeitSide: input.entry.forfeitSide } : {}),
    ...(result.selfSplit ? { selfSplit: true } : {}),
    // Results-only ballots (speakersInBallots "never", unscored elimination rounds) must keep
    // this flag, as the tab-room form does, or standings count their placeholder speeches.
    ...(result.noSpeakerScores ? { noSpeakerScores: true } : {}),
    ...(chairId ? { chairId } : {}),
    ...(input.checksVersion !== undefined ? { checksVersion: input.checksVersion } : {}),
    timestamp,
    ...(input.confirmed ? { confirmedBy: context.submitter.name, confirmedTimestamp: timestamp } : {}),
  };
}

import {
  Adjudicator,
  BallotSubmission,
  Debate,
  DebateSide,
  Round,
  SpeakerScoreEntry,
  Team,
  Tournament,
} from "@/types";
import { validateReplyScore, validateSpeakerScore } from "@/lib/scoring/validator";
import {
  buildBallotResult,
  debateBallotRules,
  polyBallotProblem,
  replySpeechesEnabled,
  rulesSides,
  selfSplitAllowed,
  substantiveSpeakerCount,
  usesSpeakerScores,
  usesVotingBallots,
  validateBallotEntry,
  type BallotRules,
} from "@/lib/ballots/result";
import { scoreCriteriaFor } from "@/lib/ballots/ballotRules";
import { arrangeDebateSides, isSidePermutation, sidesChosenOnBallot, sidesPending } from "@/lib/draw/manualSides";
import { votingAdjudicatorIds } from "@/lib/ballots/individualBallots";
import { votingRoundPrivateBallot } from "@/lib/privateIndividualBallots";
import { debateSides, isPolyFormat } from "@/lib/debateSides";
import {
  resolveParticipantBallotMotion,
  resolveParticipantBallotVetoes,
  type ParticipantMotion,
} from "@/lib/ballots/participantMotion";

/**
 * Rules for a ballot submitted through an adjudicator's private URL. It is that adjudicator's
 * own scoresheet, so it is entered and checked like a consensus ballot whatever the round's
 * ballot mode; voting rounds merge the sheets in the tab room.
 */
export function privateBallotRules(
  tournament: Pick<Tournament, "format" | "preferences">,
  round: (Pick<Round, "stage"> & Partial<Pick<Round, "seq">>) | undefined,
  debate?: Pick<Debate, "teams"> | null,
  rounds?: readonly Pick<Round, "seq">[]
): BallotRules {
  const actual = debateBallotRules(tournament, round, debate, rounds);
  // Poly voting rounds: the adjudicator's own sheet records scores only (PolyNoWinScoresheet).
  const polyScoresOnly = isPolyFormat(tournament.format) && usesVotingBallots(actual);
  return {
    ...actual,
    preferences: { ...tournament.preferences, ballotMode: "consensus", eliminationBallotMode: "consensus" },
    ...(polyScoresOnly ? { polyScoresOnly: true } : {}),
  };
}

/**
 * Tabbycat `participant_ballots`: private-URL ballot submission is on unless the tournament turned
 * it off (`privateUrlBallots: false`, Tabbycat "off"). Checked by the private sync route.
 */
export function privateUrlBallotsEnabled(tournament: Pick<Tournament, "preferences">): boolean {
  return tournament.preferences?.privateUrlBallots !== false;
}

/**
 * Whether a solo adjudicator may declare a 2:1 split on their private-URL ballot: a voting round
 * whose only voting adjudicator submits it. Their sheet then becomes the voting ballot (merged
 * with individual ballots, or directly; see votingRoundPrivateBallot), so the split is recorded.
 */
export function privateSelfSplitAllowed(
  tournament: Pick<Tournament, "format" | "preferences">,
  round: Pick<Round, "stage"> | undefined,
  debate: Pick<Debate, "adjudicators">
): boolean {
  const rules: BallotRules = {
    format: tournament.format,
    preferences: tournament.preferences,
    ...(round?.stage ? { stage: round.stage } : {}),
  };
  return selfSplitAllowed(rules, votingAdjudicatorIds(debate).length);
}

export function buildPrivateBallot(
  input: Record<string, unknown>,
  {
    tournament,
    adjudicator,
    debate: drawnDebate,
    teams,
    tournamentId,
    round,
    rounds,
    roundMotions,
  }: {
    tournament: Tournament;
    adjudicator: Adjudicator;
    debate: Debate;
    teams: Map<string, Team>;
    tournamentId: string;
    /** The debate's round, for its stage (ballots may drop speaker scores in elimination rounds). */
    round?: Pick<Round, "stage"> & Partial<Pick<Round, "seq">>;
    /** Every round, so a poly ballot knows whether it is for the last round (one team advances). */
    rounds?: readonly Pick<Round, "seq">[];
    /**
     * The round's motions in order (`participantRoundMotions`). With several, the adjudicator must
     * choose the debated motion (Tabbycat `enable_motions`); with one, it is recorded. Callers that
     * do not pass them keep the debate's own motion (older behaviour).
     */
    roundMotions?: readonly ParticipantMotion[];
  }
): BallotSubmission {
  const adjudicatorId = adjudicator.id;
  const poly = isPolyFormat(tournament.format);
  // A poly room has its own sides (the last random room may be short); others the format's.
  const sides = rulesSides({ format: tournament.format, preferences: tournament.preferences, sides: debateSides(drawnDebate, tournament) });
  // Sides chosen on the ballot (manual-ballot sides): the chair records which team took which side
  // through each side's team id; the roster checks below then follow that arrangement.
  let debate = drawnDebate;
  if (sidesChosenOnBallot(drawnDebate)) {
    const submittedTeamScores = isRecord(input.teamScores) ? input.teamScores : {};
    const assignment = Object.fromEntries(sides.map((side) => {
      const score = submittedTeamScores[side];
      return [side, isRecord(score) && typeof score.teamId === "string" ? score.teamId : undefined];
    })) as Partial<Record<DebateSide, string>>;
    if (isSidePermutation(drawnDebate, assignment)) {
      debate = arrangeDebateSides(drawnDebate, assignment);
    } else if (sidesPending(drawnDebate)) {
      throw new Error("The ballot must record which team took which side.");
    }
  }
  const isVotingMember =
    !adjudicator.trainee &&
    (debate.adjudicators?.chairId === adjudicatorId ||
      debate.adjudicators?.panellistIds?.includes(adjudicatorId));
  if (!isVotingMember) {
    throw new Error("Only the chair or a voting panellist may submit a ballot.");
  }

  const id = input.id;
  if (
    typeof id !== "string" ||
    !id.startsWith(`ballot-${debate.id}-adj-${adjudicatorId}-`) ||
    id.length > 128 ||
    id.includes("/")
  ) {
    throw new Error("The ballot identifier is invalid.");
  }

  if (input.submitterType !== "judge" || input.submitterId !== adjudicatorId) {
    throw new Error("The ballot does not match this adjudicator.");
  }

  const inputSpeakerScores = input.speakerScores;
  const inputTeamScores = input.teamScores;
  if (
    !isRecord(inputSpeakerScores) ||
    !isRecord(inputTeamScores) ||
    !hasExactKeys(inputSpeakerScores, sides) ||
    !hasExactKeys(inputTeamScores, sides)
  ) {
    throw new Error("The ballot must contain scores for every debate side.");
  }

  const rules = privateBallotRules(tournament, round, debate, rounds);
  const polyProblem = polyBallotProblem(debateBallotRules(tournament, round, debate, rounds));
  if (polyProblem) throw new Error(polyProblem);
  const scored = usesSpeakerScores(rules);
  // Poly sheets without ranks: a voting round's own sheet (scores only) or a results-only ballot,
  // which declares the advancing teams through `teamScores[side].win`.
  const ranked = !poly || (scored && !rules.polyScoresOnly);
  const ranks = new Map<DebateSide, number>();
  const usedRanks = new Set<number>();
  const winners: DebateSide[] = [];
  for (const side of sides) {
    if (!ranked) {
      const score = inputTeamScores[side];
      if (!isRecord(score)) throw new Error("The ballot contains an invalid team result.");
      if (score.win === true) winners.push(side);
      continue;
    }
    const score = inputTeamScores[side];
    if (
      !isRecord(score) ||
      typeof score.rank !== "number" ||
      !Number.isInteger(score.rank) ||
      score.rank < 1 ||
      score.rank > sides.length
    ) {
      throw new Error("The ballot contains an invalid team ranking.");
    }
    if (usedRanks.has(score.rank)) {
      throw new Error("The ballot rankings must be unique.");
    }
    usedRanks.add(score.rank);
    ranks.set(side, score.rank);
  }

  const substantive = substantiveSpeakerCount(rules);
  const replyEnabled = replySpeechesEnabled(rules);
  const criteriaIds = new Set(scoreCriteriaFor(tournament.preferences).map((criterion) => criterion.id));
  const speakerScores = {} as BallotSubmission["speakerScores"];
  const rosters: Partial<Record<DebateSide, Team["speakers"]>> = {};
  for (const side of sides) {
    const slot = debate.teams?.[side];
    const team = slot && teams.get(slot.teamId);
    const submitted = inputSpeakerScores[side];
    if (!slot || !team || !Array.isArray(team.speakers) || !Array.isArray(submitted)) {
      throw new Error("The ballot does not match the debate roster.");
    }
    rosters[side] = team.speakers;
    if (!scored) {
      // A results-only ballot: whatever scores were sent are dropped.
      speakerScores[side] = [];
      continue;
    }

    const expectedCount = substantive + (replyEnabled ? 1 : 0);
    if (submitted.length !== expectedCount) {
      throw new Error("The ballot must score every speech in the debate.");
    }

    // Names come from the roster, never from the submission; scores, ranks and criteria are
    // checked by the shared ballot validation below.
    speakerScores[side] = submitted.map((entry, index) => {
      const speaker = isRecord(entry) ? team.speakers.find((candidate) => candidate.id === entry.speakerId) : undefined;
      const isReply = replyEnabled && index === substantive;
      if (
        !isRecord(entry) ||
        !speaker ||
        entry.position !== index + 1 ||
        typeof entry.score !== "number" ||
        (scoreCriteriaFor(tournament.preferences).length === 0 &&
          !(isReply ? validateReplyScore : validateSpeakerScore)(entry.score, tournament.preferences).valid)
      ) {
        throw new Error(isReply ? "The reply score is invalid." : "A speaker score is invalid or does not match the debate roster.");
      }
      const criteria = isRecord(entry.criteria)
        ? Object.fromEntries(
            Object.entries(entry.criteria).filter(([id, value]) => criteriaIds.has(id) && typeof value === "number" && Number.isFinite(value))
          ) as Record<string, number>
        : undefined;
      const speech: SpeakerScoreEntry = {
        speakerId: speaker.id,
        speakerName: speaker.name,
        position: index + 1,
        score: entry.score,
        ...(entry.ghost === true ? { ghost: true } : {}),
        ...(typeof entry.rank === "number" ? { rank: entry.rank } : {}),
        ...(criteria && Object.keys(criteria).length > 0 ? { criteria } : {}),
      };
      return speech;
    });
  }

  if (input.selfSplit !== undefined && typeof input.selfSplit !== "boolean") {
    throw new Error("The split-decision flag is invalid.");
  }
  const selfSplit = input.selfSplit === true;
  if (selfSplit && !privateSelfSplitAllowed(tournament, round, debate)) {
    throw new Error("A split decision can only be declared by a solo adjudicator, when self-split ballots are allowed.");
  }

  let motion: ParticipantMotion | undefined;
  let vetoes: Partial<Record<DebateSide, string>> | undefined;
  if (roundMotions) {
    motion = resolveParticipantBallotMotion(input.motionId, tournament.preferences, roundMotions);
    vetoes = resolveParticipantBallotVetoes(input.vetoes, sides, tournament.preferences, roundMotions, motion?.id);
  } else if (debate.motionId !== undefined) {
    motion = { id: debate.motionId, text: debate.motionText ?? "" };
  }

  const entry = { speakerScores, ...(ranked ? { ranks: Object.fromEntries(ranks) } : {}), ...(poly && !scored ? { winners } : {}) };
  const errors = validateBallotEntry(entry, { ...rules, rosters });
  if (errors.length > 0) {
    // The reply-speaker rule keeps its long-standing message for API clients.
    throw new Error(errors.some((error) => /reply/i.test(error)) ? `The reply score is invalid. ${errors.join(" ")}` : errors.join(" "));
  }
  const result = buildBallotResult(
    entry,
    Object.fromEntries(sides.map((side) => [side, debate.teams?.[side]?.teamId || ""])),
    debate.adjudicators?.chairId,
    rules
  );
  const teamScores = result.teamScores;

  const timestamp = new Date().toISOString();
  const isChair = debate.adjudicators?.chairId === adjudicatorId;
  const ballot: BallotSubmission = {
    id,
    tournamentId,
    roundId: debate.roundId,
    debateId: debate.id,
    version: 1,
    confirmed: isChair,
    discarded: false,
    submitterType: "judge",
    submitterId: adjudicatorId,
    submitterName: adjudicator.name,
    ...(motion ? { motionId: motion.id } : {}),
    ...(motion && (roundMotions || debate.motionText !== undefined) ? { motionText: motion.text } : {}),
    ...(vetoes ? { vetoes } : {}),
    speakerScores: result.speakerScores,
    teamScores,
    ...(result.noSpeakerScores ? { noSpeakerScores: true } : {}),
    ...(selfSplit ? { selfSplit: true } : {}),
    ...(debate.adjudicators?.chairId !== undefined
      ? { chairId: debate.adjudicators.chairId }
      : {}),
    timestamp,
    ...(isChair
      ? { confirmedBy: adjudicator.name, confirmedTimestamp: timestamp }
      : {}),
  };
  // A voting round's result needs every voting adjudicator's sheet (Tabbycat's per-adjudicator form).
  return votingRoundPrivateBallot(ballot, { tournament, round, debate, rounds });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: DebateSide[]): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((side) => Object.hasOwn(value, side))
  );
}

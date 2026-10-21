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
  selfSplitAllowed,
  substantiveSpeakerCount,
  usesSpeakerScores,
  validateBallotEntry,
  type BallotRules,
} from "@/lib/ballots/result";
import { scoreCriteriaFor } from "@/lib/ballots/ballotRules";
import { arrangeDebateSides, isSidePermutation, sidesChosenOnBallot, sidesPending } from "@/lib/draw/manualSides";
import { votingAdjudicatorIds } from "@/lib/ballots/individualBallots";
import { usesIndividualBallots } from "@/lib/privateIndividualBallots";

const BP_SIDES: DebateSide[] = ["OG", "OO", "CG", "CO"];
const TWO_TEAM_SIDES: DebateSide[] = ["AFF", "NEG"];

/**
 * Rules for a ballot submitted through an adjudicator's private URL. It is that adjudicator's
 * own scoresheet, so it is entered and checked like a consensus ballot whatever the round's
 * ballot mode; voting rounds merge the sheets in the tab room.
 */
export function privateBallotRules(
  tournament: Pick<Tournament, "format" | "preferences">,
  round: Pick<Round, "stage"> | undefined
): BallotRules {
  return {
    format: tournament.format,
    preferences: { ...tournament.preferences, ballotMode: "consensus", eliminationBallotMode: "consensus" },
    ...(round?.stage ? { stage: round.stage } : {}),
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
 * Whether a solo adjudicator may declare a 2:1 split on their private-URL ballot. The private
 * ballot becomes a voting ballot only through individual ballots (merged into one voting ballot);
 * otherwise it is stored as a consensus-shaped ballot without votes, where a split would mean
 * nothing, so the option is offered only with individual ballots on. The tab room can still record
 * a split when it enters or re-enters the voting ballot.
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
  return usesIndividualBallots(tournament, round) && selfSplitAllowed(rules, votingAdjudicatorIds(debate).length);
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
  }: {
    tournament: Tournament;
    adjudicator: Adjudicator;
    debate: Debate;
    teams: Map<string, Team>;
    tournamentId: string;
    /** The debate's round, for its stage (ballots may drop speaker scores in elimination rounds). */
    round?: Pick<Round, "stage">;
  }
): BallotSubmission {
  const adjudicatorId = adjudicator.id;
  const sides = tournament.format === "bp" ? BP_SIDES : TWO_TEAM_SIDES;
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

  const ranks = new Map<DebateSide, number>();
  const usedRanks = new Set<number>();
  for (const side of sides) {
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

  const rules = privateBallotRules(tournament, round);
  const scored = usesSpeakerScores(rules);
  const substantive = substantiveSpeakerCount(rules);
  const replyEnabled = Boolean(tournament.preferences?.replyScoresEnabled && tournament.format !== "bp");
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

  const entry = { speakerScores, ranks: Object.fromEntries(ranks) };
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
  return {
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
    ...(debate.motionId !== undefined ? { motionId: debate.motionId } : {}),
    ...(debate.motionText !== undefined ? { motionText: debate.motionText } : {}),
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

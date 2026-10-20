import {
  Adjudicator,
  BallotSubmission,
  Debate,
  DebateSide,
  Team,
  Tournament,
} from "@/types";
import { validateReplyScore, validateSpeakerScore } from "@/lib/scoring/validator";
import { consensusTeamScores } from "@/lib/ballots/result";
import { arrangeDebateSides, isSidePermutation, sidesChosenOnBallot, sidesPending } from "@/lib/draw/manualSides";

const BP_SIDES: DebateSide[] = ["OG", "OO", "CG", "CO"];
const TWO_TEAM_SIDES: DebateSide[] = ["AFF", "NEG"];

export function buildPrivateBallot(
  input: Record<string, unknown>,
  {
    tournament,
    adjudicator,
    debate: drawnDebate,
    teams,
    tournamentId,
  }: {
    tournament: Tournament;
    adjudicator: Adjudicator;
    debate: Debate;
    teams: Map<string, Team>;
    tournamentId: string;
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

  const speakerScores = {} as BallotSubmission["speakerScores"];
  for (const side of sides) {
    const slot = debate.teams?.[side];
    const team = slot && teams.get(slot.teamId);
    const submitted = inputSpeakerScores[side];
    if (!slot || !team || !Array.isArray(team.speakers) || !Array.isArray(submitted)) {
      throw new Error("The ballot does not match the debate roster.");
    }

    const replyEnabled = Boolean(tournament.preferences?.replyScoresEnabled && tournament.format !== "bp");
    const expectedCount = team.speakers.length + (replyEnabled ? 1 : 0);
    if (submitted.length !== expectedCount) {
      throw new Error("The ballot must score every speaker in the debate roster.");
    }

    const scores = team.speakers.map((speaker, index) => {
      const entry = submitted[index];
      if (
        !isRecord(entry) ||
        entry.speakerId !== speaker.id ||
        entry.position !== index + 1 ||
        typeof entry.score !== "number" ||
        !validateSpeakerScore(entry.score, tournament.preferences).valid
      ) {
        throw new Error("A speaker score is invalid or does not match the debate roster.");
      }
      return {
        speakerId: speaker.id,
        speakerName: speaker.name,
        position: index + 1,
        score: entry.score,
      };
    });

    if (replyEnabled) {
      const entry = submitted[team.speakers.length];
      // The reply is given by one of the first (n - 1) substantive speakers.
      const replySpeaker = team.speakers
        .slice(0, Math.max(1, team.speakers.length - 1))
        .find((speaker) => isRecord(entry) && speaker.id === entry.speakerId);
      if (
        !isRecord(entry) ||
        !replySpeaker ||
        entry.position !== 4 ||
        typeof entry.score !== "number" ||
        !validateReplyScore(entry.score, tournament.preferences).valid
      ) {
        throw new Error("The reply score is invalid.");
      }
      scores.push({
        speakerId: replySpeaker.id,
        speakerName: replySpeaker.name,
        position: 4,
        score: entry.score,
      });
    }
    speakerScores[side] = scores;
  }
  const teamScores = consensusTeamScores(
    speakerScores,
    Object.fromEntries(ranks),
    Object.fromEntries(sides.map((side) => [side, debate.teams?.[side]?.teamId || ""])),
    { format: tournament.format, preferences: tournament.preferences }
  );

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
    speakerScores,
    teamScores,
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

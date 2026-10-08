import {
  Adjudicator,
  BallotSubmission,
  Debate,
  DebateSide,
  Team,
  Tournament,
} from "@/types";
import { validateReplyScore, validateSpeakerScore } from "@/lib/scoring/validator";

const BP_SIDES: DebateSide[] = ["OG", "OO", "CG", "CO"];
const TWO_TEAM_SIDES: DebateSide[] = ["AFF", "NEG"];

export function buildPrivateBallot(
  input: Record<string, unknown>,
  {
    tournament,
    adjudicator,
    debate,
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
  const isVotingMember =
    !adjudicator.trainee &&
    (debate.adjudicators?.chairId === adjudicatorId ||
      debate.adjudicators?.panellistIds?.includes(adjudicatorId));
  if (!isVotingMember) {
    throw new Error("Only the chair or a voting panellist may submit a ballot.");
  }

  const sides = tournament.format === "bp" ? BP_SIDES : TWO_TEAM_SIDES;
  const id = input.id;
  if (
    typeof id !== "string" ||
    !id.startsWith(`ballot-${debate.id}-adj-`) ||
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
  const teamScores = {} as BallotSubmission["teamScores"];
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
      if (
        !isRecord(entry) ||
        entry.speakerId !== `reply-${side}` ||
        entry.position !== 4 ||
        typeof entry.score !== "number" ||
        !validateReplyScore(entry.score, tournament.preferences).valid
      ) {
        throw new Error("The reply score is invalid.");
      }
      scores.push({
        speakerId: `reply-${side}`,
        speakerName: `${team.name} Reply`,
        position: 4,
        score: entry.score,
      });
    }
    speakerScores[side] = scores;

    const includeGhosts = tournament.preferences?.teamScoreIncludesGhosts ?? false;
    const substantiveScores = includeGhosts
      ? scores.slice(0, team.speakers.length)
      : scores
          .slice(0, team.speakers.length)
          .filter((entry, index, all) =>
            all.findIndex((candidate) => candidate.speakerId === entry.speakerId) === index
          );
    const totalSpeakerScore =
      substantiveScores.reduce((sum, entry) => sum + entry.score, 0) +
      (replyEnabled ? scores[team.speakers.length].score : 0);
    const rank = ranks.get(side)!;
    const points =
      tournament.format === "bp"
        ? sides.length - rank
        : rank === 1
          ? 1
          : 0;
    teamScores[side] = {
      side,
      teamId: slot.teamId,
      points,
      totalSpeakerScore,
      rank,
      win: points > 0,
      ...(tournament.format === "bp" ? {} : { margin: rank === 1 ? 2 : -2 }),
    };
  }

  const timestamp = new Date().toISOString();
  return {
    id,
    tournamentId,
    roundId: debate.roundId,
    debateId: debate.id,
    version: 1,
    confirmed: true,
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
    confirmedBy: adjudicator.name,
    confirmedTimestamp: timestamp,
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

import type { Debate, DebateSide, FeedbackAnswer, Round, Team } from "@/types";
import { sidesChosenOnBallot } from "@/lib/draw/manualSides";

/**
 * Client-side helpers for the public ballot and feedback forms (#26). They work on the public
 * projection only; the server re-validates everything with the private-portal rules.
 */

/** Rounds a public form can be used for: released draw and announced panels, newest first. */
export function publicFormRounds(rounds: Round[]): Round[] {
  return rounds
    .filter((round) => {
      const drawPublic = (round as Round & { drawPublic?: boolean }).drawPublic;
      return (
        round.cancelled !== true &&
        round.adjudicatorsRevealed === true &&
        (drawPublic ?? (round.drawStatus === "confirmed" || round.drawStatus === "released"))
      );
    })
    .sort((left, right) => right.seq - left.seq);
}

export interface PublicFormParticipant {
  type: "team" | "adjudicator";
  id: string;
  name: string;
  debateId: string;
}

/** Voting adjudicators (chairs and panellists) in a round, by name; anonymous people are left out. */
export function ballotSubmitters(debates: Debate[], roundId: string): PublicFormParticipant[] {
  return debates
    .filter((debate) => debate.roundId === roundId)
    .flatMap((debate) => {
      const panel = debate.adjudicators;
      const ids = [panel?.chairId, ...(panel?.panellistIds ?? [])];
      const names = [panel?.chairName, ...(panel?.panellistNames ?? [])];
      return ids.flatMap((id, index) =>
        id && names[index] ? [{ type: "adjudicator" as const, id, name: names[index]!, debateId: debate.id }] : []
      );
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Everyone who can give feedback in a round: its teams and its adjudicators (trainees included). */
export function feedbackSources(debates: Debate[], roundId: string): PublicFormParticipant[] {
  return debates
    .filter((debate) => debate.roundId === roundId)
    .flatMap((debate) => {
      const teams = Object.values(debate.teams ?? {}).flatMap((slot) =>
        slot?.teamId && slot.teamName ? [{ type: "team" as const, id: slot.teamId, name: slot.teamName, debateId: debate.id }] : []
      );
      const panel = debate.adjudicators;
      const ids = [panel?.chairId, ...(panel?.panellistIds ?? []), ...(panel?.traineeIds ?? [])];
      const names = [panel?.chairName, ...(panel?.panellistNames ?? []), ...(panel?.traineeNames ?? [])];
      const adjudicators = ids.flatMap((id, index) =>
        id && names[index] ? [{ type: "adjudicator" as const, id, name: names[index]!, debateId: debate.id }] : []
      );
      return [...teams, ...adjudicators];
    })
    .sort((left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name));
}

/** Whether the public ballot form can take this debate (sides chosen on the ballot need the private URL or tab room). */
export function canUsePublicBallot(debate: Debate): boolean {
  return !debate.byeTeamId && !sidesChosenOnBallot(debate);
}

/** Ranks from team totals, highest first; null when two totals tie (the submitter must choose). */
export function ranksFromTotals(totals: Partial<Record<DebateSide, number>>, sides: DebateSide[]): Partial<Record<DebateSide, number>> | null {
  const values = sides.map((side) => totals[side]);
  if (values.some((value) => value === undefined || !Number.isFinite(value))) return null;
  if (new Set(values).size !== values.length) return null;
  const ordered = [...sides].sort((left, right) => (totals[right] ?? 0) - (totals[left] ?? 0));
  return Object.fromEntries(ordered.map((side, index) => [side, index + 1]));
}

export interface PublicBallotInput {
  debate: Debate;
  adjudicatorId: string;
  sides: DebateSide[];
  teamsById: Map<string, Pick<Team, "speakers">>;
  /** side -> substantive scores in roster order. */
  scores: Partial<Record<DebateSide, number[]>>;
  /** side -> reply speaker id and score, when replies are scored. */
  replies?: Partial<Record<DebateSide, { speakerId: string; score: number }>>;
  ranks: Partial<Record<DebateSide, number>>;
  nonce: string;
}

/** The ballot record the server's ballot rules expect (lib/privateBallot.ts). */
export function buildPublicBallotRecord(input: PublicBallotInput): Record<string, unknown> {
  const speakerScores = Object.fromEntries(
    input.sides.map((side) => {
      const teamId = input.debate.teams?.[side]?.teamId ?? "";
      const speakers = input.teamsById.get(teamId)?.speakers ?? [];
      const entries: Array<Record<string, unknown>> = speakers.map((speaker, index) => ({
        speakerId: speaker.id,
        position: index + 1,
        score: input.scores[side]?.[index],
      }));
      const reply = input.replies?.[side];
      if (input.replies) entries.push({ speakerId: reply?.speakerId, position: 4, score: reply?.score });
      return [side, entries];
    })
  );
  return {
    id: `ballot-${input.debate.id}-adj-${input.adjudicatorId}-public-${input.nonce}`,
    debateId: input.debate.id,
    submitterType: "judge",
    submitterId: input.adjudicatorId,
    speakerScores,
    teamScores: Object.fromEntries(
      input.sides.map((side) => [side, { side, teamId: input.debate.teams?.[side]?.teamId ?? "", rank: input.ranks[side] }])
    ),
  };
}

export function buildPublicFeedbackRecord(input: {
  debateId: string;
  source: Pick<PublicFormParticipant, "type" | "id">;
  targetAdjudicatorId: string;
  score: number;
  comments?: string;
  answers?: Record<string, FeedbackAnswer>;
  nonce: string;
}): Record<string, unknown> {
  return {
    id: `feedback-public-${input.nonce}`,
    debateId: input.debateId,
    targetType: "adjudicator",
    targetAdjudicatorId: input.targetAdjudicatorId,
    sourceType: input.source.type,
    sourceId: input.source.id,
    score: input.score,
    ...(input.comments?.trim() ? { comments: input.comments.trim() } : {}),
    ...(input.answers && Object.keys(input.answers).length > 0 ? { answers: input.answers } : {}),
  };
}

/** A random id part for client-created records. */
export function submissionNonce(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

import type { Adjudicator, BallotSubmission, Debate, DebateSide, FeedbackSubmission, Round, Team } from "@/types";

/**
 * The tab room's record of one team (Tabbycat participants-team-record): every debate in every
 * round, released or not, with the result and speeches from the confirmed ballot, plus the
 * adjudicators conflicted with the team. Unlike the public record page it ignores release settings,
 * so it is for administrators only.
 */

export type AdminResultStatus = "confirmed" | "unconfirmed" | "none";

export interface AdminTeamRecordRow {
  roundId: string;
  roundName: string;
  roundSeq: number;
  debateId: string;
  side: DebateSide;
  venueName?: string;
  opponents: string[];
  panel: { chair?: string; panellists: string[]; trainees: string[] };
  status: AdminResultStatus;
  /** From the confirmed ballot. */
  result?: { points: number; win?: boolean; rank?: number; forfeit?: boolean; speakerTotal?: number };
  speeches: Array<{ speakerName: string; position: number; score: number; ghost?: boolean }>;
  /** Whether the round's results are public (released). */
  released: boolean;
  bye?: boolean;
}

export interface TeamConflictRow {
  adjudicatorId: string;
  adjudicatorName: string;
  reason: "personal" | "institution" | "team_institution";
}

function confirmedBallot(ballots: BallotSubmission[], debateId: string): BallotSubmission | undefined {
  return ballots
    .filter((ballot) => ballot.debateId === debateId && ballot.confirmed === true && ballot.discarded !== true)
    .sort((left, right) => (right.version ?? 0) - (left.version ?? 0))[0];
}

export function adminTeamRecord(
  teamId: string,
  input: { rounds: Round[]; debates: Debate[]; ballots: BallotSubmission[]; adjudicators: Pick<Adjudicator, "id" | "name">[] }
): AdminTeamRecordRow[] {
  const rounds = new Map(input.rounds.filter((round) => !round.cancelled).map((round) => [round.id, round]));
  const names = new Map(input.adjudicators.map((adjudicator) => [adjudicator.id, adjudicator.name]));
  const name = (id: string, stored?: string) => names.get(id) ?? stored ?? id;
  const rows: AdminTeamRecordRow[] = [];
  for (const debate of input.debates) {
    const round = rounds.get(debate.roundId);
    if (!round) continue;
    const entries = Object.entries(debate.teams ?? {}) as Array<[DebateSide, Debate["teams"][DebateSide]]>;
    const own = entries.find(([, slot]) => slot?.teamId === teamId);
    const bye = debate.byeTeamId === teamId;
    if (!own && !bye) continue;
    const side = (own?.[0] ?? entries[0]?.[0] ?? "AFF") as DebateSide;
    const ballot = confirmedBallot(input.ballots, debate.id);
    const hasUnconfirmed = input.ballots.some(
      (item) => item.debateId === debate.id && item.confirmed !== true && item.discarded !== true
    );
    const score = own ? ballot?.teamScores?.[side] : undefined;
    const panel = debate.adjudicators;
    rows.push({
      roundId: round.id,
      roundName: round.name,
      roundSeq: round.seq,
      debateId: debate.id,
      side,
      ...(debate.venueName ? { venueName: debate.venueName } : {}),
      opponents: entries.filter(([, slot]) => slot?.teamId && slot.teamId !== teamId).map(([, slot]) => slot!.teamName ?? slot!.teamId),
      panel: {
        ...(panel?.chairId ? { chair: name(panel.chairId, panel.chairName) } : {}),
        panellists: (panel?.panellistIds ?? []).map((id, index) => name(id, panel?.panellistNames?.[index])),
        trainees: (panel?.traineeIds ?? []).map((id, index) => name(id, panel?.traineeNames?.[index])),
      },
      status: ballot ? "confirmed" : hasUnconfirmed ? "unconfirmed" : "none",
      ...(score
        ? {
            result: {
              points: score.points,
              ...(score.win !== undefined ? { win: score.win } : {}),
              ...(score.rank !== undefined ? { rank: score.rank } : {}),
              ...(score.forfeit ? { forfeit: true } : {}),
              ...(ballot?.noSpeakerScores ? {} : { speakerTotal: score.totalSpeakerScore }),
            },
          }
        : {}),
      speeches: own && ballot && !ballot.noSpeakerScores
        ? (ballot.speakerScores?.[side] ?? [])
            .map((entry) => ({
              speakerName: entry.speakerName,
              position: entry.position,
              score: entry.score,
              ...(entry.ghost ? { ghost: true } : {}),
            }))
            .sort((left, right) => left.position - right.position)
        : [],
      released: round.resultsReleased === true,
      ...(bye ? { bye: true } : {}),
    });
  }
  return rows.sort((left, right) => left.roundSeq - right.roundSeq || left.debateId.localeCompare(right.debateId));
}

/**
 * Adjudicators who may not judge the team: personal team conflicts, conflicts with the team's
 * institution, and adjudicators from an institution the team declared a conflict with.
 */
export function teamConflicts(
  team: Pick<Team, "id" | "institutionId" | "institutionConflictIds">,
  adjudicators: Pick<Adjudicator, "id" | "name" | "conflicts" | "institutionId">[]
): TeamConflictRow[] {
  const teamInstitutions = new Set(team.institutionConflictIds ?? []);
  const rows: TeamConflictRow[] = [];
  for (const adjudicator of adjudicators) {
    const conflicts = adjudicator.conflicts ?? [];
    if (conflicts.some((conflict) => conflict.teamId === team.id)) {
      rows.push({ adjudicatorId: adjudicator.id, adjudicatorName: adjudicator.name, reason: "personal" });
    } else if (
      team.institutionId &&
      conflicts.some((conflict) => conflict.institutionId === team.institutionId && !conflict.teamId && !conflict.adjudicatorId)
    ) {
      rows.push({ adjudicatorId: adjudicator.id, adjudicatorName: adjudicator.name, reason: "institution" });
    } else if (adjudicator.institutionId && teamInstitutions.has(adjudicator.institutionId)) {
      rows.push({ adjudicatorId: adjudicator.id, adjudicatorName: adjudicator.name, reason: "team_institution" });
    }
  }
  return rows.sort((left, right) => left.adjudicatorName.localeCompare(right.adjudicatorName));
}

/** Feedback the team submitted, and feedback on the team, newest first. */
export function teamFeedback(teamId: string, feedback: FeedbackSubmission[]) {
  const newest = (left: FeedbackSubmission, right: FeedbackSubmission) => (right.timestamp || "").localeCompare(left.timestamp || "");
  return {
    submitted: feedback.filter((item) => item.sourceType === "team" && item.sourceId === teamId).sort(newest),
    received: feedback.filter((item) => item.targetType === "team" && item.targetTeamId === teamId).sort(newest),
  };
}

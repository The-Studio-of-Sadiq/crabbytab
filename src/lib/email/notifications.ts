import type {
  Adjudicator,
  BallotSubmission,
  Debate,
  DebateSide,
  Round,
  Team,
  TeamStandingRow,
  TournamentPreferences,
} from "@/types";
import { MAX_CAMPAIGN_RECIPIENTS, resolveEmailRecipients, type EmailRecipient } from "@/lib/email/messaging";
import { isDrawVisibleToTeams } from "@/lib/privatePortalBallots";

/**
 * Automatic notifications (Tabbycat's draw / results / ballot receipt emails). Everything here is
 * pure; the server route reads the cloud copy, decides what is due from it and records each send.
 *
 * Release rules, so that nothing unreleased is ever emailed:
 * - draw to teams: the draw is visible to teams (confirmed or released);
 * - draw to adjudicators: the same, and the panels have been revealed;
 * - team points: the round's results are released, the round is not silent and public results
 *   are on; the running total only counts rounds that pass the same test;
 * - ballot receipt: sent to the adjudicator who submitted the ballot, and only contains what they
 *   submitted.
 */

export const ROUND_NOTIFICATION_EVENTS = ["draw_teams", "draw_adjudicators", "team_points"] as const;
export type RoundNotificationEvent = (typeof ROUND_NOTIFICATION_EVENTS)[number];
export type NotificationEvent = RoundNotificationEvent | "ballot_receipt";

export const NOTIFICATION_TEMPLATES: Record<NotificationEvent, { subject: string; body: string }> = {
  draw_teams: {
    subject: "{{tournament}} — {{round}} draw",
    body:
      "Hi {{name}},\n\nThe draw for {{round}} has been released.\n\nTeam: {{team}}\nSide: {{side}}\nDebate: {{debate}}\nVenue: {{venue}}\nChair: {{chair}}\n\nGood luck!\nTournament Staff",
  },
  draw_adjudicators: {
    subject: "{{tournament}} — {{round}} adjudicator allocation",
    body:
      "Hi {{name}},\n\nYour allocation for {{round}}:\n\nDebate: {{debate}}\nVenue: {{venue}}\nChair: {{chair}}\nPanellists: {{panellists}}\n\nThank you,\nTournament Staff",
  },
  team_points: {
    subject: "{{tournament}} — {{round}} result for {{team}}",
    body:
      "Hi {{name}},\n\nResults for {{round}} have been released.\n\nTeam: {{team}}\nResult: {{result}}\nTeam points after released rounds: {{points}}\n\nTournament Staff",
  },
  ballot_receipt: {
    subject: "{{tournament}} — ballot received for {{round}}",
    body:
      "Hi {{name}},\n\nWe received your ballot for {{debate}} ({{round}}, {{venue}}).\n\n{{ballot}}\n\nIf this is not what you submitted, contact the tab room straight away.\n\nTournament Staff",
  },
};

export type NotificationPreferences = Pick<
  TournamentPreferences,
  "notifyDrawReleased" | "notifyTeamPoints" | "notifyBallotReceipt" | "publicResults"
>;

/** Whether a round's results may be emailed to teams (and counted in running totals). */
export function areRoundResultsReleased(
  round: Pick<Round, "resultsReleased" | "silent" | "cancelled">,
  preferences: Partial<NotificationPreferences> | undefined
): boolean {
  return round.resultsReleased === true && round.silent !== true && round.cancelled !== true &&
    preferences?.publicResults !== false;
}

export interface DueRoundNotification {
  event: RoundNotificationEvent;
  round: Round;
}

/** Round notifications the organiser has opted in to whose release condition currently holds. */
export function releasedRoundNotifications(
  preferences: Partial<NotificationPreferences> | undefined,
  rounds: Round[]
): DueRoundNotification[] {
  const due: DueRoundNotification[] = [];
  for (const round of [...rounds].sort((left, right) => left.seq - right.seq)) {
    if (round.cancelled) continue;
    if (preferences?.notifyDrawReleased === true && isDrawVisibleToTeams(round)) {
      due.push({ event: "draw_teams", round });
      if (round.adjudicatorsRevealed === true) due.push({ event: "draw_adjudicators", round });
    }
    if (preferences?.notifyTeamPoints === true && areRoundResultsReleased(round, preferences)) {
      due.push({ event: "team_points", round });
    }
  }
  return due;
}

/** Firestore document id of the log entry for one notification (ids never contain "/"). */
export function notificationLogId(event: NotificationEvent, subjectId: string): string {
  return `${event}-${subjectId}`;
}

export interface NotificationLogEntry {
  event: NotificationEvent;
  subjectId: string;
  /** "skipped": released before the organiser opted in, so never sent. */
  status: "skipped" | "sending" | "done";
  chunksClaimed: number;
  totalChunks?: number;
  updatedAt: string;
}

/** Splits recipients (sorted by address so chunks are stable between calls) into sendable chunks. */
export function chunkRecipients(recipients: EmailRecipient[], size = MAX_CAMPAIGN_RECIPIENTS): EmailRecipient[][] {
  const sorted = [...recipients].sort((left, right) =>
    left.email.toLowerCase().localeCompare(right.email.toLowerCase()) || left.name.localeCompare(right.name)
  );
  const chunks: EmailRecipient[][] = [];
  for (let index = 0; index < sorted.length; index += size) chunks.push(sorted.slice(index, index + size));
  return chunks;
}

function teamSide(debates: Debate[], teamId: string | undefined): DebateSide | undefined {
  if (!teamId) return undefined;
  for (const debate of debates) {
    for (const slot of Object.values(debate.teams || {})) {
      if (slot?.teamId === teamId) return debate.byeTeamId === teamId ? undefined : slot.side;
    }
  }
  return undefined;
}

/** Draw emails for the speakers of every team in the round. Panels stay "TBA" until revealed. */
export function buildDrawTeamRecipients(
  round: Round,
  debates: Debate[],
  teams: Team[],
  adjudicators: Adjudicator[]
): EmailRecipient[] {
  if (!isDrawVisibleToTeams(round)) return [];
  const roundDebates = debates.filter((debate) => debate.roundId === round.id);
  return resolveEmailRecipients("round_participants", teams, adjudicators, roundDebates, round).map((recipient) => {
    const side = teamSide(roundDebates, recipient.teamId);
    const isBye = roundDebates.some((debate) => debate.byeTeamId && debate.byeTeamId === recipient.teamId);
    return {
      ...recipient,
      side: isBye ? "Bye" : side ?? "",
      chair: round.adjudicatorsRevealed === true ? recipient.chair : "TBA",
      panellists: round.adjudicatorsRevealed === true ? recipient.panellists : "TBA",
    };
  });
}

/** Allocation emails for every adjudicator on a panel in the round, once panels are revealed. */
export function buildDrawAdjudicatorRecipients(
  round: Round,
  debates: Debate[],
  teams: Team[],
  adjudicators: Adjudicator[]
): EmailRecipient[] {
  if (!isDrawVisibleToTeams(round) || round.adjudicatorsRevealed !== true) return [];
  const roundDebates = debates.filter((debate) => debate.roundId === round.id);
  return resolveEmailRecipients("round_adjudicators", teams, adjudicators, roundDebates, round);
}

function ordinal(rank: number): string {
  return ({ 1: "1st", 2: "2nd", 3: "3rd" } as Record<number, string>)[rank] ?? `${rank}th`;
}

function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * Result emails for every team in the round. `standings` must be calculated over released rounds
 * only (see areRoundResultsReleased), so the running total never includes unreleased results.
 */
export function buildTeamPointsRecipients(
  round: Round,
  debates: Debate[],
  teams: Team[],
  standings: TeamStandingRow[],
  isBP: boolean,
  preferences: Partial<NotificationPreferences> | undefined
): EmailRecipient[] {
  if (!areRoundResultsReleased(round, preferences)) return [];
  const roundDebates = debates.filter((debate) => debate.roundId === round.id);
  const rowByTeam = new Map(standings.map((row) => [row.teamId, row]));
  return resolveEmailRecipients("round_participants", teams, [], roundDebates, round).flatMap((recipient) => {
    const row = recipient.teamId ? rowByTeam.get(recipient.teamId) : undefined;
    const roundResult = row?.roundResults.find((result) => result.roundSeq === round.seq);
    const bye = roundDebates.find((debate) => debate.byeTeamId && debate.byeTeamId === recipient.teamId);
    let result: string;
    if (bye) {
      result = bye.byeResult === "win" ? "Bye (win awarded)" : "Bye";
    } else if (!roundResult) {
      // No confirmed result for this team yet: say nothing rather than report a zero.
      return [];
    } else if (isBP) {
      result = roundResult.rank ? `${ordinal(roundResult.rank)} place (${formatPoints(roundResult.points)} points)` : `${formatPoints(roundResult.points)} points`;
    } else {
      result = roundResult.win ? "Win" : "Loss";
    }
    return [{
      ...recipient,
      side: teamSide(roundDebates, recipient.teamId) ?? "",
      result,
      points: row ? formatPoints(row.points) : "",
    }];
  });
}

/** A plain-text summary of a submitted ballot for the submitting adjudicator's receipt. */
export function summarizeBallot(ballot: BallotSubmission, debate: Debate, isBP: boolean): string {
  const sides = (isBP ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"]) as DebateSide[];
  const lines: string[] = [];
  if (ballot.motionText) lines.push(`Motion: ${ballot.motionText}`);
  if (ballot.forfeitSide) {
    const name = debate.teams?.[ballot.forfeitSide]?.teamName || ballot.forfeitSide;
    lines.push(`Forfeit by ${name} (${ballot.forfeitSide}).`);
  }
  for (const side of sides) {
    const slot = debate.teams?.[side];
    const score = ballot.teamScores?.[side];
    if (!slot || !score) continue;
    const outcome = isBP
      ? score.rank ? `${ordinal(score.rank)}, ${formatPoints(score.points)} points` : `${formatPoints(score.points)} points`
      : score.win ? "Win" : "Loss";
    lines.push(`${side} ${slot.teamName}: ${outcome}, total ${formatPoints(score.totalSpeakerScore)}`);
    for (const speech of ballot.speakerScores?.[side] ?? []) {
      lines.push(`  ${speech.position}. ${speech.speakerName}: ${formatPoints(speech.score)}${speech.ghost ? " (duplicate speech)" : ""}`);
    }
  }
  return lines.join("\n");
}

export function buildBallotReceiptRecipient(
  adjudicator: Pick<Adjudicator, "id" | "name" | "email">,
  ballot: BallotSubmission,
  debate: Debate,
  round: Pick<Round, "name"> | undefined,
  isBP: boolean
): EmailRecipient | null {
  const email = adjudicator.email?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return {
    email,
    name: adjudicator.name,
    adjudicatorId: adjudicator.id,
    round: round?.name,
    debate: Object.values(debate.teams || {})
      .map((slot) => slot?.teamName)
      .filter(Boolean)
      .join(" vs "),
    venue: debate.venueName || "",
    ballot: summarizeBallot(ballot, debate, isBP),
  };
}

import type {
  Adjudicator,
  BallotSubmission,
  Debate,
  DebateSide,
  Motion,
  Round,
  Team,
  TeamStandingRow,
  TournamentPreferences,
  Venue,
} from "@/types";
import { MAX_CAMPAIGN_RECIPIENTS, resolveEmailRecipients, type EmailRecipient } from "@/lib/email/messaging";
import { sheetOutcome, teamSpeakerTotal, type BallotRules } from "@/lib/ballots/result";
import { isDrawVisibleToAdjudicators, isDrawVisibleToTeams } from "@/lib/privatePortalBallots";
import { DEFAULT_EMAIL_TEMPLATES, type EmailTemplate } from "@/lib/email/settings";
import { compareSides, isPolySide } from "@/lib/debateSides";

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

export const ROUND_NOTIFICATION_EVENTS = ["draw_teams", "draw_adjudicators", "team_points", "motions_released"] as const;
export type RoundNotificationEvent = (typeof ROUND_NOTIFICATION_EVENTS)[number];
export type NotificationEvent = RoundNotificationEvent | "ballot_receipt" | "ballot_confirmed";

/** Default wording; each tournament may save its own (lib/email/settings.ts, `templateFor`). */
export const NOTIFICATION_TEMPLATES: Record<NotificationEvent, EmailTemplate> = {
  draw_teams: DEFAULT_EMAIL_TEMPLATES.draw_teams,
  draw_adjudicators: DEFAULT_EMAIL_TEMPLATES.draw_adjudicators,
  team_points: DEFAULT_EMAIL_TEMPLATES.team_points,
  motions_released: DEFAULT_EMAIL_TEMPLATES.motions_released,
  ballot_receipt: DEFAULT_EMAIL_TEMPLATES.ballot_receipt,
  ballot_confirmed: DEFAULT_EMAIL_TEMPLATES.ballot_confirmed,
};

export type NotificationPreferences = Pick<
  TournamentPreferences,
  | "notifyDrawReleased"
  | "notifyTeamPoints"
  | "notifyBallotReceipt"
  | "notifyMotionsReleased"
  | "notifyBallotConfirmed"
  | "publicResults"
>;

/** Whether a round's results may be emailed to teams (and counted in running totals). */
export function areRoundResultsReleased(
  round: Pick<Round, "resultsReleased" | "silent" | "cancelled">,
  preferences: Partial<NotificationPreferences> | undefined
): boolean {
  return round.resultsReleased === true && round.silent !== true && round.cancelled !== true &&
    preferences?.publicResults !== false;
}

/**
 * Whether a round's motions may be emailed: released for the round and its draw fully released
 * (a teams-only release does not reach adjudicators, who also receive motions).
 * The one place that decides it, so the three-state motion release (G5) only changes this.
 */
export function areRoundMotionsReleased(round: Pick<Round, "motionsReleased" | "drawStatus" | "cancelled">): boolean {
  return round.motionsReleased === true && round.cancelled !== true && isDrawVisibleToAdjudicators(round as Round);
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
      // A teams-only release emails teams; adjudicators are emailed once the draw is fully released.
      due.push({ event: "draw_teams", round });
      if (round.adjudicatorsRevealed === true && isDrawVisibleToAdjudicators(round)) {
        due.push({ event: "draw_adjudicators", round });
      }
    }
    if (preferences?.notifyTeamPoints === true && areRoundResultsReleased(round, preferences)) {
      due.push({ event: "team_points", round });
    }
    if (preferences?.notifyMotionsReleased === true && areRoundMotionsReleased(round)) {
      due.push({ event: "motions_released", round });
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
  adjudicators: Adjudicator[],
  venues: Array<Pick<Venue, "id" | "url">> = []
): EmailRecipient[] {
  if (!isDrawVisibleToTeams(round)) return [];
  const roundDebates = debates.filter((debate) => debate.roundId === round.id);
  // Panels stay "TBA" in a teams-only release, as on the team portal.
  const panelsShown = round.adjudicatorsRevealed === true && isDrawVisibleToAdjudicators(round);
  return resolveEmailRecipients("round_participants", teams, adjudicators, roundDebates, round, { venues }).map((recipient) => {
    const side = teamSide(roundDebates, recipient.teamId);
    const isBye = roundDebates.some((debate) => debate.byeTeamId && debate.byeTeamId === recipient.teamId);
    return {
      ...recipient,
      side: isBye ? "Bye" : side ?? "",
      chair: panelsShown ? recipient.chair : "TBA",
      panellists: panelsShown ? recipient.panellists : "TBA",
    };
  });
}

/**
 * Allocation emails for every adjudicator on a panel in the round, once panels are revealed. As
 * Tabbycat's AdjudicatorAssignmentEmailGenerator, each carries the adjudicator's position and, given
 * `links`, their own private URL ({{private_url}} / {{key}}; the passcode is never included).
 */
export function buildDrawAdjudicatorRecipients(
  round: Round,
  debates: Debate[],
  teams: Team[],
  adjudicators: Adjudicator[],
  venues: Array<Pick<Venue, "id" | "url">> = [],
  links: { privateUrlOrigin?: string; tournamentSlug?: string } = {}
): EmailRecipient[] {
  if (!isDrawVisibleToAdjudicators(round) || round.adjudicatorsRevealed !== true) return [];
  const roundDebates = debates.filter((debate) => debate.roundId === round.id);
  const withLinks = Boolean(links.privateUrlOrigin && links.tournamentSlug);
  return resolveEmailRecipients("round_adjudicators", teams, adjudicators, roundDebates, round, {
    venues,
    ...(withLinks ? { includePrivateCredentials: true, ...links } : {}),
  }).map(({ passcode: _passcode, ...recipient }) => recipient);
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
    } else if (isPolySide(roundResult.side)) {
      // N teams per room: a rank (scored consensus ballot), advancing (results-only) or scores only.
      result = roundResult.rank
        ? `${ordinal(roundResult.rank)} place (${formatPoints(roundResult.points)} points)`
        : roundResult.win !== undefined
          ? roundResult.win ? "Advances" : "Eliminated"
          : `Total ${formatPoints(roundResult.speakerScore)}`;
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
  const polySides = Object.keys(debate.teams || {}).filter(isPolySide).sort(compareSides) as DebateSide[];
  const poly = polySides.length > 0;
  const sides = poly ? polySides : (isBP ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"]) as DebateSide[];
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
    const outcome = isBP || (poly && score.rank)
      ? score.rank ? `${ordinal(score.rank)}, ${formatPoints(score.points)} points` : `${formatPoints(score.points)} points`
      : poly
        ? score.win === undefined ? "" : score.win ? "Advances" : "Eliminated"
        : score.win ? "Win" : "Loss";
    lines.push(`${side} ${slot.teamName}: ${outcome ? `${outcome}, ` : ""}total ${formatPoints(score.totalSpeakerScore)}`);
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

/** The round's released motions as plain text, one per line, with info slides indented. */
export function formatRoundMotions(motions: Motion[], roundId: string): string {
  return motions
    .filter((motion) => motion.released && motion.rounds?.includes(roundId))
    .sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0))
    .map((motion, index, all) => {
      const label = all.length > 1 ? `${index + 1}. ` : "";
      const slide = motion.infoSlide?.trim() ? `\n   Info slide: ${motion.infoSlide.trim()}` : "";
      return `${label}${motion.text}${slide}`;
    })
    .join("\n");
}

/** Motions emails to every speaker and adjudicator in the round, once its motions are released. */
export function buildMotionsRecipients(
  round: Round,
  debates: Debate[],
  teams: Team[],
  adjudicators: Adjudicator[],
  motions: Motion[]
): EmailRecipient[] {
  if (!areRoundMotionsReleased(round)) return [];
  const text = formatRoundMotions(motions, round.id);
  if (!text) return [];
  const roundDebates = debates.filter((debate) => debate.roundId === round.id);
  const speakers = resolveEmailRecipients("round_participants", teams, adjudicators, roundDebates, round);
  const panel = round.adjudicatorsRevealed === true
    ? resolveEmailRecipients("round_adjudicators", teams, adjudicators, roundDebates, round)
    : [];
  const seen = new Set<string>();
  return [...speakers, ...panel]
    .filter((recipient) => {
      const key = recipient.email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((recipient) => ({
      ...recipient,
      motions: text,
      // Panels stay hidden from speakers until revealed.
      ...(round.adjudicatorsRevealed === true ? {} : { chair: "TBA", panellists: "TBA" }),
    }));
}

/** One adjudicator's own scoresheet of a voting ballot, with the decision it gives (its winner). */
function summarizeSheet(
  ballot: BallotSubmission,
  sheet: NonNullable<BallotSubmission["sheets"]>[number],
  debate: Debate,
  rules: BallotRules
): string {
  const sides = Object.keys(sheet.speakerScores ?? {}) as DebateSide[];
  const winner = sides.length === 2 ? sheetOutcome(sheet, rules).winner : undefined;
  const teamScores = Object.fromEntries(sides.map((side) => [side, {
    side,
    teamId: ballot.teamScores?.[side]?.teamId ?? debate.teams?.[side]?.teamId ?? "",
    points: side === winner ? 1 : 0,
    ...(winner ? { win: side === winner } : {}),
    totalSpeakerScore: teamSpeakerTotal(sheet.speakerScores?.[side] ?? [], rules),
  }])) as BallotSubmission["teamScores"];
  return summarizeBallot({ ...ballot, speakerScores: sheet.speakerScores, teamScores, forfeitSide: undefined }, debate, false);
}

/**
 * Ballot-confirmed emails (Tabbycat BALLOTS_CONFIRMED). A consensus ballot goes to every adjudicator
 * of the debate (trainees included) with an address. A voting ballot goes, as in Tabbycat, only to
 * the voting adjudicators, each with their own scoresheet as recorded, never the panel's aggregate.
 * `rules` (format and scoring settings) total those sheets; absent = the format's defaults.
 */
export function buildBallotConfirmedRecipients(
  ballot: BallotSubmission,
  debate: Debate,
  adjudicators: Pick<Adjudicator, "id" | "name" | "email">[],
  round: Pick<Round, "name"> | undefined,
  isBP: boolean,
  rules?: Pick<BallotRules, "format" | "preferences">
): EmailRecipient[] {
  if (!ballot.confirmed || ballot.discarded) return [];
  const panel = debate.adjudicators;
  const byId = new Map(adjudicators.map((adjudicator) => [adjudicator.id, adjudicator]));
  const sheets = ballot.sheets ?? [];
  if (sheets.length > 0) {
    const sheetRules: BallotRules = { format: rules?.format ?? (isBP ? "bp" : "wsdc"), preferences: rules?.preferences };
    return sheets.flatMap((sheet) => {
      const adjudicator = byId.get(sheet.adjudicatorId);
      if (!adjudicator) return [];
      const recipient = buildBallotReceiptRecipient(adjudicator, ballot, debate, round, isBP);
      if (!recipient) return [];
      const motion = ballot.motionText ? `Motion: ${ballot.motionText}\n` : "";
      return [{ ...recipient, ballot: `${motion}${summarizeSheet({ ...ballot, motionText: undefined }, sheet, debate, sheetRules)}` }];
    });
  }
  const ids = [...new Set([panel?.chairId, ...(panel?.panellistIds ?? []), ...(panel?.traineeIds ?? [])].filter(Boolean))];
  return ids.flatMap((id) => {
    const adjudicator = byId.get(id as string);
    if (!adjudicator) return [];
    const recipient = buildBallotReceiptRecipient(adjudicator, ballot, debate, round, isBP);
    return recipient ? [recipient] : [];
  });
}

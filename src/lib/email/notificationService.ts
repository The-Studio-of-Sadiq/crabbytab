import type { DocumentReference, Firestore, QuerySnapshot } from "firebase-admin/firestore";
import { isDrawReleasedToTeams } from "@/lib/draw/drawStatus";
import type { Adjudicator, BallotSubmission, Debate, Motion, Round, Team, Tournament } from "@/types";
import { createEmailCampaign } from "@/lib/email/history";
import { sendEmailCampaign, type EmailRecipient, type EmailRecipientGroup } from "@/lib/email/messaging";
import {
  areRoundResultsReleased,
  buildBallotConfirmedRecipients,
  buildBallotReceiptRecipient,
  buildMotionsRecipients,
  buildDrawAdjudicatorRecipients,
  buildDrawTeamRecipients,
  buildTeamPointsRecipients,
  chunkRecipients,
  notificationLogId,
  releasedRoundNotifications,
  type NotificationLogEntry,
  type RoundNotificationEvent,
} from "@/lib/email/notifications";
import { createSmtpEmailProvider, type EmailProvider } from "@/lib/email/provider";
import { deliveryRef } from "@/lib/email/deliveryStatus";
import { loadEmailSettings, replyToHeader, templateFor } from "@/lib/email/settings";
import { calculateStandings } from "@/lib/standings/calculator";
import { loadPortalVenues } from "@/lib/privateParticipantData";

/**
 * Server-side delivery of automatic notifications. All data comes from the cloud copy in
 * Firestore, so only what the organiser has uploaded (and released there) is ever emailed.
 *
 * Each (event, round) has a log document in `tournaments/{id}/notificationLog`. Recipients are split
 * into chunks of at most MAX_CAMPAIGN_RECIPIENTS; a chunk is claimed in a transaction before it is
 * sent, so concurrent triggers never send the same chunk twice. A claimed chunk is not re-sent
 * automatically if delivery fails: its failures show in campaign history, where they can be
 * retried.
 */

const LOG_COLLECTION = "notificationLog";

export interface NotificationSender {
  uid: string;
  email: string;
  name: string;
}

export const SYSTEM_SENDER: NotificationSender = { uid: "system", email: "", name: "Automatic notification" };

const RECIPIENT_GROUP: Record<RoundNotificationEvent, EmailRecipientGroup> = {
  draw_teams: "round_participants",
  draw_adjudicators: "round_adjudicators",
  team_points: "round_participants",
  motions_released: "round_participants",
};

function activeDocuments<T>(snapshot: QuerySnapshot): T[] {
  return snapshot.docs
    .filter((document) => typeof document.data().deletedAt !== "string")
    .map((document) => ({ ...document.data(), id: document.id }) as T);
}

function isAlreadyExists(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 6 || code === "already-exists" || code === "ALREADY_EXISTS";
}

async function loadTournament(firestore: Firestore, tournamentId: string) {
  const tournamentRef = firestore.collection("tournaments").doc(tournamentId);
  const [tournamentSnapshot, roundsSnapshot] = await Promise.all([
    tournamentRef.get(),
    tournamentRef.collection("rounds").get(),
  ]);
  if (!tournamentSnapshot.exists) return null;
  return {
    tournamentRef,
    tournament: { ...tournamentSnapshot.data(), id: tournamentSnapshot.id } as Tournament,
    rounds: activeDocuments<Round>(roundsSnapshot),
  };
}

/**
 * Marks round notifications that are already released as skipped, so opting in mid-tournament
 * does not email old draws or results. Run when an organiser switches an event on.
 */
export async function baselineRoundNotifications(
  firestore: Firestore,
  tournamentId: string,
  events: RoundNotificationEvent[]
): Promise<number> {
  const loaded = await loadTournament(firestore, tournamentId);
  if (!loaded) return 0;
  const wanted = new Set(events);
  const due = releasedRoundNotifications(
    {
      ...loaded.tournament.preferences,
      notifyDrawReleased: wanted.has("draw_teams") || wanted.has("draw_adjudicators"),
      notifyTeamPoints: wanted.has("team_points"),
      notifyMotionsReleased: wanted.has("motions_released"),
    },
    loaded.rounds
  ).filter((item) => wanted.has(item.event));
  if (due.length === 0) return 0;
  const refs = due.map((item) =>
    loaded.tournamentRef.collection(LOG_COLLECTION).doc(notificationLogId(item.event, item.round.id))
  );
  const existing = await firestore.getAll(...refs);
  const batch = firestore.batch();
  let skipped = 0;
  existing.forEach((snapshot, index) => {
    if (snapshot.exists) return;
    const entry: NotificationLogEntry = {
      event: due[index].event,
      subjectId: due[index].round.id,
      status: "skipped",
      chunksClaimed: 0,
      updatedAt: new Date().toISOString(),
    };
    batch.create(refs[index], entry);
    skipped += 1;
  });
  if (skipped > 0) await batch.commit();
  return skipped;
}

async function buildRoundRecipients(
  tournamentRef: DocumentReference,
  tournament: Tournament,
  rounds: Round[],
  event: RoundNotificationEvent,
  round: Round,
  links?: { privateUrlOrigin?: string }
): Promise<EmailRecipient[]> {
  const [teamsSnapshot, adjudicatorsSnapshot] = await Promise.all([
    tournamentRef.collection("teams").get(),
    event === "team_points" ? Promise.resolve(null) : tournamentRef.collection("adjudicators").get(),
  ]);
  const teams = activeDocuments<Team>(teamsSnapshot);
  const adjudicators = adjudicatorsSnapshot ? activeDocuments<Adjudicator>(adjudicatorsSnapshot) : [];
  if (event !== "team_points") {
    const debates = activeDocuments<Debate>(
      await tournamentRef.collection("debates").where("roundId", "==", round.id).get()
    );
    if (event === "motions_released") {
      const motions = activeDocuments<Motion>(
        await tournamentRef.collection("motions").where("rounds", "array-contains", round.id).get()
      );
      return buildMotionsRecipients(round, debates, teams, adjudicators, motions);
    }
    // Room links for {{venue_url}}: one read per room of this round.
    const venues = await loadPortalVenues(tournamentRef, debates);
    return event === "draw_teams"
      ? buildDrawTeamRecipients(round, debates, teams, adjudicators, venues)
      : buildDrawAdjudicatorRecipients(round, debates, teams, adjudicators, venues, {
          privateUrlOrigin: links?.privateUrlOrigin,
          tournamentSlug: tournament.slug,
        });
  }
  // Running totals only include rounds whose results pass the same release test.
  const releasedRounds = rounds.filter((item) => areRoundResultsReleased(item, tournament.preferences));
  const releasedRoundIds = new Set(releasedRounds.map((item) => item.id));
  const [debatesSnapshot, ballotsSnapshot] = await Promise.all([
    tournamentRef.collection("debates").get(),
    tournamentRef.collection("ballots").where("confirmed", "==", true).get(),
  ]);
  const debates = activeDocuments<Debate>(debatesSnapshot).filter((debate) => releasedRoundIds.has(debate.roundId));
  const ballots = activeDocuments<BallotSubmission>(ballotsSnapshot).filter(
    (ballot) => ballot.discarded !== true && releasedRoundIds.has(ballot.roundId)
  );
  const standings = calculateStandings(tournament, releasedRounds, teams, debates, ballots);
  return buildTeamPointsRecipients(
    round,
    debates,
    teams,
    standings.teams,
    tournament.format === "bp",
    tournament.preferences
  );
}

export type RoundNotificationResult =
  | { status: "idle" }
  | {
      status: "sent";
      event: RoundNotificationEvent | "ballot_confirmed";
      roundName: string;
      sent: number;
      failed: number;
      campaignId?: string;
    };

/**
 * Sends the next unsent chunk of the first due round notification. Callers repeat until "idle".
 * The provider is created before anything is claimed, so a missing SMTP configuration fails
 * without consuming a notification.
 */
export async function sendNextRoundNotification(input: {
  firestore: Firestore;
  tournamentId: string;
  sender: NotificationSender;
  createProvider?: () => EmailProvider;
  /** The site's origin, so allocation emails can carry each adjudicator's private URL. */
  privateUrlOrigin?: string;
}): Promise<RoundNotificationResult> {
  const roundResult = await sendNextRoundEventNotification(input);
  if (roundResult.status !== "idle") return roundResult;
  return sendNextBallotConfirmation(input);
}

async function sendNextRoundEventNotification(input: {
  firestore: Firestore;
  tournamentId: string;
  sender: NotificationSender;
  createProvider?: () => EmailProvider;
  privateUrlOrigin?: string;
}): Promise<RoundNotificationResult> {
  const { firestore } = input;
  const loaded = await loadTournament(firestore, input.tournamentId);
  if (!loaded) return { status: "idle" };
  const { tournament, tournamentRef, rounds } = loaded;
  const due = releasedRoundNotifications(tournament.preferences, rounds);
  if (due.length === 0) return { status: "idle" };
  const logRefs = due.map((item) =>
    tournamentRef.collection(LOG_COLLECTION).doc(notificationLogId(item.event, item.round.id))
  );
  const logs = await firestore.getAll(...logRefs);
  const nextIndex = logs.findIndex((snapshot) => {
    const status = (snapshot.data() as NotificationLogEntry | undefined)?.status;
    return status !== "skipped" && status !== "done";
  });
  if (nextIndex === -1) return { status: "idle" };

  const provider = (input.createProvider ?? createSmtpEmailProvider)();
  const { event, round } = due[nextIndex];
  const logRef = logRefs[nextIndex];
  const chunks = chunkRecipients(
    await buildRoundRecipients(tournamentRef, tournament, rounds, event, round, { privateUrlOrigin: input.privateUrlOrigin })
  );

  const claimedChunk = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(logRef);
    const current = snapshot.data() as NotificationLogEntry | undefined;
    if (current?.status === "skipped" || current?.status === "done") return null;
    const chunkIndex = current?.chunksClaimed ?? 0;
    const entry: NotificationLogEntry = {
      event,
      subjectId: round.id,
      status: chunkIndex + 1 >= chunks.length ? "done" : "sending",
      chunksClaimed: Math.min(chunkIndex + 1, chunks.length),
      totalChunks: chunks.length,
      updatedAt: new Date().toISOString(),
    };
    transaction.set(logRef, entry);
    return chunkIndex < chunks.length ? chunkIndex : null;
  });
  if (claimedChunk === null) {
    // Nothing to send (no recipients with email, or another request finished it); move on.
    return { status: "sent", event, roundName: round.name, sent: 0, failed: 0 };
  }

  const recipients = chunks[claimedChunk];
  const settings = await loadEmailSettings(tournamentRef);
  const template = templateFor(settings, event);
  const campaign = await createEmailCampaign(firestore, {
    tournamentId: input.tournamentId,
    senderUid: input.sender.uid,
    senderEmail: input.sender.email,
    senderName: input.sender.name,
    recipientGroup: RECIPIENT_GROUP[event],
    roundId: round.id,
    roundName: round.name,
    subjectTemplate: template.subject,
    bodyTemplate: template.body,
    recipients,
    notificationKey: `${notificationLogId(event, round.id)}#${claimedChunk + 1}`,
  });
  const result = await sendEmailCampaign(
    provider,
    recipients,
    tournament.name,
    round.name,
    template.subject,
    template.body,
    { replyTo: replyToHeader(settings), ref: deliveryRef(input.tournamentId, campaign.id) }
  );
  await campaign.update(result);
  return { status: "sent", event, roundName: round.name, sent: result.sent, failed: result.failed, campaignId: campaign.id };
}

/**
 * Emails each newly submitted ballot back to the adjudicator who submitted it, when the organiser
 * has opted in. Each ballot id is claimed once, so an offline resubmission does not repeat the
 * receipt. Never throws: a receipt must not fail the ballot submission it confirms.
 */
export async function sendBallotReceipts(input: {
  firestore: Firestore;
  tournament: Tournament;
  adjudicator: Pick<Adjudicator, "id" | "name" | "email">;
  ballots: BallotSubmission[];
  debates: Map<string, Debate>;
  rounds: Map<string, Round>;
  createProvider?: () => EmailProvider;
}): Promise<void> {
  if (input.tournament.preferences?.notifyBallotReceipt !== true || input.ballots.length === 0) return;
  try {
    const provider = (input.createProvider ?? createSmtpEmailProvider)();
    const tournamentRef = input.firestore.collection("tournaments").doc(input.tournament.id);
    let settings: Awaited<ReturnType<typeof loadEmailSettings>> | undefined;
    for (const ballot of input.ballots) {
      const debate = input.debates.get(ballot.debateId);
      if (!debate) continue;
      const round = input.rounds.get(ballot.roundId);
      // Tabbycat sends no receipts for BP elimination rounds (results only, no scores to check).
      if (!ballotReceiptsApply(input.tournament, round)) continue;
      const recipient = buildBallotReceiptRecipient(
        input.adjudicator,
        ballot,
        debate,
        round,
        input.tournament.format === "bp"
      );
      // The adjudicator has no usable address; there is nobody to send a receipt to.
      if (!recipient) return;
      const logId = notificationLogId("ballot_receipt", ballot.id);
      try {
        await tournamentRef.collection(LOG_COLLECTION).doc(logId).create({
          event: "ballot_receipt",
          subjectId: ballot.id,
          status: "done",
          chunksClaimed: 1,
          totalChunks: 1,
          updatedAt: new Date().toISOString(),
        } satisfies NotificationLogEntry);
      } catch (error) {
        if (isAlreadyExists(error)) continue;
        throw error;
      }
      settings ??= await loadEmailSettings(tournamentRef);
      const template = templateFor(settings, "ballot_receipt");
      const campaign = await createEmailCampaign(input.firestore, {
        tournamentId: input.tournament.id,
        senderUid: SYSTEM_SENDER.uid,
        senderEmail: SYSTEM_SENDER.email,
        senderName: SYSTEM_SENDER.name,
        recipientGroup: "round_adjudicators",
        roundId: ballot.roundId,
        roundName: round?.name,
        subjectTemplate: template.subject,
        bodyTemplate: template.body,
        recipients: [recipient],
        notificationKey: logId,
      });
      const result = await sendEmailCampaign(
        provider,
        [recipient],
        input.tournament.name,
        round?.name,
        template.subject,
        template.body,
        { replyTo: replyToHeader(settings), ref: deliveryRef(input.tournament.id, campaign.id) }
      );
      await campaign.update(result);
    }
  } catch (error) {
    console.error(
      "Could not send ballot receipt:",
      error instanceof Error ? error.message : "Unknown ballot receipt error."
    );
  }
}

/** Tabbycat `should_send_email_receipts`: never for BP elimination rounds. */
export function ballotReceiptsApply(tournament: Pick<Tournament, "format">, round: Pick<Round, "stage"> | undefined): boolean {
  return !(tournament.format === "bp" && round?.stage === "elimination");
}

/**
 * Which email a confirmed result sends to its debate's adjudicators: "confirmed" (CrabbyTab's
 * opt-in "ballot confirmed" email), else "receipt" when ballot receipts are on (Tabbycat
 * `enable_ballot_receipts` also emails the panel when the tab room or an assistant confirms a
 * ballot), else none.
 */
export function ballotConfirmationEmailMode(
  preferences: Tournament["preferences"] | undefined
): "confirmed" | "receipt" | null {
  if (preferences?.notifyBallotConfirmed === true) return "confirmed";
  if (preferences?.notifyBallotReceipt === true) return "receipt";
  return null;
}

/**
 * In "receipt" mode, whether a confirmed ballot is emailed: not one an adjudicator submitted
 * (their own receipt went out on submission), and not in a BP elimination round (Tabbycat).
 */
export function receiptModeSendsConfirmation(
  ballot: Pick<BallotSubmission, "submitterType">,
  tournament: Pick<Tournament, "format">,
  round: Pick<Round, "stage">
): boolean {
  return ballot.submitterType !== "judge" && ballotReceiptsApply(tournament, round);
}

/** Records ballots as handled in a round's confirmation log (sent, skipped or baselined). */
async function claimBallotConfirmations(
  firestore: Firestore,
  logRef: DocumentReference,
  roundId: string,
  ballotIds: string[]
): Promise<void> {
  await firestore.runTransaction(async (transaction) => {
    const current = (await transaction.get(logRef)).data() as BallotConfirmedLog | undefined;
    const sentBallotIds = { ...(current?.sentBallotIds ?? {}) };
    for (const id of ballotIds) sentBallotIds[id] = true;
    transaction.set(logRef, {
      event: "ballot_confirmed",
      subjectId: roundId,
      sentBallotIds,
      updatedAt: new Date().toISOString(),
    } satisfies BallotConfirmedLog);
  });
}

/** Rounds whose confirmations are emailed: drawn for teams, not cancelled, not completed. */
function ballotConfirmationRounds(rounds: Round[]): Round[] {
  return rounds.filter((round) =>
    round.cancelled !== true && round.completed !== true &&
    isDrawReleasedToTeams(round)
  );
}

function ballotConfirmedLogId(roundId: string): string {
  return notificationLogId("ballot_confirmed", roundId);
}

interface BallotConfirmedLog {
  event: "ballot_confirmed";
  subjectId: string;
  /** Ballot ids already emailed (or skipped when the organiser opted in). */
  sentBallotIds: Record<string, true>;
  updatedAt: string;
}

async function confirmedBallotsOf(tournamentRef: DocumentReference, roundId: string): Promise<BallotSubmission[]> {
  const snapshot = await tournamentRef.collection("ballots").where("roundId", "==", roundId).where("confirmed", "==", true).get();
  return activeDocuments<BallotSubmission>(snapshot).filter((ballot) => ballot.discarded !== true);
}

/**
 * Marks every confirmed ballot of the running rounds as already emailed, so switching
 * "ballot confirmed" emails on mid-round does not email earlier confirmations.
 */
export async function baselineBallotConfirmations(firestore: Firestore, tournamentId: string): Promise<number> {
  const loaded = await loadTournament(firestore, tournamentId);
  if (!loaded) return 0;
  let skipped = 0;
  for (const round of ballotConfirmationRounds(loaded.rounds)) {
    const ballots = await confirmedBallotsOf(loaded.tournamentRef, round.id);
    const logRef = loaded.tournamentRef.collection(LOG_COLLECTION).doc(ballotConfirmedLogId(round.id));
    await firestore.runTransaction(async (transaction) => {
      const current = (await transaction.get(logRef)).data() as BallotConfirmedLog | undefined;
      const sentBallotIds = { ...(current?.sentBallotIds ?? {}) };
      for (const ballot of ballots) {
        if (!sentBallotIds[ballot.id]) {
          sentBallotIds[ballot.id] = true;
          skipped += 1;
        }
      }
      transaction.set(logRef, {
        event: "ballot_confirmed",
        subjectId: round.id,
        sentBallotIds,
        updatedAt: new Date().toISOString(),
      } satisfies BallotConfirmedLog);
    });
  }
  return skipped;
}

/**
 * Emails the next confirmed result not emailed yet to its debate's adjudicators. Reads only the
 * confirmed ballots of running rounds and one log document per round; each ballot is claimed in a
 * transaction before it is sent, so two triggers never email it twice.
 */
export async function sendNextBallotConfirmation(input: {
  firestore: Firestore;
  tournamentId: string;
  createProvider?: () => EmailProvider;
}): Promise<RoundNotificationResult> {
  const { firestore } = input;
  const loaded = await loadTournament(firestore, input.tournamentId);
  const mode = loaded ? ballotConfirmationEmailMode(loaded.tournament.preferences) : null;
  if (!loaded || !mode) return { status: "idle" };
  const { tournament, tournamentRef } = loaded;
  for (const round of ballotConfirmationRounds(loaded.rounds)) {
    const logRef = tournamentRef.collection(LOG_COLLECTION).doc(ballotConfirmedLogId(round.id));
    const [ballots, logSnapshot] = await Promise.all([confirmedBallotsOf(tournamentRef, round.id), logRef.get()]);
    // Receipts for tab-room confirmations are new for tournaments that already had receipts on:
    // a round with no log yet starts from its current confirmations instead of emailing them all.
    if (mode === "receipt" && !logSnapshot.exists) {
      await claimBallotConfirmations(firestore, logRef, round.id, ballots.map((ballot) => ballot.id));
      continue;
    }
    const sent = (logSnapshot.data() as BallotConfirmedLog | undefined)?.sentBallotIds ?? {};
    const unsent = ballots.filter((ballot) => !sent[ballot.id]);
    // Receipt mode skips ballots it never emails, marking them so they are not read again.
    const skipped = mode === "receipt" ? unsent.filter((ballot) => !receiptModeSendsConfirmation(ballot, tournament, round)) : [];
    if (skipped.length > 0) await claimBallotConfirmations(firestore, logRef, round.id, skipped.map((ballot) => ballot.id));
    const next = unsent.find((ballot) => !skipped.includes(ballot));
    if (!next) continue;
    const provider = (input.createProvider ?? createSmtpEmailProvider)();
    const claimed = await firestore.runTransaction(async (transaction) => {
      const current = (await transaction.get(logRef)).data() as BallotConfirmedLog | undefined;
      if (current?.sentBallotIds?.[next.id]) return false;
      transaction.set(logRef, {
        event: "ballot_confirmed",
        subjectId: round.id,
        sentBallotIds: { ...(current?.sentBallotIds ?? {}), [next.id]: true },
        updatedAt: new Date().toISOString(),
      } satisfies BallotConfirmedLog);
      return true;
    });
    if (!claimed) return { status: "sent", event: "ballot_confirmed", roundName: round.name, sent: 0, failed: 0 };
    const [debateSnapshot, adjudicatorsSnapshot] = await Promise.all([
      tournamentRef.collection("debates").doc(next.debateId).get(),
      tournamentRef.collection("adjudicators").get(),
    ]);
    const debate = debateSnapshot.exists && typeof debateSnapshot.data()?.deletedAt !== "string"
      ? ({ ...debateSnapshot.data(), id: debateSnapshot.id } as Debate)
      : null;
    const recipients = debate
      ? buildBallotConfirmedRecipients(next, debate, activeDocuments<Adjudicator>(adjudicatorsSnapshot), round, tournament.format === "bp", tournament)
      : [];
    if (recipients.length === 0) return { status: "sent", event: "ballot_confirmed", roundName: round.name, sent: 0, failed: 0 };
    const settings = await loadEmailSettings(tournamentRef);
    const template = templateFor(settings, mode === "confirmed" ? "ballot_confirmed" : "ballot_receipt");
    const campaign = await createEmailCampaign(firestore, {
      tournamentId: input.tournamentId,
      senderUid: SYSTEM_SENDER.uid,
      senderEmail: SYSTEM_SENDER.email,
      senderName: SYSTEM_SENDER.name,
      recipientGroup: "round_adjudicators",
      roundId: round.id,
      roundName: round.name,
      subjectTemplate: template.subject,
      bodyTemplate: template.body,
      recipients,
      notificationKey: notificationLogId("ballot_confirmed", next.id),
    });
    const result = await sendEmailCampaign(provider, recipients, tournament.name, round.name, template.subject, template.body, {
      replyTo: replyToHeader(settings),
      ref: deliveryRef(input.tournamentId, campaign.id),
    });
    await campaign.update(result);
    return { status: "sent", event: "ballot_confirmed", roundName: round.name, sent: result.sent, failed: result.failed, campaignId: campaign.id };
  }
  return { status: "idle" };
}

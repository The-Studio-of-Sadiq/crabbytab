import { NextRequest, NextResponse } from "next/server";
import { Tournament } from "@/types";
import {
  authorizeTournamentEmailRequest,
  EmailAuthorizationError,
} from "@/lib/email/authorize";
import {
  EmailCampaignInputError,
  EmailRecipient,
  StoredEmailCampaign,
  prepareEmailMessages,
  sendEmailCampaign,
} from "@/lib/email/messaging";
import {
  createSmtpEmailProvider,
  EmailProviderConfigError,
} from "@/lib/email/provider";
import { createEmailCampaign } from "@/lib/email/history";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 60;

class EmailRetryConflictError extends Error {}

export async function POST(request: NextRequest) {
  let body: { tournamentId?: unknown; campaignId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { tournamentId, campaignId } = body;
  if (
    typeof tournamentId !== "string" ||
    !tournamentId.trim() ||
    tournamentId.includes("/") ||
    typeof campaignId !== "string" ||
    !/^[A-Za-z0-9_-]{1,150}$/.test(campaignId)
  ) {
    return NextResponse.json({ error: "Invalid campaign reference." }, { status: 400 });
  }

  try {
    const sender = await authorizeTournamentEmailRequest(request, tournamentId);
    const firestore = getAdminFirestore();
    const collection = firestore
      .collection("tournaments")
      .doc(tournamentId)
      .collection("emailCampaigns");
    const sourceReference = collection.doc(campaignId);
    const sourceSnapshot = await sourceReference.get();
    if (!sourceSnapshot.exists) {
      return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    }

    const source = sourceSnapshot.data() as StoredEmailCampaign;
    if (source.status === "sending" || source.retriedBy || source.retryInProgress) {
      return NextResponse.json(
        { error: "This campaign has already been retried. Retry the latest attempt instead." },
        { status: 409 }
      );
    }
    if (!Array.isArray(source.failedRecipients) || source.failedRecipients.length === 0) {
      return NextResponse.json({ error: "This campaign has no failed recipients to retry." }, { status: 400 });
    }
    if (source.failedRecipients.length > 100) {
      return NextResponse.json({ error: "Stored retry recipient count exceeds the send limit." }, { status: 400 });
    }

    const recipients = source.failedRecipients as EmailRecipient[];
    const tournamentSnapshot = await firestore.collection("tournaments").doc(tournamentId).get();
    if (!tournamentSnapshot.exists) {
      return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
    }
    const tournament = tournamentSnapshot.data() as Tournament;
    prepareEmailMessages(
      recipients,
      tournament.name,
      source.roundName,
      source.subjectTemplate,
      source.bodyTemplate
    );
    const provider = createSmtpEmailProvider();
    const campaign = await createEmailCampaign(firestore, {
      tournamentId,
      senderUid: sender.uid,
      senderEmail: sender.email || "",
      senderName: sender.name || sender.email || sender.uid,
      recipientGroup: source.recipientGroup,
      roundId: source.roundId,
      roundName: source.roundName,
      subjectTemplate: source.subjectTemplate,
      bodyTemplate: source.bodyTemplate,
      recipients,
      retryOf: source.id,
    });
    try {
      await firestore.runTransaction(async (transaction) => {
        const latestSource = await transaction.get(sourceReference);
        if (!latestSource.exists) throw new EmailRetryConflictError();
        const latestData = latestSource.data() as StoredEmailCampaign;
        if (latestData.retriedBy || latestData.retryInProgress) {
          throw new EmailRetryConflictError();
        }
        transaction.update(sourceReference, {
          retriedBy: campaign.id,
          retryInProgress: true,
        });
      });
    } catch (error) {
      await firestore
        .collection("tournaments")
        .doc(tournamentId)
        .collection("emailCampaigns")
        .doc(campaign.id)
        .delete();
      throw error;
    }

    const result = await sendEmailCampaign(
      provider,
      recipients,
      tournament.name,
      source.roundName,
      source.subjectTemplate,
      source.bodyTemplate
    );
    await campaign.update(result);
    await sourceReference.update({ retryInProgress: false });
    return NextResponse.json({
      ...result,
      campaignId: campaign.id,
      recipientCount: recipients.length,
    });
  } catch (error) {
    if (error instanceof EmailAuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof EmailCampaignInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof EmailRetryConflictError) {
      return NextResponse.json(
        { error: "This campaign was retried by another request. Refresh the history." },
        { status: 409 }
      );
    }
    if (error instanceof EmailProviderConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error(
      "Failed email retry failed:",
      error instanceof Error ? error.message : "Unknown retry error."
    );
    return NextResponse.json(
      { error: "Could not retry failed emails. Check the campaign history and server logs." },
      { status: 502 }
    );
  }
}

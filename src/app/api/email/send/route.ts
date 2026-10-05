import { NextRequest, NextResponse } from "next/server";
import { Adjudicator, Debate, Round, Team, Tournament } from "@/types";
import {
  authorizeTournamentEmailRequest,
  EmailAuthorizationError,
} from "@/lib/email/authorize";
import {
  EmailCampaignInputError,
  EMAIL_RECIPIENT_GROUPS,
  EmailRecipientGroup,
  MAX_CAMPAIGN_RECIPIENTS,
  prepareEmailMessages,
  resolveEmailRecipients,
  sendEmailCampaign,
} from "@/lib/email/messaging";
import {
  createSmtpEmailProvider,
  EmailProviderConfigError,
} from "@/lib/email/provider";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { createEmailCampaign } from "@/lib/email/history";

export const runtime = "nodejs";
export const maxDuration = 60;

interface SendRequestBody {
  tournamentId?: unknown;
  recipientGroup?: unknown;
  roundId?: unknown;
  subject?: unknown;
  body?: unknown;
}

export async function POST(request: NextRequest) {
  let body: SendRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { tournamentId, recipientGroup, roundId, subject, body: messageBody } = body;
  if (
    typeof tournamentId !== "string" ||
    !tournamentId.trim() ||
    tournamentId.includes("/") ||
    typeof recipientGroup !== "string" ||
    !EMAIL_RECIPIENT_GROUPS.includes(recipientGroup as EmailRecipientGroup) ||
    (roundId !== undefined && typeof roundId !== "string") ||
    (typeof roundId === "string" && (roundId.includes("/") || roundId.length > 128)) ||
    typeof subject !== "string" ||
    typeof messageBody !== "string"
  ) {
    return NextResponse.json({ error: "Invalid email campaign details." }, { status: 400 });
  }

  const group = recipientGroup as EmailRecipientGroup;
  const requiresRound =
    group === "round_participants" ||
    group === "round_adjudicators" ||
    group === "chairs" ||
    group === "panellists";
  if (requiresRound && !roundId) {
    return NextResponse.json(
      { error: "Select a round for this recipient group." },
      { status: 400 }
    );
  }

  try {
    const sender = await authorizeTournamentEmailRequest(request, tournamentId);
    const firestore = getAdminFirestore();
    const tournamentSnapshot = await firestore.collection("tournaments").doc(tournamentId).get();
    if (!tournamentSnapshot.exists) {
      return NextResponse.json({ error: "Tournament not found." }, { status: 404 });
    }
    const tournament = tournamentSnapshot.data() as Tournament;

    const [teamSnapshot, adjudicatorSnapshot] = await Promise.all([
      firestore.collection("tournaments").doc(tournamentId).collection("teams").get(),
      firestore.collection("tournaments").doc(tournamentId).collection("adjudicators").get(),
    ]);
    const teams = teamSnapshot.docs.map((document) => document.data() as Team);
    const adjudicators = adjudicatorSnapshot.docs.map((document) => document.data() as Adjudicator);

    let round: Round | undefined;
    let debates: Debate[] = [];
    if (typeof roundId === "string" && roundId) {
      const roundSnapshot = await firestore
        .collection("tournaments")
        .doc(tournamentId)
        .collection("rounds")
        .doc(roundId)
        .get();
      if (!roundSnapshot.exists) {
        return NextResponse.json({ error: "Selected round not found." }, { status: 404 });
      }
      round = roundSnapshot.data() as Round;
      const debateSnapshot = await firestore
        .collection("tournaments")
        .doc(tournamentId)
        .collection("debates")
        .where("roundId", "==", roundId)
        .get();
      debates = debateSnapshot.docs.map((document) => document.data() as Debate);
    }

    const recipients = resolveEmailRecipients(group, teams, adjudicators, debates, round);
    prepareEmailMessages(recipients, tournament.name, round?.name, subject, messageBody);
    const provider = createSmtpEmailProvider();
    const campaign = await createEmailCampaign(getAdminFirestore(), {
      tournamentId,
      senderUid: sender.uid,
      senderEmail: sender.email || "",
      senderName: sender.name || sender.email || sender.uid,
      recipientGroup: group,
      roundId: round?.id,
      roundName: round?.name,
      subjectTemplate: subject,
      bodyTemplate: messageBody,
      recipients,
    });
    const result = await sendEmailCampaign(
      provider,
      recipients,
      tournament.name,
      round?.name,
      subject,
      messageBody
    );
    await campaign.update(result);
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
    if (error instanceof EmailProviderConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    console.error(
      "Tournament email campaign failed:",
      error instanceof Error ? error.message : "Unknown email campaign error."
    );
    return NextResponse.json(
      { error: "Could not send the email campaign. Check the server logs." },
      { status: 502 }
    );
  }
}

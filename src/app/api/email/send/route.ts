import { NextRequest, NextResponse } from "next/server";
import { Adjudicator, Debate, Round, Team, Tournament } from "@/types";
import {
  authorizeTournamentEmailRequest,
  EmailAuthorizationError,
} from "@/lib/email/authorize";
import {
  EmailCampaignInputError,
  type EmailBreakCategory,
  EMAIL_RECIPIENT_GROUPS,
  EmailRecipientGroup,
  findCredentialEmailConflict,
  MAX_CAMPAIGN_RECIPIENTS,
  prepareEmailMessages,
  resolveEmailRecipients,
  institutionCoachRecipients,
  sendEmailCampaign,
  usesPrivateCredentials,
} from "@/lib/email/messaging";
import {
  createSmtpEmailProvider,
  EmailProviderConfigError,
} from "@/lib/email/provider";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { loadPortalVenues } from "@/lib/privateParticipantData";
import { createEmailCampaign } from "@/lib/email/history";
import { deliveryRef } from "@/lib/email/deliveryStatus";
import { loadEmailSettings, replyToHeader } from "@/lib/email/settings";

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
  const includesPrivateCredentials = usesPrivateCredentials(subject, messageBody);
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
    const teams = teamSnapshot.docs.map(
      (document) => ({ ...document.data(), id: document.id }) as Team
    );
    const adjudicators = adjudicatorSnapshot.docs.map(
      (document) => ({ ...document.data(), id: document.id }) as Adjudicator
    );

    let round: Round | undefined;
    let debates: Debate[] = [];
    let venues: Awaited<ReturnType<typeof loadPortalVenues>> = [];
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
      // Room links for {{venue_url}}, read only when the template uses them.
      if (`${subject}${messageBody}`.includes("{{venue_url}}")) {
        venues = await loadPortalVenues(firestore.collection("tournaments").doc(tournamentId), debates);
      }
    }

    // Break category names for {{break_categories}}, read only when the template uses them.
    let breakCategories: EmailBreakCategory[] = [];
    if (/\{\{\s*break_categories\s*\}\}/.test(`${subject}\n${messageBody}`)) {
      const categorySnapshot = await firestore.collection("tournaments").doc(tournamentId).collection("breakCategories").get();
      breakCategories = categorySnapshot.docs.map((document) => ({ ...document.data(), id: document.id }) as EmailBreakCategory);
    }

    // Institution coaches (Tabbycat Coach): read only for that group.
    const coaches = group === "institution_coaches"
      ? institutionCoachRecipients(
          (await firestore.collection("tournaments").doc(tournamentId).collection("institutions").get()).docs
            .map((document) => document.data())
            .filter((institution) => typeof institution.deletedAt !== "string")
            .map((institution) => ({
              name: String(institution.name ?? ""),
              coaches: Array.isArray(institution.coaches) ? institution.coaches : [],
            }))
        )
      : [];
    const recipients = resolveEmailRecipients(group, teams, adjudicators, debates, round, {
      coaches,
      breakCategories,
      includePrivateCredentials: includesPrivateCredentials,
      privateUrlOrigin: request.nextUrl.origin,
      tournamentSlug: tournament.slug,
      preserveDuplicateEmails: includesPrivateCredentials,
      venues,
    });
    const conflictingEmail = includesPrivateCredentials ? findCredentialEmailConflict(recipients) : null;
    if (conflictingEmail) {
      throw new EmailCampaignInputError(
        `${conflictingEmail} belongs to more than one participant. Each participant needs their own email address to receive a private URL and passcode.`
      );
    }
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
    const settings = await loadEmailSettings(firestore.collection("tournaments").doc(tournamentId));
    const result = await sendEmailCampaign(
      provider,
      recipients,
      tournament.name,
      round?.name,
      subject,
      messageBody,
      { replyTo: replyToHeader(settings), ref: deliveryRef(tournamentId, campaign.id) }
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

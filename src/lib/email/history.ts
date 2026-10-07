import { Firestore } from "firebase-admin/firestore";
import {
  EmailCampaignResult,
  EmailRecipient,
  EmailRecipientGroup,
  StoredEmailCampaign,
} from "@/lib/email/messaging";

function withoutUndefinedProperties<T extends Record<string, unknown>>(record: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

export interface NewEmailCampaign {
  tournamentId: string;
  senderUid: string;
  senderEmail: string;
  senderName: string;
  recipientGroup: EmailRecipientGroup;
  roundId?: string;
  roundName?: string;
  subjectTemplate: string;
  bodyTemplate: string;
  recipients: EmailRecipient[];
  retryOf?: string;
}

function withoutPrivateCredentials(recipient: EmailRecipient): EmailRecipient {
  const safeRecipient = { ...recipient };
  delete safeRecipient.privateUrl;
  delete safeRecipient.passcode;
  return {
    ...withoutUndefinedProperties(safeRecipient),
    email: safeRecipient.email,
    name: safeRecipient.name,
  };
}

export async function createEmailCampaign(
  firestore: Firestore,
  campaign: NewEmailCampaign
): Promise<{ id: string; update: (result: EmailCampaignResult) => Promise<void> }> {
  const reference = firestore
    .collection("tournaments")
    .doc(campaign.tournamentId)
    .collection("emailCampaigns")
    .doc();
  const record: StoredEmailCampaign = {
    id: reference.id,
    tournamentId: campaign.tournamentId,
    createdAt: new Date().toISOString(),
    senderUid: campaign.senderUid,
    senderEmail: campaign.senderEmail,
    senderName: campaign.senderName,
    recipientGroup: campaign.recipientGroup,
    ...(campaign.roundId !== undefined ? { roundId: campaign.roundId } : {}),
    ...(campaign.roundName !== undefined ? { roundName: campaign.roundName } : {}),
    subjectTemplate: campaign.subjectTemplate,
    bodyTemplate: campaign.bodyTemplate,
    status: "sending",
    sent: 0,
    failed: campaign.recipients.length,
    results: [],
    failedRecipients: campaign.recipients.map(withoutPrivateCredentials),
    ...(campaign.retryOf !== undefined ? { retryOf: campaign.retryOf } : {}),
  };

  await reference.create(record);

  return {
    id: reference.id,
    update: async (result) => {
      const failedEmails = new Set(
        result.results.filter((item) => !item.sent).map((item) => item.email.toLowerCase())
      );
      const failedRecipients = campaign.recipients
        .filter((recipient) => failedEmails.has(recipient.email.toLowerCase()))
        .map(withoutPrivateCredentials);
      await reference.update({
        status: result.sent === 0 ? "failed" : "completed",
        sent: result.sent,
        failed: result.failed,
        results: result.results,
        failedRecipients,
      } satisfies Partial<StoredEmailCampaign>);
    },
  };
}

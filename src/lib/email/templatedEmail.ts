import type { DocumentReference } from "firebase-admin/firestore";
import { deliverMessages, type DeliveryOutcome } from "@/lib/email/deliver";
import { prepareEmailMessages, type EmailRecipient } from "@/lib/email/messaging";
import type { EmailProvider } from "@/lib/email/provider";
import { loadEmailSettings, replyToHeader, templateFor, type TemplateEvent, type TournamentEmailSettings } from "@/lib/email/settings";

/**
 * One-off emails rendered from a tournament's saved template (registration received / approved,
 * places allocated). Never throws: the outcome says whether it was delivered, so the action that
 * triggered it (a registration, a representative link) is never undone by email trouble.
 */
export async function sendTemplatedEmail(input: {
  tournamentRef: DocumentReference;
  tournamentName: string;
  event: TemplateEvent;
  recipient: EmailRecipient;
  /** Skip unless this holds for the loaded settings (e.g. registration emails switched on). */
  when?: (settings: TournamentEmailSettings) => boolean;
  createProvider?: () => EmailProvider;
}): Promise<DeliveryOutcome | null> {
  try {
    const settings = await loadEmailSettings(input.tournamentRef);
    if (input.when && !input.when(settings)) return null;
    const template = templateFor(settings, input.event);
    const [message] = prepareEmailMessages([input.recipient], input.tournamentName, undefined, template.subject, template.body, {
      replyTo: replyToHeader(settings),
    });
    const [outcome] = await deliverMessages([message], input.createProvider);
    return outcome;
  } catch (error) {
    console.error("Templated email failed:", error instanceof Error ? error.message : "unknown error");
    return { delivered: false, error: "The email could not be prepared; check the tournament's email template." };
  }
}

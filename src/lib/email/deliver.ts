import {
  createSmtpEmailProvider,
  EmailProviderConfigError,
  type EmailMessage,
  type EmailProvider,
} from "@/lib/email/provider";

export interface DeliveryOutcome {
  delivered: boolean;
  /** Short, organiser-facing reason; never contains SMTP credentials or server details. */
  error?: string;
}

/**
 * Sends one-off transactional messages (invitations, representative links) one by one, reporting
 * each outcome instead of throwing, so a failed address never undoes the records already saved.
 * A missing SMTP configuration fails every message with the same explanation.
 */
export async function deliverMessages(
  messages: EmailMessage[],
  createProvider: () => EmailProvider = createSmtpEmailProvider
): Promise<DeliveryOutcome[]> {
  if (messages.length === 0) return [];
  let provider: EmailProvider;
  try {
    provider = createProvider();
  } catch (error) {
    const reason = error instanceof EmailProviderConfigError
      ? "Email is not configured on this server; share the link another way."
      : "The email provider could not be started.";
    return messages.map(() => ({ delivered: false, error: reason }));
  }
  const outcomes: DeliveryOutcome[] = [];
  for (const message of messages) {
    try {
      await provider.send(message);
      outcomes.push({ delivered: true });
    } catch (error) {
      console.error("Transactional email failed:", error instanceof Error ? error.message : "unknown error");
      outcomes.push({ delivered: false, error: "The email could not be sent; share the link another way or resend." });
    }
  }
  return outcomes;
}

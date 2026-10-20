import { signWebhookBody } from "@/lib/email/deliveryStatus";

/**
 * Optional SMS hook (docs/email-notifications.md, "SMS"). CrabbyTab has no SMS provider built in:
 * set SMS_WEBHOOK_URL (and SMS_WEBHOOK_SECRET) and every SMS is POSTed as JSON
 * `{ to, text, ref? }`, signed like the email delivery webhook, to a relay you control (Twilio,
 * Vonage, an email-to-SMS gateway, ...). Without the variables SMS is simply unavailable.
 */

export interface SmsMessage {
  /** E.164 number, e.g. +8801712345678. */
  to: string;
  text: string;
  ref?: string;
}

export interface SmsProvider {
  send(message: SmsMessage): Promise<void>;
}

export class SmsProviderConfigError extends Error {}

/** A plausible E.164 number (leading +, 8–15 digits), after removing spaces, dashes and brackets. */
export function normalizePhoneNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
}

export function isSmsConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.SMS_WEBHOOK_URL?.trim());
}

export function createWebhookSmsProvider(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch
): SmsProvider {
  const url = env.SMS_WEBHOOK_URL?.trim();
  if (!url) throw new SmsProviderConfigError("SMS_WEBHOOK_URL is not configured.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SmsProviderConfigError("SMS_WEBHOOK_URL must be a valid URL.");
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new SmsProviderConfigError("SMS_WEBHOOK_URL must use https.");
  }
  const secret = env.SMS_WEBHOOK_SECRET;
  return {
    async send(message) {
      const to = normalizePhoneNumber(message.to);
      if (!to) throw new Error("The phone number is not in international format (+country code).");
      if (!message.text.trim() || message.text.length > 1_600) throw new Error("SMS text must be 1 to 1,600 characters.");
      const body = JSON.stringify({ to, text: message.text, ...(message.ref ? { ref: message.ref } : {}) });
      const response = await fetchImpl(parsed.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(secret ? { "X-CrabbyTab-Signature": signWebhookBody(body, secret) } : {}),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`The SMS relay answered ${response.status}.`);
    },
  };
}

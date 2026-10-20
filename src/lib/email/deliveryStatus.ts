import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Delivery status from the email provider (Tabbycat's EmailStatus; docs/email-notifications.md,
 * "Delivery status"). Every message CrabbyTab sends carries an `X-CrabbyTab-Ref` header naming its
 * tournament and campaign. A provider (or a small adapter in front of it) posts events back to
 * `POST /api/email/webhook`, signed with HMAC-SHA256 over the raw body using EMAIL_WEBHOOK_SECRET,
 * so no provider is built in: SMTP stays the default and webhooks are optional.
 */

export { DELIVERY_REF_HEADER } from "@/lib/email/messaging";
export const WEBHOOK_SIGNATURE_HEADER = "x-crabbytab-signature";
export const MAX_WEBHOOK_EVENTS = 500;
export const MAX_WEBHOOK_BODY_BYTES = 256_000;

/** Tabbycat's EmailStatus events. */
export const DELIVERY_EVENTS = [
  "processed",
  "deferred",
  "delivered",
  "bounce",
  "dropped",
  "open",
  "click",
  "spamreport",
  "unsubscribe",
  "failed",
] as const;
export type DeliveryEvent = (typeof DELIVERY_EVENTS)[number];

/** Later stages win; opens and clicks never hide a bounce. */
const EVENT_RANK: Record<DeliveryEvent, number> = {
  processed: 1,
  deferred: 2,
  delivered: 3,
  open: 4,
  click: 5,
  unsubscribe: 6,
  spamreport: 7,
  bounce: 8,
  dropped: 8,
  failed: 8,
};

export interface DeliveryUpdate {
  tournamentId: string;
  campaignId: string;
  email: string;
  event: DeliveryEvent;
  timestamp: string;
  reason?: string;
}

export interface StoredDeliveryStatus {
  event: DeliveryEvent;
  at: string;
  reason?: string;
}

export function deliveryRef(tournamentId: string, campaignId: string): string {
  return `${tournamentId}/${campaignId}`;
}

function parseRef(value: unknown): { tournamentId: string; campaignId: string } | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})$/);
  return match ? { tournamentId: match[1], campaignId: match[2] } : null;
}

/** A Firestore-safe map key for an address (dots and slashes are not allowed in field paths). */
export function deliveryKey(email: string): string {
  return Buffer.from(email.trim().toLowerCase()).toString("base64url");
}

export function signWebhookBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Constant-time check of the signature header against the raw body. */
export function verifyWebhookSignature(body: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const expected = Buffer.from(signWebhookBody(body, secret));
  const received = Buffer.from(header.trim());
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export class DeliveryWebhookError extends Error {}

/**
 * Parses `{ events: [{ ref, email, event, timestamp?, reason? }] }`. Events with an unknown kind or
 * a malformed ref are skipped (providers send many kinds); a malformed body is refused.
 */
export function parseDeliveryEvents(payload: unknown, now: string): DeliveryUpdate[] {
  const events = (payload as { events?: unknown } | null)?.events;
  if (!Array.isArray(events)) throw new DeliveryWebhookError("The body must be { events: [...] }.");
  if (events.length > MAX_WEBHOOK_EVENTS) throw new DeliveryWebhookError(`Send at most ${MAX_WEBHOOK_EVENTS} events at a time.`);
  const updates: DeliveryUpdate[] = [];
  for (const item of events) {
    const record = (item ?? {}) as Record<string, unknown>;
    const ref = parseRef(record.ref);
    const event = typeof record.event === "string" ? record.event.toLowerCase() : "";
    const email = typeof record.email === "string" ? record.email.trim() : "";
    if (!ref || !(DELIVERY_EVENTS as readonly string[]).includes(event) || !email || email.length > 320) continue;
    const time = typeof record.timestamp === "number"
      ? new Date(record.timestamp * (record.timestamp < 1e12 ? 1000 : 1))
      : typeof record.timestamp === "string" ? new Date(record.timestamp) : null;
    updates.push({
      ...ref,
      email,
      event: event as DeliveryEvent,
      timestamp: time && Number.isFinite(time.getTime()) ? time.toISOString() : now,
      ...(typeof record.reason === "string" && record.reason.trim()
        ? { reason: record.reason.replace(/[\r\n\t]+/g, " ").slice(0, 300) }
        : {}),
    });
  }
  return updates;
}

/** Whether `next` should replace the stored status (a later stage, or the same stage later). */
export function supersedesStatus(current: StoredDeliveryStatus | undefined, next: StoredDeliveryStatus): boolean {
  if (!current) return true;
  const rank = EVENT_RANK[next.event] - EVENT_RANK[current.event];
  return rank > 0 || (rank === 0 && next.at >= current.at);
}

/** Counts of the latest status per address, for campaign history. */
export function summarizeDelivery(statuses: Record<string, StoredDeliveryStatus> | undefined): Partial<Record<DeliveryEvent, number>> {
  const summary: Partial<Record<DeliveryEvent, number>> = {};
  for (const status of Object.values(statuses ?? {})) summary[status.event] = (summary[status.event] ?? 0) + 1;
  return summary;
}

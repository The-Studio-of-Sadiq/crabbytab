import { NextRequest, NextResponse } from "next/server";
import {
  deliveryKey,
  DeliveryWebhookError,
  MAX_WEBHOOK_BODY_BYTES,
  parseDeliveryEvents,
  supersedesStatus,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
  type StoredDeliveryStatus,
} from "@/lib/email/deliveryStatus";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

/**
 * Email delivery status webhook (docs/email-notifications.md, "Delivery status"). Generic and
 * signed: `X-CrabbyTab-Signature: sha256=<hex HMAC-SHA256 of the raw body>` with the server's
 * EMAIL_WEBHOOK_SECRET. Unsigned or wrongly signed requests are refused; without the secret the
 * endpoint is off. Each event updates the latest status of one address on its campaign.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.EMAIL_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Delivery webhooks are not configured." }, { status: 404 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_WEBHOOK_BODY_BYTES) return NextResponse.json({ error: "Body too large." }, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_WEBHOOK_BODY_BYTES) return NextResponse.json({ error: "Body too large." }, { status: 413 });
  if (!verifyWebhookSignature(raw, request.headers.get(WEBHOOK_SIGNATURE_HEADER), secret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }
  let updates;
  try {
    updates = parseDeliveryEvents(JSON.parse(raw), new Date().toISOString());
  } catch (error) {
    const message = error instanceof DeliveryWebhookError ? error.message : "Invalid JSON body.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  let applied = 0;
  try {
    const firestore = getAdminFirestore();
    // One transaction per campaign, so concurrent webhook calls never lose an update.
    const byCampaign = new Map<string, typeof updates>();
    for (const update of updates) {
      const key = `${update.tournamentId}/${update.campaignId}`;
      byCampaign.set(key, [...(byCampaign.get(key) ?? []), update]);
    }
    for (const group of byCampaign.values()) {
      const { tournamentId, campaignId } = group[0];
      const reference = firestore.collection("tournaments").doc(tournamentId).collection("emailCampaigns").doc(campaignId);
      applied += await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) return 0;
        const current = (snapshot.data()?.delivery ?? {}) as Record<string, StoredDeliveryStatus>;
        const next = { ...current };
        let changed = 0;
        for (const update of group) {
          const key = deliveryKey(update.email);
          const status: StoredDeliveryStatus = { event: update.event, at: update.timestamp, ...(update.reason ? { reason: update.reason } : {}) };
          if (supersedesStatus(next[key], status)) {
            next[key] = status;
            changed += 1;
          }
        }
        if (changed > 0) transaction.update(reference, { delivery: next });
        return changed;
      });
    }
  } catch (error) {
    console.error("Email delivery webhook failed:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Could not record delivery status." }, { status: 503 });
  }
  return NextResponse.json({ received: updates.length, applied });
}

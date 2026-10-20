import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { createFakeAdminFirestore, type FakeAdminFirestore } from "@/test/fakeAdminFirestore";
import { deliveryKey, signWebhookBody } from "@/lib/email/deliveryStatus";

let fake: FakeAdminFirestore;
vi.mock("@/lib/firebaseAdmin", () => ({ getAdminFirestore: () => fake.firestore }));

import { POST } from "./route";

const CAMPAIGN = "tournaments/t1/emailCampaigns/c1";

function request(body: string, signature?: string): NextRequest {
  return new Request("http://localhost/api/email/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...(signature ? { "x-crabbytab-signature": signature } : {}) },
    body,
  }) as unknown as NextRequest;
}

describe("POST /api/email/webhook", () => {
  beforeEach(() => {
    vi.stubEnv("EMAIL_WEBHOOK_SECRET", "secret");
    fake = createFakeAdminFirestore({ [CAMPAIGN]: { status: "completed" } });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("records the latest status per address from a signed request", async () => {
    const body = JSON.stringify({
      events: [
        { ref: "t1/c1", email: "a@b.co", event: "delivered", timestamp: "2026-10-20T10:00:00Z" },
        { ref: "t1/c1", email: "a@b.co", event: "open", timestamp: "2026-10-20T10:05:00Z" },
        { ref: "t1/missing", email: "a@b.co", event: "delivered" },
      ],
    });
    const response = await POST(request(body, signWebhookBody(body, "secret")));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: 3, applied: 2 });
    const delivery = fake.store.get(CAMPAIGN)?.delivery as Record<string, { event: string }>;
    expect(delivery[deliveryKey("a@b.co")].event).toBe("open");
  });

  it("refuses unsigned or wrongly signed requests and is off without a secret", async () => {
    const body = JSON.stringify({ events: [] });
    expect((await POST(request(body))).status).toBe(401);
    expect((await POST(request(body, signWebhookBody(body, "wrong")))).status).toBe(401);
    vi.stubEnv("EMAIL_WEBHOOK_SECRET", "");
    expect((await POST(request(body, signWebhookBody(body, "secret")))).status).toBe(404);
  });
});

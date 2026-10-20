import { describe, expect, it, vi } from "vitest";
import {
  deliveryKey,
  DeliveryWebhookError,
  parseDeliveryEvents,
  signWebhookBody,
  summarizeDelivery,
  supersedesStatus,
  verifyWebhookSignature,
} from "./deliveryStatus";
import { createWebhookSmsProvider, normalizePhoneNumber, SmsProviderConfigError } from "@/lib/sms/provider";

describe("delivery webhook", () => {
  it("verifies HMAC signatures over the raw body", () => {
    const body = JSON.stringify({ events: [] });
    const signature = signWebhookBody(body, "secret");
    expect(verifyWebhookSignature(body, signature, "secret")).toBe(true);
    expect(verifyWebhookSignature(`${body} `, signature, "secret")).toBe(false);
    expect(verifyWebhookSignature(body, signature, "other")).toBe(false);
    expect(verifyWebhookSignature(body, null, "secret")).toBe(false);
    expect(verifyWebhookSignature(body, signature, undefined)).toBe(false);
  });

  it("parses known events with a valid ref and skips the rest", () => {
    const updates = parseDeliveryEvents({
      events: [
        { ref: "t1/c1", email: "a@b.co", event: "Delivered", timestamp: 1_700_000_000 },
        { ref: "t1/c1", email: "a@b.co", event: "bounce", reason: "mailbox\nfull" },
        { ref: "bad ref", email: "a@b.co", event: "delivered" },
        { ref: "t1/c1", email: "a@b.co", event: "group_resubscribe" },
      ],
    }, "2026-10-20T00:00:00.000Z");
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ tournamentId: "t1", campaignId: "c1", event: "delivered" });
    expect(updates[0].timestamp).toBe(new Date(1_700_000_000_000).toISOString());
    expect(updates[1].reason).toBe("mailbox full");
    expect(() => parseDeliveryEvents({}, "now")).toThrow(DeliveryWebhookError);
  });

  it("keeps the latest stage per address and never hides a bounce behind an open", () => {
    const bounce = { event: "bounce" as const, at: "2026-10-20T10:00:00Z" };
    expect(supersedesStatus(undefined, bounce)).toBe(true);
    expect(supersedesStatus(bounce, { event: "open", at: "2026-10-20T11:00:00Z" })).toBe(false);
    expect(supersedesStatus({ event: "delivered", at: "x" }, bounce)).toBe(true);
    expect(summarizeDelivery({ a: bounce, b: { event: "delivered", at: "y" } })).toEqual({ bounce: 1, delivered: 1 });
    expect(deliveryKey(" A@B.co ")).toBe(deliveryKey("a@b.co"));
    expect(deliveryKey("a@b.co")).not.toMatch(/[./]/);
  });
});

describe("SMS hook", () => {
  it("normalizes international numbers only", () => {
    expect(normalizePhoneNumber("+880 1712-345678")).toBe("+8801712345678");
    expect(normalizePhoneNumber("01712345678")).toBeNull();
  });

  it("posts signed JSON to the configured relay, and is unavailable without one", async () => {
    expect(() => createWebhookSmsProvider({})).toThrow(SmsProviderConfigError);
    expect(() => createWebhookSmsProvider({ SMS_WEBHOOK_URL: "http://relay.example.com" })).toThrow(/https/);
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const provider = createWebhookSmsProvider(
      { SMS_WEBHOOK_URL: "https://relay.example.com/sms", SMS_WEBHOOK_SECRET: "s" },
      fetchImpl as unknown as typeof fetch
    );
    await provider.send({ to: "+8801712345678", text: "Draw is out" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://relay.example.com/sms");
    expect((init.headers as Record<string, string>)["X-CrabbyTab-Signature"]).toBe(signWebhookBody(String(init.body), "s"));
    await expect(provider.send({ to: "123", text: "x" })).rejects.toThrow(/international/);
  });
});

import { describe, expect, it, vi } from "vitest";
import { deliverMessages } from "./deliver";
import { EmailProviderConfigError, type EmailProvider } from "./provider";

const message = (to: string) => ({ to, subject: "s", text: "t" });

describe("deliverMessages", () => {
  it("reports each outcome without throwing", async () => {
    const provider: EmailProvider = {
      verifyConnection: vi.fn(),
      send: vi.fn(async ({ to }) => {
        if (to === "bad@example.com") throw new Error("550 mailbox unavailable");
      }),
    };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const outcomes = await deliverMessages([message("a@example.com"), message("bad@example.com")], () => provider);
    expect(outcomes[0]).toEqual({ delivered: true });
    expect(outcomes[1].delivered).toBe(false);
    expect(outcomes[1].error).not.toContain("550");
  });

  it("explains a missing SMTP configuration for every message", async () => {
    const outcomes = await deliverMessages([message("a@example.com"), message("b@example.com")], () => {
      throw new EmailProviderConfigError("SMTP_HOST missing");
    });
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((outcome) => !outcome.delivered && /not configured/.test(outcome.error ?? ""))).toBe(true);
  });

  it("does nothing for no messages", async () => {
    await expect(deliverMessages([], () => { throw new Error("unused"); })).resolves.toEqual([]);
  });
});

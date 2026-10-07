import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { EmailRecipient } from "./messaging";
import { createEmailCampaign } from "./history";

describe("email campaign history", () => {
  it("omits undefined Firestore fields and private credentials from campaign records", async () => {
    const create = vi.fn(async () => undefined);
    const campaignDocument = {
      id: "campaign-1",
      create,
      update: vi.fn(async () => undefined),
    };
    const campaignCollection = { doc: vi.fn(() => campaignDocument) };
    const tournamentDocument = { collection: vi.fn(() => campaignCollection) };
    const tournamentsCollection = { doc: vi.fn(() => tournamentDocument) };
    const firestore = {
      collection: vi.fn(() => tournamentsCollection),
    } as unknown as Firestore;
    const recipient: EmailRecipient = {
      email: "judge@example.com",
      name: "Judge One",
      adjudicatorId: "adj-1",
      round: undefined,
      chair: undefined,
      privateUrl: "https://example.com/private",
      passcode: "secret",
    };

    await createEmailCampaign(firestore, {
      tournamentId: "tournament-1",
      senderUid: "admin-1",
      senderEmail: "admin@example.com",
      senderName: "Admin",
      recipientGroup: "all_adjudicators",
      subjectTemplate: "Your portal",
      bodyTemplate: "{{private_url}}\n{{passcode}}",
      recipients: [recipient],
    });

    const record = create.mock.calls[0][0] as Record<string, unknown>;
    expect(record).not.toHaveProperty("roundId");
    expect(record).not.toHaveProperty("roundName");
    expect(record).not.toHaveProperty("retryOf");
    expect(record.failedRecipients).toEqual([
      { email: "judge@example.com", name: "Judge One", adjudicatorId: "adj-1" },
    ]);
  });
});

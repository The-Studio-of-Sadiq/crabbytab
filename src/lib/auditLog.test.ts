import { describe, expect, it } from "vitest";
import { AuditEvent, PublicAuditEvent } from "@/types";
import { buildAuditChain, verifyAuditChain } from "@/lib/auditLog";

const sampleEvents: AuditEvent[] = [
  {
    id: "event-2",
    tournamentId: "tournament-1",
    timestamp: "2026-01-02T00:00:00.000Z",
    actorType: "user",
    action: "draw_released",
    category: "draw",
    summary: "Round 1 draw released",
  },
  {
    id: "event-1",
    tournamentId: "tournament-1",
    timestamp: "2026-01-01T00:00:00.000Z",
    actorType: "user",
    action: "round_created",
    category: "tournament",
    summary: "Round 1 created",
  },
];

describe("audit log hash chain", () => {
  it("hashes events in chronological order and verifies the chain", async () => {
    const chain = await buildAuditChain(sampleEvents);
    const publicEvents: PublicAuditEvent[] = chain.map((event) => ({
      sequence: event.sequence!,
      timestamp: event.timestamp,
      category: event.category,
      action: event.action,
      summary: event.summary,
      previousHash: event.previousHash!,
      hash: event.hash!,
    }));

    expect(chain.map((event) => event.id)).toEqual(["event-1", "event-2"]);
    expect((await verifyAuditChain(publicEvents)).valid).toBe(true);
  });

  it("detects changed event contents and broken links", async () => {
    const chain = await buildAuditChain(sampleEvents);
    const publicEvents: PublicAuditEvent[] = chain.map((event) => ({
      sequence: event.sequence!,
      timestamp: event.timestamp,
      category: event.category,
      action: event.action,
      summary: event.summary,
      previousHash: event.previousHash!,
      hash: event.hash!,
    }));

    publicEvents[0].summary = "Changed after release";
    expect(await verifyAuditChain(publicEvents)).toEqual({ valid: false, invalidSequence: 1 });

    const validChain = await buildAuditChain(sampleEvents);
    const brokenLinks: PublicAuditEvent[] = validChain.map((event) => ({
      sequence: event.sequence!,
      timestamp: event.timestamp,
      category: event.category,
      action: event.action,
      summary: event.summary,
      previousHash: event.previousHash!,
      hash: event.hash!,
    }));
    brokenLinks[1].previousHash = "f".repeat(64);
    expect(await verifyAuditChain(brokenLinks)).toEqual({ valid: false, invalidSequence: 2 });
  });
});

import { AuditEvent, PublicAuditEvent } from "@/types";

export const AUDIT_HASH_GENESIS = "0".repeat(64);

export function orderAuditEvents(events: AuditEvent[]): AuditEvent[] {
  return [...events].sort((left, right) => {
    const timeDifference = Date.parse(left.timestamp) - Date.parse(right.timestamp);
    return timeDifference || left.id.localeCompare(right.id);
  });
}

async function hashPayload(
  sequence: number,
  previousHash: string,
  event: Pick<AuditEvent, "timestamp" | "category" | "action" | "summary">
): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("This browser does not support secure audit-log hashing.");
  }

  const canonicalEvent = JSON.stringify({
    sequence,
    timestamp: event.timestamp,
    category: event.category,
    action: event.action,
    summary: event.summary,
  });
  const bytes = new TextEncoder().encode(
    `crabbytab-audit-v1\n${previousHash}\n${canonicalEvent}`
  );
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildAuditChain(events: AuditEvent[]): Promise<AuditEvent[]> {
  let previousHash = AUDIT_HASH_GENESIS;
  const orderedEvents = orderAuditEvents(events);
  const hashedEvents: AuditEvent[] = [];

  for (const [index, event] of orderedEvents.entries()) {
    const sequence = index + 1;
    const hash = await hashPayload(sequence, previousHash, event);
    hashedEvents.push({ ...event, sequence, previousHash, hash });
    previousHash = hash;
  }

  return hashedEvents;
}

export async function verifyAuditChain(
  events: PublicAuditEvent[]
): Promise<{ valid: boolean; invalidSequence?: number }> {
  let previousHash = AUDIT_HASH_GENESIS;

  for (const [index, event] of events.entries()) {
    const sequence = index + 1;
    if (event.sequence !== sequence || event.previousHash !== previousHash) {
      return { valid: false, invalidSequence: sequence };
    }
    const expectedHash = await hashPayload(sequence, previousHash, event);
    if (event.hash !== expectedHash) {
      return { valid: false, invalidSequence: sequence };
    }
    previousHash = expectedHash;
  }

  return { valid: true };
}

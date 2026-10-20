import type { RateLimitResult } from "./store";

/**
 * Per-instance sliding-window limiter for API reads. It costs no Firestore reads, which matters
 * on the Spark tier, but each serverless instance counts on its own, so it is a burst guard rather
 * than a global quota. Writes additionally use the durable limiter in the store.
 */
export class MemoryRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly maxKeys = 10_000) {}

  consume(key: string, max: number, windowMs: number, now: number): RateLimitResult {
    const recent = (this.hits.get(key) ?? []).filter((timestamp) => timestamp > now - windowMs);
    if (recent.length >= max) {
      this.hits.set(key, recent);
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) };
    }
    recent.push(now);
    this.hits.delete(key);
    this.hits.set(key, recent);
    // Forget the least recently used keys so memory stays bounded.
    while (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest === undefined) break;
      this.hits.delete(oldest);
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export const RATE_LIMITS = {
  /** Requests per client address per minute, before any token lookup. */
  perAddressPerMinute: 600,
  /** Requests per token per minute. */
  perTokenPerMinute: 300,
  /** Writes per token per hour (durable, shared across instances). */
  writesPerTokenPerHour: 1000,
  /** `/me` lookups per client address per hour (durable): private keys must not be guessable. */
  participantLookupsPerAddressPerHour: 120,
} as const;

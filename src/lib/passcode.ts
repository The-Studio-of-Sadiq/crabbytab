import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time passcode comparison. Both values are hashed first so the
 * buffers passed to timingSafeEqual always have equal length and the
 * comparison time does not reveal the stored passcode's length or prefix.
 */
export function passcodesMatch(stored: unknown, provided: unknown): boolean {
  if (typeof stored !== "string" || typeof provided !== "string" || stored.length === 0) return false;
  const storedDigest = createHash("sha256").update(stored, "utf8").digest();
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  return timingSafeEqual(storedDigest, providedDigest);
}

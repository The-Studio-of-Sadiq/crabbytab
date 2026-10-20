import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Single-purpose link tokens (staff invitations, institution representative links).
 *
 * A token is `{tournamentId}.{recordId}.{secret}`: the ids let the server fetch the one record
 * directly (no query, one read), and only the SHA-256 hash of the 256-bit secret is stored, so a
 * database read does not reveal a usable link. Tokens travel in the URL fragment, which browsers
 * never send to servers or in Referer headers.
 */

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface ParsedLinkToken {
  tournamentId: string;
  recordId: string;
  secret: string;
}

export function isValidRecordId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function hashLinkSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function createLinkToken(
  tournamentId: string,
  recordId: string,
  random: (size: number) => Buffer = randomBytes
): { token: string; secretHash: string } {
  if (!isValidRecordId(tournamentId) || !isValidRecordId(recordId)) {
    throw new Error("Link tokens need URL-safe tournament and record ids.");
  }
  const secret = random(32).toString("base64url");
  return { token: `${tournamentId}.${recordId}.${secret}`, secretHash: hashLinkSecret(secret) };
}

export function parseLinkToken(value: unknown): ParsedLinkToken | null {
  if (typeof value !== "string" || value.length > 400) return null;
  const parts = value.trim().split(".");
  if (parts.length !== 3) return null;
  const [tournamentId, recordId, secret] = parts;
  if (!isValidRecordId(tournamentId) || !isValidRecordId(recordId) || !SECRET_PATTERN.test(secret)) {
    return null;
  }
  return { tournamentId, recordId, secret };
}

/** Constant-time comparison of a presented secret with the stored hash. */
export function linkSecretMatches(secret: string, storedHash: unknown): boolean {
  if (typeof storedHash !== "string" || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  return timingSafeEqual(Buffer.from(hashLinkSecret(secret), "hex"), Buffer.from(storedHash, "hex"));
}

/** A stable record id for one email address within a tournament (one live link per address). */
export function recordIdForEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/**
 * Origin used in emailed links. NEXT_PUBLIC_APP_URL wins so links never depend on the request's
 * Host header; the request origin is the fallback for local development.
 */
export function linkOrigin(requestOrigin: string, configured = process.env.NEXT_PUBLIC_APP_URL): string {
  const value = configured?.trim() || requestOrigin;
  return value.replace(/\/+$/, "");
}

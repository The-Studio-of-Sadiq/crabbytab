import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Public (non-private-URL) ballot and feedback forms — roadmap #26, Tabbycat's
 * `participant_ballots` / `participant_feedback` = "public" with the optional `public_password`.
 *
 * The password is stored only as a salted scrypt hash in `tournaments/{id}/serverOnly/publicForms`
 * (firestore.rules deny clients everything under serverOnly), never in the tournament preferences,
 * which are published with the public view.
 */

export const PUBLIC_FORMS_DOCUMENT = "publicForms";
export const PUBLIC_PASSWORD_MIN_LENGTH = 4;
export const PUBLIC_PASSWORD_MAX_LENGTH = 128;
export const MAX_PUBLIC_SUBMISSION_BYTES = 32_000;

export interface StoredPublicPassword {
  passwordHash: string;
  salt: string;
  updatedAt: string;
}

const KEY_LENGTH = 32;

function derive(password: string, salt: string): Buffer {
  return scryptSync(password.normalize("NFC"), salt, KEY_LENGTH);
}

/** Trims and checks a new password; returns an error message, or null when it is acceptable. */
export function publicPasswordProblem(password: unknown): string | null {
  if (typeof password !== "string") return "Enter a password.";
  const trimmed = password.trim();
  if (trimmed.length < PUBLIC_PASSWORD_MIN_LENGTH) return `The password needs at least ${PUBLIC_PASSWORD_MIN_LENGTH} characters.`;
  if (trimmed.length > PUBLIC_PASSWORD_MAX_LENGTH) return `The password can have at most ${PUBLIC_PASSWORD_MAX_LENGTH} characters.`;
  return null;
}

export function hashPublicPassword(password: string, now = new Date(), salt = randomBytes(16).toString("hex")): StoredPublicPassword {
  return { passwordHash: derive(password.trim(), salt).toString("hex"), salt, updatedAt: now.toISOString() };
}

/** Constant-time check of a submitted password against the stored hash. */
export function verifyPublicPassword(stored: unknown, provided: unknown): boolean {
  if (!stored || typeof stored !== "object" || typeof provided !== "string") return false;
  const { passwordHash, salt } = stored as Partial<StoredPublicPassword>;
  if (typeof passwordHash !== "string" || typeof salt !== "string" || provided.length > PUBLIC_PASSWORD_MAX_LENGTH * 4) return false;
  const expected = Buffer.from(passwordHash, "hex");
  const actual = derive(provided.trim(), salt);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export type PublicSubmissionKind = "ballot" | "feedback";

export interface PublicSubmissionRequest {
  kind: PublicSubmissionKind;
  /** Who submits: the adjudicator for a ballot; the team or adjudicator giving feedback. */
  participantType: "adjudicator" | "team";
  participantId: string;
  /** The ballot or feedback record, validated by the shared participant-submission rules. */
  record: Record<string, unknown>;
  password?: string;
  honeypot?: unknown;
  startedAt?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("/");
}

/** Shape check of a public submission body; the record's contents are checked by the shared rules. */
export function parsePublicSubmission(body: unknown): PublicSubmissionRequest | { error: string } {
  if (!isRecord(body)) return { error: "Invalid request body." };
  const { kind, participantType, participantId, record, password } = body;
  if (kind !== "ballot" && kind !== "feedback") return { error: "Choose a ballot or feedback form." };
  if (participantType !== "adjudicator" && participantType !== "team") return { error: "Choose who you are." };
  if (kind === "ballot" && participantType !== "adjudicator") return { error: "Only adjudicators submit ballots." };
  if (!validId(participantId)) return { error: "Choose who you are." };
  if (!isRecord(record) || !validId(record.id)) return { error: "The submission is invalid." };
  if (password !== undefined && (typeof password !== "string" || password.length > PUBLIC_PASSWORD_MAX_LENGTH * 4)) {
    return { error: "The password is invalid." };
  }
  return {
    kind,
    participantType,
    participantId,
    record,
    ...(typeof password === "string" ? { password } : {}),
    honeypot: body.website,
    startedAt: body.startedAt,
  };
}

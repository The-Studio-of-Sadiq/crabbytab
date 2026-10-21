import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { MAX_PUBLIC_FORMS_PASSWORD_LENGTH } from "@/lib/publicFormsPasswordRules";

/**
 * The tournament password for public forms (Tabbycat `public_password`). Only a salted scrypt hash
 * is stored, in `tournaments/{id}/serverOnly/publicForms`, which firestore.rules deny to every
 * client; the password never appears in the tournament preferences or the public snapshot.
 */

export const PUBLIC_FORMS_PASSWORD_DOCUMENT = "publicForms";
const KEY_LENGTH = 32;

export {
  MAX_PUBLIC_FORMS_PASSWORD_LENGTH,
  MIN_PUBLIC_FORMS_PASSWORD_LENGTH,
  publicFormsPasswordError,
} from "@/lib/publicFormsPasswordRules";

export interface StoredPublicFormsPassword {
  algorithm: "scrypt";
  salt: string;
  hash: string;
}

export function hashPublicFormsPassword(password: string, salt = randomBytes(16).toString("hex")): StoredPublicFormsPassword {
  return { algorithm: "scrypt", salt, hash: scryptSync(password, salt, KEY_LENGTH).toString("hex") };
}

function isStored(value: unknown): value is StoredPublicFormsPassword {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.algorithm === "scrypt" &&
    typeof record.salt === "string" && record.salt.length > 0 &&
    typeof record.hash === "string" && /^[0-9a-f]{64}$/.test(record.hash);
}

/** Whether a password has been set (a well-formed hash is stored). */
export function hasPublicFormsPassword(stored: unknown): boolean {
  return isStored(stored);
}

/**
 * Constant-time check of a typed password against the stored hash. A missing or malformed hash
 * never matches, so a form that requires a password stays closed until one is set.
 */
export function verifyPublicFormsPassword(stored: unknown, provided: unknown): boolean {
  if (!isStored(stored) || typeof provided !== "string" || provided.length === 0 || provided.length > 4 * MAX_PUBLIC_FORMS_PASSWORD_LENGTH) {
    return false;
  }
  const expected = Buffer.from(stored.hash, "hex");
  const actual = scryptSync(provided, stored.salt, KEY_LENGTH);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

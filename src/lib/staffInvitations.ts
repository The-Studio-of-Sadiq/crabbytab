import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { isGlobalAdminUid } from "@/lib/globalAdmin";
import {
  createLinkToken,
  linkSecretMatches,
  normalizeEmail,
  parseLinkToken,
  recordIdForEmail,
} from "@/lib/linkTokens";
import { isTournamentAdministrator } from "@/lib/tournamentAccess";

/**
 * Staff invitations (docs/staff-invitations.md). An administrator invites an email address to a
 * tournament role; the invitee opens the emailed link, signs in or creates an account with that
 * address, and the server grants the role. Invitations live in the server-only collection
 * `tournaments/{id}/serverOnly/staffInvitations/items/{invitationId}` (firestore.rules deny
 * clients), keyed by a hash of the email so an address has at most one live invitation.
 */

export type StaffRole = "admin" | "dataEntry";
export type StaffInvitationStatus = "pending" | "accepted" | "revoked";
export type StaffInvitationState = StaffInvitationStatus | "expired";

export interface StaffInvitationRecord {
  email: string;
  role: StaffRole;
  tokenHash: string;
  status: StaffInvitationStatus;
  createdAt: string;
  createdBy: string;
  expiresAt: string;
  sendCount: number;
  lastSentAt?: string;
  deliveryError?: string;
  acceptedAt?: string;
  acceptedBy?: string;
  revokedAt?: string;
  revokedBy?: string;
}

/** What administrators see: never the token hash. */
export type StaffInvitationSummary = Omit<StaffInvitationRecord, "tokenHash"> & {
  id: string;
  state: StaffInvitationState;
};

export const DEFAULT_INVITATION_DAYS = 7;
export const MAX_INVITATION_DAYS = 30;
export const MAX_INVITATIONS_PER_REQUEST = 50;
export const MIN_PASSWORD_LENGTH = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

export class InvitationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** True when the presented token itself was wrong (counts toward the failure throttle). */
    readonly badToken = false
  ) {
    super(message);
  }
}

export function invitationsCollection(tournamentRef: DocumentReference) {
  return tournamentRef.collection("serverOnly").doc("staffInvitations").collection("items");
}

export function invitationState(record: Pick<StaffInvitationRecord, "status" | "expiresAt">, now: number): StaffInvitationState {
  if (record.status !== "pending") return record.status;
  const expires = Date.parse(record.expiresAt);
  return Number.isFinite(expires) && expires > now ? "pending" : "expired";
}

export function summarizeInvitation(id: string, record: StaffInvitationRecord, now: number): StaffInvitationSummary {
  const { tokenHash: _tokenHash, ...rest } = record;
  return { ...rest, id, state: invitationState(record, now) };
}

export function parseInvitationRole(value: unknown): StaffRole | null {
  return value === "admin" || value === "dataEntry" ? value : null;
}

/** Whole days, 1–30; absent means the default. Anything else is refused rather than clamped. */
export function parseExpiryDays(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return DEFAULT_INVITATION_DAYS;
  const days = typeof value === "string" ? Number(value) : value;
  return typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= MAX_INVITATION_DAYS ? days : null;
}

export function parseInvitationEmails(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_INVITATIONS_PER_REQUEST) return null;
  const emails = value.map(normalizeEmail);
  if (emails.some((email) => email === null)) return null;
  return [...new Set(emails as string[])];
}

export function invitationLink(origin: string, token: string): string {
  return `${origin}/invite#${token}`;
}

export function buildInvitationEmail(input: {
  tournamentName: string;
  role: StaffRole;
  link: string;
  expiresAt: string;
  inviterName?: string;
}): { subject: string; text: string } {
  const roleName = input.role === "admin" ? "tournament administrator" : "data-entry staff member";
  const inviter = input.inviterName?.trim() ? `${input.inviterName.trim()} has invited you` : "You have been invited";
  return {
    subject: `Invitation to ${input.tournamentName} on CrabbyTab`,
    text: [
      `${inviter} to join ${input.tournamentName} on CrabbyTab as a ${roleName}.`,
      "",
      "Open this link to accept. You can sign in with an existing CrabbyTab account for this email address or create one:",
      input.link,
      "",
      `The link works once and expires on ${new Date(input.expiresAt).toUTCString()}.`,
      "If you were not expecting this invitation, you can ignore this email.",
    ].join("\n"),
  };
}

export interface InvitationIssue {
  id: string;
  email: string;
  role: StaffRole;
  expiresAt: string;
  token: string;
}

/**
 * Creates (or renews) one invitation per email. Renewing an address's invitation replaces its
 * token, so older links for it stop working. Runs inside the caller's administrator check.
 */
export function issueInvitations(input: {
  emails: string[];
  role: StaffRole;
  expiryDays: number;
  tournamentId: string;
  actorUid: string;
  now: number;
  existing: Map<string, StaffInvitationRecord | undefined>;
}): Array<{ issue: InvitationIssue; record: StaffInvitationRecord }> {
  return input.emails.map((email) => {
    const id = recordIdForEmail(email);
    const { token, secretHash } = createLinkToken(input.tournamentId, id);
    const previous = input.existing.get(id);
    const createdAt = new Date(input.now).toISOString();
    const expiresAt = new Date(input.now + input.expiryDays * DAY_MS).toISOString();
    const record: StaffInvitationRecord = {
      email,
      role: input.role,
      tokenHash: secretHash,
      status: "pending",
      createdAt,
      createdBy: input.actorUid,
      expiresAt,
      sendCount: previous?.status === "pending" ? previous.sendCount : 0,
    };
    return { issue: { id, email, role: input.role, expiresAt, token }, record };
  });
}

/** Renews an existing invitation's token and expiry for resending. */
export function renewInvitation(
  record: StaffInvitationRecord,
  input: { id: string; tournamentId: string; expiryDays: number; now: number }
): { issue: InvitationIssue; record: StaffInvitationRecord } {
  if (record.status !== "pending") {
    throw new InvitationError(
      record.status === "accepted" ? "This invitation has already been accepted." : "This invitation was revoked. Create a new one.",
      409
    );
  }
  const { token, secretHash } = createLinkToken(input.tournamentId, input.id);
  const expiresAt = new Date(input.now + input.expiryDays * DAY_MS).toISOString();
  // Firestore rejects undefined values, so the old delivery error is dropped rather than cleared.
  const { deliveryError: _deliveryError, ...rest } = record;
  return {
    issue: { id: input.id, email: record.email, role: record.role, expiresAt, token },
    record: { ...rest, tokenHash: secretHash, expiresAt },
  };
}

interface LoadedInvitation {
  tournamentRef: DocumentReference;
  invitationRef: DocumentReference;
  record: StaffInvitationRecord;
  tournament: Record<string, unknown>;
}

/** Finds the invitation a token names and checks its secret. Any mismatch is a 404 bad token. */
export async function loadInvitationByToken(firestore: Firestore, token: unknown): Promise<LoadedInvitation> {
  const parsed = parseLinkToken(token);
  if (!parsed) throw new InvitationError("This invitation link is not valid.", 404, true);
  const tournamentRef = firestore.collection("tournaments").doc(parsed.tournamentId);
  const invitationRef = invitationsCollection(tournamentRef).doc(parsed.recordId);
  const [invitationSnapshot, tournamentSnapshot] = await firestore.getAll(invitationRef, tournamentRef);
  const record = invitationSnapshot.data() as StaffInvitationRecord | undefined;
  if (!record || !tournamentSnapshot.exists || !linkSecretMatches(parsed.secret, record.tokenHash)) {
    throw new InvitationError("This invitation link is not valid.", 404, true);
  }
  return { tournamentRef, invitationRef, record, tournament: tournamentSnapshot.data() ?? {} };
}

export interface InvitationPreview {
  tournamentName: string;
  tournamentSlug: string;
  email: string;
  role: StaffRole;
  expiresAt: string;
  state: StaffInvitationState;
}

export function previewInvitation(loaded: LoadedInvitation, now: number): InvitationPreview {
  return {
    tournamentName: typeof loaded.tournament.name === "string" ? loaded.tournament.name : "Tournament",
    tournamentSlug: typeof loaded.tournament.slug === "string" ? loaded.tournament.slug : "",
    email: loaded.record.email,
    role: loaded.record.role,
    expiresAt: loaded.record.expiresAt,
    state: invitationState(loaded.record, now),
  };
}

function stateError(state: StaffInvitationState): InvitationError | null {
  if (state === "pending") return null;
  if (state === "accepted") return new InvitationError("This invitation has already been used.", 410);
  if (state === "revoked") return new InvitationError("This invitation was withdrawn by the tournament.", 410);
  return new InvitationError("This invitation has expired. Ask the tournament to send a new one.", 410);
}

export function assertInvitationUsable(record: StaffInvitationRecord, now: number): void {
  const error = stateError(invitationState(record, now));
  if (error) throw error;
}

/**
 * Accepts an invitation for a signed-in account, in one transaction: the invitation must still be
 * pending, unexpired, hold the same token hash that was checked, and be addressed to the
 * account's email. The staff role is granted and the invitation marked used together, so a link
 * works exactly once. An existing higher role is never lowered.
 */
export async function acceptInvitation(input: {
  firestore: Firestore;
  token: unknown;
  account: { uid: string; email?: string | null; displayName?: string | null };
  now: number;
}): Promise<{ role: StaffRole; tournamentId: string; tournamentSlug: string }> {
  const loaded = await loadInvitationByToken(input.firestore, input.token);
  const accountEmail = normalizeEmail(input.account.email);
  if (!accountEmail || accountEmail !== loaded.record.email) {
    throw new InvitationError(
      `This invitation is for ${loaded.record.email}. Sign in with that address to accept it.`,
      403
    );
  }
  const staffRef = loaded.tournamentRef.collection("staff").doc(input.account.uid);
  return input.firestore.runTransaction(async (transaction) => {
    const [invitationSnapshot, tournamentSnapshot, staffSnapshot] = await Promise.all([
      transaction.get(loaded.invitationRef),
      transaction.get(loaded.tournamentRef),
      transaction.get(staffRef),
    ]);
    const record = invitationSnapshot.data() as StaffInvitationRecord | undefined;
    if (!record || record.tokenHash !== loaded.record.tokenHash || !tournamentSnapshot.exists) {
      throw new InvitationError("This invitation link is no longer valid.", 410);
    }
    assertInvitationUsable(record, input.now);
    const tournament = tournamentSnapshot.data() ?? {};
    const currentRole = staffSnapshot.data()?.role;
    const alreadyAdministrator =
      isGlobalAdminUid(input.account.uid) ||
      isTournamentAdministrator({ ownerId: tournament.ownerId, admins: tournament.admins }, input.account.uid) ||
      currentRole === "admin";
    const role: StaffRole = alreadyAdministrator ? "admin" : record.role;
    const acceptedAt = new Date(input.now).toISOString();
    transaction.set(staffRef, {
      email: accountEmail,
      displayName: input.account.displayName || staffSnapshot.data()?.displayName || "",
      role,
      addedAt: staffSnapshot.data()?.addedAt || acceptedAt,
      addedBy: record.createdBy,
      invitationId: loaded.invitationRef.id,
    });
    transaction.update(loaded.invitationRef, {
      status: "accepted",
      acceptedAt,
      acceptedBy: input.account.uid,
    });
    return {
      role,
      tournamentId: loaded.tournamentRef.id,
      tournamentSlug: typeof tournament.slug === "string" ? tournament.slug : "",
    };
  });
}

export function validateNewAccount(input: { password?: unknown; displayName?: unknown }): {
  password: string;
  displayName: string;
} {
  const password = typeof input.password === "string" ? input.password : "";
  const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 128) {
    throw new InvitationError(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`, 400);
  }
  if (displayName.length < 1 || displayName.length > 100) {
    throw new InvitationError("Enter your name (up to 100 characters).", 400);
  }
  return { password, displayName };
}

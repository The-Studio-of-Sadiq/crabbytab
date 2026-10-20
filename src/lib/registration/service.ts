import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import {
  createLinkToken,
  linkSecretMatches,
  normalizeEmail,
  parseLinkToken,
  recordIdForEmail,
} from "@/lib/linkTokens";
import { isValidPublicSlug } from "@/lib/publicView/store";
import { adjustCounters, quotaLimits, quotaRefusal, readCounters, remainingPlaces } from "@/lib/registration/quota";
import type {
  RegistrationCounters,
  RegistrationEntry,
  RegistrationInstitution,
  RegistrationRepresentative,
  RegistrationSettings,
  RegistrationSubmission,
  RepresentativeSummary,
} from "@/lib/registration/types";
import {
  cleanText,
  defaultRegistrationSettings,
  makeInstitution,
  parseRegistrationEntry,
  registrationWindowState,
  RegistrationValidationError,
} from "@/lib/registration/validation";

/**
 * Server-side registration storage (docs/registration.md):
 * - `tournaments/{id}/serverOnly/registration`: settings;
 * - `tournaments/{id}/serverOnly/registrationCounters`: quota counters;
 * - `…/serverOnly/registration/submissions/{id}`: submissions;
 * - `…/serverOnly/registration/representatives/{id}`: institution representative links.
 * firestore.rules deny clients everything under `serverOnly`.
 */

export class RegistrationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** A wrong representative token (counts toward the failure throttle). */
    readonly badToken = false
  ) {
    super(message);
  }
}

export function registrationRefs(tournamentRef: DocumentReference) {
  const serverOnly = tournamentRef.collection("serverOnly");
  const settingsRef = serverOnly.doc("registration");
  return {
    settingsRef,
    countersRef: serverOnly.doc("registrationCounters"),
    submissions: settingsRef.collection("submissions"),
    representatives: settingsRef.collection("representatives"),
  };
}

/** Finds a tournament by its public slug: the slug registry first, then a two-document query. */
export async function resolveTournamentBySlug(firestore: Firestore, slug: string): Promise<DocumentReference | null> {
  if (!isValidPublicSlug(slug)) return null;
  const reservation = await firestore.collection("tournamentSlugs").doc(slug).get();
  const reservedFor = reservation.data()?.tournamentId;
  if (typeof reservedFor === "string" && reservedFor) return firestore.collection("tournaments").doc(reservedFor);
  const snapshot = await firestore.collection("tournaments").where("slug", "==", slug).limit(2).get();
  return snapshot.docs.length === 1 ? snapshot.docs[0].ref : null;
}

export function readSettings(value: unknown): RegistrationSettings | null {
  if (!value || typeof value !== "object") return null;
  const settings = value as RegistrationSettings;
  return {
    ...defaultRegistrationSettings(settings.tournamentName ?? "Tournament"),
    ...settings,
  };
}

export function summarizeRepresentative(record: RegistrationRepresentative): RepresentativeSummary {
  const { tokenHash: _tokenHash, ...summary } = record;
  return summary;
}

export function representativeIdFor(institution: RegistrationInstitution, email: string): string {
  return recordIdForEmail(`${institution.key}|${email}`);
}

/** Loads the active representative a token names, checked against the tournament it was used for. */
export async function loadRepresentativeByToken(
  tournamentRef: DocumentReference,
  token: unknown
): Promise<RegistrationRepresentative> {
  const parsed = parseLinkToken(token);
  if (!parsed || parsed.tournamentId !== tournamentRef.id) {
    throw new RegistrationError("This registration link is not valid.", 404, true);
  }
  const snapshot = await registrationRefs(tournamentRef).representatives.doc(parsed.recordId).get();
  const record = snapshot.data() as RegistrationRepresentative | undefined;
  if (!record || !linkSecretMatches(parsed.secret, record.tokenHash)) {
    throw new RegistrationError("This registration link is not valid.", 404, true);
  }
  if (record.status !== "active") throw new RegistrationError("This registration link was withdrawn by the tournament.", 410);
  return record;
}

function windowError(settings: RegistrationSettings, now: number): RegistrationError | null {
  const state = registrationWindowState(settings, now);
  if (state === "open") return null;
  if (state === "not_open") return new RegistrationError("Registration has not opened yet.", 403);
  if (state === "closed") return new RegistrationError("Registration has closed.", 403);
  return new RegistrationError("This tournament is not taking registrations.", 403);
}

export interface RepresentativeView {
  institutionName: string;
  name: string;
  remaining: { team: number | null; adjudicator: number | null };
}

export async function describeRepresentative(
  tournamentRef: DocumentReference,
  representative: RegistrationRepresentative,
  settings: RegistrationSettings
): Promise<RepresentativeView> {
  const counters = readCounters((await registrationRefs(tournamentRef).countersRef.get()).data());
  const key = representative.institution.key;
  return {
    institutionName: representative.institution.name,
    name: representative.name,
    remaining: {
      team: remainingPlaces(counters, "team", key, quotaLimits("team", settings, representative)),
      adjudicator: remainingPlaces(counters, "adjudicator", key, quotaLimits("adjudicator", settings, representative)),
    },
  };
}

/**
 * Stores one public submission. The window, kind and representative rules are checked first;
 * quota and the counters update happen in the transaction that creates the submission, so two
 * simultaneous registrations cannot both take an institution's last place.
 */
export async function submitRegistration(input: {
  firestore: Firestore;
  tournamentRef: DocumentReference;
  registration: unknown;
  representativeToken?: unknown;
  sourceHash?: string;
  now: number;
}): Promise<{ id: string; kind: RegistrationEntry["kind"]; entry: RegistrationEntry; tournamentName: string }> {
  const refs = registrationRefs(input.tournamentRef);
  const settings = readSettings((await refs.settingsRef.get()).data());
  if (!settings) throw new RegistrationError("This tournament is not taking registrations.", 403);
  const closed = windowError(settings, input.now);
  if (closed) throw closed;
  const hasToken = typeof input.representativeToken === "string" && input.representativeToken.trim() !== "";
  const representative = hasToken ? await loadRepresentativeByToken(input.tournamentRef, input.representativeToken) : undefined;
  if (settings.representativesOnly && !representative) {
    throw new RegistrationError("Registration is through institution representatives only. Use the link your representative received.", 403);
  }
  const entry = parseRegistrationEntry(input.registration, settings, { institution: representative?.institution });
  const reference = refs.submissions.doc();
  const timestamp = new Date(input.now).toISOString();

  await input.firestore.runTransaction(async (transaction) => {
    const counters = readCounters((await transaction.get(refs.countersRef)).data());
    const key = entry.institution?.key ?? null;
    const refusal = quotaRefusal(counters, entry.kind, key, quotaLimits(entry.kind, settings, representative));
    if (refusal) throw new RegistrationError(refusal, 409);
    const submission: RegistrationSubmission = {
      ...entry,
      id: reference.id,
      status: "pending",
      submittedAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
    };
    if (representative) submission.representativeId = representative.id;
    if (input.sourceHash) submission.sourceHash = input.sourceHash;
    transaction.create(reference, stripUndefined(submission));
    transaction.set(refs.countersRef, adjustCounters(counters, entry.kind, key, 1));
  });
  return { id: reference.id, kind: entry.kind, entry, tournamentName: settings.tournamentName };
}

/** Firestore rejects undefined values; registration records never need them. */
function stripUndefined<T extends object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export type ReviewAction = "edit" | "reject" | "reopen" | "claim" | "release" | "approve";

export function parseReviewAction(value: unknown): ReviewAction | null {
  return ["edit", "reject", "reopen", "claim", "release", "approve"].includes(value as string) ? (value as ReviewAction) : null;
}

const ACTION_PAST: Record<ReviewAction, string> = {
  edit: "edited",
  reject: "rejected",
  reopen: "reopened",
  claim: "claimed for approval",
  release: "released",
  approve: "approved",
};

const ALLOWED_FROM: Record<ReviewAction, RegistrationSubmission["status"][]> = {
  edit: ["pending"],
  reject: ["pending", "approving"],
  reopen: ["rejected"],
  claim: ["pending"],
  release: ["approving"],
  approve: ["approving"],
};

/**
 * Applies one review action in a transaction. The caller passes the revision it saw; a submission
 * changed since (by the registrant's quota neighbour, another administrator, …) is refused so no
 * newer change is overwritten. `assertAdministrator` re-checks the reviewer's role in the same
 * transaction.
 */
export async function reviewSubmission(input: {
  firestore: Firestore;
  tournamentRef: DocumentReference;
  assertAdministrator: (transaction: Transaction) => Promise<unknown>;
  reviewerUid: string;
  action: ReviewAction;
  submissionId: string;
  revision: unknown;
  data?: unknown;
  reason?: unknown;
  entityId?: unknown;
  entityName?: unknown;
  now: number;
}): Promise<RegistrationSubmission> {
  const refs = registrationRefs(input.tournamentRef);
  const reference = refs.submissions.doc(input.submissionId);
  return input.firestore.runTransaction(async (transaction) => {
    await input.assertAdministrator(transaction);
    const [snapshot, settingsSnapshot, countersSnapshot] = await Promise.all([
      transaction.get(reference),
      transaction.get(refs.settingsRef),
      transaction.get(refs.countersRef),
    ]);
    const current = snapshot.data() as RegistrationSubmission | undefined;
    if (!current) throw new RegistrationError("Submission not found.", 404);
    if (current.revision !== input.revision) {
      throw new RegistrationError("This submission changed since you loaded it. Reload the queue and try again.", 409);
    }
    if (!ALLOWED_FROM[input.action].includes(current.status)) {
      const status = current.status === "approving" ? "being approved" : current.status;
      throw new RegistrationError(`This submission is ${status} and cannot be ${ACTION_PAST[input.action]}.`, 409);
    }
    const timestamp = new Date(input.now).toISOString();
    let counters: RegistrationCounters = readCounters(countersSnapshot.data());
    const key = current.institution?.key ?? null;
    let next: RegistrationSubmission = { ...current, updatedAt: timestamp, revision: current.revision + 1 };

    if (input.action === "edit") {
      const settings = readSettings(settingsSnapshot.data()) ?? defaultRegistrationSettings("Tournament");
      // Administrators may edit outside the window and above quota; the kind cannot change.
      const entry = parseRegistrationEntry(
        { ...(input.data as Record<string, unknown>), kind: current.kind },
        { ...settings, teamRegistration: true, adjudicatorRegistration: true }
      );
      const nextKey = entry.institution?.key ?? null;
      if (nextKey !== key) {
        counters = adjustCounters(adjustCounters(counters, current.kind, key, -1), current.kind, nextKey, 1);
      }
      const { team: _team, adjudicator: _adjudicator, ...rest } = next;
      next = { ...rest, ...entry };
    } else if (input.action === "reject") {
      const reason = cleanText(input.reason ?? "", 500);
      if (reason === null) throw new RegistrationValidationError("Keep the reason under 500 characters.");
      next = { ...next, status: "rejected", reviewedAt: timestamp, reviewedBy: input.reviewerUid, rejectionReason: reason };
      delete next.claimedBy;
      delete next.claimedAt;
      counters = adjustCounters(counters, current.kind, key, -1);
    } else if (input.action === "reopen") {
      next = { ...next, status: "pending" };
      delete next.rejectionReason;
      delete next.reviewedAt;
      delete next.reviewedBy;
      counters = adjustCounters(counters, current.kind, key, 1);
    } else if (input.action === "claim") {
      next = { ...next, status: "approving", claimedBy: input.reviewerUid, claimedAt: timestamp };
    } else if (input.action === "release") {
      next = { ...next, status: "pending" };
      delete next.claimedBy;
      delete next.claimedAt;
    } else {
      const entityId = typeof input.entityId === "string" && /^[^/]{1,200}$/.test(input.entityId) ? input.entityId : null;
      const entityName = cleanText(input.entityName ?? "", 200);
      if (!entityId || entityName === null) throw new RegistrationValidationError("Name the team or adjudicator this approval created.");
      next = {
        ...next,
        status: "approved",
        reviewedAt: timestamp,
        reviewedBy: input.reviewerUid,
        approvedEntityId: entityId,
        approvedEntityName: entityName,
      };
    }
    const stored = stripUndefined(next);
    transaction.set(reference, stored);
    transaction.set(refs.countersRef, counters);
    return stored;
  });
}

export interface RepresentativeInput {
  institution: RegistrationInstitution;
  email: string;
  name: string;
  teamQuota?: number;
  adjudicatorQuota?: number;
}

function optionalQuota(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isInteger(number) || number < 0 || number > 1_000) {
    throw new RegistrationValidationError(`${label} must be a whole number from 0 to 1000, or empty for the default.`);
  }
  return number;
}

export function parseRepresentativeInput(input: unknown): RepresentativeInput {
  const record = (input ?? {}) as Record<string, unknown>;
  const institution = makeInstitution(record.institutionName);
  if (!institution) throw new RegistrationValidationError("Enter the representative's institution.");
  const email = normalizeEmail(record.email);
  if (!email) throw new RegistrationValidationError("Enter a valid email address for the representative.");
  const name = cleanText(record.name ?? "", 120);
  if (name === null) throw new RegistrationValidationError("Names can be at most 120 characters.");
  const parsed: RepresentativeInput = { institution, email, name };
  const teamQuota = optionalQuota(record.teamQuota, "Team places");
  const adjudicatorQuota = optionalQuota(record.adjudicatorQuota, "Adjudicator places");
  if (teamQuota !== undefined) parsed.teamQuota = teamQuota;
  if (adjudicatorQuota !== undefined) parsed.adjudicatorQuota = adjudicatorQuota;
  return parsed;
}

/** A new representative record (or a renewed one) with a fresh link token. */
export function issueRepresentative(
  input: RepresentativeInput,
  context: { tournamentId: string; actorUid: string; now: number; previous?: RegistrationRepresentative }
): { record: RegistrationRepresentative; token: string } {
  const id = representativeIdFor(input.institution, input.email);
  const { token, secretHash } = createLinkToken(context.tournamentId, id);
  const record: RegistrationRepresentative = {
    id,
    institution: input.institution,
    email: input.email,
    name: input.name,
    tokenHash: secretHash,
    status: "active",
    createdAt: context.previous?.createdAt ?? new Date(context.now).toISOString(),
    createdBy: context.previous?.createdBy ?? context.actorUid,
    sendCount: context.previous?.sendCount ?? 0,
  };
  if (input.teamQuota !== undefined) record.teamQuota = input.teamQuota;
  if (input.adjudicatorQuota !== undefined) record.adjudicatorQuota = input.adjudicatorQuota;
  return { record, token };
}

export function representativeLink(origin: string, slug: string, token: string): string {
  return `${origin}/register/${encodeURIComponent(slug)}#${token}`;
}

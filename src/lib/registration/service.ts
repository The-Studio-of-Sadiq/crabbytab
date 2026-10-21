import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import {
  createLinkToken,
  linkSecretMatches,
  normalizeEmail,
  parseLinkToken,
  recordIdForEmail,
} from "@/lib/linkTokens";
import { isValidPublicSlug } from "@/lib/publicView/store";
import { adjustCounters, isOverAllocated, quotaLimits, quotaRefusal, readCounters, remainingPlaces } from "@/lib/registration/quota";
import type {
  SlotTransfer,
  RegistrationCounters,
  RegistrationEntry,
  RegistrationInstitution,
  RegistrationRepresentative,
  RegistrationSettings,
  RegistrationSubmission,
  RepresentativeSummary,
} from "@/lib/registration/types";
import { applyTransfer } from "@/lib/registration/transfers";
import { channelRefusal } from "@/lib/registration/access";
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
    transfers: settingsRef.collection("transfers"),
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
  if (
    !record ||
    !(linkSecretMatches(parsed.secret, record.tokenHash) ||
      (record.landingTokenHash !== undefined && linkSecretMatches(parsed.secret, record.landingTokenHash)))
  ) {
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
  /** The institution registered but has no places yet: the link can only show its request. */
  awaitingPlaces?: boolean;
  remaining: { team: number | null; adjudicator: number | null };
  /** With slot transfers on: the other institutions places can be given to. */
  transferTargets?: Array<{ id: string; institutionName: string }>;
}

export async function describeRepresentative(
  tournamentRef: DocumentReference,
  representative: RegistrationRepresentative,
  settings: RegistrationSettings
): Promise<RepresentativeView> {
  const counters = readCounters((await registrationRefs(tournamentRef).countersRef.get()).data());
  const key = representative.institution.key;
  const view: RepresentativeView = {
    institutionName: representative.institution.name,
    name: representative.name,
    remaining: {
      team: remainingPlaces(counters, "team", key, quotaLimits("team", settings, representative)),
      adjudicator: remainingPlaces(counters, "adjudicator", key, quotaLimits("adjudicator", settings, representative)),
    },
  };
  if (representative.awaitingPlaces) {
    view.awaitingPlaces = true;
    view.remaining = { team: 0, adjudicator: 0 };
    return view;
  }
  if (settings.slotTransfers) {
    const others = await registrationRefs(tournamentRef).representatives.where("status", "==", "active").get();
    view.transferTargets = others.docs
      .map((document) => document.data() as RegistrationRepresentative)
      .filter((other) => other.id !== representative.id && other.institution.key !== representative.institution.key && !other.awaitingPlaces)
      .map((other) => ({ id: other.id, institutionName: other.institution.name }))
      .filter((other, index, all) => all.findIndex((item) => item.institutionName === other.institutionName) === index)
      .sort((left, right) => left.institutionName.localeCompare(right.institutionName));
  }
  return view;
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
}): Promise<{
  id: string;
  kind: RegistrationEntry["kind"];
  entry: RegistrationEntry;
  tournamentName: string;
  settings: RegistrationSettings;
  submission: RegistrationSubmission;
}> {
  const refs = registrationRefs(input.tournamentRef);
  const settings = readSettings((await refs.settingsRef.get()).data());
  if (!settings) throw new RegistrationError("This tournament is not taking registrations.", 403);
  const closed = windowError(settings, input.now);
  if (closed) throw closed;
  const hasToken = typeof input.representativeToken === "string" && input.representativeToken.trim() !== "";
  const representative = hasToken ? await loadRepresentativeByToken(input.tournamentRef, input.representativeToken) : undefined;
  const entry = parseRegistrationEntry(input.registration, settings, { institution: representative?.institution });
  if (entry.kind !== "institution") {
    // Open and representative registration are separate switches (src/lib/registration/access.ts).
    const refusal = channelRefusal(settings, entry.kind, Boolean(representative));
    if (refusal) throw new RegistrationError(refusal, 403);
    if (representative?.awaitingPlaces) {
      throw new RegistrationError("Your institution's places have not been allocated yet. You will get your registration link by email once they are.", 403);
    }
  }
  const reference = refs.submissions.doc();
  const timestamp = new Date(input.now).toISOString();

  const submission = await input.firestore.runTransaction(async (transaction) => {
    const counters = readCounters((await transaction.get(refs.countersRef)).data());
    const key = entry.institution?.key ?? null;
    const limits = quotaLimits(entry.kind, settings, representative);
    const allowOver = settings.blockOverAllocation === false;
    const refusal = quotaRefusal(counters, entry.kind, key, limits, allowOver);
    if (refusal) throw new RegistrationError(refusal, 409);
    const created: RegistrationSubmission = {
      ...entry,
      id: reference.id,
      status: "pending",
      submittedAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
    };
    if (representative) created.representativeId = representative.id;
    if (input.sourceHash) created.sourceHash = input.sourceHash;
    if (allowOver && isOverAllocated(counters, entry.kind, key, limits)) created.overAllocated = true;
    transaction.create(reference, stripUndefined(created));
    transaction.set(refs.countersRef, adjustCounters(counters, entry.kind, key, 1));
    return stripUndefined(created);
  });
  return { id: reference.id, kind: entry.kind, entry, tournamentName: settings.tournamentName, settings, submission };
}

/** Firestore rejects undefined values; registration records never need them. */
function stripUndefined<T extends object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export type ReviewAction = "edit" | "reject" | "reopen" | "claim" | "release" | "approve" | "allocate";

export function parseReviewAction(value: unknown): ReviewAction | null {
  return ["edit", "reject", "reopen", "claim", "release", "approve", "allocate"].includes(value as string)
    ? (value as ReviewAction)
    : null;
}

const ACTION_PAST: Record<ReviewAction, string> = {
  edit: "edited",
  reject: "rejected",
  reopen: "reopened",
  claim: "claimed for approval",
  release: "released",
  approve: "approved",
  allocate: "allocated places",
};

const ALLOWED_FROM: Record<ReviewAction, RegistrationSubmission["status"][]> = {
  edit: ["pending"],
  reject: ["pending", "approving"],
  reopen: ["rejected"],
  claim: ["pending"],
  release: ["approving"],
  approve: ["approving"],
  allocate: ["pending"],
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
  /** "allocate": the places given to an institution registration. */
  teamsAllocated?: unknown;
  adjudicatorsAllocated?: unknown;
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
    if (input.action === "allocate" && current.kind !== "institution") {
      throw new RegistrationError("Only institution registrations are given places.", 409);
    }
    if ((input.action === "claim" || input.action === "approve") && current.kind === "institution") {
      throw new RegistrationError("Give an institution registration its places instead.", 409);
    }
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
    } else if (input.action === "allocate") {
      const places = (value: unknown, label: string) => {
        const number = typeof value === "string" ? Number(value) : value;
        if (typeof number !== "number" || !Number.isInteger(number) || number < 0 || number > 1_000) {
          throw new RegistrationValidationError(`${label} must be a whole number from 0 to 1000.`);
        }
        return number;
      };
      next = {
        ...next,
        status: "approved",
        reviewedAt: timestamp,
        reviewedBy: input.reviewerUid,
        teamsAllocated: places(input.teamsAllocated, "Team places"),
        adjudicatorsAllocated: places(input.adjudicatorsAllocated, "Adjudicator places"),
        approvedEntityName: current.institution?.name ?? "",
      };
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
  context: {
    tournamentId: string;
    actorUid: string;
    now: number;
    previous?: RegistrationRepresentative;
    /**
     * Allocating places to a registered institution: the link emailed when it registered keeps
     * working (Tabbycat's coach landing page). A "new link" never keeps old links.
     */
    keepLandingLink?: boolean;
  }
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
  const previous = context.previous;
  if (context.keepLandingLink && previous?.status === "active") {
    const landing = previous.landingTokenHash ?? (previous.awaitingPlaces ? previous.tokenHash : undefined);
    if (landing) record.landingTokenHash = landing;
  }
  return { record, token };
}

/**
 * Tabbycat's coach landing page: when an institution registers, its contact gets a representative
 * link at once (`awaitingPlaces`), to follow the registration. Nothing is issued when that
 * institution and email already have a representative record (an organiser-added representative is
 * never downgraded). Returns the new token, or null.
 */
export async function issueInstitutionLanding(input: {
  firestore: Firestore;
  tournamentRef: DocumentReference;
  submission: Pick<RegistrationSubmission, "kind" | "institution" | "contactEmail" | "contactName">;
  now: number;
}): Promise<string | null> {
  const { submission } = input;
  if (submission.kind !== "institution" || !submission.institution) return null;
  const email = normalizeEmail(submission.contactEmail);
  if (!email) return null;
  const institution = submission.institution;
  const id = representativeIdFor(institution, email);
  const reference = registrationRefs(input.tournamentRef).representatives.doc(id);
  return input.firestore.runTransaction(async (transaction) => {
    if ((await transaction.get(reference)).exists) return null;
    const { record, token } = issueRepresentative(
      { institution, email, name: submission.contactName },
      { tournamentId: input.tournamentRef.id, actorUid: "registration", now: input.now }
    );
    transaction.create(reference, { ...record, awaitingPlaces: true });
    return token;
  });
}

export function representativeLink(origin: string, slug: string, token: string): string {
  return `${origin}/register/${encodeURIComponent(slug)}#${token}`;
}

/**
 * Marks a submission approved by the server itself (automatic acceptance). Refused, leaving the
 * submission for review, if anything changed it since it was stored.
 */
export async function markAutoApproved(input: {
  firestore: Firestore;
  tournamentRef: DocumentReference;
  submission: RegistrationSubmission;
  entity: { entityId: string; entityName: string };
  now: number;
}): Promise<RegistrationSubmission | null> {
  const reference = registrationRefs(input.tournamentRef).submissions.doc(input.submission.id);
  return input.firestore.runTransaction(async (transaction) => {
    const current = (await transaction.get(reference)).data() as RegistrationSubmission | undefined;
    if (!current || current.status !== "pending" || current.revision !== input.submission.revision) return null;
    const timestamp = new Date(input.now).toISOString();
    const next: RegistrationSubmission = {
      ...current,
      status: "approved",
      autoApproved: true,
      reviewedAt: timestamp,
      reviewedBy: "automatic",
      approvedEntityId: input.entity.entityId,
      approvedEntityName: input.entity.entityName,
      updatedAt: timestamp,
      revision: current.revision + 1,
    };
    transaction.set(reference, next);
    return next;
  });
}

/** Stores a representative's request to give places to another institution, for review. */
export async function requestSlotTransfer(input: {
  tournamentRef: DocumentReference;
  representative: RegistrationRepresentative;
  toRepresentativeId: string;
  teams: number;
  adjudicators: number;
  now: number;
}): Promise<SlotTransfer> {
  const refs = registrationRefs(input.tournamentRef);
  const settings = readSettings((await refs.settingsRef.get()).data());
  if (!settings?.slotTransfers) throw new RegistrationError("This tournament does not take place transfers.", 403);
  if (input.representative.awaitingPlaces) throw new RegistrationError("Your institution's places have not been allocated yet.", 403);
  const target = (await refs.representatives.doc(input.toRepresentativeId).get()).data() as RegistrationRepresentative | undefined;
  if (!target || target.status !== "active" || target.awaitingPlaces || target.institution.key === input.representative.institution.key) {
    throw new RegistrationError("Choose another registered institution.", 400);
  }
  const reference = refs.transfers.doc();
  const transfer: SlotTransfer = {
    id: reference.id,
    fromRepresentativeId: input.representative.id,
    fromInstitution: input.representative.institution,
    toRepresentativeId: target.id,
    toInstitution: target.institution,
    teams: input.teams,
    adjudicators: input.adjudicators,
    status: "pending",
    requestedAt: new Date(input.now).toISOString(),
  };
  await reference.create(transfer);
  return transfer;
}

/**
 * Approves or rejects a pending transfer. Approval moves the places between the two
 * representatives' limits in the same transaction (see applyTransfer).
 */
export async function reviewSlotTransfer(input: {
  firestore: Firestore;
  tournamentRef: DocumentReference;
  assertAdministrator: (transaction: Transaction) => Promise<unknown>;
  reviewerUid: string;
  transferId: string;
  approve: boolean;
  now: number;
}): Promise<SlotTransfer> {
  const refs = registrationRefs(input.tournamentRef);
  const reference = refs.transfers.doc(input.transferId);
  return input.firestore.runTransaction(async (transaction) => {
    await input.assertAdministrator(transaction);
    const transfer = (await transaction.get(reference)).data() as SlotTransfer | undefined;
    if (!transfer) throw new RegistrationError("Transfer not found.", 404);
    if (transfer.status !== "pending") throw new RegistrationError("This transfer was already reviewed.", 409);
    const timestamp = new Date(input.now).toISOString();
    const reviewed: SlotTransfer = { ...transfer, status: input.approve ? "approved" : "rejected", reviewedAt: timestamp, reviewedBy: input.reviewerUid };
    if (input.approve) {
      const [fromSnapshot, toSnapshot, settingsSnapshot, countersSnapshot] = await Promise.all([
        transaction.get(refs.representatives.doc(transfer.fromRepresentativeId)),
        transaction.get(refs.representatives.doc(transfer.toRepresentativeId)),
        transaction.get(refs.settingsRef),
        transaction.get(refs.countersRef),
      ]);
      const from = fromSnapshot.data() as RegistrationRepresentative | undefined;
      const to = toSnapshot.data() as RegistrationRepresentative | undefined;
      if (!from || !to) throw new RegistrationError("One of the representatives no longer exists.", 409);
      const settings = readSettings(settingsSnapshot.data()) ?? defaultRegistrationSettings("Tournament");
      const used = readCounters(countersSnapshot.data()).institutions[from.institution.key] ?? { teams: 0, adjudicators: 0 };
      const next = applyTransfer(transfer, from, to, settings, used);
      transaction.set(refs.representatives.doc(from.id), next.from);
      transaction.set(refs.representatives.doc(to.id), next.to);
    }
    transaction.set(reference, reviewed);
    return reviewed;
  });
}

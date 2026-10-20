import type { FeedbackAnswer, FeedbackQuestion } from "@/types";

/**
 * Self-registration records (docs/registration.md). Everything here is stored under the
 * server-only `tournaments/{id}/serverOnly` namespace and reaches clients only through server
 * routes: administrators through `/api/tournaments/{id}/registration*`, the public through
 * `/api/public/tournaments/{slug}/registration` (the public form and nothing else).
 */

export type RegistrationKind = "team" | "adjudicator";

export interface RegistrationSettings {
  enabled: boolean;
  /** ISO times; absent = no limit on that side. */
  opensAt?: string;
  closesAt?: string;
  teamRegistration: boolean;
  adjudicatorRegistration: boolean;
  /** Only people holding an institution representative link may register. */
  representativesOnly: boolean;
  minSpeakers: number;
  maxSpeakers: number;
  /** Speaker category labels registrants may tick (e.g. "ESL", "Novice"). */
  speakerCategories: string[];
  /** Per-institution limits on non-rejected submissions; 0 = unlimited. */
  teamQuotaPerInstitution: number;
  adjudicatorQuotaPerInstitution: number;
  /** Tournament-wide limits on non-rejected submissions; 0 = unlimited. */
  maxTeams: number;
  maxAdjudicators: number;
  teamQuestions: FeedbackQuestion[];
  adjudicatorQuestions: FeedbackQuestion[];
  /** Shown above the public form. Plain text. */
  instructions: string;
  /** Copied from the tournament when saved, so the public form needs no tournament read. */
  tournamentName: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface RegisteredSpeaker {
  name: string;
  email?: string;
  categories: string[];
}

export interface TeamRegistrationData {
  name: string;
  speakers: RegisteredSpeaker[];
}

export interface AdjudicatorRegistrationData {
  name: string;
  email: string;
  /** Institutions the adjudicator is conflicted with, beyond their own. */
  institutionConflicts: string[];
  /** Teams or people the adjudicator is conflicted with (free text; matched on approval). */
  teamConflicts: string[];
}

export interface RegistrationInstitution {
  name: string;
  /** Normalized name used for quotas and matching. */
  key: string;
}

/** What a registrant (or an administrator editing) supplies. */
export interface RegistrationEntry {
  kind: RegistrationKind;
  /** null: independent / no institution. */
  institution: RegistrationInstitution | null;
  team?: TeamRegistrationData;
  adjudicator?: AdjudicatorRegistrationData;
  contactName: string;
  contactEmail: string;
  answers: Record<string, FeedbackAnswer>;
}

export type RegistrationStatus = "pending" | "approving" | "approved" | "rejected";

export interface RegistrationSubmission extends RegistrationEntry {
  id: string;
  status: RegistrationStatus;
  representativeId?: string;
  submittedAt: string;
  updatedAt: string;
  /** Increments on every change; edits and reviews must name the revision they saw. */
  revision: number;
  /** Hash of the submitting client address, to spot floods from one network. */
  sourceHash?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  rejectionReason?: string;
  claimedBy?: string;
  claimedAt?: string;
  approvedEntityId?: string;
  approvedEntityName?: string;
}

export interface RegistrationRepresentative {
  id: string;
  institution: RegistrationInstitution;
  email: string;
  name: string;
  tokenHash: string;
  status: "active" | "revoked";
  /** Overrides the per-institution quota for this institution; absent = the default. */
  teamQuota?: number;
  adjudicatorQuota?: number;
  createdAt: string;
  createdBy: string;
  sendCount: number;
  lastSentAt?: string;
  deliveryError?: string;
}

export type RepresentativeSummary = Omit<RegistrationRepresentative, "tokenHash">;

export interface InstitutionCount {
  teams: number;
  adjudicators: number;
}

/** Running totals of non-rejected submissions, kept in one document for quota checks. */
export interface RegistrationCounters {
  teams: number;
  adjudicators: number;
  institutions: Record<string, InstitutionCount>;
}

/** The public form definition (no quotas or review data). */
export interface PublicRegistrationForm {
  tournamentName: string;
  state: "open" | "not_open" | "closed" | "disabled";
  opensAt?: string;
  closesAt?: string;
  teamRegistration: boolean;
  adjudicatorRegistration: boolean;
  representativesOnly: boolean;
  minSpeakers: number;
  maxSpeakers: number;
  speakerCategories: string[];
  teamQuestions: FeedbackQuestion[];
  adjudicatorQuestions: FeedbackQuestion[];
  instructions: string;
}

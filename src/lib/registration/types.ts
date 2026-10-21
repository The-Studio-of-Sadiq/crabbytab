import type { FeedbackAnswer, FeedbackQuestion, TeamSeedMode } from "@/types";
import type { CodeNameGenerator, TeamNameGenerator } from "@/lib/registration/names";

/**
 * Self-registration records (docs/registration.md). Everything here is stored under the
 * server-only `tournaments/{id}/serverOnly` namespace and reaches clients only through server
 * routes: administrators through `/api/tournaments/{id}/registration*`, the public through
 * `/api/public/tournaments/{slug}/registration` (the public form and nothing else).
 */

/** "institution": an institution (or its coach) asking for places, Tabbycat's institution registration. */
export type RegistrationKind = "team" | "adjudicator" | "institution";

/** Tabbycat `registration_confirmation`: which submissions wait for an administrator. */
export type RegistrationConfirmation = "always" | "open" | "never";

/** Optional person fields a form asks for (mapped to Speaker / Adjudicator fields on approval). */
export type PersonField = "phone" | "gender";

/**
 * Optional team fields registrants may fill (Tabbycat `reg_team_fields`): prefixing the team name
 * with the institution, choosing break categories, a seed and an emoji.
 */
export type TeamRegistrationField = "use_institution_prefix" | "break_categories" | "seed" | "emoji";

/** A break category registrants may choose (copied from the tournament when settings are saved). */
export interface RegistrationBreakCategory {
  id: string;
  name: string;
}

export interface RegistrationSettings {
  enabled: boolean;
  /** ISO times; absent = no limit on that side. */
  opensAt?: string;
  closesAt?: string;
  teamRegistration: boolean;
  adjudicatorRegistration: boolean;
  /**
   * Only people holding an institution representative link may register. Superseded by the
   * per-kind switches below when they are set (see src/lib/registration/access.ts).
   */
  representativesOnly: boolean;
  /**
   * Tabbycat `open_team_registration` / `open_adj_registration`: teams / adjudicators may register
   * on the public form without a representative link. Absent: `!representativesOnly` (as before).
   */
  openTeamRegistration?: boolean;
  openAdjudicatorRegistration?: boolean;
  /**
   * Tabbycat `institution_participant_registration`: representative links may register teams and
   * adjudicators. Absent: on (as before).
   */
  institutionParticipantRegistration?: boolean;
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
  /** Wave 4/5 breadth (docs/registration.md); absent in older settings, read with defaults. */
  institutionRegistration?: boolean;
  confirmation?: RegistrationConfirmation;
  /** Refuse team/adjudicator registrations above an institution's places (default) or accept and flag them. */
  blockOverAllocation?: boolean;
  /** Representatives may ask to give places to another institution. */
  slotTransfers?: boolean;
  teamNameGenerator?: TeamNameGenerator;
  codeNameGenerator?: CodeNameGenerator;
  speakerFields?: PersonField[];
  adjudicatorFields?: PersonField[];
  /**
   * Tabbycat `reg_speaker_fields` "email" / "categories" and `reg_adjudicator_fields` "email":
   * whether the forms ask for them. Absent: asked (as before).
   */
  askSpeakerEmail?: boolean;
  askSpeakerCategories?: boolean;
  askAdjudicatorEmail?: boolean;
  /** Optional team fields (Tabbycat `reg_team_fields`); absent = none (the form as before). */
  teamFields?: TeamRegistrationField[];
  /**
   * The tournament's non-general break categories, copied when the settings are saved so the
   * public form needs no extra reads. Re-save the settings after changing break categories.
   */
  teamBreakCategories?: RegistrationBreakCategory[];
  /** The tournament's seed mode (preferences.teamSeedMode), copied when the settings are saved. */
  teamSeedMode?: TeamSeedMode;
  /** Ask institutions for their region. */
  institutionRegion?: boolean;
  /** Per-form messages shown above the team / adjudicator / institution form. Plain text. */
  teamMessage?: string;
  adjudicatorMessage?: string;
  institutionMessage?: string;
  institutionQuestions?: FeedbackQuestion[];
  /**
   * Asked of the institution's contact person (Tabbycat's coach questions, reg-coach-questions) on
   * the institution form, separately from the questions about the institution. Absent = none.
   */
  coachQuestions?: FeedbackQuestion[];
  /** Asked once per speaker on the team form. */
  speakerQuestions?: FeedbackQuestion[];
  /** Copied from the tournament when saved, so the public form needs no tournament read. */
  tournamentName: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface RegisteredSpeaker {
  name: string;
  email?: string;
  categories: string[];
  phone?: string;
  gender?: string;
  answers?: Record<string, FeedbackAnswer>;
}

export interface TeamRegistrationData {
  /** Empty when a team-name generator names the team on approval (the form does not ask). */
  name: string;
  speakers: RegisteredSpeaker[];
  /** Optional team fields (present only when the settings ask for them). */
  useInstitutionPrefix?: boolean;
  /** Break category ids, from RegistrationSettings.teamBreakCategories. */
  breakCategories?: string[];
  seed?: number;
  emoji?: string;
}

export interface AdjudicatorRegistrationData {
  name: string;
  /** Absent when the form does not ask for it (`askAdjudicatorEmail: false`). */
  email?: string;
  /** Institutions the adjudicator is conflicted with, beyond their own. */
  institutionConflicts: string[];
  /** Teams or people the adjudicator is conflicted with (free text; matched on approval). */
  teamConflicts: string[];
  phone?: string;
  gender?: string;
}

/** An institution (its coach is the submission's contact) asking for places. */
export interface InstitutionRegistrationData {
  code?: string;
  region?: string;
  teamsRequested: number;
  adjudicatorsRequested: number;
  /** The contact person's answers to the coach questions (absent when none were asked). */
  coachAnswers?: Record<string, FeedbackAnswer>;
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
  institutionRequest?: InstitutionRegistrationData;
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
  /** Accepted above the institution's places (when over-allocation is allowed). */
  overAllocated?: boolean;
  /** Approved automatically (no confirmation needed). */
  autoApproved?: boolean;
  /** Institution registrations: the places allocated on approval. */
  teamsAllocated?: number;
  adjudicatorsAllocated?: number;
}

/** A representative's request to give places to another institution (docs/registration.md). */
export interface SlotTransfer {
  id: string;
  fromRepresentativeId: string;
  fromInstitution: RegistrationInstitution;
  toRepresentativeId: string;
  toInstitution: RegistrationInstitution;
  teams: number;
  adjudicators: number;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
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
  /**
   * Issued when the institution registered (Tabbycat's coach landing page), before the tab room
   * allocated places: the link shows the institution's own request only and cannot register
   * anyone or transfer places. Cleared when places are allocated.
   */
  awaitingPlaces?: boolean;
  /** Hash of that registration-time link, kept valid after allocation issues the places link. */
  landingTokenHash?: string;
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
  /** True when neither teams nor adjudicators may register without a representative link. */
  representativesOnly: boolean;
  /** Resolved channels (src/lib/registration/access.ts); optional for forms cached before them. */
  openTeamRegistration?: boolean;
  openAdjudicatorRegistration?: boolean;
  institutionParticipantRegistration?: boolean;
  /** A team-name generator names teams: the team-name field is not asked. */
  teamNameGenerated?: boolean;
  askSpeakerEmail?: boolean;
  askSpeakerCategories?: boolean;
  askAdjudicatorEmail?: boolean;
  minSpeakers: number;
  maxSpeakers: number;
  speakerCategories: string[];
  teamQuestions: FeedbackQuestion[];
  adjudicatorQuestions: FeedbackQuestion[];
  instructions: string;
  institutionRegistration: boolean;
  slotTransfers: boolean;
  speakerFields: PersonField[];
  adjudicatorFields: PersonField[];
  /** Optional team fields; the prefix option is listed only when the team-name generator is "user". */
  teamFields: TeamRegistrationField[];
  teamBreakCategories: RegistrationBreakCategory[];
  /** How the seed field asks: "title" offers Tabbycat's seed titles, anything else a number. */
  teamSeedMode: TeamSeedMode;
  institutionRegion: boolean;
  teamMessage: string;
  adjudicatorMessage: string;
  institutionMessage: string;
  institutionQuestions: FeedbackQuestion[];
  coachQuestions: FeedbackQuestion[];
  speakerQuestions: FeedbackQuestion[];
}

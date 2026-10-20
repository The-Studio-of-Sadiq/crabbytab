"use client";

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  Tournament,
  Round,
  Team,
  Adjudicator,
  Venue,
  Motion,
  BreakCategory,
  Debate,
  BallotSubmission,
  FeedbackSubmission,
  AuditCategory,
  AuditEvent,
  BallotIntakeRecord,
  TeamStandingRow,
  SpeakerStandingRow,
  Institution,
} from "@/types";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { calculateStandings } from "@/lib/standings/calculator";
import { calculateBreaks, BreakCategoryResult } from "@/lib/breakqual/calculator";
import {
  buildDataEntrySyncPayload,
  DATA_ENTRY_COLLECTIONS,
  downloadTournamentCommand,
  baselineAfterDataEntrySync,
  mergeCloudIntoWorkingCopy,
  mergeCloudTournament,
  parseDivergedRecords,
  parseSyncBaseline,
  resolveDivergedRecords,
  uploadTournamentCommand,
  type CloudRecord,
  type CloudDeletionMap,
  type CloudOverwriteMap,
  divergedRecordKey,
  type DivergedRecord,
  type SyncBaseline,
  type WorkingCopyMerge,
} from "@/features/tournament/application/cloudSync";
import { safeJsonParse } from "@/lib/safeJson";
import { getLocalStore } from "@/lib/offline/localStore";
import { generatePrivateKey } from "@/lib/privateUrls";
import { createRoundCommand, updateRoundCommand } from "@/features/tournament/application/rounds";
import { createEntityId, createTournamentEntityCommands, type EntityBatch } from "@/features/tournament/application/entities";
import { confirmBallotCommand, discardBallotCommand, submitBallotCommand } from "@/features/tournament/application/ballots";
import { addIntakeRecord, createIntakeRecord, type BallotSheet } from "@/features/tournament/application/ballotIntake";
import { createSeededRng } from "@/lib/draw/rng";
import { applyMotionReleaseSync, roundsNeedingMotionReleaseSync } from "@/features/tournament/application/motionRelease";
import {
  addFeedbackInSequence,
  planSimulatedBallots,
  planSimulatedFeedback,
  submitBallotsInSequence,
  type SkippedDebate,
} from "@/features/tournament/application/rehearsal";
import { generateDrawCommand } from "@/features/tournament/application/draws";
import { saveTournamentCommand } from "@/features/tournament/application/settings";
import { withRuleOverride } from "@/features/tournament/application/ruleOverridePrompt";
import type { RuleOverride } from "@/features/tournament/application/stateGuards";
import { validateDraw } from "@/lib/draw/validateDraw";
import {
  addFeedbackCommand,
  reviewFeedbackCommand,
  type FeedbackReviewChange,
} from "@/features/tournament/application/feedback";
import {
  autoAllocateCommand,
  updateDebateCommand,
  updateDebatesCommand,
  type AutoAllocateSettings,
  type AutoAllocationInput,
} from "@/features/tournament/application/allocation";
import {
  generateBreakCommand,
  proceedToNextEliminationRoundCommand,
  saveBreakCategoriesCommand,
} from "@/features/tournament/application/breaks";
import {
  deleteRoundCommand,
  setPreliminaryRoundCountCommand,
} from "@/features/tournament/application/roundAdministration";
import { regeneratePrivateAccessCommand } from "@/features/tournament/application/privateAccess";
import { CLOUD_COLLECTIONS } from "@/features/tournament/collections";
import {
  createTournamentBackup,
  diffTournamentBackup,
  mergeTournamentBackup,
  parseTournamentBackup,
  planTournamentBackupReplace,
  validateTournamentBackup,
  type BackupCollections,
  type BackupDiff,
  type BackupValidation,
} from "@/features/tournament/application/tournamentBackup";
import { createDebateXmlArchive } from "@/features/tournament/application/debateXml";
import {
  fetchCompletePublicProjection,
  fetchPublicProjection,
  fetchPublicRound,
  fetchPublicViewVersion,
  publicRoundsToLoad,
  replaceRoundRecords,
  PUBLIC_VIEW_POLL_MILLISECONDS,
  publishPublicViewCommand,
  type PublicProjectionExtras,
  type PublicProjectionResponse,
} from "@/features/tournament/application/publicView";
import {
  computePendingChanges,
  NO_PENDING_CHANGES,
  parseCloudIdMap,
  parseUploadIssue,
  planRepublish,
  publishBlockerAfterUpload,
  type PendingChanges,
  type UploadIssue,
} from "@/features/tournament/application/syncStatus";
import type { SelfCheckInRequest, SelfCheckInStatus } from "@/lib/selfCheckIn";
import {
  describeNotificationSummary,
  hasAutomaticRoundNotifications,
  sendDueNotificationsCommand,
} from "@/features/tournament/application/notifications";
import { createFirestoreRoundRepository } from "@/features/tournament/infrastructure/roundRepository";
import { createFirestoreEntityRepository } from "@/features/tournament/infrastructure/entityRepository";
import { createFirestoreDrawRepository } from "@/features/tournament/infrastructure/drawRepository";
import { createFirestoreBreakRepository } from "@/features/tournament/infrastructure/breakRepository";
import { createFirestoreTournamentRepository } from "@/features/tournament/infrastructure/tournamentRepository";
import { createFirestoreAuditRepository } from "@/features/tournament/infrastructure/auditRepository";
import { createFirestoreLivePort } from "@/features/tournament/infrastructure/liveRepository";
import { createLiveSession, type LiveSession, type LiveSessionHost } from "@/features/tournament/application/liveSession";
import {
  applyLiveSnapshot,
  findConfirmationConflicts,
  LIVE_SYNC_OFF,
  mergeDivergedRecords,
  planLiveWrites,
  withBaselineEntries,
  type LiveCollectionName,
  type LiveSyncStatus,
} from "@/features/tournament/application/liveSync";
import { runComputeJob } from "@/features/tournament/compute/computeClient";
import type { ComputeKind, ComputeRequest, ComputeResults } from "@/features/tournament/compute/computeJobs";
import { summarizeDivergedRecord, type DivergedRecordSummary } from "@/features/tournament/application/syncConflicts";
import {
  isViewerTournamentAdmin,
  sanitizeAssistantAdjudicator,
  sanitizeAssistantTeam,
} from "@/lib/tournamentAccess";

export interface TournamentContextType {
  tournament: Tournament | null;
  loading: boolean;
  cloudLoadError: string;
  rounds: Round[];
  activeRound: Round | null;
  setActiveRound: (round: Round | null) => void;
  teams: Team[];
  adjudicators: Adjudicator[];
  venues: Venue[];
  motions: Motion[];
  breakCategories: BreakCategory[];
  debates: Debate[];
  ballots: BallotSubmission[];
  feedback: FeedbackSubmission[];
  auditEvents: AuditEvent[];
  institutions: Institution[];
  /** Receipts of paper ballot sheets (ballot intake). */
  ballotIntake: BallotIntakeRecord[];
  teamStandings: TeamStandingRow[];
  speakerStandings: SpeakerStandingRow[];
  replyStandings: SpeakerStandingRow[];
  breakResults: BreakCategoryResult[];
  isOwnerOrAdmin: boolean;
    isDataEntryAssistant: boolean;
  /** Data-entry staff: effective permissions from the server (lib/staffPermissions.ts); empty for administrators. */
  staffPermissions: string[];
  staffAccessLoading: boolean;
  staffAccessError: string;
  cloudSyncState: "idle" | "syncing" | "success" | "error";
  cloudSyncMessage: string;
  privateSyncState: "idle" | "syncing" | "error";
  privateSyncMessage: string;
  localSaveError: string;
  /** Shared views: earlier rounds' public debates and ballots are still loading. */
  publicRoundsLoading: boolean;
  /** Shared views: publish-time tabs and aggregates from the public projection (null until loaded / without a cloud copy). */
  publicExtras: PublicProjectionExtras | null;
  /** A draw or auto-allocation running in the background, if any. */
  computeJob: { kind: ComputeKind; startedAt: number } | null;
  /** Stops the running draw or allocation; it then fails with ComputeCancelledError and saves nothing. */
  cancelCompute: () => void;
  /** Uploads this device's records, then publishes public pages unless the upload left conflicts. */
  uploadToCloud: () => Promise<UploadOutcome>;
  /**
   * Rebuilds the cached public view from the cloud copy; `force` skips the unchanged check.
   * Refuses while the last upload left conflicts or stopped part-way, and while this device has
   * changes the cloud lacks unless `publishWithPendingChanges` acknowledges them.
   */
  publishPublicView: (force?: boolean, options?: { publishWithPendingChanges?: boolean }) => Promise<void>;
  /** Records changed on this device since they were last uploaded or downloaded. */
  pendingChanges: PendingChanges;
  /** Set when the last upload left records unsynced (conflicts) or stopped part-way. */
  uploadIssue: UploadIssue | null;
  /**
   * Live collaboration for ballots, check-ins (teams, adjudicators) and debates (draw and
   * allocation): "off" for local-only tournaments, shared views, assistants, or when paused here.
   */
  liveSync: LiveSyncStatus;
  /** Whether this device uses live collaboration when it can (a per-device setting). */
  liveSyncEnabled: boolean;
  setLiveSyncEnabled: (enabled: boolean) => void;
  /** Debates with more than one confirmed ballot (two devices confirmed different versions). */
  ballotConfirmationConflicts: Array<{ debateId: string; ballotIds: string[] }>;
  downloadFromCloud: () => Promise<void>;
  syncDataEntry: () => Promise<void>;
  exportSyncRecovery: () => Promise<void>;
  /** Records changed both on this device and in the cloud since they were last synced. */
  divergedRecords: DivergedRecord[];
  /** `divergedRecords` described for choosing a version: name and the fields that differ. */
  divergedRecordSummaries: DivergedRecordSummary[];
  /** Keeps the cloud or this device's version of the diverged records with these keys (default: all). */
  resolveDivergedRecords: (keep: "cloud" | "local", keys?: string[]) => void;
  /** `fileSuffix` names the download, e.g. "pre-restore". */
  exportTournamentBackup: (fileSuffix?: string) => void;
  exportTournamentArchive: () => void;
  /** Merges a backup: records missing here are added; existing records win. */
  importTournamentBackup: (file: File) => Promise<void>;
  /** Validates a backup file and compares it with this tournament's data, without changing anything. */
  previewTournamentBackup: (file: File) => Promise<{ validation: BackupValidation; diff?: BackupDiff }>;
  /** Replaces this tournament's data with a backup after downloading a pre-restore backup. */
  replaceTournamentWithBackup: (file: File) => Promise<void>;
  syncPrivatePortal: (
    privateUrlKey: string,
    passcode: string,
    options?: { checkIn?: SelfCheckInRequest }
  ) => Promise<void>;
  /** The private portal participant's check-in status for the current round, from the last sync. */
  privateSelfCheckIn: SelfCheckInStatus | null;
  loadPrivateTeamPortal: (privateUrlKey: string, passcode: string) => Promise<void>;

  // Mutations
  saveTournament: (t: Tournament) => Promise<void>;
  createRound: (
    name: string,
    abbr: string,
    stage: "preliminary" | "elimination",
    customDrawType?: "random" | "power_paired" | "round_robin" | "elimination" | "manual"
  ) => Promise<Round>;
  setPreliminaryRoundCount: (count: number) => Promise<void>;
  deleteRound: (roundId: string) => Promise<void>;
  updateRound: (round: Round) => Promise<void>;
  /** Throws DrawHasResultsError when the round has ballots, unless discardExistingResults is set. */
  generateDraw: (roundId: string, options?: { discardExistingResults?: boolean }) => Promise<void>;
  autoAllocate: (roundId: string, panelSize?: number, settings?: AutoAllocateSettings) => Promise<void>;
  updateDebate: (debate: Debate) => Promise<void>;
  updateDebates: (debates: Debate[]) => Promise<void>;
  submitBallot: (ballot: BallotSubmission, privatePasscode?: string) => Promise<void>;
  confirmBallot: (ballotId: string, debateId: string, submittedBallot?: BallotSubmission) => Promise<void>;
  discardBallot: (ballotId: string) => Promise<void>;
  addInstitution: (inst: Omit<Institution, "id" | "tournamentId">) => Promise<void>;
  /** Resolves to the created institutions. */
  addInstitutions: (institutions: Omit<Institution, "id" | "tournamentId">[]) => Promise<Institution[]>;
  /** Creates and updates institutions, teams and adjudicators in one write per collection (previewed imports). */
  saveEntityBatch: (batch: EntityBatch, source: string) => Promise<void>;
  updateInstitution: (inst: Institution) => Promise<void>;
  deleteInstitution: (instId: string) => Promise<void>;
  addTeam: (team: Omit<Team, "id" | "tournamentId">) => Promise<void>;
  /** Resolves to the created teams (with ids and private URL keys). */
  addTeams: (teams: Omit<Team, "id" | "tournamentId">[]) => Promise<Team[]>;
  updateTeam: (team: Team, privatePasscode?: string) => Promise<void>;
  deleteTeam: (teamId: string) => Promise<void>;
  addAdjudicator: (adj: Omit<Adjudicator, "id" | "tournamentId">) => Promise<void>;
  /** Resolves to the created adjudicators (with ids and private URL keys). */
  addAdjudicators: (adjudicators: Omit<Adjudicator, "id" | "tournamentId">[]) => Promise<Adjudicator[]>;
  updateAdjudicator: (adj: Adjudicator, privatePasscode?: string) => Promise<void>;
  updateAdjudicators: (adjudicators: Adjudicator[]) => Promise<void>;
  /** Sets base/test scores and records the change (with the reason) in the score history. */
  updateAdjudicatorScores: (
    adjudicatorId: string,
    scores: { baseScore: number; testScore?: number },
    reason?: string
  ) => Promise<void>;
  deleteAdjudicator: (adjId: string) => Promise<void>;
  addVenue: (venue: Omit<Venue, "id" | "tournamentId">) => Promise<void>;
  addVenues: (venues: Omit<Venue, "id" | "tournamentId">[]) => Promise<void>;
  updateVenue: (venue: Venue) => Promise<void>;
  deleteVenue: (venueId: string) => Promise<void>;
  addMotion: (motion: Omit<Motion, "id" | "tournamentId">) => Promise<void>;
  addMotions: (motions: Omit<Motion, "id" | "tournamentId">[]) => Promise<void>;
  updateMotion: (motion: Motion) => Promise<void>;
  deleteMotion: (motionId: string) => Promise<void>;
  saveBreakCategories: (categories: BreakCategory[]) => Promise<void>;
  generateBreak: (categoryId: string) => Promise<Round | null>;
  proceedToNextEliminationRound: (roundId: string) => Promise<Round | null>;
  addFeedback: (
    fb: Omit<FeedbackSubmission, "id" | "tournamentId" | "timestamp">,
    privatePasscode?: string,
    privateUrlKey?: string
  ) => Promise<void>;
  reviewFeedback: (feedbackId: string, change: FeedbackReviewChange) => Promise<void>;
  /** Rehearsal tools: random valid confirmed ballots for a round's unresulted debates (seeded). */
  simulateRoundResults: (roundId: string, seed: number) => Promise<RehearsalOutcome>;
  /** Rehearsal tools: random valid feedback along the feedback paths for a round (seeded). */
  simulateRoundFeedback: (roundId: string, seed: number) => Promise<RehearsalOutcome>;
  /** Records that a paper ballot sheet arrived; returns false when it was already recorded. */
  recordBallotIntake: (sheet: BallotSheet) => Promise<boolean>;
  recordAuditEvent: (event: {
    action: string;
    category: AuditCategory;
    summary: string;
    roundId?: string;
    debateId?: string;
    details?: Record<string, unknown>;
  }) => Promise<void>;
  releaseAuditLog: () => Promise<{ releasedAt: string; eventCount: number }>;
  generatePrivateUrlKeys: (forceRegenerate?: boolean) => Promise<void>;
}
export interface RehearsalOutcome {
  created: number;
  skipped: SkippedDebate[];
}
export interface UploadOutcome {
  /** Records archived as sync conflicts instead of being written. */
  conflicts: number;
  publish: "published" | "unchanged" | "refused" | "failed";
  /** Why public pages were not updated, when `publish` is "refused" or "failed". */
  publishError?: string;
}

const toCloudRecords = (records: Array<{ id: string }>): CloudRecord[] => records as unknown as CloudRecord[];

const TournamentContext = createContext<TournamentContextType | undefined>(undefined);

const AUTOMATIC_CLOUD_WRITES = false;

const LIVE_FLUSH_TIMEOUT_MILLISECONDS = 20_000;

/** A network failure (no connection), as opposed to a refusal by the server. */
function isLikelyOffline(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (error instanceof TypeError) return true;
  return (error as { code?: unknown } | null)?.code === "unavailable";
}

export function TournamentProvider({
  tournamentSlug,
  children,
}: {
  tournamentSlug: string;
  children: React.ReactNode;
}) {
  const { user, isGlobalAdmin, loading: authLoading } = useAuth();
  const pathname = usePathname();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);
  const [cloudLoadError, setCloudLoadError] = useState("");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [activeRound, setActiveRound] = useState<Round | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [adjudicators, setAdjudicators] = useState<Adjudicator[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [motions, setMotions] = useState<Motion[]>([]);
  const [breakCategories, setBreakCategories] = useState<BreakCategory[]>([]);
  const [debates, setDebates] = useState<Debate[]>([]);
  const [ballots, setBallots] = useState<BallotSubmission[]>([]);
  const [feedback, setFeedback] = useState<FeedbackSubmission[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const auditEventsRef = useRef<AuditEvent[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [ballotIntake, setBallotIntake] = useState<BallotIntakeRecord[]>([]);
  // Mirrors ballotIntake; recordBallotIntake also updates it at once, so back-to-back scans each
  // see the previous one before a re-render.
  const ballotIntakeRef = useRef<BallotIntakeRecord[]>([]);
  useEffect(() => {
    ballotIntakeRef.current = ballotIntake;
  }, [ballotIntake]);
  const [cloudSyncState, setCloudSyncState] = useState<"idle" | "syncing" | "success" | "error">("idle");
  const [cloudSyncMessage, setCloudSyncMessage] = useState("");
  const [privateSyncState, setPrivateSyncState] = useState<"idle" | "syncing" | "error">("idle");
  const [privateSyncMessage, setPrivateSyncMessage] = useState("");
  const [localSaveError, setLocalSaveError] = useState("");
  const [cloudStaffRole, setCloudStaffRole] = useState<"admin" | "dataEntry" | "none" | null>(null);
  const [staffPermissions, setStaffPermissions] = useState<string[]>([]);
  const [liveAdminVerified, setLiveAdminVerified] = useState(false);
  const [staffAccessError, setStaffAccessError] = useState("");
  const [privateSelfCheckIn, setPrivateSelfCheckIn] = useState<SelfCheckInStatus | null>(null);
  const [divergedRecords, setDivergedRecords] = useState<DivergedRecord[]>([]);
  const [uploadIssue, setUploadIssue] = useState<UploadIssue | null>(null);
  // The sync baseline and queues as stored on this device, mirrored so `pendingChanges` updates.
  const [storedSyncState, setStoredSyncState] = useState<{
    baseline: SyncBaseline;
    deletions: CloudDeletionMap;
    overwrites: CloudOverwriteMap;
  }>({ baseline: {}, deletions: {}, overwrites: {} });

  const storagePrefix = `crabbytab_t_${tournamentSlug}`;
  const privateQueueKey = `${storagePrefix}_privateSyncQueue`;
  type PrivateSyncItem =
    | { collection: "ballots"; record: BallotSubmission }
    | { collection: "feedback"; record: FeedbackSubmission };

  // Helper to persist state to local storage
  const persistLocal = useCallback(
    (key: string, data: any) => {
      if (typeof window === "undefined") return;
      try {
        // In memory now, on disk (IndexedDB) a moment later; disk failures arrive via onWriteError below.
        getLocalStore().setItem(`${storagePrefix}_${key}`, JSON.stringify(data));
      } catch (e) {
        const message = e instanceof Error ? e.message : "Local storage is unavailable.";
        setLocalSaveError(`Could not save ${key} locally: ${message}`);
        console.error(`Local storage save failed for ${key}:`, e);
      }
    },
    [storagePrefix]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const keyPrefix = `${storagePrefix}_`;
    return getLocalStore().onWriteError((keys, error) => {
      const names = keys.filter((key) => key.startsWith(keyPrefix)).map((key) => key.slice(keyPrefix.length));
      if (names.length === 0) return;
      const message = error instanceof Error ? error.message : "Device storage is unavailable.";
      setLocalSaveError(`Could not save ${names.join(", ")} locally: ${message}`);
      console.error("Local save failed:", error);
    });
  }, [storagePrefix]);

  const refreshStoredSyncState = () => {
    if (typeof window === "undefined") return;
    const readStored = (key: string) => safeJsonParse<unknown>(getLocalStore().getItem(`${storagePrefix}_${key}`), null);
    setStoredSyncState({
      baseline: parseSyncBaseline(readStored("syncBaseline")),
      deletions: parseCloudIdMap(readStored("syncTombstones")),
      overwrites: parseCloudIdMap(readStored("syncOverwrites")),
    });
  };

  // Per-device sync queues kept in the working copy: ids to delete from the cloud ("syncTombstones")
  // and ids restored from a backup that must overwrite the cloud copy ("syncOverwrites").
  type SyncIdQueue = "syncTombstones" | "syncOverwrites";

  const readSyncIds = (queue: SyncIdQueue): CloudDeletionMap => {
    if (typeof window === "undefined") return {};
    const raw = getLocalStore().getItem(`${storagePrefix}_${queue}`);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Local sync data is invalid. Export a backup before continuing.");
    }
    const ids: CloudDeletionMap = {};
    for (const [collectionName, values] of Object.entries(parsed)) {
      if (
        !CLOUD_COLLECTIONS.includes(collectionName as (typeof CLOUD_COLLECTIONS)[number]) ||
        !Array.isArray(values) ||
        !values.every((id) => typeof id === "string")
      ) {
        throw new Error("Local sync data is invalid. Export a backup before continuing.");
      }
      ids[collectionName as (typeof CLOUD_COLLECTIONS)[number]] = values;
    }
    return ids;
  };

  const recordSyncIds = (queue: SyncIdQueue, additions: CloudDeletionMap) => {
    const current = readSyncIds(queue);
    for (const [collectionName, ids] of Object.entries(additions)) {
      if (!ids?.length) continue;
      current[collectionName as (typeof CLOUD_COLLECTIONS)[number]] = [
        ...new Set([...(current[collectionName as (typeof CLOUD_COLLECTIONS)[number]] || []), ...ids]),
      ];
    }
    persistLocal(queue, current);
    refreshStoredSyncState();
  };

  const clearSyncIds = (queue: SyncIdQueue, uploaded: CloudDeletionMap) => {
    const remaining = readSyncIds(queue);
    for (const [collectionName, ids] of Object.entries(uploaded)) {
      const uploadedIds = new Set(ids || []);
      remaining[collectionName as (typeof CLOUD_COLLECTIONS)[number]] =
        (remaining[collectionName as (typeof CLOUD_COLLECTIONS)[number]] || [])
          .filter((id) => !uploadedIds.has(id));
    }
    persistLocal(
      queue,
      Object.fromEntries(
        Object.entries(remaining).filter(([, ids]) => ids && ids.length > 0)
      )
    );
    refreshStoredSyncState();
  };

  // Each record as this device last uploaded or downloaded it ("syncBaseline"), and the records
  // changed both here and in the cloud since then ("syncDiverged"), kept until the organiser
  // chooses a version. See mergeCloudIntoWorkingCopy.
  const readSyncBaseline = (): SyncBaseline =>
    typeof window === "undefined"
      ? {}
      : parseSyncBaseline(safeJsonParse<unknown>(getLocalStore().getItem(`${storagePrefix}_syncBaseline`), {}));

  const saveSyncState = (baseline: SyncBaseline, diverged?: DivergedRecord[]) => {
    persistLocal("syncBaseline", baseline);
    refreshStoredSyncState();
    if (diverged) {
      persistLocal("syncDiverged", diverged);
      setDivergedRecords(diverged);
    }
  };

  const saveUploadIssue = (issue: UploadIssue | null) => {
    persistLocal("syncUploadIssue", issue);
    setUploadIssue(issue);
  };

  const readSyncTombstones = () => readSyncIds("syncTombstones");
  // Records already soft-deleted in the cloud by a live write need no tombstone for upload.
  const liveDeletedRef = useRef(new Set<string>());
  const recordSyncTombstones = (deletions: CloudDeletionMap) => recordSyncIds(
    "syncTombstones",
    Object.fromEntries(
      Object.entries(deletions).map(([name, ids]) => [
        name,
        (ids || []).filter((id) => !liveDeletedRef.current.has(`${name}/${id}`)),
      ])
    ) as CloudDeletionMap
  );
  const clearSyncedTombstones = (uploaded: CloudDeletionMap) => clearSyncIds("syncTombstones", uploaded);

  // Live collaboration (docs/live-collaboration.md). While a live session runs, ballots, debates,
  // teams and adjudicators are written to Firestore record by record as commands save them, and
  // listeners bring other devices' changes in. `liveRecordsRef` then holds this device's current
  // copy of those collections (updated synchronously by every live save and listener event, so a
  // command never builds on a copy older than a change already received); without a session it
  // follows React state.
  const [liveSync, setLiveSync] = useState<LiveSyncStatus>(LIVE_SYNC_OFF);
  const [liveSyncEnabled, setLiveSyncEnabledState] = useState(true);
  const [liveResyncCount, setLiveResyncCount] = useState(0);
  const liveSessionRef = useRef<LiveSession | null>(null);
  const liveRecordsRef = useRef<Record<LiveCollectionName, CloudRecord[]>>({
    ballots: [],
    debates: [],
    teams: [],
    adjudicators: [],
  });
  if (!liveSessionRef.current) {
    liveRecordsRef.current = {
      ballots: toCloudRecords(ballots),
      debates: toCloudRecords(debates),
      teams: toCloudRecords(teams),
      adjudicators: toCloudRecords(adjudicators),
    };
  }
  const liveStorageKeys: Record<LiveCollectionName, string> = {
    ballots: "ballots",
    debates: "debates",
    teams: "teams",
    adjudicators: "adjudicators",
  };
  const setLiveCollectionState = (name: LiveCollectionName, records: CloudRecord[]) => {
    liveRecordsRef.current = { ...liveRecordsRef.current, [name]: records };
    if (name === "ballots") setBallots(records as unknown as BallotSubmission[]);
    else if (name === "debates") setDebates(records as unknown as Debate[]);
    else if (name === "teams") setTeams(records as unknown as Team[]);
    else setAdjudicators(records as unknown as Adjudicator[]);
    persistLocal(liveStorageKeys[name], records);
  };

  /**
   * Saves a command's result for a live collection. `base` is the state the command started from:
   * with a live session, only what the command changed is applied on top of the current copy and
   * written to the cloud (see planLiveWrites); otherwise the result is saved as is.
   */
  const saveLiveRecords = <T extends { id: string }>(name: LiveCollectionName, base: T[], next: T[]) => {
    const session = liveSessionRef.current;
    if (!session) {
      setLiveCollectionState(name, toCloudRecords(next));
      return;
    }
    const baseline = readSyncBaseline();
    const plan = planLiveWrites({
      collection: name,
      base: toCloudRecords(base),
      next: toCloudRecords(next),
      latest: liveRecordsRef.current[name],
      baseline: baseline[name] || {},
      now: new Date().toISOString(),
    });
    setLiveCollectionState(name, plan.records);
    if (plan.writes.length === 0) return;
    saveSyncState(withBaselineEntries(baseline, name, plan.baseline));
    if (plan.deletedIds.length > 0) {
      for (const id of plan.deletedIds) liveDeletedRef.current.add(`${name}/${id}`);
      clearSyncIds("syncTombstones", { [name]: plan.deletedIds });
    }
    session.write(plan.writes);
  };

  /**
   * Stops the live session before replacing whole collections (download, upload results, backup
   * restore, conflict choices); `resumeLive` restarts it from the new state, and the listeners'
   * first events re-apply every cloud record on top of it.
   */
  const suspendLive = () => {
    liveSessionRef.current?.dispose();
    liveSessionRef.current = null;
  };
  const resumeLive = () => setLiveResyncCount((count) => count + 1);
  /**
   * Waits until the cloud has every live write made on this device, so an upload or publish
   * reads them. Refuses after a while instead of hanging when the connection is gone.
   */
  const flushLiveWrites = async () => {
    const session = liveSessionRef.current;
    if (!session) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        session.flush(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Live changes from this device are still being sent to the cloud. Check the connection and try again.")),
            LIVE_FLUSH_TIMEOUT_MILLISECONDS
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const liveHost: LiveSessionHost = {
    applySnapshot(name, snapshot) {
      const baseline = readSyncBaseline();
      const stored = (key: string) => safeJsonParse<unknown>(getLocalStore().getItem(`${storagePrefix}_${key}`), null);
      const result = applyLiveSnapshot({
        collection: name,
        local: liveRecordsRef.current[name],
        baseline: baseline[name] || {},
        changes: snapshot.changes,
        deletions: parseCloudIdMap(stored("syncTombstones"))[name],
        overwrites: parseCloudIdMap(stored("syncOverwrites"))[name],
      });
      if (result.changed) setLiveCollectionState(name, result.records);
      const nextBaseline = withBaselineEntries(baseline, name, result.baseline);
      const diverged = result.diverged.length > 0
        ? mergeDivergedRecords(parseDivergedRecords(stored("syncDiverged")), result.diverged)
        : undefined;
      if (nextBaseline !== baseline || diverged) saveSyncState(nextBaseline, diverged);
    },
    onWritesRejected(writes, error) {
      // Without a baseline entry the records count as changes not uploaded (and are compared with
      // the cloud version as diverged records), so nothing refused is silently lost.
      let baseline = readSyncBaseline();
      const deletions: CloudDeletionMap = {};
      for (const write of writes) {
        baseline = withBaselineEntries(baseline, write.collection, { [write.id]: null });
        if (write.kind === "patch" && write.fields.some((field) => field.path[0] === "deletedAt")) {
          // The soft-delete did not reach the cloud: queue it for the next upload instead.
          liveDeletedRef.current.delete(`${write.collection}/${write.id}`);
          deletions[write.collection] = [...(deletions[write.collection] || []), write.id];
        }
      }
      saveSyncState(baseline);
      if (Object.keys(deletions).length > 0) recordSyncIds("syncTombstones", deletions);
      console.error("Live changes were refused by the cloud:", error);
    },
    onStatus: setLiveSync,
  };
  const liveHostRef = useRef(liveHost);
  liveHostRef.current = liveHost;

  const saveRoundsLocally = useCallback(
    (updatedRounds: Round[], nextActiveRound?: Round) => {
      setRounds(updatedRounds);
      if (nextActiveRound) setActiveRound(nextActiveRound);
      persistLocal("rounds", updatedRounds);
    },
    [persistLocal]
  );

  const publicVersionRef = useRef<string | null>(null);
  // Shared views load the public projection by round: each round's content hash, and the hash of
  // each round whose debates and ballots are in state.
  const publicRoundsRef = useRef<{ hashes: Record<string, string>; loaded: Map<string, string> }>({
    hashes: {},
    loaded: new Map(),
  });
  const [publicViewVersion, setPublicViewVersion] = useState<string | null>(null);
  const [publicRoundsLoading, setPublicRoundsLoading] = useState(false);
  const [publicExtras, setPublicExtras] = useState<PublicProjectionExtras | null>(null);
  const applyPublicProjection = useCallback(
    (result: PublicProjectionResponse, preserveActiveRound: boolean) => {
      const publicRounds = (result.collections.rounds || []) as Round[];
      const latestRound =
        [...publicRounds].filter((round) => !round.cancelled).sort((a, b) => b.seq - a.seq)[0] || null;
      publicVersionRef.current = result.version ?? null;
      const hashes = result.roundSections;
      // Rounds loaded earlier whose content is unchanged stay as they are; the rest reload.
      const kept = new Set<string>();
      if (hashes) {
        const fresh = new Set(result.loadedRoundIds || []);
        const loaded = new Map<string, string>();
        for (const [roundId, hash] of publicRoundsRef.current.loaded) {
          if (hashes[roundId] === hash && !fresh.has(roundId)) {
            kept.add(roundId);
            loaded.set(roundId, hash);
          }
        }
        for (const roundId of fresh) loaded.set(roundId, hashes[roundId]);
        publicRoundsRef.current = { hashes, loaded };
      } else {
        publicRoundsRef.current = { hashes: {}, loaded: new Map() };
      }
      const withKeptRounds = <T extends { roundId: string }>(current: T[], incoming: T[]) => [
        ...current.filter((record) => kept.has(record.roundId)),
        ...incoming,
      ];
      setTournament(result.tournament);
      setRounds(publicRounds);
      setActiveRound((current) =>
        preserveActiveRound && current
          ? publicRounds.find((round) => round.id === current.id) || latestRound
          : latestRound
      );
      setTeams((result.collections.teams || []) as Team[]);
      setAdjudicators((result.collections.adjudicators || []) as Adjudicator[]);
      setVenues((result.collections.venues || []) as Venue[]);
      setMotions((result.collections.motions || []) as Motion[]);
      setBreakCategories((result.collections.breakCategories || []) as BreakCategory[]);
      setDebates((current) => withKeptRounds(current, (result.collections.debates || []) as Debate[]));
      setBallots((current) => withKeptRounds(current, (result.collections.ballots || []) as BallotSubmission[]));
      setFeedback((result.collections.feedback || []) as FeedbackSubmission[]);
      setInstitutions((result.collections.institutions || []) as Institution[]);
      setBallotIntake([]);
      auditEventsRef.current = [];
      setAuditEvents([]);
      setPublicExtras({ tabs: result.tabs ?? undefined, derived: result.derived ?? {} });
      setPublicViewVersion(result.version ?? null);
    },
    []
  );

  // Public and projector pages poll a tiny cached version marker and refetch the (CDN-cached)
  // projection only when something was published. Private portals are excluded because they merge
  // participant-specific data into state.
  const isPollingPublicView =
    Boolean(db) &&
    !pathname?.includes("/private/") &&
    Boolean(pathname?.includes("/public") || pathname?.includes("/display"));
  useEffect(() => {
    if (!isPollingPublicView || !tournamentSlug) return;
    let cancelled = false;
    const refresh = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const version = await fetchPublicViewVersion(tournamentSlug);
        if (cancelled || !version || version === publicVersionRef.current) return;
        const result = await fetchPublicProjection(tournamentSlug);
        if (!cancelled) applyPublicProjection(result, true);
      } catch (error) {
        // Keep showing the last good data; the next poll retries.
        console.warn("Could not refresh public tournament data:", error);
      }
    };
    const timer = window.setInterval(() => void refresh(), PUBLIC_VIEW_POLL_MILLISECONDS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isPollingPublicView, tournamentSlug, applyPublicProjection]);

  // Only the shared-view flag depends on the route. Keying the load effect on it (not on
  // `pathname`) stops every in-tournament navigation from re-reading the cloud copy.
  const isSharedView = Boolean(
    pathname?.includes("/public") ||
    pathname?.includes("/private/") ||
    pathname?.includes("/display")
  );
  const isPrivatePortal = Boolean(pathname?.includes("/private/"));
  const isProjectorView = Boolean(pathname?.includes("/display"));

  // Public pages open with the latest round and load the others' debates and ballots after it
  // (standings and results need them); the projector loads a round when it is shown. Private
  // portals load every round up front instead, before merging their own data.
  const activeRoundId = activeRound?.id;
  useEffect(() => {
    if (!db || !isSharedView || isPrivatePortal || !tournamentSlug || !publicViewVersion) return;
    const { hashes, loaded } = publicRoundsRef.current;
    const missing = publicRoundsToLoad(
      hashes,
      loaded,
      isProjectorView ? (activeRoundId ? [activeRoundId] : []) : undefined
    );
    if (missing.length === 0) return;
    let cancelled = false;
    setPublicRoundsLoading(true);
    void (async () => {
      try {
        for (let index = 0; index < missing.length; index += 3) {
          const batch = await Promise.all(
            missing.slice(index, index + 3).map((roundId) => fetchPublicRound(tournamentSlug, roundId, hashes[roundId]))
          );
          if (cancelled) return;
          // A round republished meanwhile is skipped; the next version poll reloads it.
          const current = batch.filter((round) => publicRoundsRef.current.hashes[round.roundId] === round.hash);
          for (const round of current) publicRoundsRef.current.loaded.set(round.roundId, round.hash);
          setDebates((records) => replaceRoundRecords(records, current.map((round) => ({ roundId: round.roundId, records: round.debates }))));
          setBallots((records) => replaceRoundRecords(records, current.map((round) => ({ roundId: round.roundId, records: round.ballots }))));
        }
      } catch (error) {
        // The rounds already shown stay; the next published version retries.
        console.warn("Could not load earlier public rounds:", error);
      } finally {
        if (!cancelled) setPublicRoundsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      setPublicRoundsLoading(false);
    };
  }, [isSharedView, isPrivatePortal, isProjectorView, tournamentSlug, publicViewVersion, activeRoundId]);

  const pendingChanges = useMemo((): PendingChanges => {
    if (isSharedView || !tournament) return NO_PENDING_CHANGES;
    return computePendingChanges({
      tournament,
      collections: {
        rounds: toCloudRecords(rounds),
        teams: toCloudRecords(teams),
        adjudicators: toCloudRecords(adjudicators),
        venues: toCloudRecords(venues),
        motions: toCloudRecords(motions),
        breakCategories: toCloudRecords(breakCategories),
        debates: toCloudRecords(debates),
        ballots: toCloudRecords(ballots),
        feedback: toCloudRecords(feedback),
        institutions: toCloudRecords(institutions),
        auditEvents: toCloudRecords(auditEvents),
        ballotIntake: toCloudRecords(ballotIntake),
      },
      ...storedSyncState,
    });
  }, [
    isSharedView, tournament, storedSyncState, rounds, teams, adjudicators, venues, motions,
    breakCategories, debates, ballots, feedback, institutions, auditEvents, ballotIntake,
  ]);

  // Local storage is the working copy. Shared links fall back to the published cloud copy.
  useEffect(() => {
    let isMounted = true;
    async function loadLocalData() {
      setLoading(true);
      setCloudLoadError("");
      auditEventsRef.current = [];
      setAuditEvents([]);
      if (authLoading) return () => { isMounted = false; };
      if (!user && !isSharedView) {
        setTournament(null);
        setRounds([]);
        setActiveRound(null);
        setTeams([]);
        setAdjudicators([]);
        setVenues([]);
        setMotions([]);
        setBreakCategories([]);
        setDebates([]);
        setBallots([]);
        setFeedback([]);
        setInstitutions([]);
        setBallotIntake([]);
        setLoading(false);
        return () => { isMounted = false; };
      }
      try {
        if (typeof window === "undefined" || !isMounted) return;
        const localStore = getLocalStore();
        await localStore.loadPrefix(`${storagePrefix}_`);
        if (!isMounted) return;
        const readLocal = <T,>(key: string, fallback: T): T =>
          safeJsonParse<T>(localStore.getItem(`${storagePrefix}_${key}`), fallback);
        let localTournament = readLocal<Tournament | null>("meta", null);
        setDivergedRecords(parseDivergedRecords(readLocal<unknown>("syncDiverged", [])));
        setUploadIssue(parseUploadIssue(readLocal<unknown>("syncUploadIssue", null)));
        refreshStoredSyncState();
        const loadPublicProjection = async () => {
          const result = isPrivatePortal
            ? await fetchCompletePublicProjection(tournamentSlug)
            : await fetchPublicProjection(tournamentSlug);
          if (!isMounted) return;
          applyPublicProjection(result, false);
          setLoading(false);
        };

        const loadAssistantProjection = async (tournamentId: string) => {
          if (!user) throw new Error("Sign in to load assistant tournament data.");
          const token = await user.getIdToken();
          const response = await fetch(
            `/api/tournaments/${encodeURIComponent(tournamentId)}/assistant-data`,
            { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
          );
          const result = await response.json() as {
            error?: string;
            tournament: Tournament;
            collections: Record<string, CloudRecord[]>;
          };
          if (!response.ok) throw new Error(result.error || "Could not load assistant tournament data.");

          const localKeys: Record<(typeof CLOUD_COLLECTIONS)[number], string> = {
            rounds: "rounds",
            teams: "teams",
            adjudicators: "adjudicators",
            venues: "venues",
            motions: "motions",
            breakCategories: "breaks",
            debates: "debates",
            ballots: "ballots",
            feedback: "feedback",
            institutions: "institutions",
            auditEvents: "auditEvents",
            ballotIntake: "ballotIntake",
          };
          // Sanitised before merging, so the baseline describes records exactly as stored here.
          const cloudCollections = Object.fromEntries(
            CLOUD_COLLECTIONS.map((name) => [name, result.collections[name] || []])
          ) as Record<(typeof CLOUD_COLLECTIONS)[number], CloudRecord[]>;
          cloudCollections.teams = cloudCollections.teams.map((record) => {
            return sanitizeAssistantTeam(record as unknown as Team) as unknown as CloudRecord;
          });
          cloudCollections.adjudicators = cloudCollections.adjudicators.map((record) => {
            return sanitizeAssistantAdjudicator(record as unknown as Adjudicator) as unknown as CloudRecord;
          });
          cloudCollections.auditEvents = [];
          // The same baseline merge as an administrator's device. The projection leaves deleted
          // and hidden records out, so local copies of those are dropped unless edited here.
          const hasLocalCopy = localTournament?.id === tournamentId;
          const merge = mergeCloudIntoWorkingCopy({
            cloudCollections,
            localCollections: hasLocalCopy
              ? Object.fromEntries(CLOUD_COLLECTIONS.map((name) => [
                  name,
                  name === "auditEvents" ? [] : readLocal<CloudRecord[]>(localKeys[name], []),
                ])) as Record<(typeof CLOUD_COLLECTIONS)[number], CloudRecord[]>
              : null,
            baseline: hasLocalCopy ? readSyncBaseline() : {},
            cloudOmitsDeleted: true,
          });
          return { tournament: result.tournament, merge };
        };

        if (db) {
          try {
            if (isSharedView) {
              await loadPublicProjection();
              return;
            }
            const repository = createFirestoreTournamentRepository();
            const cloudTournamentDoc =
              (await repository.findTournamentBySlug(tournamentSlug)) ||
              (await repository.getTournament(`tourn-${tournamentSlug}`));
            if (!isMounted) return;

            if (cloudTournamentDoc) {
              const data = cloudTournamentDoc.data;
              let isAssistant = false;
              if (user) {
                const token = await user.getIdToken();
                const accessResponse = await fetch(
                  `/api/tournaments/${encodeURIComponent(cloudTournamentDoc.id)}/access`,
                  { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
                );
                if (accessResponse.ok) {
                  const access = await accessResponse.json() as { role?: string | null };
                  isAssistant = access.role === "dataEntry";
                }
              }
              const localCollectionNames: Record<(typeof CLOUD_COLLECTIONS)[number], string> = {
                rounds: "rounds",
                teams: "teams",
                adjudicators: "adjudicators",
                venues: "venues",
                motions: "motions",
                breakCategories: "breaks",
                debates: "debates",
                ballots: "ballots",
                feedback: "feedback",
                institutions: "institutions",
                auditEvents: "auditEvents",
                ballotIntake: "ballotIntake",
              };
              let cloudCollections: Record<(typeof CLOUD_COLLECTIONS)[number], CloudRecord[]>;
              let cloudMerge: WorkingCopyMerge;
              if (isAssistant) {
                const projection = await loadAssistantProjection(cloudTournamentDoc.id);
                localTournament = projection.tournament;
                cloudMerge = projection.merge;
                cloudCollections = cloudMerge.collections;
              } else {
                // Uploads are manual, so the local working copy may hold changes the cloud has
                // never seen. Merge instead of replacing: records edited here since their synced
                // baseline are kept (as diverged records if the cloud changed them too), other
                // records take the cloud version, cloud-only records are added, and cloud
                // soft-deletions and pending local deletions are dropped.
                const hasLocalCopy = localTournament?.id === cloudTournamentDoc.id;
                const baseline = hasLocalCopy ? readSyncBaseline() : {};
                const settings = mergeCloudTournament({
                  cloudTournament: {
                    ...data,
                    id: cloudTournamentDoc.id,
                    slug: typeof data.slug === "string" ? data.slug : tournamentSlug,
                  } as Tournament,
                  localTournament: hasLocalCopy ? localTournament : null,
                  base: baseline.tournament,
                });
                localTournament = settings.tournament;
                const recordMerge = mergeCloudIntoWorkingCopy({
                  cloudCollections: await repository.getCollections(cloudTournamentDoc.id),
                  localCollections: hasLocalCopy
                    ? Object.fromEntries(CLOUD_COLLECTIONS.map((name) => [
                        name,
                        readLocal<CloudRecord[]>(localCollectionNames[name], []),
                      ])) as Record<(typeof CLOUD_COLLECTIONS)[number], CloudRecord[]>
                    : null,
                  baseline,
                  deletions: hasLocalCopy ? readSyncTombstones() : {},
                  overwrites: hasLocalCopy ? readSyncIds("syncOverwrites") : {},
                });
                cloudMerge = {
                  collections: recordMerge.collections,
                  baseline: { ...recordMerge.baseline, tournament: settings.baseline },
                  divergedRecords: settings.diverged
                    ? [settings.diverged, ...recordMerge.divergedRecords]
                    : recordMerge.divergedRecords,
                };
                cloudCollections = cloudMerge.collections;
              }
              if (!isMounted) return;

              const storeCloudCollection = <T,>(
                name: (typeof CLOUD_COLLECTIONS)[number],
                setValue: (items: T[]) => void
              ) => {
                const items = cloudCollections[name] as T[];
                setValue(items);
                persistLocal(localCollectionNames[name], items);
              };

              setTournament(localTournament);
              persistLocal("meta", localTournament);
              const loadedRounds = cloudCollections.rounds as Round[];
              const publicRound = isSharedView
                ? [...loadedRounds]
                    .filter(
                      (round) =>
                        !round.cancelled &&
                        (round.drawStatus === "confirmed" ||
                          round.drawStatus === "released" ||
                          round.resultsReleased ||
                          round.adjudicatorsRevealed)
                    )
                    .sort((a, b) => b.seq - a.seq)[0]
                : undefined;
              setRounds(loadedRounds);
              persistLocal("rounds", loadedRounds);
              setActiveRound(
                publicRound || loadedRounds.find((round) => !round.cancelled) || null
              );
              storeCloudCollection<Team>("teams", setTeams);
              storeCloudCollection<Adjudicator>("adjudicators", setAdjudicators);
              storeCloudCollection<Venue>("venues", setVenues);
              storeCloudCollection<Motion>("motions", setMotions);
              storeCloudCollection<BreakCategory>("breakCategories", setBreakCategories);
              storeCloudCollection<Debate>("debates", setDebates);
              storeCloudCollection<BallotSubmission>("ballots", setBallots);
              storeCloudCollection<FeedbackSubmission>("feedback", setFeedback);
              storeCloudCollection<Institution>("institutions", setInstitutions);
              storeCloudCollection<BallotIntakeRecord>("ballotIntake", setBallotIntake);
              storeCloudCollection<AuditEvent>("auditEvents", (events) => {
                auditEventsRef.current = events;
                setAuditEvents(events);
              });
              // After the records: a baseline saved without them would mark the old local
              // versions as edits here.
              saveSyncState(cloudMerge.baseline, cloudMerge.divergedRecords);
              setLoading(false);
              return;
            }
          } catch (error) {
            // Offline, staff open this device's working copy (below) instead of an error; live
            // collaboration then resumes from the cloud SDK's cache and queues writes.
            const offlineWithLocalCopy = !isSharedView && Boolean(localTournament) && isLikelyOffline(error);
            if (user && !isGlobalAdmin && !offlineWithLocalCopy) {
              const message = error instanceof Error ? error.message : "This account is not assigned to this tournament.";
              setCloudLoadError(message);
              setTournament(null);
              setRounds([]);
              setActiveRound(null);
              setTeams([]);
              setAdjudicators([]);
              setVenues([]);
              setMotions([]);
              setBreakCategories([]);
              setDebates([]);
              setBallots([]);
              setFeedback([]);
              setInstitutions([]);
              setBallotIntake([]);
              setLoading(false);
              return;
            }
            const message =
              error instanceof Error ? error.message : "Could not load tournament data from the cloud.";
            console.error("Could not load shared tournament data:", error);
            if (isSharedView) {
              setCloudLoadError(`Could not load this tournament from the cloud: ${message}`);
              setTournament(null);
              setRounds([]);
              setActiveRound(null);
              setTeams([]);
              setAdjudicators([]);
              setVenues([]);
              setMotions([]);
              setBreakCategories([]);
              setDebates([]);
              setBallots([]);
              setFeedback([]);
              setInstitutions([]);
              setBallotIntake([]);
              setLoading(false);
              return;
            }
          }
        }

        if (!localTournament && isSharedView) {
          setCloudLoadError(
            db
              ? "This tournament has no cloud copy yet. Ask the tabroom to upload the latest tournament data."
              : "Cloud access is not configured, and this tournament is not saved on this device."
          );
          setTournament(null);
          setRounds([]);
          setActiveRound(null);
          setTeams([]);
          setAdjudicators([]);
          setVenues([]);
          setMotions([]);
          setBreakCategories([]);
          setDebates([]);
          setBallots([]);
          setFeedback([]);
          setInstitutions([]);
          setBallotIntake([]);
          setLoading(false);
          return;
        }

        if (localTournament) {
          setTournament(localTournament);
        } else {
          const defaultTournament: Tournament = {
            id: `tourn-${tournamentSlug}`,
            name: `${tournamentSlug.toUpperCase()} Tournament`,
            shortName: tournamentSlug.toUpperCase(),
            slug: tournamentSlug,
            format: "bp",
            active: true,
            ownerId: "local",
            admins: {},
            preferences: {
              teamsInDebate: 4,
              substantiveSpeakers: 2,
              replyScoresEnabled: false,
              minSpeakerScore: 68,
              maxSpeakerScore: 84,
              stepSpeakerScore: 1,
              minReplyScore: 34,
              maxReplyScore: 42,
              drawRule: "power_paired",
              sideAllocationRule: "balanced",
              ballotDoubleEntry: false,
              publicDraw: true,
              publicResults: true,
              publicStandings: true,
              publicMotions: true,
              feedbackEnabled: true,
              feedbackMinScore: 1,
              feedbackMaxScore: 10,
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          setTournament(defaultTournament);
          persistLocal("meta", defaultTournament);
        }

        const localRounds = readLocal<Round[]>("rounds", []);
        setRounds(localRounds);
        const publicRound = isSharedView
          ? [...localRounds]
              .filter(
                (round) =>
                  !round.cancelled &&
                  (round.drawStatus === "confirmed" ||
                    round.drawStatus === "released" ||
                    round.resultsReleased ||
                    round.adjudicatorsRevealed)
              )
              .sort((a, b) => b.seq - a.seq)[0]
          : undefined;
        setActiveRound(publicRound || localRounds.find((round) => !round.cancelled) || null);
        setTeams(readLocal<Team[]>("teams", []));
        setAdjudicators(readLocal<Adjudicator[]>("adjudicators", []));
        setVenues(readLocal<Venue[]>("venues", []));
        setMotions(readLocal<Motion[]>("motions", []));
        setBreakCategories(readLocal<BreakCategory[]>("breaks", []));
        setDebates(readLocal<Debate[]>("debates", []));
        setBallots(readLocal<BallotSubmission[]>("ballots", []));
        setFeedback(readLocal<FeedbackSubmission[]>("feedback", []));
        const localAuditEvents = readLocal<AuditEvent[]>("auditEvents", []);
        auditEventsRef.current = localAuditEvents;
        setAuditEvents(localAuditEvents);
        setInstitutions(readLocal<Institution[]>("institutions", []));
        setBallotIntake(readLocal<BallotIntakeRecord[]>("ballotIntake", []));
      } catch (e) {
        const message = e instanceof Error ? e.message : "Could not read tournament data.";
        console.error("Error reading tournament data:", e);
        if (isSharedView) {
          setCloudLoadError(`Could not load tournament data: ${message}`);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadLocalData();
    return () => {
      isMounted = false;
    };
  }, [tournamentSlug, storagePrefix, persistLocal, isSharedView, isPrivatePortal, user, authLoading, applyPublicProjection]);

  const syncPrivatePortal: TournamentContextType["syncPrivatePortal"] = async (
    privateUrlKey,
    passcode,
    options
  ) => {
    if (!tournament || !db) {
      throw new Error("Cloud sync is unavailable for this tournament.");
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("You are offline. Your submissions are saved on this device and will sync when online.");
    }

    setPrivateSyncState("syncing");
    setPrivateSyncMessage("Syncing submissions and downloading saved ballots and feedback…");
    try {
      const pending = safeJsonParse<PrivateSyncItem[]>(
        typeof window === "undefined" ? null : getLocalStore().getItem(privateQueueKey),
        []
      );
      const response = await fetch("/api/private/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tournamentId: tournament.id,
          privateUrlKey,
          passcode,
          pending,
          ...(options?.checkIn ? { checkIn: options.checkIn } : {}),
        }),
      });
      const responseBody = await response.text();
      let result: {
        error?: string;
        ballots?: BallotSubmission[];
        feedback?: FeedbackSubmission[];
        uploadedCount?: number;
        tournament?: Omit<Tournament, "ownerId" | "admins">;
        adjudicator?: Adjudicator;
        team?: Team;
        teams?: Team[];
        rounds?: Round[];
        debates?: Debate[];
        selfCheckIn?: SelfCheckInStatus | null;
      };

      try {
        result = JSON.parse(responseBody) as typeof result;
      } catch {
        const contentType = response.headers.get("content-type") || "unknown content type";
        if (contentType.includes("text/html") || /^\s*<!doctype html/i.test(responseBody)) {
          throw new Error(
            `The deployed site returned an HTML page for /api/private/sync (HTTP ${response.status}). Redeploy the latest app version; your pending submissions are still saved on this device.`
          );
        }
        throw new Error(
          `The sync service returned an invalid response (HTTP ${response.status}, ${contentType}). Your pending submissions are still saved on this device.`
        );
      }
      if (!response.ok) throw new Error(result.error || "Could not sync private portal data.");

      const uploadedIds = new Set(pending.map((item) => item.record.id));
      const remaining = pending.filter((item) => !uploadedIds.has(item.record.id));
      persistLocal(privateQueueKey.slice(storagePrefix.length + 1), remaining);

      const downloadedBallots = result.ballots || [];
      const mergedBallots = [
        ...ballots.filter((item) => !downloadedBallots.some((remote) => remote.id === item.id)),
        ...downloadedBallots,
      ];
      const downloadedFeedback = result.feedback || [];
      const mergedFeedback = [
        ...feedback.filter((item) => !downloadedFeedback.some((remote) => remote.id === item.id)),
        ...downloadedFeedback,
      ];
      if (result.tournament) {
        setTournament({ ...result.tournament, ownerId: "", admins: {} });
      }
      if (result.adjudicator) {
        setAdjudicators((current) => [
          ...current.filter((item) => item.id !== result.adjudicator!.id),
          result.adjudicator!,
        ]);
      }
      if (result.teams || result.team) {
        const remoteTeams = result.teams || [];
        setTeams((current) => {
          const currentPortalTeam = result.team
            ? current.find((item) => item.id === result.team!.id)
            : undefined;
          const debateTeams = remoteTeams.filter((remote) => remote.id !== result.team?.id);
          return [
            ...current.filter(
              (item) => item.id !== result.team?.id && !debateTeams.some((remote) => remote.id === item.id)
            ),
            ...debateTeams,
            ...(result.team ? [{ ...currentPortalTeam, ...result.team }] : []),
          ];
        });
      }
      if (result.rounds) {
        const privateRounds = result.rounds;
        setRounds((current) => [
          ...current.filter((item) => !result.rounds!.some((remote) => remote.id === item.id)),
          ...privateRounds,
        ]);
        setActiveRound(
          [...privateRounds]
            .filter((round) => !round.cancelled)
            .sort((left, right) => right.seq - left.seq)[0] || null
        );
      }
      if (result.debates) {
        setDebates((current) => [
          ...current.filter((item) => !result.debates!.some((remote) => remote.id === item.id)),
          ...result.debates!,
        ]);
      }
      setBallots(mergedBallots);
      setFeedback(mergedFeedback);
      persistLocal("ballots", mergedBallots);
      persistLocal("feedback", mergedFeedback);
      setPrivateSelfCheckIn(result.selfCheckIn ?? null);
      setPrivateSyncState("idle");
      setPrivateSyncMessage(
        `Synced ${result.uploadedCount || 0} pending item(s); downloaded ${downloadedBallots.length} ballot(s) and ${downloadedFeedback.length} feedback item(s).`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Private portal sync failed.";
      setPrivateSyncState("error");
      setPrivateSyncMessage(message);
      throw error;
    }
  };

  const loadPrivateTeamPortal: TournamentContextType["loadPrivateTeamPortal"] = async (privateUrlKey, passcode) => {
    if (!tournament || !db) {
      throw new Error("Private team data is unavailable for this tournament.");
    }
    const response = await fetch("/api/private/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tournamentId: tournament.id, privateUrlKey, passcode }),
    });
    const result = await response.json();
    if (!response.ok) {
      const message = typeof result.error === "string" ? result.error : "Could not load private team data.";
      throw new Error(message);
    }

    setTournament({ ...result.tournament, ownerId: "", admins: {} });
    setTeams((current) => [
      ...current.filter((item) => item.id !== result.team.id),
      result.team as Team,
    ]);
    const privateRounds = result.rounds as Round[];
    setRounds((current) => [
      ...current.filter((item) => !result.rounds.some((remote: Round) => remote.id === item.id)),
      ...privateRounds,
    ]);
    setActiveRound(
      [...privateRounds]
        .filter((round) => !round.cancelled)
        .sort((left, right) => right.seq - left.seq)[0] || null
    );
    setDebates((current) => [
      ...current.filter((item) => !result.debates.some((remote: Debate) => remote.id === item.id)),
      ...(result.debates as Debate[]),
    ]);
    setFeedback((current) => [
      ...current.filter((item) => !result.feedback.some((remote: FeedbackSubmission) => remote.id === item.id)),
      ...(result.feedback as FeedbackSubmission[]),
    ]);
  };

  const queuePrivateRecord = async (
    item: PrivateSyncItem,
    privateUrlKey?: string,
    passcode?: string
  ) => {
    const current = safeJsonParse<PrivateSyncItem[]>(
      typeof window === "undefined" ? null : getLocalStore().getItem(privateQueueKey),
      []
    );
    const queued = [
      ...current.filter((entry) => {
        if (entry.record.id === item.record.id) return false;
        return !(
          item.collection === "ballots" &&
          entry.collection === "ballots" &&
          entry.record.debateId === item.record.debateId
        );
      }),
      item,
    ];
    persistLocal(privateQueueKey.slice(storagePrefix.length + 1), queued);
    if (privateUrlKey && passcode && typeof navigator !== "undefined" && navigator.onLine) {
      try {
        await syncPrivatePortal(privateUrlKey, passcode);
      } catch (error) {
        console.error("Private portal submission queued for retry:", error);
      }
    } else {
      setPrivateSyncMessage("Saved on this device; it will sync when you are online.");
    }
  };

  // Is the current user an owner or admin of this tournament?
  const isOwnerOrAdmin = useMemo(() => isViewerTournamentAdmin({
    hasTournament: Boolean(tournament),
    signedIn: Boolean(user),
    isGlobalAdmin,
    staffRole: cloudStaffRole,
  }), [tournament, user, isGlobalAdmin, cloudStaffRole]);
  // Keep each round's motionsReleased in step with its motions' release toggles (see
  // motionRelease.ts). Only an administrator's working copy is updated; shared views receive the
  // flag through the public projection.
  useEffect(() => {
    if (!isOwnerOrAdmin || isSharedView || loading) return;
    const changed = roundsNeedingMotionReleaseSync(rounds, motions);
    if (changed.length > 0) saveRoundsLocally(applyMotionReleaseSync(rounds, changed));
  }, [isOwnerOrAdmin, isSharedView, loading, rounds, motions, saveRoundsLocally]);
  useEffect(() => {
    let active = true;
    setCloudStaffRole(null);
    setStaffAccessError("");
    if (!user || !tournament || !db) return () => { active = false; };
    const currentUser = user;
    const currentTournament = tournament;

    async function checkStaffRole() {
      try {
        const token = await currentUser.getIdToken();
        const response = await fetch(
          `/api/tournaments/${encodeURIComponent(currentTournament.id)}/access`,
          { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
        );
        const result = await response.json().catch(() => ({})) as {
          error?: string;
          role?: "admin" | "dataEntry" | null;
          permissions?: unknown;
        };
        if (!response.ok) {
          throw new Error(result.error || `Access verification failed (${response.status}).`);
        }
        if (active && result.role === "dataEntry" && typeof window !== "undefined") {
          const safeTeams = safeJsonParse<Team[]>(getLocalStore().getItem(`${storagePrefix}_teams`), [])
            .map(sanitizeAssistantTeam);
          const safeAdjudicators = safeJsonParse<Adjudicator[]>(getLocalStore().getItem(`${storagePrefix}_adjudicators`), [])
            .map(sanitizeAssistantAdjudicator);
          setTeams(safeTeams);
          persistLocal("teams", safeTeams);
          setAdjudicators(safeAdjudicators);
          persistLocal("adjudicators", safeAdjudicators);
          const safeTournament = { ...currentTournament, ownerId: "", admins: {} };
          setTournament(safeTournament);
          persistLocal("meta", safeTournament);
        }
        if (active) {
          const permissions = Array.isArray(result.permissions)
            ? result.permissions.filter((item): item is string => typeof item === "string")
            : [];
          setStaffPermissions(permissions);
          persistLocal("verifiedRole", { uid: currentUser.uid, role: result.role ?? null, permissions });
          setLiveAdminVerified(result.role === "admin");
          setCloudStaffRole(result.role === "admin" || result.role === "dataEntry" ? result.role : "none");
          setStaffAccessError(
            result.role === "admin" || result.role === "dataEntry"
              ? ""
              : "This account is not listed as a tournament owner, administrator, or data-entry assistant."
          );
        }
      } catch (error) {
        // Offline, the role last verified for this account on this device still applies, so the
        // tab room keeps working; Firestore rules enforce access whenever writes reach the cloud.
        const cached = safeJsonParse<{ uid?: unknown; role?: unknown; permissions?: unknown } | null>(
          typeof window === "undefined" ? null : getLocalStore().getItem(`${storagePrefix}_verifiedRole`),
          null
        );
        if (
          active &&
          isLikelyOffline(error) &&
          cached?.uid === currentUser.uid &&
          (cached.role === "admin" || cached.role === "dataEntry")
        ) {
          setLiveAdminVerified(cached.role === "admin");
          setCloudStaffRole(cached.role);
          setStaffPermissions(Array.isArray(cached.permissions)
            ? cached.permissions.filter((item): item is string => typeof item === "string")
            : []);
          setStaffAccessError("");
          return;
        }
        if (active) setLiveAdminVerified(false);
        if (active) setCloudStaffRole("none");
        if (active) {
          setStaffAccessError(
            error instanceof Error
              ? `Could not verify tournament access: ${error.message}`
              : "Could not verify tournament access. Check the server Firebase configuration and try again."
          );
        }
      }
    }
    void checkStaffRole();
    return () => { active = false; };
  }, [isGlobalAdmin, pathname, persistLocal, storagePrefix, tournament?.id, user]);
  const isDataEntryAssistant = !isGlobalAdmin && cloudStaffRole === "dataEntry";
  const staffAccessLoading = Boolean(user && db && tournament && cloudStaffRole === null);

  // A cloud tournament (it has a cloud version) opened by a verified administrator on an admin
  // page goes live. `liveAdminVerified` changes only when a role check finishes, so navigating
  // (which re-checks the role) does not restart the listeners.
  const tournamentSyncVersion = Number(tournament?.syncVersion) || 0;
  const liveActive = Boolean(
    db &&
      user &&
      tournament?.id &&
      tournamentSyncVersion > 0 &&
      (isGlobalAdmin || liveAdminVerified) &&
      !isSharedView &&
      !loading &&
      liveSyncEnabled
  );
  const activeRoundIdRef = useRef(activeRound?.id);
  activeRoundIdRef.current = activeRound?.id;
  useEffect(() => {
    if (typeof window === "undefined") return;
    setLiveSyncEnabledState(getLocalStore().getItem(`${storagePrefix}_liveSyncDisabled`) !== "true");
  }, [storagePrefix, loading]);
  useEffect(() => {
    setLiveAdminVerified(false);
  }, [user?.uid, tournament?.id]);
  const liveTournamentId = liveActive ? tournament?.id : undefined;
  useEffect(() => {
    if (!liveTournamentId || !db) {
      setLiveSync(LIVE_SYNC_OFF);
      return;
    }
    const session = createLiveSession(
      createFirestoreLivePort(db, liveTournamentId),
      {
        applySnapshot: (name, snapshot) => liveHostRef.current.applySnapshot(name, snapshot),
        onWritesRejected: (writes, error) => liveHostRef.current.onWritesRejected(writes, error),
        onStatus: (status) => liveHostRef.current.onStatus(status),
      },
      { online: typeof navigator === "undefined" ? true : navigator.onLine }
    );
    liveSessionRef.current = session;
    session.setActiveRound(activeRoundIdRef.current);
    const updateOnline = () => session.setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      session.dispose();
      if (liveSessionRef.current === session) liveSessionRef.current = null;
      setLiveSync(LIVE_SYNC_OFF);
    };
  }, [liveTournamentId, liveResyncCount]);
  useEffect(() => {
    liveSessionRef.current?.setActiveRound(activeRound?.id);
  }, [activeRound?.id, liveTournamentId, liveResyncCount]);

  const setLiveSyncEnabled = (enabled: boolean) => {
    if (typeof window !== "undefined") {
      getLocalStore().setItem(`${storagePrefix}_liveSyncDisabled`, enabled ? "false" : "true");
    }
    setLiveSyncEnabledState(enabled);
  };
  const ballotConfirmationConflicts = useMemo(
    () => (liveSync.mode === "off" ? [] : findConfirmationConflicts(ballots)),
    [liveSync.mode, ballots]
  );

  const recordAuditEvent: TournamentContextType["recordAuditEvent"] = async (eventData) => {
    const timestamp = new Date().toISOString();
    const event: AuditEvent = {
      ...eventData,
      id: typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      tournamentId: tournament?.id || tournamentSlug,
      timestamp,
      actorId: user?.uid,
      actorName: user?.displayName || user?.email || undefined,
      actorType: user ? "user" : "system",
    };
    const updated = [event, ...auditEventsRef.current];
    auditEventsRef.current = updated;
    setAuditEvents(updated);
    persistLocal("auditEvents", updated);
    if (AUTOMATIC_CLOUD_WRITES && db && tournament?.id) {
      // The change this event describes has already been saved, and the event is in the local
      // audit log, which every cloud upload appends to Firestore. A failed immediate append must
      // therefore not surface as a failure of the change itself.
      try {
        await createFirestoreAuditRepository(tournament.id).append(event);
      } catch (error) {
        console.warn("Audit event kept locally; it will be uploaded with the next cloud sync.", error);
      }
    }
  };

  const entityCommands = createTournamentEntityCommands({
    tournamentId: tournament?.id || tournamentSlug,
    institutions,
    teams,
    adjudicators,
    venues,
    motions,
    debates,
    ballots,
    feedback,
    repositories: {
      institutions: {
        save: (items) => {
          setInstitutions(items);
          persistLocal("institutions", items);
        },
      },
      teams: {
        save: (items) => {
          saveLiveRecords("teams", teams, isDataEntryAssistant ? items.map(sanitizeAssistantTeam) : items);
        },
      },
      adjudicators: {
        save: (items) => {
          saveLiveRecords(
            "adjudicators",
            adjudicators,
            isDataEntryAssistant ? items.map(sanitizeAssistantAdjudicator) : items
          );
        },
      },
      venues: {
        save: (items) => {
          setVenues(items);
          persistLocal("venues", items);
        },
      },
      motions: {
        save: (items) => {
          setMotions(items);
          persistLocal("motions", items);
        },
      },
    },
    recordAuditEvent,
    createId: createEntityId,
    generatePrivateKey,
    currentActor: () => ({ id: user?.uid, name: user?.displayName || user?.email || undefined }),
    cloudRepository:
      AUTOMATIC_CLOUD_WRITES && db && tournament?.id
        ? createFirestoreEntityRepository(tournament.id)
        : undefined,
  });

  const {
    saveEntityBatch,
    addInstitutions: addInstitutionsCommand,
    updateInstitution: updateInstitutionCommand,
    deleteInstitution: deleteInstitutionCommand,
    addTeams: addTeamsCommand,
    updateTeam: updateTeamCommand,
    deleteTeam: deleteTeamCommand,
    addAdjudicators: addAdjudicatorsCommand,
    updateAdjudicator: updateAdjudicatorCommand,
    updateAdjudicators,
    deleteAdjudicator: deleteAdjudicatorCommand,
    addVenues: addVenuesCommand,
    updateVenue: updateVenueCommand,
    deleteVenue: deleteVenueCommand,
    addMotions: addMotionsCommand,
    updateMotion: updateMotionCommand,
    deleteMotion: deleteMotionCommand,
  } = entityCommands;

  const releaseAuditLog: TournamentContextType["releaseAuditLog"] = async () => {
    if (!db || !user || !tournament || !isOwnerOrAdmin) {
      throw new Error("Sign in as a tournament administrator to release the audit log.");
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("You are offline. Connect to the internet before releasing the audit log.");
    }

    const token = await user.getIdToken();
    const response = await fetch(
      `/api/tournaments/${encodeURIComponent(tournament.id)}/audit/release`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
    const responseText = await response.text();
    let result: {
      error?: string;
      releasedAt?: string;
      eventCount?: number;
      events?: Array<{
        id: string;
        sequence: number;
        previousHash: string;
        hash: string;
      }>;
    };
    try {
      result = JSON.parse(responseText) as typeof result;
    } catch {
      throw new Error(`The audit release service returned an invalid response (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      throw new Error(result.error || "Could not release the audit log.");
    }
    if (
      typeof result.releasedAt !== "string" ||
      typeof result.eventCount !== "number" ||
      !Number.isSafeInteger(result.eventCount) ||
      result.eventCount < 0 ||
      !Array.isArray(result.events) ||
      result.events.length !== result.eventCount ||
      !result.events.every((event, index) =>
        typeof event.id === "string" &&
        event.sequence === index + 1 &&
        typeof event.previousHash === "string" &&
        typeof event.hash === "string"
      )
    ) {
      throw new Error("The audit release service returned incomplete release details.");
    }

    const releasedHashes = new Map(result.events.map((event) => [event.id, event]));
    const updated = auditEventsRef.current.map((event) => {
      const released = releasedHashes.get(event.id);
      if (!released) return event;
      return {
        ...event,
        sequence: released.sequence,
        previousHash: released.previousHash,
        hash: released.hash,
      };
    });
    auditEventsRef.current = updated;
    setAuditEvents(updated);
    persistLocal("auditEvents", updated);
    return { releasedAt: result.releasedAt, eventCount: result.eventCount };
  };

  const hideRevealedAdjudicators = async (roundIds: Set<string>) => {
    for (const round of rounds) {
      if (roundIds.has(round.id) && round.adjudicatorsRevealed) {
        await updateRound({ ...round, adjudicatorsRevealed: false });
      }
    }
  };

  // Dynamic Standings Recalculation (Instantaneous in-browser compute)
  const standingsResult = useMemo(() => {
    if (!tournament) return { teams: [], speakers: [], replies: [] };
    const activeRounds = rounds.filter((round) => !round.cancelled);
    const activeRoundIds = new Set(activeRounds.map((round) => round.id));
    return calculateStandings(
      tournament,
      activeRounds,
      teams,
      debates.filter((debate) => activeRoundIds.has(debate.roundId)),
      ballots.filter((ballot) => activeRoundIds.has(ballot.roundId))
    );
  }, [tournament, rounds, teams, debates, ballots]);

  const teamStandings = standingsResult.teams;
  const speakerStandings = standingsResult.speakers;
  const replyStandings = standingsResult.replies;

  // Dynamic Break Qualification Calculation
  const divergedRecordSummaries = useMemo(() => {
    const local: Record<(typeof CLOUD_COLLECTIONS)[number], Array<{ id: string }>> = {
      rounds,
      teams,
      adjudicators,
      venues,
      motions,
      breakCategories,
      debates,
      ballots,
      feedback,
      institutions,
      auditEvents,
      ballotIntake,
    };
    return divergedRecords.map((diverged) => {
      const localRecord = diverged.collectionName === "tournament"
        ? tournament ?? undefined
        : local[diverged.collectionName].find((record) => record.id === diverged.recordId);
      return summarizeDivergedRecord(diverged, localRecord as CloudRecord | undefined, divergedRecordKey(diverged));
    });
  }, [divergedRecords, tournament, rounds, teams, adjudicators, venues, motions, breakCategories, debates, ballots, feedback, institutions, auditEvents, ballotIntake]);

  const breakResults = useMemo(() => {
    if (breakCategories.length === 0 || teamStandings.length === 0) return [];
    return calculateBreaks(breakCategories, teams, teamStandings, tournament?.format);
  }, [breakCategories, teams, teamStandings]);

  // Mutations
  // Overridable tournament rules ask an administrator for a reason (RuleOverrideHost); assistants
  // are never offered an override.
  const guarded = <T,>(action: (override?: RuleOverride) => Promise<T>) =>
    withRuleOverride(action, isOwnerOrAdmin);

  const saveTournament = async (t: Tournament) => {
    await guarded((override) => saveTournamentCommand(t, tournament, {
      ballots,
      rounds,
      localRepository: {
        saveTournament: (value) => {
          setTournament(value);
          persistLocal("meta", value);
        },
      },
      cloudRepository:
        AUTOMATIC_CLOUD_WRITES && db
          ? createFirestoreTournamentRepository()
          : undefined,
      recordAuditEvent,
      warn: (message, error) => console.warn(message, error),
    }, override));
  };

  const createRound = async (
    name: string,
    abbr: string,
    stage: "preliminary" | "elimination",
    customDrawType?: "random" | "power_paired" | "round_robin" | "elimination" | "manual"
  ) => {
    return createRoundCommand(
      {
        tournamentId: tournament?.id || tournamentSlug,
        roundSeq: rounds.length + 1,
        name,
        abbr,
        stage,
        customDrawType,
        defaultDrawRule: tournament?.preferences?.drawRule || "power_paired",
      },
      rounds,
      {
        localRepository: { saveRounds: saveRoundsLocally },
        recordAuditEvent,
      }
    );
  };

  const updateRound = async (round: Round) => {
    const cloudRepository =
      AUTOMATIC_CLOUD_WRITES && db && tournament?.id
        ? createFirestoreRoundRepository(tournament.id)
        : undefined;
    await guarded((override) => updateRoundCommand(round, rounds, activeRound, {
      localRepository: { saveRounds: saveRoundsLocally },
      recordAuditEvent,
      cloudRepository,
      guards: {
        debates,
        ballots,
        drawIssues: (target) => tournament
          ? validateDraw({ tournament, round: target, rounds, debates, teams, adjudicators, venues })
          : [],
      },
    }, override));
  };

  const ballotWorkflowDependencies = {
    ballots,
    rounds,
    debates,
    adjudicators,
    repository: {
      saveBallots: (items: BallotSubmission[]) => saveLiveRecords("ballots", ballots, items),
      saveDebates: (items: Debate[]) => saveLiveRecords("debates", debates, items),
    },
    updateRound,
    recordAuditEvent,
    queuePrivateRecord,
    checkPolicy: {
      doubleEntry: Boolean(tournament?.preferences?.ballotDoubleEntry),
      actorId: user?.uid,
    },
  };
  // Draws and allocations run in a Web Worker; these let their results land on the current state.
  const latestRecordsRef = useRef({ rounds, debates, ballots });
  useEffect(() => {
    latestRecordsRef.current = { rounds, debates, ballots };
  }, [rounds, debates, ballots]);
  const [computeJob, setComputeJob] = useState<{ kind: ComputeKind; startedAt: number } | null>(null);
  const computeAbortRef = useRef<AbortController | null>(null);
  const runCompute = useCallback(async <K extends ComputeKind>(
    request: Extract<ComputeRequest, { kind: K }>
  ): Promise<ComputeResults[K]> => {
    computeAbortRef.current?.abort();
    const controller = new AbortController();
    computeAbortRef.current = controller;
    setComputeJob({ kind: request.kind, startedAt: Date.now() });
    try {
      return await runComputeJob(request, { signal: controller.signal });
    } finally {
      if (computeAbortRef.current === controller) {
        computeAbortRef.current = null;
        setComputeJob(null);
      }
    }
  }, []);
  const cancelCompute = useCallback(() => computeAbortRef.current?.abort(), []);

  const allocationDependencies = {
    tournament,
    rounds,
    teams,
    debates,
    ballots,
    adjudicators,
    standings: teamStandings,
    breakCategories,
    feedback,
    venues,
    repository: {
      saveDebates: (items: Debate[]) => saveLiveRecords("debates", debates, items),
    },
    cloudRepository:
      AUTOMATIC_CLOUD_WRITES && db && tournament?.id
        ? createFirestoreDrawRepository(tournament.id)
        : undefined,
    hideRevealedAdjudicators,
    recordAuditEvent,
    computeAllocation: (input: AutoAllocationInput) => runCompute({ kind: "allocation", input }),
    latestDebates: () => latestRecordsRef.current.debates,
  };
  const breakDependencies = {
    tournament,
    rounds,
    teams,
    breakCategories,
    breakResults,
    debates,
    ballots,
    localRepository: {
      saveBreakCategories: (items: BreakCategory[]) => {
        setBreakCategories(items);
        persistLocal("breaks", items);
      },
      saveTeams: (items: Team[]) => saveLiveRecords("teams", teams, items),
      saveRounds: (items: Round[]) => {
        setRounds(items);
        persistLocal("rounds", items);
      },
      setActiveRound,
    },
    cloudRepository:
      AUTOMATIC_CLOUD_WRITES && db && tournament?.id
        ? createFirestoreBreakRepository(tournament.id)
        : undefined,
    recordAuditEvent,
  };

  const setPreliminaryRoundCount = async (count: number) => {
    await guarded((override) => setPreliminaryRoundCountCommand(count, {
      rounds,
      debates,
      ballots,
      tournamentId: tournament?.id || tournamentSlug,
      drawRule: tournament?.preferences?.drawRule || "power_paired",
      localRepository: {
        saveRounds: (items) => {
          setRounds(items);
          persistLocal("rounds", items);
        },
        saveDebates: (items) => saveLiveRecords("debates", debates, items),
        setActiveRound,
      },
      cloudRepository:
        AUTOMATIC_CLOUD_WRITES && db && tournament?.id
          ? createFirestoreRoundRepository(tournament.id)
          : undefined,
      recordAuditEvent,
    }, override));
  };

  const deleteRound = async (roundId: string) => {
    if (!rounds.some((round) => round.id === roundId)) return;
    const deletedDebates = debates.filter((debate) => debate.roundId === roundId);
    const deletedDebateIds = new Set(deletedDebates.map((debate) => debate.id));
    const deletedBallots = ballots.filter(
      (ballot) => ballot.roundId === roundId || deletedDebateIds.has(ballot.debateId)
    );
    const deletedFeedback = feedback.filter(
      (submission) => submission.roundId === roundId || deletedDebateIds.has(submission.debateId)
    );
    await guarded((override) => deleteRoundCommand({
      roundId,
      rounds,
      debates,
      ballots,
      feedback,
      motions,
      activeRound,
      localRepository: {
        saveRounds: (items) => {
          setRounds(items);
          persistLocal("rounds", items);
        },
        saveDebates: (items) => saveLiveRecords("debates", debates, items),
        saveBallots: (items) => saveLiveRecords("ballots", ballots, items),
        saveFeedback: (items) => {
          setFeedback(items);
          persistLocal("feedback", items);
        },
        saveMotions: (items) => {
          setMotions(items);
          persistLocal("motions", items);
        },
        setActiveRound,
      },
      cloudRepository:
        AUTOMATIC_CLOUD_WRITES && db && tournament?.id
          ? createFirestoreRoundRepository(tournament.id)
          : undefined,
      recordAuditEvent,
    }, override));
    recordSyncTombstones({
      rounds: [roundId],
      debates: deletedDebates.map((debate) => debate.id),
      ballots: deletedBallots.map((ballot) => ballot.id),
      feedback: deletedFeedback.map((submission) => submission.id),
    });
  };

  const generateDraw = async (roundId: string, options?: { discardExistingResults?: boolean }) => {
    await guarded((override) => generateDrawCommand(roundId, {
      tournament,
      rounds,
      teams,
      institutions,
      venues,
      debates,
      ballots,
      motions,
      standings: teamStandings,
      generateRoundDraw: (input) => runCompute({ kind: "draw", input }),
      latest: () => latestRecordsRef.current,
      localRepository: {
        saveDebates: (items) => saveLiveRecords("debates", debates, items),
        saveBallots: (items) => saveLiveRecords("ballots", ballots, items),
        markDebatesRemoved: (debateIds) => recordSyncTombstones({ debates: debateIds }),
        saveRounds: (items, active) => {
          setRounds(items);
          setActiveRound(active);
          persistLocal("rounds", items);
        },
      },
      cloudRepository:
        AUTOMATIC_CLOUD_WRITES && db && tournament?.id
          ? createFirestoreDrawRepository(tournament.id)
          : undefined,
      recordAuditEvent,
    }, { ...options, override }));
  };

  const autoAllocate = async (roundId: string, panelSize: number = 1, settings?: AutoAllocateSettings) => {
    await guarded((override) =>
      autoAllocateCommand(roundId, panelSize, allocationDependencies, settings, override)
    );
  };

  const updateDebate = async (debate: Debate) => {
    await guarded((override) => updateDebateCommand(debate, debates, allocationDependencies, override));
  };

  const updateDebates = async (newDebates: Debate[]) => {
    await guarded((override) => updateDebatesCommand(newDebates, debates, {
      rounds,
      ballots,
      repository: allocationDependencies.repository,
      cloudRepository: allocationDependencies.cloudRepository,
      hideRevealedAdjudicators,
      recordAuditEvent,
    }, override));
  };

  /**
   * Data-entry staff confirm ballots on the server (docs/staff-access.md); the changed ballots and
   * debate come back and are stored as synced, so they are not sent back as local edits.
   */
  const confirmBallotAsStaff = async (
    request: { action: "confirm" | "check"; ballotId: string; version: number; entry?: BallotSubmission }
  ) => {
    if (!user || !tournament) throw new Error("Sign in to confirm ballots.");
    const token = await user.getIdToken();
    const response = await fetch(`/api/tournaments/${encodeURIComponent(tournament.id)}/assistant-ballots`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const result = await response.json().catch(() => ({})) as {
      error?: string;
      differences?: Array<{ field: string; first: string; second: string }>;
      ballots?: BallotSubmission[];
      debate?: Debate;
    };
    if (!response.ok || !result.ballots || !result.debate) {
      const details = result.differences?.length
        ? ` ${result.differences.map((difference) => `${difference.field}: ${difference.first} / ${difference.second}`).join("; ")}`
        : "";
      throw new Error(`${result.error || "Could not confirm the ballot."}${details}`);
    }
    const changedBallots = new Map(result.ballots.map((item) => [item.id, item]));
    const nextBallots = [
      ...ballots.map((item) => changedBallots.get(item.id) ?? item),
      ...result.ballots.filter((item) => !ballots.some((existing) => existing.id === item.id)),
    ];
    const serverDebate = result.debate;
    const nextDebates = debates.map((item) => item.id === serverDebate.id ? serverDebate : item);
    setBallots(nextBallots);
    persistLocal("ballots", nextBallots);
    setDebates(nextDebates);
    persistLocal("debates", nextDebates);
    saveSyncState(baselineAfterDataEntrySync({
      baseline: readSyncBaseline(),
      sentCollections: {
        ballots: result.ballots as unknown as CloudRecord[],
        debates: [serverDebate] as unknown as CloudRecord[],
      },
      rejected: [],
    }));
  };

  const submitBallot = async (ballot: BallotSubmission, privatePasscode?: string) => {
    // A data-entry assistant's blind check of someone else's entry is confirmed on the server.
    if (isDataEntryAssistant && ballot.confirmed && ballot.checksVersion !== undefined) {
      const pending = ballots.find((item) =>
        item.debateId === ballot.debateId && item.version === ballot.checksVersion && !item.discarded && !item.confirmed
      );
      if (!pending) throw new Error("The ballot being checked is no longer waiting for a check. Sync and reload.");
      await confirmBallotAsStaff({ action: "check", ballotId: pending.id, version: pending.version, entry: ballot });
      return;
    }
    await guarded((override) => submitBallotCommand(ballot, privatePasscode, ballotWorkflowDependencies, override));
    if (ballot.confirmed) notifyBallotConfirmed();
  };

  const confirmBallot = async (
    ballotId: string,
    debateId: string,
    submittedBallot?: BallotSubmission
  ) => {
    if (isDataEntryAssistant) {
      const pending = ballots.find((item) => item.id === ballotId);
      if (!pending) throw new Error("That ballot could not be found. Sync and reload.");
      await confirmBallotAsStaff({ action: "confirm", ballotId, version: pending.version });
      return;
    }
    await guarded((override) =>
      confirmBallotCommand(ballotId, debateId, submittedBallot, ballotWorkflowDependencies, override)
    );
    notifyBallotConfirmed();
  };

  /**
   * "Ballot confirmed" emails (docs/email-notifications.md): confirmations of a live cloud
   * tournament reach Firestore through live writes, not uploads, so the server is asked to send
   * them once the writes are flushed. A failure only delays them to the next trigger.
   */
  const notifyBallotConfirmed = () => {
    if (!db || !user || !tournament || !isOwnerOrAdmin || tournament.preferences?.notifyBallotConfirmed !== true) return;
    const currentUser = user;
    const tournamentId = tournament.id;
    void (async () => {
      await flushLiveWrites();
      await sendDueNotificationsCommand({ tournamentId, idToken: await currentUser.getIdToken() });
    })().catch((error: unknown) =>
      console.warn("Could not send ballot-confirmed emails:", error instanceof Error ? error.message : error)
    );
  };

  const discardBallot = async (ballotId: string) => {
    await guarded((override) =>
      discardBallotCommand(ballotId, user?.email || user?.uid || undefined, ballotWorkflowDependencies, override)
    );
  };

  const addInstitutions = (instData: Omit<Institution, "id" | "tournamentId">[]) => addInstitutionsCommand(instData);

  const addInstitution = async (instData: Omit<Institution, "id" | "tournamentId">) => {
    await addInstitutionsCommand([instData]);
  };

  const updateInstitution = async (inst: Institution) => {
    await updateInstitutionCommand(inst);
  };

  const deleteInstitution = async (instId: string) => {
    await deleteInstitutionCommand(instId);
    if (institutions.some((institution) => institution.id === instId)) {
      recordSyncTombstones({ institutions: [instId] });
    }
  };

  const addTeams = (teamData: Omit<Team, "id" | "tournamentId">[]) => addTeamsCommand(teamData);

  const addTeam = async (teamData: Omit<Team, "id" | "tournamentId">) => {
    await addTeamsCommand([teamData]);
  };

  const updateTeam = async (team: Team, _privatePasscode?: string) => {
    await updateTeamCommand(team);
  };

  const deleteTeam = async (teamId: string) => {
    await deleteTeamCommand(teamId);
    if (teams.some((team) => team.id === teamId)) recordSyncTombstones({ teams: [teamId] });
  };

  const addAdjudicators = (adjData: Omit<Adjudicator, "id" | "tournamentId">[]) => addAdjudicatorsCommand(adjData);

  const addAdjudicator = async (adjData: Omit<Adjudicator, "id" | "tournamentId">) => {
    await addAdjudicatorsCommand([adjData]);
  };

  const updateAdjudicator = async (adj: Adjudicator, _privatePasscode?: string) => {
    await updateAdjudicatorCommand(adj);
  };

  const updateAdjudicatorScores: TournamentContextType["updateAdjudicatorScores"] = async (
    adjudicatorId,
    scores,
    reason
  ) => {
    const current = adjudicators.find((adjudicator) => adjudicator.id === adjudicatorId);
    if (!current) throw new Error("This adjudicator no longer exists.");
    const { testScore: _previousTestScore, ...rest } = current;
    await updateAdjudicatorCommand(
      { ...rest, baseScore: scores.baseScore, ...(scores.testScore !== undefined ? { testScore: scores.testScore } : {}) },
      { scoreChangeReason: reason }
    );
  };

  const deleteAdjudicator = async (adjId: string) => {
    await deleteAdjudicatorCommand(adjId);
    if (adjudicators.some((adjudicator) => adjudicator.id === adjId)) {
      recordSyncTombstones({ adjudicators: [adjId] });
    }
  };

  const addVenues = async (venueData: Omit<Venue, "id" | "tournamentId">[]) => {
    await addVenuesCommand(venueData);
  };

  const addVenue = async (venueData: Omit<Venue, "id" | "tournamentId">) => {
    await addVenuesCommand([venueData]);
  };

  const updateVenue = async (venue: Venue) => {
    await updateVenueCommand(venue);
  };

  const deleteVenue = async (venueId: string) => {
    await deleteVenueCommand(venueId);
    if (venues.some((venue) => venue.id === venueId)) recordSyncTombstones({ venues: [venueId] });
  };

  const addMotions = async (motionData: Omit<Motion, "id" | "tournamentId">[]) => {
    await addMotionsCommand(motionData);
  };

  const addMotion = async (motionData: Omit<Motion, "id" | "tournamentId">) => {
    await addMotionsCommand([motionData]);
  };

  const updateMotion = async (motion: Motion) => {
    await updateMotionCommand(motion);
  };

  const deleteMotion = async (motionId: string) => {
    await deleteMotionCommand(motionId);
    if (motions.some((motion) => motion.id === motionId)) recordSyncTombstones({ motions: [motionId] });
  };

  const saveBreakCategories = async (cats: BreakCategory[]) => {
    await saveBreakCategoriesCommand(cats, breakDependencies);
    const deletedIds = breakCategories
      .filter((category) => !cats.some((next) => next.id === category.id))
      .map((category) => category.id);
    if (deletedIds.length > 0) recordSyncTombstones({ breakCategories: deletedIds });
  };

  const generateBreak = async (categoryId: string) => {
    return guarded((override) => generateBreakCommand(categoryId, breakDependencies, override));
  };

  const proceedToNextEliminationRound = async (roundId: string) => {
    return proceedToNextEliminationRoundCommand(roundId, breakDependencies);
  };

  const addFeedback = async (
    fbData: Omit<FeedbackSubmission, "id" | "tournamentId" | "timestamp">,
    privatePasscode?: string,
    privateUrlKey?: string
  ) => {
    await addFeedbackCommand(fbData, {
      tournamentId: tournament?.id || tournamentSlug,
      feedback,
      questions: tournament?.preferences?.feedbackQuestions,
      privatePasscode,
      privateUrlKey,
      teams,
      adjudicators,
      repository: {
        saveFeedback: (items) => {
          setFeedback(items);
          persistLocal("feedback", items);
        },
      },
      queuePrivateRecord: (record, urlKey, passcode) =>
        queuePrivateRecord({ collection: "feedback", record }, urlKey, passcode),
      recordAuditEvent,
    });
  };

  // Rehearsal tools. Ballots and feedback go through their commands one after another (see
  // application/rehearsal.ts); the result is saved once, like any other batch of changes.
  const simulateRoundResults = async (roundId: string, seed: number): Promise<RehearsalOutcome> => {
    const round = rounds.find((item) => item.id === roundId);
    if (!tournament || !round) throw new Error("That round no longer exists.");
    const plan = planSimulatedBallots({
      tournament,
      round,
      debates,
      teams,
      motions,
      ballots,
      rng: createSeededRng(seed),
      submitter: { id: user?.uid, name: user?.displayName || user?.email || undefined },
    });
    if (plan.ballots.length > 0) {
      const state = await guarded((override) => submitBallotsInSequence(plan.ballots, { ballots, debates, rounds }, {
        adjudicators,
        recordAuditEvent,
        checkPolicy: ballotWorkflowDependencies.checkPolicy,
        // A confirmed ballot withdraws released results; the changed rounds are saved below.
        updateRound: async () => undefined,
      }, override));
      saveLiveRecords("ballots", ballots, state.ballots);
      saveLiveRecords("debates", debates, state.debates);
      if (state.rounds.some((item, index) => item !== rounds[index])) saveRoundsLocally(state.rounds);
    }
    await recordAuditEvent({
      action: "rehearsal.results_simulated",
      category: "ballot",
      roundId,
      summary: `Rehearsal: simulated ${plan.ballots.length} ballot(s) for ${round.name}`,
      details: { seed, ballotIds: plan.ballots.map((ballot) => ballot.id), skipped: plan.skipped },
    });
    return { created: plan.ballots.length, skipped: plan.skipped };
  };

  const simulateRoundFeedback = async (roundId: string, seed: number): Promise<RehearsalOutcome> => {
    const round = rounds.find((item) => item.id === roundId);
    if (!tournament || !round) throw new Error("That round no longer exists.");
    const plan = planSimulatedFeedback({
      tournament,
      round,
      debates,
      teams,
      adjudicators,
      feedback,
      rng: createSeededRng(seed),
    });
    if (plan.feedback.length > 0) {
      const saved = await addFeedbackInSequence(plan.feedback, {
        tournament,
        feedback,
        createId: () => createEntityId("fb"),
        recordAuditEvent,
      });
      setFeedback(saved);
      persistLocal("feedback", saved);
    }
    await recordAuditEvent({
      action: "rehearsal.feedback_simulated",
      category: "feedback",
      roundId,
      summary: `Rehearsal: simulated ${plan.feedback.length} feedback submission(s) for ${round.name}`,
      details: { seed, skipped: plan.skipped },
    });
    return { created: plan.feedback.length, skipped: plan.skipped };
  };

  const reviewFeedback = async (feedbackId: string, change: FeedbackReviewChange) => {
    await reviewFeedbackCommand(feedbackId, change, {
      feedback,
      repository: {
        saveFeedback: (items) => {
          setFeedback(items);
          persistLocal("feedback", items);
        },
      },
      recordAuditEvent,
    });
  };

  const recordBallotIntake = async (sheet: BallotSheet): Promise<boolean> => {
    if (!tournament) throw new Error("Load a tournament before receiving ballots.");
    // Stored rounds, not the context's list, which hides cancelled rounds that must still be refused.
    const record = createIntakeRecord({
      sheet,
      round: rounds.find((round) => round.id === sheet.roundId),
      tournamentId: tournament.id,
      receivedAt: new Date().toISOString(),
      receivedBy: user?.uid,
      receivedByName: user?.displayName || user?.email || undefined,
    });
    const result = addIntakeRecord(ballotIntakeRef.current, record);
    if (!result.added) return false;
    ballotIntakeRef.current = result.intake;
    setBallotIntake(result.intake);
    persistLocal("ballotIntake", result.intake);
    return true;
  };

  const generatePrivateUrlKeys = async (forceRegenerate = false) => {
    await regeneratePrivateAccessCommand(teams, adjudicators, forceRegenerate, {
      localRepository: {
        saveTeams: (items) => saveLiveRecords("teams", teams, items),
        saveAdjudicators: (items) => saveLiveRecords("adjudicators", adjudicators, items),
      },
      cloudRepository:
        AUTOMATIC_CLOUD_WRITES && db && tournament?.id
          ? createFirestoreEntityRepository(tournament.id)
          : undefined,
      recordAuditEvent,
    });
  };

  const asCloudRecords = (records: Array<{ id: string }>): CloudRecord[] =>
    records as unknown as CloudRecord[];

  const getLocalCollections = (): Record<(typeof CLOUD_COLLECTIONS)[number], CloudRecord[]> => ({
    rounds: asCloudRecords(rounds),
    teams: asCloudRecords(teams),
    adjudicators: asCloudRecords(adjudicators),
    venues: asCloudRecords(venues),
    motions: asCloudRecords(motions),
    breakCategories: asCloudRecords(breakCategories),
    debates: asCloudRecords(debates),
    ballots: asCloudRecords(ballots),
    feedback: asCloudRecords(feedback),
    institutions: asCloudRecords(institutions),
    auditEvents: asCloudRecords(auditEventsRef.current),
    ballotIntake: asCloudRecords(ballotIntakeRef.current),
  });

  const syncDataEntry = async () => {
    if (!db || !user || !tournament || !isDataEntryAssistant) {
      throw new Error("Only assigned data-entry assistants can sync these records.");
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("You are offline. Your changes remain saved on this device.");
    }

    setCloudSyncState("syncing");
    setCloudSyncMessage("Syncing participant, ballot, feedback, and result records…");
    try {
      const token = await user.getIdToken();
      const localCollections = getLocalCollections();
      const response = await fetch(
        `/api/tournaments/${encodeURIComponent(tournament.id)}/data-entry-sync`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(buildDataEntrySyncPayload({ localCollections })),
        }
      );
      const result = await response.json() as {
        error?: string;
        archivedConflictCount?: number;
        rejected?: Array<{ collectionName: string; recordId: string }>;
      };
      if (!response.ok) throw new Error(result.error || "Data-entry sync failed.");
      // The records the server applied count as synced, so the next load takes its result.
      saveSyncState(baselineAfterDataEntrySync({
        baseline: readSyncBaseline(),
        sentCollections: {
          ...Object.fromEntries(DATA_ENTRY_COLLECTIONS.map((name) => [name, localCollections[name]])),
          debates: localCollections.debates,
        },
        rejected: Array.isArray(result.rejected) ? result.rejected : [],
      }));
      const archivedConflictCount = result.archivedConflictCount || 0;
      setCloudSyncState("success");
      setCloudSyncMessage(
        archivedConflictCount > 0
          ? `Synced records. Preserved ${archivedConflictCount} prior cloud version(s).`
          : "Synced approved records. Tournament settings and draw data were not changed."
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Data-entry sync failed.";
      setCloudSyncState("error");
      setCloudSyncMessage(message);
      throw error;
    }
  };

  const uploadToCloud = async () => {
    if (!db) {
      const message = "Cloud sync is unavailable because Firebase is not configured.";
      setCloudSyncState("error");
      setCloudSyncMessage(message);
      throw new Error(message);
    }
    if (!user) {
      const message = "Sign in before uploading this tournament to the cloud.";
      setCloudSyncState("error");
      setCloudSyncMessage(message);
      throw new Error(message);
    }
    if (!tournament || !isOwnerOrAdmin) {
      const message = "You do not have permission to upload this tournament.";
      setCloudSyncState("error");
      setCloudSyncMessage(message);
      throw new Error(message);
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const message = "You are offline. Your changes are saved on this device; try uploading when connected.";
      setCloudSyncState("error");
      setCloudSyncMessage(message);
      throw new Error(message);
    }

    setCloudSyncState("syncing");
    setCloudSyncMessage("Uploading this device's tournament records…");
    // Set once records start being written: an error after that leaves the cloud partly updated.
    let recordsSent = false;
    try {
      // Live writes go first, so the upload's stale-version checks and the publish see them.
      await flushLiveWrites();
      const localCollections = getLocalCollections();
      const deletions = readSyncTombstones();
      const overwrites = readSyncIds("syncOverwrites");
      // Runs after the records are sent, also when the upload stops part-way, so the sync
      // versions of the records that were written are kept on this device.
      const saveSyncedRecords = (
        syncedTournament: Tournament,
        syncedCollections: Record<(typeof CLOUD_COLLECTIONS)[number], CloudRecord[]>,
        syncedBaseline: SyncBaseline
      ) => {
        recordsSent = true;
        suspendLive();
        setTournament({ ...syncedTournament });
        persistLocal("meta", { ...syncedTournament });
        const persistSyncedCollection = <T,>(
          collectionName: (typeof CLOUD_COLLECTIONS)[number],
          localName: string,
          setter: (items: T[]) => void
        ) => {
          const items = syncedCollections[collectionName] as unknown as T[];
          setter([...items]);
          persistLocal(localName, items);
        };
        persistSyncedCollection<Round>("rounds", "rounds", setRounds);
        persistSyncedCollection<Team>("teams", "teams", setTeams);
        persistSyncedCollection<Adjudicator>("adjudicators", "adjudicators", setAdjudicators);
        persistSyncedCollection<Venue>("venues", "venues", setVenues);
        persistSyncedCollection<Motion>("motions", "motions", setMotions);
        persistSyncedCollection<BreakCategory>("breakCategories", "breaks", setBreakCategories);
        persistSyncedCollection<Debate>("debates", "debates", setDebates);
        persistSyncedCollection<BallotSubmission>("ballots", "ballots", setBallots);
        persistSyncedCollection<FeedbackSubmission>("feedback", "feedback", setFeedback);
        persistSyncedCollection<Institution>("institutions", "institutions", setInstitutions);
        persistSyncedCollection<BallotIntakeRecord>("ballotIntake", "ballotIntake", setBallotIntake);
        persistLocal("auditEvents", syncedCollections.auditEvents);
        saveSyncState(syncedBaseline);
        resumeLive();
      };
      const archivedConflictCount = await uploadTournamentCommand({
        tournament,
        userId: user.uid,
        isGlobalAdmin,
        localCollections,
        baseline: readSyncBaseline(),
        deletions,
        overwrites,
        repository: createFirestoreTournamentRepository(),
        saveSyncedRecords,
      });
      clearSyncedTombstones(deletions);
      clearSyncIds("syncOverwrites", overwrites);
      const syncSummary =
        archivedConflictCount > 0
          ? `Uploaded, but ${archivedConflictCount} record(s) conflicted with newer cloud versions and were not written (the cloud versions are archived for recovery).`
          : `Uploaded at ${new Date().toLocaleTimeString()}.`;
      saveUploadIssue(
        archivedConflictCount > 0
          ? { kind: "conflicts", count: archivedConflictCount, at: new Date().toISOString() }
          : null
      );
      const outcome: UploadOutcome = { conflicts: archivedConflictCount, publish: "refused" };
      let publishSummary: string;
      const publishBlocker = publishBlockerAfterUpload(archivedConflictCount);
      if (publishBlocker) {
        // Publishing now would show the public a mix of this device's changes and older versions.
        outcome.publishError = publishBlocker;
        publishSummary = ` ${publishBlocker}`;
      } else {
        setCloudSyncMessage("Uploaded. Publishing public pages…");
        try {
          const published = await publishPublicViewCommand({
            tournament,
            collections: localCollections,
            idToken: await user.getIdToken(),
          });
          outcome.publish = published.status;
          publishSummary = published.status === "published"
            ? " Public pages updated."
            : " Public pages already up to date.";
        } catch (publishError) {
          // The upload itself succeeded; public pages keep serving the previous published view.
          outcome.publish = "failed";
          outcome.publishError = `Public pages were not updated: ${
            publishError instanceof Error ? publishError.message : "publish failed"
          }. Use Republish public pages to retry.`;
          publishSummary = ` ${outcome.publishError}`;
        }
      }
      // Opted-in draw / results emails go out once their release is in the cloud copy.
      let notificationSummary = "";
      if (hasAutomaticRoundNotifications(tournament.preferences)) {
        try {
          notificationSummary = describeNotificationSummary(
            await sendDueNotificationsCommand({ tournamentId: tournament.id, idToken: await user.getIdToken() })
          );
        } catch (notificationError) {
          notificationSummary = ` Notifications were not sent: ${
            notificationError instanceof Error ? notificationError.message : "notification failed"
          }`;
        }
      }
      setCloudSyncState(outcome.publish === "published" || outcome.publish === "unchanged" ? "success" : "error");
      setCloudSyncMessage(syncSummary + publishSummary + notificationSummary);
      return outcome;
    } catch (error) {
      const reason = (error instanceof Error ? error.message : "Cloud upload failed.").replace(/\.?$/, ".");
      if (recordsSent) {
        saveUploadIssue({ kind: "partial", message: reason, at: new Date().toISOString() });
      }
      const message = recordsSent
        ? `Upload stopped part-way: ${reason} Public pages were not updated. Upload again to finish.`
        : `Upload failed: ${reason} Nothing was changed in the cloud.`;
      setCloudSyncState("error");
      setCloudSyncMessage(message);
      throw new Error(message);
    }
  };

  const publishPublicView = async (
    force = false,
    options: { publishWithPendingChanges?: boolean } = {}
  ) => {
    if (!user || !tournament || !isOwnerOrAdmin) {
      throw new Error("Sign in as a tournament administrator to publish public pages.");
    }
    const plan = planRepublish({ pendingTotal: pendingChanges.total, uploadIssue });
    const refusal =
      plan.kind === "blocked"
        ? plan.reason
        : plan.kind === "confirm-pending" && !options.publishWithPendingChanges
          ? `${plan.pendingTotal} change(s) on this device are not uploaded, so publishing would show the public an older version. Upload first.`
          : "";
    if (refusal) {
      setCloudSyncState("error");
      setCloudSyncMessage(refusal);
      throw new Error(refusal);
    }
    setCloudSyncState("syncing");
    setCloudSyncMessage("Publishing public pages from the cloud copy…");
    try {
      await flushLiveWrites();
      const published = await publishPublicViewCommand({
        tournament,
        collections: getLocalCollections(),
        idToken: await user.getIdToken(),
        force,
      });
      setCloudSyncState("success");
      setCloudSyncMessage(
        published.status === "published"
          ? `Public pages updated at ${new Date().toLocaleTimeString()}.`
          : "Public pages are already up to date."
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not publish public pages.";
      setCloudSyncState("error");
      setCloudSyncMessage(message);
      throw error;
    }
  };

  const downloadFromCloud = async () => {
    if (!db || !user || !tournament || !isOwnerOrAdmin) {
      throw new Error("Sign in as a tournament administrator to download cloud data.");
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("You are offline. Connect to the internet before downloading.");
    }

    setCloudSyncState("syncing");
    setCloudSyncMessage("Merging Firestore records with this device's local data…");
    try {
      const {
        tournament: cloudTournament,
        collections,
        baseline,
        divergedRecords: diverged,
      } = await downloadTournamentCommand({
        tournamentId: tournament.id,
        slug: tournament.slug,
        userId: user.uid,
        isGlobalAdmin,
        localTournament: tournament,
        localCollections: getLocalCollections(),
        baseline: readSyncBaseline(),
        deletions: readSyncTombstones(),
        overwrites: readSyncIds("syncOverwrites"),
        repository: createFirestoreTournamentRepository(),
      });
      const downloadedRounds = collections.rounds as unknown as Round[];

      suspendLive();
      setTournament(cloudTournament);
      persistLocal("meta", cloudTournament);
      setRounds(downloadedRounds);
      persistLocal("rounds", downloadedRounds);
      setActiveRound(downloadedRounds.find((round) => !round.cancelled) || null);
      const applyDownloadedCollection = <T,>(
        cloudName: (typeof CLOUD_COLLECTIONS)[number],
        localName: string,
        setValue: (items: T[]) => void
      ) => {
        const items = collections[cloudName] as T[];
        setValue(items);
        persistLocal(localName, items);
      };
      applyDownloadedCollection<Team>("teams", "teams", setTeams);
      applyDownloadedCollection<Adjudicator>("adjudicators", "adjudicators", setAdjudicators);
      applyDownloadedCollection<Venue>("venues", "venues", setVenues);
      applyDownloadedCollection<Motion>("motions", "motions", setMotions);
      applyDownloadedCollection<BreakCategory>("breakCategories", "breaks", setBreakCategories);
      applyDownloadedCollection<Debate>("debates", "debates", setDebates);
      applyDownloadedCollection<BallotSubmission>("ballots", "ballots", setBallots);
      applyDownloadedCollection<FeedbackSubmission>("feedback", "feedback", setFeedback);
      applyDownloadedCollection<Institution>("institutions", "institutions", setInstitutions);
      applyDownloadedCollection<BallotIntakeRecord>("ballotIntake", "ballotIntake", setBallotIntake);
      applyDownloadedCollection<AuditEvent>("auditEvents", "auditEvents", (events) => {
        auditEventsRef.current = events;
        setAuditEvents(events);
      });
      saveSyncState(baseline, diverged);
      resumeLive();
      // Records an upload could not write are now either the cloud version or diverged records
      // awaiting a choice, so the conflict notice is replaced by those. A part-way upload still
      // needs another upload.
      if (uploadIssue?.kind === "conflicts") saveUploadIssue(null);
      setCloudSyncState("success");
      setCloudSyncMessage(
        diverged.length > 0
          ? `Downloaded cloud changes. ${diverged.length} record(s) changed both here and in the cloud; this device's version was kept until you choose one.`
          : `Downloaded cloud changes at ${new Date().toLocaleTimeString()}. Unuploaded changes on this device were kept.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cloud download failed.";
      setCloudSyncState("error");
      setCloudSyncMessage(message);
      throw error;
    }
  };

  const exportSyncRecovery = async () => {
    if (!db || !user || !tournament || !isOwnerOrAdmin) {
      throw new Error("Sign in as a tournament administrator to export recovery data.");
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("Connect to the internet before exporting cloud recovery data.");
    }

    setCloudSyncState("syncing");
    setCloudSyncMessage("Preparing archived cloud versions for export…");
    try {
      const conflicts = await createFirestoreTournamentRepository().getSyncConflicts(tournament.id);
      const backup = {
        format: "crabbytab-sync-recovery-v1",
        tournamentId: tournament.id,
        tournamentSlug: tournament.slug,
        exportedAt: new Date().toISOString(),
        conflicts,
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${tournament.slug.replace(/[^a-z0-9-]/gi, "-")}-sync-recovery.json`;
      link.click();
      URL.revokeObjectURL(url);
      setCloudSyncState("success");
      setCloudSyncMessage(`Exported ${conflicts.length} archived version(s) for recovery.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not export sync recovery data.";
      setCloudSyncState("error");
      setCloudSyncMessage(message);
      throw error;
    }
  };

  const exportTournamentBackup = (fileSuffix?: string) => {
    if (!tournament || !isOwnerOrAdmin) {
      throw new Error("Only a tournament administrator can export a full backup.");
    }
    const backup = createTournamentBackup({ tournament, collections: getLocalCollections() });
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${tournament.slug}-${fileSuffix ? `${fileSuffix}-` : ""}backup.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportTournamentArchive = () => {
    if (!tournament || !isOwnerOrAdmin) {
      throw new Error("Only a tournament administrator can export a DebateXML archive.");
    }
    const archive = createDebateXmlArchive({
      tournament,
      rounds,
      teams,
      adjudicators,
      venues,
      motions,
      breakCategories,
      debates,
      ballots,
      feedback,
      institutions,
    });
    const blob = new Blob([archive], { type: "application/xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${tournament.slug}-archive.xml`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const BACKUP_MAX_BYTES = 50 * 1024 * 1024;

  const readBackupFile = async (file: File): Promise<unknown> => {
    if (file.size > BACKUP_MAX_BYTES) throw new Error("The backup file is larger than 50 MB.");
    try {
      return JSON.parse(await file.text()) as unknown;
    } catch {
      throw new Error("The backup file is not valid JSON.");
    }
  };

  const applyCollectionsLocally = (
    restoredTournament: Tournament,
    collections: BackupCollections,
    keepActiveRoundId?: string
  ) => {
    const roundsValue = collections.rounds as unknown as Round[];
    suspendLive();
    setTournament(restoredTournament);
    persistLocal("meta", restoredTournament);
    setRounds(roundsValue);
    persistLocal("rounds", roundsValue);
    setActiveRound(
      roundsValue.find((round) => round.id === keepActiveRoundId && !round.cancelled) ||
      roundsValue.find((round) => !round.cancelled) ||
      null
    );
    const apply = <T,>(name: (typeof CLOUD_COLLECTIONS)[number], localKey: string, setter: (items: T[]) => void) => {
      const items = collections[name] as unknown as T[];
      setter(items);
      persistLocal(localKey, items);
    };
    apply<Team>("teams", "teams", setTeams);
    apply<Adjudicator>("adjudicators", "adjudicators", setAdjudicators);
    apply<Venue>("venues", "venues", setVenues);
    apply<Motion>("motions", "motions", setMotions);
    apply<BreakCategory>("breakCategories", "breaks", setBreakCategories);
    apply<Debate>("debates", "debates", setDebates);
    apply<BallotSubmission>("ballots", "ballots", setBallots);
    apply<FeedbackSubmission>("feedback", "feedback", setFeedback);
    apply<Institution>("institutions", "institutions", setInstitutions);
    apply<BallotIntakeRecord>("ballotIntake", "ballotIntake", setBallotIntake);
    apply<AuditEvent>("auditEvents", "auditEvents", (events) => {
      auditEventsRef.current = events;
      setAuditEvents(events);
    });
    resumeLive();
  };

  const resolveDiverged = (keep: "cloud" | "local", keys?: string[]) => {
    if (!tournament || !(isOwnerOrAdmin || isDataEntryAssistant)) {
      throw new Error("Only tournament staff can resolve sync conflicts.");
    }
    const resolved = resolveDivergedRecords({
      localTournament: tournament,
      localCollections: getLocalCollections(),
      baseline: readSyncBaseline(),
      divergedRecords,
      keys,
      keep,
    });
    const count = divergedRecords.length - resolved.remaining.length;
    if (count === 0) return;
    applyCollectionsLocally(resolved.tournament, resolved.collections, activeRound?.id);
    saveSyncState(resolved.baseline, resolved.remaining);
    setCloudSyncState("success");
    setCloudSyncMessage(
      keep === "cloud"
        ? `Used the cloud version of ${count} record(s).`
        : `Kept this device's version of ${count} record(s). Upload to replace the cloud versions; they are archived for recovery.`
    );
  };

  const importTournamentBackup = async (file: File) => {
    if (!tournament || !isOwnerOrAdmin) {
      throw new Error("Only a tournament administrator can restore a full backup.");
    }
    const parsed = parseTournamentBackup(await readBackupFile(file), tournament.id);
    const collections = mergeTournamentBackup({ current: getLocalCollections(), backup: parsed.collections });
    const restoredTournament = { ...parsed.tournament, ...tournament, id: tournament.id, slug: tournament.slug };
    applyCollectionsLocally(restoredTournament, collections);
    setCloudSyncState("success");
    setCloudSyncMessage("Backup merged. Existing local records were preserved where IDs matched.");
  };

  const previewTournamentBackup = async (file: File) => {
    if (!tournament || !isOwnerOrAdmin) {
      throw new Error("Only a tournament administrator can restore a full backup.");
    }
    const validation = validateTournamentBackup(await readBackupFile(file), tournament.id);
    return {
      validation,
      ...(validation.backup
        ? { diff: diffTournamentBackup({ currentTournament: tournament, current: getLocalCollections(), backup: validation.backup }) }
        : {}),
    };
  };

  const replaceTournamentWithBackup = async (file: File) => {
    if (!tournament || !isOwnerOrAdmin) {
      throw new Error("Only a tournament administrator can restore a full backup.");
    }
    const backup = parseTournamentBackup(await readBackupFile(file), tournament.id);
    // Keep a copy of what is about to be replaced before touching anything.
    exportTournamentBackup("pre-restore");
    const plan = planTournamentBackupReplace({ currentTournament: tournament, current: getLocalCollections(), backup });
    applyCollectionsLocally(plan.tournament, plan.collections);
    // Removed records must also be deleted from the cloud copy on the next upload, and
    // restored records must not be deleted by an older pending deletion; they overwrite the cloud
    // copy even where it is newer or deleted.
    clearSyncedTombstones(plan.restoredIds);
    recordSyncTombstones(plan.removedIds);
    recordSyncIds("syncOverwrites", plan.restoredIds);
    await recordAuditEvent({
      action: "backup.replaced",
      category: "tournament",
      summary: `Tournament data replaced with the backup exported ${backup.exportedAt}.`,
    });
    setCloudSyncState("success");
    setCloudSyncMessage("Tournament data replaced with the backup. A pre-restore backup was downloaded. Upload to update the cloud copy.");
  };

  return (
    <TournamentContext.Provider
      value={{
        tournament,
        loading,
        cloudLoadError,
        rounds: rounds.filter((round) => !round.cancelled),
        activeRound,
        setActiveRound,
        teams,
        adjudicators,
        institutions,
        venues,
        motions,
        breakCategories,
        debates,
        ballots,
        feedback,
        auditEvents,
        ballotIntake,
        teamStandings,
        speakerStandings,
        replyStandings,
        breakResults,
        isOwnerOrAdmin,
          isDataEntryAssistant,
        staffPermissions,
        staffAccessLoading,
          staffAccessError,
        cloudSyncState,
        cloudSyncMessage,
        privateSyncState,
        privateSyncMessage,
        localSaveError,
        publicRoundsLoading,
        publicExtras,
        computeJob,
        cancelCompute,
        uploadToCloud,
        publishPublicView,
        pendingChanges,
        uploadIssue,
        liveSync,
        liveSyncEnabled,
        setLiveSyncEnabled,
        ballotConfirmationConflicts,
        downloadFromCloud,
        syncDataEntry,
        exportSyncRecovery,
        divergedRecords,
        divergedRecordSummaries,
        resolveDivergedRecords: resolveDiverged,
        exportTournamentBackup,
        exportTournamentArchive,
        importTournamentBackup,
        previewTournamentBackup,
        replaceTournamentWithBackup,
        syncPrivatePortal,
        loadPrivateTeamPortal,
        privateSelfCheckIn,
        saveTournament,
        createRound,
        setPreliminaryRoundCount,
        deleteRound,
        updateRound,
        generateDraw,
        autoAllocate,
        updateDebate,
        updateDebates,
        submitBallot,
        confirmBallot,
        discardBallot,
        addInstitution,
        addInstitutions,
        saveEntityBatch,
        updateInstitution,
        deleteInstitution,
        addTeam,
        addTeams,
        updateTeam,
        deleteTeam,
        addAdjudicator,
        addAdjudicators,
        updateAdjudicator,
        updateAdjudicators,
        updateAdjudicatorScores,
        deleteAdjudicator,
        addVenue,
        addVenues,
        updateVenue,
        deleteVenue,
        addMotion,
        addMotions,
        updateMotion,
        deleteMotion,
        saveBreakCategories,
        generateBreak,
        proceedToNextEliminationRound,
        addFeedback,
        reviewFeedback,
        simulateRoundResults,
        simulateRoundFeedback,
        recordBallotIntake,
        recordAuditEvent,
        releaseAuditLog,
        generatePrivateUrlKeys,
      }}
    >
      {children}
    </TournamentContext.Provider>
  );
}

export function useTournament() {
  const context = useContext(TournamentContext);
  if (!context) {
    throw new Error("useTournament must be used within a TournamentProvider");
  }
  return context;
}

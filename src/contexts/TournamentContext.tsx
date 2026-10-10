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
  TeamStandingRow,
  SpeakerStandingRow,
  Institution,
} from "@/types";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { generateRoundDraw } from "@/lib/draw/generator";
import { calculateStandings } from "@/lib/standings/calculator";
import { calculateBreaks, BreakCategoryResult } from "@/lib/breakqual/calculator";
import {
  buildDataEntrySyncPayload,
  downloadTournamentCommand,
  uploadTournamentCommand,
  type CloudRecord,
} from "@/features/tournament/application/cloudSync";
import { safeJsonParse } from "@/lib/safeJson";
import { generatePrivateKey } from "@/lib/privateUrls";
import { createRoundCommand, updateRoundCommand } from "@/features/tournament/application/rounds";
import { createEntityId, createTournamentEntityCommands } from "@/features/tournament/application/entities";
import { confirmBallotCommand, submitBallotCommand } from "@/features/tournament/application/ballots";
import { generateDrawCommand } from "@/features/tournament/application/draws";
import { saveTournamentCommand } from "@/features/tournament/application/settings";
import { addFeedbackCommand } from "@/features/tournament/application/feedback";
import { autoAllocateCommand, updateDebateCommand, updateDebatesCommand } from "@/features/tournament/application/allocation";
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
  mergeTournamentBackup,
  parseTournamentBackup,
} from "@/features/tournament/application/tournamentBackup";
import { createFirestoreRoundRepository } from "@/features/tournament/infrastructure/roundRepository";
import { createFirestoreEntityRepository } from "@/features/tournament/infrastructure/entityRepository";
import { createFirestoreDrawRepository } from "@/features/tournament/infrastructure/drawRepository";
import { createFirestoreBreakRepository } from "@/features/tournament/infrastructure/breakRepository";
import { createFirestoreTournamentRepository } from "@/features/tournament/infrastructure/tournamentRepository";
import { createFirestoreAuditRepository } from "@/features/tournament/infrastructure/auditRepository";
import { sanitizeAssistantAdjudicator, sanitizeAssistantTeam } from "@/lib/tournamentAccess";

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
  teamStandings: TeamStandingRow[];
  speakerStandings: SpeakerStandingRow[];
  replyStandings: SpeakerStandingRow[];
  breakResults: BreakCategoryResult[];
  isOwnerOrAdmin: boolean;
    isDataEntryAssistant: boolean;
  staffAccessLoading: boolean;
  staffAccessError: string;
  cloudSyncState: "idle" | "syncing" | "success" | "error";
  cloudSyncMessage: string;
  privateSyncState: "idle" | "syncing" | "error";
  privateSyncMessage: string;
  localSaveError: string;
  uploadToCloud: () => Promise<void>;
  downloadFromCloud: () => Promise<void>;
  syncDataEntry: () => Promise<void>;
  exportSyncRecovery: () => Promise<void>;
  exportTournamentBackup: () => void;
  importTournamentBackup: (file: File) => Promise<void>;
  syncPrivatePortal: (privateUrlKey: string, passcode: string) => Promise<void>;
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
  generateDraw: (roundId: string) => Promise<void>;
  autoAllocate: (roundId: string, panelSize?: number) => Promise<void>;
  updateDebate: (debate: Debate) => Promise<void>;
  updateDebates: (debates: Debate[]) => Promise<void>;
  submitBallot: (ballot: BallotSubmission, privatePasscode?: string) => Promise<void>;
  confirmBallot: (ballotId: string, debateId: string, submittedBallot?: BallotSubmission) => Promise<void>;
  addInstitution: (inst: Omit<Institution, "id" | "tournamentId">) => Promise<void>;
  addInstitutions: (institutions: Omit<Institution, "id" | "tournamentId">[]) => Promise<void>;
  updateInstitution: (inst: Institution) => Promise<void>;
  deleteInstitution: (instId: string) => Promise<void>;
  addTeam: (team: Omit<Team, "id" | "tournamentId">) => Promise<void>;
  addTeams: (teams: Omit<Team, "id" | "tournamentId">[]) => Promise<void>;
  updateTeam: (team: Team, privatePasscode?: string) => Promise<void>;
  deleteTeam: (teamId: string) => Promise<void>;
  addAdjudicator: (adj: Omit<Adjudicator, "id" | "tournamentId">) => Promise<void>;
  addAdjudicators: (adjudicators: Omit<Adjudicator, "id" | "tournamentId">[]) => Promise<void>;
  updateAdjudicator: (adj: Adjudicator, privatePasscode?: string) => Promise<void>;
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
const TournamentContext = createContext<TournamentContextType | undefined>(undefined);

const AUTOMATIC_CLOUD_WRITES = false;

export function TournamentProvider({
  tournamentSlug,
  children,
}: {
  tournamentSlug: string;
  children: React.ReactNode;
}) {
  const { user, isGlobalAdmin } = useAuth();
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
  const [cloudSyncState, setCloudSyncState] = useState<"idle" | "syncing" | "success" | "error">("idle");
  const [cloudSyncMessage, setCloudSyncMessage] = useState("");
  const [privateSyncState, setPrivateSyncState] = useState<"idle" | "syncing" | "error">("idle");
  const [privateSyncMessage, setPrivateSyncMessage] = useState("");
  const [localSaveError, setLocalSaveError] = useState("");
  const [cloudStaffRole, setCloudStaffRole] = useState<"admin" | "dataEntry" | "none" | null>(null);
  const [staffAccessError, setStaffAccessError] = useState("");

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
        localStorage.setItem(`${storagePrefix}_${key}`, JSON.stringify(data));
      } catch (e) {
        const message = e instanceof Error ? e.message : "Local storage is unavailable.";
        setLocalSaveError(`Could not save ${key} locally: ${message}`);
        console.error(`Local storage save failed for ${key}:`, e);
      }
    },
    [storagePrefix]
  );

  const saveRoundsLocally = useCallback(
    (updatedRounds: Round[], nextActiveRound?: Round) => {
      setRounds(updatedRounds);
      if (nextActiveRound) setActiveRound(nextActiveRound);
      persistLocal("rounds", updatedRounds);
    },
    [persistLocal]
  );

  // Local storage is the working copy. Shared links fall back to the published cloud copy.
  useEffect(() => {
    let isMounted = true;
    async function loadLocalData() {
      setLoading(true);
      setCloudLoadError("");
      auditEventsRef.current = [];
      setAuditEvents([]);
      try {
        if (typeof window === "undefined" || !isMounted) return;
        const readLocal = <T,>(key: string, fallback: T): T =>
          safeJsonParse<T>(localStorage.getItem(`${storagePrefix}_${key}`), fallback);
        let localTournament = readLocal<Tournament | null>("meta", null);
        const isSharedView =
          pathname?.includes("/public") ||
          pathname?.includes("/private/") ||
          (!localTournament && !user);
        const loadPublicProjection = async () => {
          const response = await fetch(`/api/public/tournaments/${encodeURIComponent(tournamentSlug)}`);
          const result = await response.json() as {
            error?: string;
            tournament: Tournament;
            collections: Record<string, unknown[]>;
          };
          if (!response.ok) {
            throw new Error(
              typeof result.error === "string"
                ? result.error
                : "Could not load public tournament data."
            );
          }
          if (!isMounted) return;
          const publicRounds = (result.collections.rounds || []) as Round[];
          setTournament(result.tournament);
          setRounds(publicRounds);
          setActiveRound(
            [...publicRounds]
              .filter((round) => !round.cancelled)
              .sort((a, b) => b.seq - a.seq)[0] || null
          );
          setTeams((result.collections.teams || []) as Team[]);
          setAdjudicators((result.collections.adjudicators || []) as Adjudicator[]);
          setVenues((result.collections.venues || []) as Venue[]);
          setMotions((result.collections.motions || []) as Motion[]);
          setBreakCategories((result.collections.breakCategories || []) as BreakCategory[]);
          setDebates((result.collections.debates || []) as Debate[]);
          setBallots((result.collections.ballots || []) as BallotSubmission[]);
          setFeedback((result.collections.feedback || []) as FeedbackSubmission[]);
          setInstitutions((result.collections.institutions || []) as Institution[]);
          auditEventsRef.current = [];
          setAuditEvents([]);
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
          };
          const mergedCollections = Object.fromEntries(CLOUD_COLLECTIONS.map((name) => {
            const recordsById = new Map((result.collections[name] || []).map((record) => [record.id, record]));
            for (const record of readLocal<CloudRecord[]>(localKeys[name], [])) recordsById.set(record.id, record);
            return [name, [...recordsById.values()]];
          })) as Record<(typeof CLOUD_COLLECTIONS)[number], CloudRecord[]>;
          mergedCollections.teams = mergedCollections.teams.map((record) => {
            return sanitizeAssistantTeam(record as unknown as Team) as unknown as CloudRecord;
          });
          mergedCollections.adjudicators = mergedCollections.adjudicators.map((record) => {
            return sanitizeAssistantAdjudicator(record as unknown as Adjudicator) as unknown as CloudRecord;
          });
          mergedCollections.auditEvents = [];
          return { tournament: result.tournament, collections: mergedCollections };
        };

        if ((!localTournament || isSharedView) && db) {
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
              let cloudCollections: Record<(typeof CLOUD_COLLECTIONS)[number], CloudRecord[]>;
              if (isAssistant) {
                const projection = await loadAssistantProjection(cloudTournamentDoc.id);
                localTournament = projection.tournament;
                cloudCollections = projection.collections;
              } else {
                localTournament = {
                  ...data,
                  id: cloudTournamentDoc.id,
                  slug: typeof data.slug === "string" ? data.slug : tournamentSlug,
                } as Tournament;
                cloudCollections = await repository.getCollections(cloudTournamentDoc.id);
              }
              if (!isMounted) return;

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
              };
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
              storeCloudCollection<AuditEvent>("auditEvents", (events) => {
                auditEventsRef.current = events;
                setAuditEvents(events);
              });
              setLoading(false);
              return;
            }
          } catch (error) {
            if (!isSharedView) {
              try {
                await loadPublicProjection();
                return;
              } catch (projectionError) {
                console.error("Could not load the public tournament projection:", projectionError);
              }
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
      } catch (e) {
        const message = e instanceof Error ? e.message : "Could not read tournament data.";
        console.error("Error reading tournament data:", e);
        if (pathname?.includes("/public") || pathname?.includes("/private/")) {
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
  }, [tournamentSlug, storagePrefix, persistLocal, pathname, user]);

  const syncPrivatePortal: TournamentContextType["syncPrivatePortal"] = async (
    privateUrlKey,
    passcode
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
        typeof window === "undefined" ? null : localStorage.getItem(privateQueueKey),
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
      typeof window === "undefined" ? null : localStorage.getItem(privateQueueKey),
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
  const isOwnerOrAdmin = useMemo(() => {
    if (!tournament) return false;
    if (isGlobalAdmin) return true;
    if (user && (tournament.ownerId === user.uid || tournament.admins?.[user.uid] === true)) return true;
    if (
      (tournament.ownerId === "local" || tournament.ownerId === "director") &&
      cloudStaffRole !== "dataEntry"
    ) return true;
    if (user && db) return cloudStaffRole === "admin";
    return false;
  }, [tournament, user, isGlobalAdmin, cloudStaffRole]);
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
        };
        if (!response.ok) {
          throw new Error(result.error || `Access verification failed (${response.status}).`);
        }
        if (active && result.role === "dataEntry" && typeof window !== "undefined") {
          const safeTeams = safeJsonParse<Team[]>(localStorage.getItem(`${storagePrefix}_teams`), [])
            .map(sanitizeAssistantTeam);
          const safeAdjudicators = safeJsonParse<Adjudicator[]>(localStorage.getItem(`${storagePrefix}_adjudicators`), [])
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
          setCloudStaffRole(result.role === "admin" || result.role === "dataEntry" ? result.role : "none");
          setStaffAccessError(
            result.role === "admin" || result.role === "dataEntry"
              ? ""
              : "This account is not listed as a tournament owner, administrator, or data-entry assistant."
          );
        }
      } catch (error) {
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
  }, [pathname, persistLocal, storagePrefix, tournament?.id, user]);
  const isDataEntryAssistant = !isGlobalAdmin && cloudStaffRole === "dataEntry";
  const staffAccessLoading = Boolean(user && db && cloudStaffRole === null);

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
      await createFirestoreAuditRepository(tournament.id).append(event);
    }
  };

  const entityCommands = createTournamentEntityCommands({
    tournamentId: tournament?.id || tournamentSlug,
    institutions,
    teams,
    adjudicators,
    venues,
    motions,
    repositories: {
      institutions: {
        save: (items) => {
          setInstitutions(items);
          persistLocal("institutions", items);
        },
      },
      teams: {
        save: (items) => {
          const savedItems = isDataEntryAssistant ? items.map(sanitizeAssistantTeam) : items;
          setTeams(savedItems);
          persistLocal("teams", savedItems);
        },
      },
      adjudicators: {
        save: (items) => {
          const savedItems = isDataEntryAssistant ? items.map(sanitizeAssistantAdjudicator) : items;
          setAdjudicators(savedItems);
          persistLocal("adjudicators", savedItems);
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
    cloudRepository:
      AUTOMATIC_CLOUD_WRITES && db && tournament?.id
        ? createFirestoreEntityRepository(tournament.id)
        : undefined,
  });

  const {
    addInstitutions: addInstitutionsCommand,
    updateInstitution: updateInstitutionCommand,
    deleteInstitution: deleteInstitutionCommand,
    addTeams: addTeamsCommand,
    updateTeam: updateTeamCommand,
    deleteTeam: deleteTeamCommand,
    addAdjudicators: addAdjudicatorsCommand,
    updateAdjudicator: updateAdjudicatorCommand,
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
  const breakResults = useMemo(() => {
    if (breakCategories.length === 0 || teamStandings.length === 0) return [];
    return calculateBreaks(breakCategories, teams, teamStandings);
  }, [breakCategories, teams, teamStandings]);

  // Mutations
  const saveTournament = async (t: Tournament) => {
    await saveTournamentCommand(t, tournament, {
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
    });
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
    await updateRoundCommand(round, rounds, activeRound, {
      localRepository: { saveRounds: saveRoundsLocally },
      recordAuditEvent,
      cloudRepository,
    });
  };

  const ballotWorkflowDependencies = {
    ballots,
    rounds,
    debates,
    adjudicators,
    repository: {
      saveBallots: (items: BallotSubmission[]) => {
        setBallots(items);
        persistLocal("ballots", items);
      },
      saveDebates: (items: Debate[]) => {
        setDebates(items);
        persistLocal("debates", items);
      },
    },
    updateRound,
    recordAuditEvent,
    queuePrivateRecord,
  };
  const allocationDependencies = {
    tournament,
    rounds,
    teams,
    debates,
    adjudicators,
    standings: teamStandings,
    breakCategories,
    feedback,
    venues,
    repository: {
      saveDebates: (items: Debate[]) => {
        setDebates(items);
        persistLocal("debates", items);
      },
    },
    cloudRepository:
      AUTOMATIC_CLOUD_WRITES && db && tournament?.id
        ? createFirestoreDrawRepository(tournament.id)
        : undefined,
    hideRevealedAdjudicators,
    recordAuditEvent,
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
      saveTeams: (items: Team[]) => {
        setTeams(items);
        persistLocal("teams", items);
      },
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
    await setPreliminaryRoundCountCommand(count, {
      rounds,
      debates,
      tournamentId: tournament?.id || tournamentSlug,
      drawRule: tournament?.preferences?.drawRule || "power_paired",
      localRepository: {
        saveRounds: (items) => {
          setRounds(items);
          persistLocal("rounds", items);
        },
        saveDebates: (items) => {
          setDebates(items);
          persistLocal("debates", items);
        },
        setActiveRound,
      },
      cloudRepository:
        AUTOMATIC_CLOUD_WRITES && db && tournament?.id
          ? createFirestoreRoundRepository(tournament.id)
          : undefined,
      recordAuditEvent,
    });
  };

  const deleteRound = async (roundId: string) => {
    await deleteRoundCommand({
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
        saveDebates: (items) => {
          setDebates(items);
          persistLocal("debates", items);
        },
        saveBallots: (items) => {
          setBallots(items);
          persistLocal("ballots", items);
        },
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
    });
  };

  const generateDraw = async (roundId: string) => {
    await generateDrawCommand(roundId, {
      tournament,
      rounds,
      teams,
      venues,
      debates,
      motions,
      standings: teamStandings,
      generateRoundDraw,
      localRepository: {
        saveDebates: (items) => {
          setDebates(items);
          persistLocal("debates", items);
        },
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
    });
  };

  const autoAllocate = async (roundId: string, panelSize: number = 1) => {
    await autoAllocateCommand(roundId, panelSize, allocationDependencies);
  };

  const updateDebate = async (debate: Debate) => {
    await updateDebateCommand(debate, debates, allocationDependencies);
  };

  const updateDebates = async (newDebates: Debate[]) => {
    await updateDebatesCommand(newDebates, debates, {
      repository: allocationDependencies.repository,
      cloudRepository: allocationDependencies.cloudRepository,
      hideRevealedAdjudicators,
      recordAuditEvent,
    });
  };

  const submitBallot = async (ballot: BallotSubmission, privatePasscode?: string) => {
    await submitBallotCommand(ballot, privatePasscode, ballotWorkflowDependencies);
  };

  const confirmBallot = async (
    ballotId: string,
    debateId: string,
    submittedBallot?: BallotSubmission
  ) => {
    await confirmBallotCommand(ballotId, debateId, submittedBallot, ballotWorkflowDependencies);
  };

  const addInstitutions = async (instData: Omit<Institution, "id" | "tournamentId">[]) => {
    await addInstitutionsCommand(instData);
  };

  const addInstitution = async (instData: Omit<Institution, "id" | "tournamentId">) => {
    await addInstitutionsCommand([instData]);
  };

  const updateInstitution = async (inst: Institution) => {
    await updateInstitutionCommand(inst);
  };

  const deleteInstitution = async (instId: string) => {
    await deleteInstitutionCommand(instId);
  };

  const addTeams = async (teamData: Omit<Team, "id" | "tournamentId">[]) => {
    await addTeamsCommand(teamData);
  };

  const addTeam = async (teamData: Omit<Team, "id" | "tournamentId">) => {
    await addTeamsCommand([teamData]);
  };

  const updateTeam = async (team: Team, _privatePasscode?: string) => {
    await updateTeamCommand(team);
  };

  const deleteTeam = async (teamId: string) => {
    await deleteTeamCommand(teamId);
  };

  const addAdjudicators = async (adjData: Omit<Adjudicator, "id" | "tournamentId">[]) => {
    await addAdjudicatorsCommand(adjData);
  };

  const addAdjudicator = async (adjData: Omit<Adjudicator, "id" | "tournamentId">) => {
    await addAdjudicatorsCommand([adjData]);
  };

  const updateAdjudicator = async (adj: Adjudicator, _privatePasscode?: string) => {
    await updateAdjudicatorCommand(adj);
  };

  const deleteAdjudicator = async (adjId: string) => {
    await deleteAdjudicatorCommand(adjId);
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
  };

  const saveBreakCategories = async (cats: BreakCategory[]) => {
    await saveBreakCategoriesCommand(cats, breakDependencies);
  };

  const generateBreak = async (categoryId: string) => {
    return generateBreakCommand(categoryId, breakDependencies);
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

  const generatePrivateUrlKeys = async (forceRegenerate = false) => {
    await regeneratePrivateAccessCommand(teams, adjudicators, forceRegenerate, {
      localRepository: {
        saveTeams: (items) => {
          setTeams(items);
          persistLocal("teams", items);
        },
        saveAdjudicators: (items) => {
          setAdjudicators(items);
          persistLocal("adjudicators", items);
        },
      },
      cloudRepository:
        AUTOMATIC_CLOUD_WRITES && db && tournament?.id
          ? createFirestoreEntityRepository(tournament.id)
          : undefined,
      recordAuditEvent,
    });
  };

  const getLocalCollections = (): Record<(typeof CLOUD_COLLECTIONS)[number], CloudRecord[]> => ({
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
    auditEvents: auditEventsRef.current,
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
      const response = await fetch(
        `/api/tournaments/${encodeURIComponent(tournament.id)}/data-entry-sync`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(buildDataEntrySyncPayload({ localCollections: getLocalCollections() })),
        }
      );
      const result = await response.json() as { error?: string; archivedConflictCount?: number };
      if (!response.ok) throw new Error(result.error || "Data-entry sync failed.");
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
    setCloudSyncMessage("Merging this device's tournament records into Firestore…");
    try {
      const archivedConflictCount = await uploadTournamentCommand({
        tournament,
        userId: user.uid,
        isGlobalAdmin,
        localCollections: getLocalCollections(),
        repository: createFirestoreTournamentRepository(),
      });
      setCloudSyncState("success");
      setCloudSyncMessage(
        archivedConflictCount > 0
          ? `Merged records. Preserved ${archivedConflictCount} previous cloud version(s) for recovery.`
          : `Merged records at ${new Date().toLocaleTimeString()}. Cloud-only records were retained.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cloud upload failed.";
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
      const { tournament: cloudTournament, collections } = await downloadTournamentCommand({
        tournamentId: tournament.id,
        slug: tournament.slug,
        userId: user.uid,
        isGlobalAdmin,
        localTournament: tournament,
        localCollections: getLocalCollections(),
        repository: createFirestoreTournamentRepository(),
      });
      const downloadedRounds = collections.rounds as Round[];

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
      applyDownloadedCollection<AuditEvent>("auditEvents", "auditEvents", (events) => {
        auditEventsRef.current = events;
        setAuditEvents(events);
      });
      setCloudSyncState("success");
      setCloudSyncMessage("Merged cloud and local records. Local records and matching-ID local versions were retained.");
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

  const exportTournamentBackup = () => {
    if (!tournament || !isOwnerOrAdmin) {
      throw new Error("Only a tournament administrator can export a full backup.");
    }
    const backup = createTournamentBackup({ tournament, collections: getLocalCollections() });
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${tournament.slug}-backup.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importTournamentBackup = async (file: File) => {
    if (!tournament || !isOwnerOrAdmin) {
      throw new Error("Only a tournament administrator can restore a full backup.");
    }
    const parsed = parseTournamentBackup(JSON.parse(await file.text()) as unknown, tournament.id);
    const collections = mergeTournamentBackup({ current: getLocalCollections(), backup: parsed.collections });
    const restoredTournament = { ...parsed.tournament, ...tournament, id: tournament.id, slug: tournament.slug };
    const roundsValue = collections.rounds as unknown as Round[];
    setTournament(restoredTournament);
    persistLocal("meta", restoredTournament);
    setRounds(roundsValue);
    persistLocal("rounds", roundsValue);
    setActiveRound(roundsValue.find((round) => !round.cancelled) || null);
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
    apply<AuditEvent>("auditEvents", "auditEvents", (events) => {
      auditEventsRef.current = events;
      setAuditEvents(events);
    });
    setCloudSyncState("success");
    setCloudSyncMessage("Backup merged. Existing local records were preserved where IDs matched.");
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
        teamStandings,
        speakerStandings,
        replyStandings,
        breakResults,
        isOwnerOrAdmin,
          isDataEntryAssistant,
        staffAccessLoading,
          staffAccessError,
        cloudSyncState,
        cloudSyncMessage,
        privateSyncState,
        privateSyncMessage,
        localSaveError,
        uploadToCloud,
        downloadFromCloud,
        syncDataEntry,
        exportSyncRecovery,
        exportTournamentBackup,
        importTournamentBackup,
        syncPrivatePortal,
        loadPrivateTeamPortal,
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
        addInstitution,
        addInstitutions,
        updateInstitution,
        deleteInstitution,
        addTeam,
        addTeams,
        updateTeam,
        deleteTeam,
        addAdjudicator,
        addAdjudicators,
        updateAdjudicator,
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

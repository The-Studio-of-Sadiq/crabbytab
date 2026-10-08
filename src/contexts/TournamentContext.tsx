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
  DebateSide,
} from "@/types";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  WriteBatch,
} from "firebase/firestore";
import { generateRoundDraw, getEligibleTeamsForRound } from "@/lib/draw/generator";
import { applyEliminationAdvancement, getAdvancingTeamIds } from "@/lib/draw/elimination";
import {
  autoAllocateAdjudicators,
  buildPastAdjTeams,
  calculateAdjudicatorFeedbackScores,
  IntelligentAllocationContext,
} from "@/lib/draw/allocator";
import { calculateStandings } from "@/lib/standings/calculator";
import { applyBreakStatuses, calculateBreaks, BreakCategoryResult } from "@/lib/breakqual/calculator";
import { buildBreakCategorySchedule, eliminationRoundCount } from "@/lib/setup/presets";
import { safeJsonParse } from "@/lib/safeJson";
import { generatePrivateKey } from "@/lib/privateUrls";

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
  cloudSyncState: "idle" | "syncing" | "success" | "error";
  cloudSyncMessage: string;
  privateSyncState: "idle" | "syncing" | "error";
  privateSyncMessage: string;
  localSaveError: string;
  uploadToCloud: () => Promise<void>;
  downloadFromCloud: () => Promise<void>;
  syncPrivatePortal: (privateUrlKey: string, passcode: string) => Promise<void>;

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
  generatePrivateUrlKeys: (forceRegenerate?: boolean) => Promise<void>;
}

const TournamentContext = createContext<TournamentContextType | undefined>(undefined);

const BATCH_CHUNK_SIZE = 400;
const AUTOMATIC_CLOUD_WRITES = false;
const CLOUD_COLLECTIONS = [
  "rounds",
  "teams",
  "adjudicators",
  "venues",
  "motions",
  "breakCategories",
  "debates",
  "ballots",
  "feedback",
  "institutions",
] as const;

/**
 * Recursively removes any object keys whose value is undefined, which Firestore rejects.
 */
function cleanUndefined<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(cleanUndefined) as unknown as T;
  }
  const cleaned: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      cleaned[k] = cleanUndefined(v);
    }
  }
  return cleaned as T;
}

/**
 * Execute batch operations in chunks of at most 400 operations to respect Firestore's limit (500 max).
 */
async function commitChunkedBatches(
  operations: Array<(batch: WriteBatch) => void>
): Promise<void> {
  if (!db || operations.length === 0) return;
  for (let i = 0; i < operations.length; i += BATCH_CHUNK_SIZE) {
    const chunk = operations.slice(i, i + BATCH_CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((op) => op(batch));
    await batch.commit();
  }
}

export function TournamentProvider({
  tournamentSlug,
  children,
}: {
  tournamentSlug: string;
  children: React.ReactNode;
}) {
  const { user } = useAuth();
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
        const isSharedView = pathname?.includes("/public") || pathname?.includes("/private/");

        if ((!localTournament || isSharedView) && db) {
          try {
            const tournamentQuery = query(
              collection(db, "tournaments"),
              where("slug", "==", tournamentSlug)
            );
            const snapshot = await getDocs(tournamentQuery);
            if (!isMounted) return;

            const cloudTournamentDoc =
              snapshot.docs[0] ||
              (await getDoc(doc(db, "tournaments", `tourn-${tournamentSlug}`)));
            if (!isMounted) return;

            if (cloudTournamentDoc.exists()) {
              const data = cloudTournamentDoc.data();
              localTournament = {
                ...data,
                id: cloudTournamentDoc.id,
                slug: typeof data.slug === "string" ? data.slug : tournamentSlug,
              } as Tournament;

              const cloudCollections = Object.fromEntries(
                await Promise.all(
                  CLOUD_COLLECTIONS.map(async (name) => {
                    const collectionSnapshot = await getDocs(
                      collection(db!, "tournaments", cloudTournamentDoc.id, name)
                    );
                    return [
                      name,
                      collectionSnapshot.docs.map((item) => ({ ...item.data(), id: item.id })),
                    ];
                  })
                )
              ) as Record<(typeof CLOUD_COLLECTIONS)[number], Array<{ id: string }>>;
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
              setLoading(false);
              return;
            }
          } catch (error) {
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
            ownerId: "director",
            admins: { director: true },
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
  }, [tournamentSlug, storagePrefix, persistLocal, pathname]);

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
    if (!user) return tournament.ownerId === "director";
    return (
      tournament.ownerId === user.uid ||
      tournament.ownerId === "director" ||
      Boolean(tournament.admins && tournament.admins[user.uid])
    );
  }, [tournament, user]);

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
      await setDoc(
        doc(db, "tournaments", tournament.id, "auditEvents", event.id),
        cleanUndefined(event)
      );
    }
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
    const previous = tournament;
    setTournament(t);
    persistLocal("meta", t);
    try {
      if (AUTOMATIC_CLOUD_WRITES && db) {
        await setDoc(doc(db, "tournaments", t.id), t, { merge: true });
      }
    } catch (e) {
      console.warn("Firestore sync warning:", e);
    }
    if (previous && (
      previous.name !== t.name ||
      previous.format !== t.format ||
      JSON.stringify(previous.preferences) !== JSON.stringify(t.preferences)
    )) {
      const changedPreferenceKeys = Object.keys({
        ...previous.preferences,
        ...t.preferences,
      }).filter((key) =>
        JSON.stringify(previous.preferences[key as keyof typeof previous.preferences]) !==
        JSON.stringify(t.preferences[key as keyof typeof t.preferences])
      );
      await recordAuditEvent({
        action: "tournament.settings_updated",
        category: "tournament",
        summary: "Tournament settings updated",
        details: {
          previousName: previous.name,
          name: t.name,
          previousFormat: previous.format,
          format: t.format,
          changedPreferenceKeys,
          previousPreferences: previous.preferences,
          preferences: t.preferences,
        },
      });
    }
  };

  const createRound = async (
    name: string,
    abbr: string,
    stage: "preliminary" | "elimination",
    customDrawType?: "random" | "power_paired" | "round_robin" | "elimination" | "manual"
  ) => {
    const nextSeq = rounds.length + 1;
    const defaultDrawRule = tournament?.preferences?.drawRule || "power_paired";
    const mappedDrawType =
      customDrawType ||
      (nextSeq === 1 && defaultDrawRule === "power_paired"
        ? "random"
        : (defaultDrawRule as any));

    const newRound: Round = {
      id: `round-${tournament?.id || tournamentSlug}-${nextSeq}`,
      tournamentId: tournament?.id || tournamentSlug,
      seq: nextSeq,
      name,
      abbreviation: abbr,
      stage,
      drawType: mappedDrawType,
      drawStatus: "none",
      feedbackWeight: 1.0,
      silent: false,
      motionsReleased: false,
      resultsReleased: false,
      teamSpeaksReleased: false,
      completed: false,
      createdAt: new Date().toISOString(),
    };

    const updated = [...rounds, newRound];
    setRounds(updated);
    setActiveRound(newRound);
    persistLocal("rounds", updated);

    await recordAuditEvent({
      action: "round.created",
      category: "tournament",
      summary: `${name} created`,
      roundId: newRound.id,
      details: {
        sequence: newRound.seq,
        stage: newRound.stage,
        drawType: newRound.drawType,
      },
    });
    return newRound;
  };

  const updateRound = async (round: Round) => {
    const previous = rounds.find((item) => item.id === round.id);
    if (AUTOMATIC_CLOUD_WRITES && db && tournament?.id) {
      await setDoc(
        doc(db, "tournaments", tournament.id, "rounds", round.id),
        cleanUndefined(round)
      );
    }
    const updated = rounds.map((r) => (r.id === round.id ? round : r));
    setRounds(updated);
    if (activeRound?.id === round.id) setActiveRound(round);
    persistLocal("rounds", updated);
    if (previous) {
      const trackedFields = [
        "drawStatus",
        "adjudicatorsRevealed",
        "completed",
        "resultsReleased",
        "teamSpeaksReleased",
        "motionsReleased",
        "silent",
        "cancelled",
      ] as const;
      const changes = Object.fromEntries(
        trackedFields
          .filter((field) => previous[field] !== round[field])
          .map((field) => [field, { from: previous[field], to: round[field] }])
      );
      if (Object.keys(changes).length > 0) {
        const drawStatusChanged = previous.drawStatus !== round.drawStatus;
        await recordAuditEvent({
          action: drawStatusChanged ? "draw.status_changed" : "round.updated",
          category: drawStatusChanged ? "draw" : "tournament",
          summary: drawStatusChanged
            ? `${round.name} draw status changed to ${round.drawStatus}`
            : `${round.name} settings updated`,
          roundId: round.id,
          details: { changes },
        });
      }
    }
  };

  const setPreliminaryRoundCount = async (count: number) => {
    const previousCount = rounds.filter((round) => round.stage === "preliminary" && !round.cancelled).length;
    const targetCount = Math.max(0, Math.min(20, Math.floor(count)));
    const updated = [...rounds];
    const activePrelims = updated
      .filter((round) => round.stage === "preliminary" && !round.cancelled)
      .sort((a, b) => a.seq - b.seq);

    if (targetCount < activePrelims.length) {
      activePrelims.slice(targetCount).forEach((round) => {
        const index = updated.findIndex((item) => item.id === round.id);
        updated[index] = { ...round, cancelled: true };
      });
    } else if (targetCount > activePrelims.length) {
      const canceledPrelims = updated
        .filter((round) => round.stage === "preliminary" && round.cancelled)
        .sort((a, b) => a.seq - b.seq);
      const restoreCount = Math.min(targetCount - activePrelims.length, canceledPrelims.length);
      canceledPrelims.slice(0, restoreCount).forEach((round) => {
        const index = updated.findIndex((item) => item.id === round.id);
        updated[index] = { ...round, cancelled: false };
      });

      let preliminaryCount = activePrelims.length + restoreCount;
      while (preliminaryCount < targetCount) {
        const seq = Math.max(0, ...updated.map((round) => round.seq)) + 1;
        const id = `round-${tournament?.id || tournamentSlug}-${Date.now()}-${preliminaryCount + 1}`;
        const drawRule = tournament?.preferences?.drawRule || "power_paired";
        updated.push({
          id,
          tournamentId: tournament?.id || tournamentSlug,
          seq,
          name: `Round ${preliminaryCount + 1}`,
          abbreviation: `R${preliminaryCount + 1}`,
          stage: "preliminary",
          drawType:
            preliminaryCount === 0 && drawRule === "power_paired" ? "random" : (drawRule as any),
          drawStatus: "none",
          feedbackWeight: 1,
          silent: false,
          motionsReleased: false,
          resultsReleased: false,
          completed: false,
          createdAt: new Date().toISOString(),
        });
        preliminaryCount += 1;
      }
    }

    const prelims = updated
      .filter((round) => round.stage === "preliminary" && !round.cancelled)
      .sort((a, b) => a.seq - b.seq);
    const eliminations = updated
      .filter((round) => round.stage === "elimination" && !round.cancelled)
      .sort((a, b) => a.seq - b.seq);
    const canceled = updated.filter((round) => round.cancelled).sort((a, b) => a.seq - b.seq);
    const ordered = [...prelims, ...eliminations, ...canceled].map((round, index) => ({
      ...round,
      seq: index + 1,
    }));
    const seqByRoundId = new Map(ordered.map((round) => [round.id, round.seq]));
    const updatedDebates = debates.map((debate) => ({
      ...debate,
      roundSeq: seqByRoundId.get(debate.roundId) ?? debate.roundSeq,
    }));

    const changedDebates = updatedDebates.filter(
      (debate, index) => debate.roundSeq !== debates[index].roundSeq
    );
    if (AUTOMATIC_CLOUD_WRITES && db && tournament?.id) {
      const ops: Array<(batch: WriteBatch) => void> = [];
      ordered.forEach((round) => {
        ops.push((batch) =>
          batch.set(doc(db!, "tournaments", tournament.id, "rounds", round.id), cleanUndefined(round))
        );
      });
      changedDebates.forEach((debate) => {
        ops.push((batch) =>
          batch.set(doc(db!, "tournaments", tournament.id, "debates", debate.id), cleanUndefined(debate))
        );
      });
      await commitChunkedBatches(ops);
    }

    setRounds(ordered);
    persistLocal("rounds", ordered);
    if (changedDebates.length > 0) {
      setDebates(updatedDebates);
      persistLocal("debates", updatedDebates);
    }

    setActiveRound((current) => {
      const updatedActive = current && ordered.find((round) => round.id === current.id);
      if (updatedActive && !updatedActive.cancelled) return updatedActive;
      return [...prelims, ...eliminations].at(-1) || null;
    });
    if (previousCount !== targetCount) {
      await recordAuditEvent({
        action: "rounds.preliminary_count_updated",
        category: "tournament",
        summary: `Preliminary round count changed from ${previousCount} to ${targetCount}`,
        details: { previousCount, count: targetCount },
      });
    }
  };

  const deleteRound = async (roundId: string) => {
    const roundToDelete = rounds.find((round) => round.id === roundId);
    if (!roundToDelete) return;

    let preliminarySeq = 0;
    const remainingRounds = rounds
      .filter((round) => round.id !== roundId)
      .sort((a, b) => a.seq - b.seq)
      .map((round, index) => {
        let name = round.name;
        let abbreviation = round.abbreviation;
        if (round.stage === "preliminary") {
          preliminarySeq += 1;
          if (/^Round \d+$/.test(name)) name = `Round ${preliminarySeq}`;
          if (/^R\d+$/.test(abbreviation)) abbreviation = `R${preliminarySeq}`;
        }
        return { ...round, seq: index + 1, name, abbreviation };
      });
    const remainingRoundIds = new Set(remainingRounds.map((round) => round.id));
    const deletedDebates = debates.filter((debate) => debate.roundId === roundId);
    const deletedDebateIds = new Set(deletedDebates.map((debate) => debate.id));
    const deletedBallots = ballots.filter(
      (ballot) => ballot.roundId === roundId || deletedDebateIds.has(ballot.debateId)
    );
    const deletedFeedback = feedback.filter(
      (submission) => submission.roundId === roundId || deletedDebateIds.has(submission.debateId)
    );
    const oldDebateSeqById = new Map(debates.map((debate) => [debate.id, debate.roundSeq]));
    const updatedDebates = debates
      .filter((debate) => remainingRoundIds.has(debate.roundId))
      .map((debate) => ({
        ...debate,
        roundSeq: remainingRounds.find((round) => round.id === debate.roundId)?.seq ?? debate.roundSeq,
      }));
    const updatedMotions = motions.map((motion) => ({
      ...motion,
      rounds: (motion.rounds || []).filter((assignedRoundId) => assignedRoundId !== roundId),
    }));
    const changedMotions = updatedMotions.filter((motion, index) =>
      motions[index].rounds?.includes(roundId)
    );

    if (AUTOMATIC_CLOUD_WRITES && db && tournament?.id) {
      const ops: Array<(batch: WriteBatch) => void> = [];
      ops.push((batch) =>
        batch.delete(doc(db!, "tournaments", tournament.id, "rounds", roundId))
      );
      deletedDebates.forEach((debate) => {
        ops.push((batch) =>
          batch.delete(doc(db!, "tournaments", tournament.id, "debates", debate.id))
        );
      });
      deletedBallots.forEach((ballot) => {
        ops.push((batch) =>
          batch.delete(doc(db!, "tournaments", tournament.id, "ballots", ballot.id))
        );
      });
      deletedFeedback.forEach((submission) => {
        ops.push((batch) =>
          batch.delete(doc(db!, "tournaments", tournament.id, "feedback", submission.id))
        );
      });
      remainingRounds.forEach((round) => {
        ops.push((batch) =>
          batch.set(doc(db!, "tournaments", tournament.id, "rounds", round.id), round)
        );
      });
      updatedDebates.forEach((debate, index) => {
        if (debate.roundSeq !== oldDebateSeqById.get(debate.id)) {
          ops.push((batch) =>
            batch.set(doc(db!, "tournaments", tournament.id, "debates", debate.id), cleanUndefined(debate))
          );
        }
      });
      changedMotions.forEach((motion) => {
        ops.push((batch) =>
          batch.set(doc(db!, "tournaments", tournament.id, "motions", motion.id), cleanUndefined(motion))
        );
      });
      await commitChunkedBatches(ops);
    }

    setRounds(remainingRounds);
    setDebates(updatedDebates);
    setBallots(ballots.filter((ballot) => !deletedBallots.some((removed) => removed.id === ballot.id)));
    const updatedFeedback = feedback.filter(
      (submission) => !deletedFeedback.some((removed) => removed.id === submission.id)
    );
    setFeedback(updatedFeedback);
    setMotions(updatedMotions);
    persistLocal("rounds", remainingRounds);
    persistLocal("debates", updatedDebates);
    persistLocal("ballots", ballots.filter((ballot) => !deletedBallots.some((removed) => removed.id === ballot.id)));
    persistLocal("feedback", updatedFeedback);
    persistLocal("motions", updatedMotions);
    if (activeRound?.id === roundId) {
      setActiveRound(remainingRounds.filter((round) => !round.cancelled).at(-1) || null);
    }
    await recordAuditEvent({
      action: "round.deleted",
      category: "tournament",
      summary: `${roundToDelete.name} deleted`,
      roundId,
      details: {
        deletedDebateCount: deletedDebates.length,
        deletedBallotCount: deletedBallots.length,
        deletedFeedbackCount: deletedFeedback.length,
      },
    });
  };

  const getPastDebatesForRound = (targetRound: Round) => {
    const priorRoundIds = new Set(
      rounds
        .filter((round) => !round.cancelled && round.seq < targetRound.seq)
        .map((round) => round.id)
    );
    return debates.filter((debate) => priorRoundIds.has(debate.roundId));
  };

  const generateDraw = async (roundId: string) => {
    const round = rounds.find((r) => r.id === roundId);
    if (!round || !tournament) return;

    // Filter past debates before this round
    const pastDebates = getPastDebatesForRound(round);

    const generated = generateRoundDraw({
      tournament,
      round,
      teams,
      venues,
      pastDebates,
      standings: teamStandings,
    });

    // Attach round motion if available
    const roundMotion = motions.find((m) => m.rounds && m.rounds.includes(round.id));
    if (roundMotion) {
      generated.forEach((d) => {
        d.motionId = roundMotion.id;
        d.motionText = roundMotion.text;
      });
    }

    // Debates to delete for this round
    const debatesToDelete = debates.filter((d) => d.roundId === roundId);

    // Replace debates for this round locally
    const otherDebates = debates.filter((d) => d.roundId !== roundId);
    const updatedDebates = [...otherDebates, ...generated];
    setDebates(updatedDebates);
    persistLocal("debates", updatedDebates);

    // Update round draw status
    const updatedRound: Round = { ...round, drawStatus: "draft", adjudicatorsRevealed: false };
    const updatedRounds = rounds.map((r) => (r.id === round.id ? updatedRound : r));
    setRounds(updatedRounds);
    setActiveRound(updatedRound);
    persistLocal("rounds", updatedRounds);

    // Multi-document write using chunked writeBatch (at most 400 operations per chunk)
    if (AUTOMATIC_CLOUD_WRITES && db && tournament.id) {
      const ops: Array<(batch: WriteBatch) => void> = [];

      // 1. Delete previous debates for this round
      for (const d of debatesToDelete) {
        const ref = doc(db, "tournaments", tournament.id, "debates", d.id);
        ops.push((batch) => batch.delete(ref));
      }

      // 2. Set newly generated debates
      for (const d of generated) {
        const ref = doc(db, "tournaments", tournament.id, "debates", d.id);
        ops.push((batch) => batch.set(ref, cleanUndefined(d)));
      }

      // 3. Update round document
      const roundRef = doc(db, "tournaments", tournament.id, "rounds", updatedRound.id);
      ops.push((batch) => batch.set(roundRef, cleanUndefined(updatedRound)));

      await commitChunkedBatches(ops);
    }
    await recordAuditEvent({
      action: "draw.generated",
      category: "draw",
      summary: `Generated ${round.name} draw`,
      roundId: round.id,
      details: {
        format: tournament.format,
        drawType: round.drawType,
        teamCount: new Set(generated.flatMap((debate) =>
          Object.values(debate.teams).map((slot) => slot.teamId)
        )).size,
        debateCount: generated.length,
        previousDebateCount: debatesToDelete.length,
        pairingMethod: tournament.preferences?.pairingMethod ?? tournament.preferences?.drawRule,
        conflictAvoidance: tournament.preferences?.conflictAvoidance,
        sideAllocationRule: tournament.preferences?.sideAllocationRule,
      },
    });
  };

  const autoAllocate = async (roundId: string, panelSize: number = 1) => {
    const roundDebates = debates.filter((d) => d.roundId === roundId);
    if (roundDebates.length === 0 || !tournament) return;

    const round = rounds.find((r) => r.id === roundId);
    const teamsMap = new Map<string, Team>();
    teams.forEach((t) => teamsMap.set(t.id, t));

    // Build past history from all debates before this round
    const pastDebates = round ? getPastDebatesForRound(round) : [];
    const pastAdjTeams = buildPastAdjTeams(pastDebates);

    const completedPrelimRounds = rounds.filter(
      (r) => r.stage === "preliminary" && !r.cancelled && r.completed
    ).length;
    const totalPrelimRounds = rounds.filter((r) => r.stage === "preliminary" && !r.cancelled).length;

    const intelligentContext: IntelligentAllocationContext = {
      allPastDebates: pastDebates,
      standings: teamStandings,
      breakCategories,
      totalPrelimRounds,
      completedRounds: completedPrelimRounds,
      isBP: tournament.format === "bp",
      feedbackScores: calculateAdjudicatorFeedbackScores(feedback),
      venuePriorities: new Map(venues.map((venue) => [venue.id, venue.priority])),
    };

    const allocations = autoAllocateAdjudicators(roundDebates, teamsMap, adjudicators, pastAdjTeams, {
      panelSize: tournament.preferences?.noPanellistAdjs ? 1 : panelSize,
      balancePanels: true,
      respectInstitutionConflicts: true,
      respectPersonalConflicts: true,
      respectHistoryConflicts: true,
      preferences: tournament.preferences,
    }, intelligentContext);

    const updatedRoundDebates = roundDebates.map((d, idx) => {
      const alloc = allocations[idx];
      return {
        ...d,
        adjudicators: {
          chairId: alloc?.chairId,
          chairName: alloc?.chairName,
          panellistIds: alloc?.panellistIds || [],
          panellistNames: alloc?.panellistNames || [],
          traineeIds: alloc?.traineeIds || [],
          traineeNames: alloc?.traineeNames || [],
        },
      };
    });

    const otherDebates = debates.filter((d) => d.roundId !== roundId);
    const updated = [...otherDebates, ...updatedRoundDebates];
    setDebates(updated);
    persistLocal("debates", updated);
    await hideRevealedAdjudicators(new Set([roundId]));

    // Batch update allocated debates
    if (AUTOMATIC_CLOUD_WRITES && db && tournament.id) {
      const ops: Array<(batch: WriteBatch) => void> = [];
      for (const d of updatedRoundDebates) {
        const ref = doc(db, "tournaments", tournament.id, "debates", d.id);
        ops.push((batch) => batch.set(ref, cleanUndefined(d)));
      }
      await commitChunkedBatches(ops);
    }
    await recordAuditEvent({
      action: "adjudicators.allocated",
      category: "allocation",
      summary: `Allocated adjudicators for ${round?.name || "round"}`,
      roundId,
      details: {
        panelSize: tournament.preferences?.noPanellistAdjs ? 1 : panelSize,
        debateCount: updatedRoundDebates.length,
        adjudicatorCount: adjudicators.length,
        assignments: allocations.map((allocation) => ({
          debateId: allocation.debateId,
          chairId: allocation.chairId,
          panellistIds: allocation.panellistIds,
          traineeIds: allocation.traineeIds,
          conflicts: allocation.conflicts,
        })),
      },
    });
  };

  const updateDebate = async (debate: Debate) => {
    const previous = debates.find((item) => item.id === debate.id);
    const updated = debates.map((d) => (d.id === debate.id ? debate : d));
    setDebates(updated);
    persistLocal("debates", updated);
    if (previous && JSON.stringify(previous.adjudicators) !== JSON.stringify(debate.adjudicators)) {
      await hideRevealedAdjudicators(new Set([debate.roundId]));
      await recordAuditEvent({
        action: "adjudicators.manual_assignment_updated",
        category: "allocation",
        summary: `Adjudicator assignment changed for ${debate.id}`,
        roundId: debate.roundId,
        debateId: debate.id,
        details: {
          previous: previous.adjudicators,
          current: debate.adjudicators,
        },
      });
    }
    if (previous && previous.venueId !== debate.venueId) {
      await recordAuditEvent({
        action: "venue.assigned",
        category: "venue",
        summary: `Venue changed for ${debate.id}`,
        roundId: debate.roundId,
        debateId: debate.id,
        details: {
          previousVenueId: previous.venueId,
          venueId: debate.venueId,
          venueName: debate.venueName,
        },
      });
    }
  };

  const updateDebates = async (newDebates: Debate[]) => {
    const previousById = new Map(debates.map((debate) => [debate.id, debate]));
    setDebates(newDebates);
    persistLocal("debates", newDebates);
    if (AUTOMATIC_CLOUD_WRITES && db && tournament?.id) {
      const ops: Array<(batch: WriteBatch) => void> = [];
      for (const d of newDebates) {
        const ref = doc(db, "tournaments", tournament.id, "debates", d.id);
        ops.push((batch) => batch.set(ref, cleanUndefined(d)));
      }
      await commitChunkedBatches(ops);
    }
    const changedAssignments = newDebates.flatMap((debate) => {
      const previous = previousById.get(debate.id);
      if (!previous || JSON.stringify(previous.adjudicators) === JSON.stringify(debate.adjudicators)) return [];
      return [{
        debateId: debate.id,
        roundId: debate.roundId,
        previous: previous.adjudicators,
        current: debate.adjudicators,
      }];
    });
    if (changedAssignments.length > 0) {
      await hideRevealedAdjudicators(new Set(changedAssignments.map((assignment) => assignment.roundId)));
      await recordAuditEvent({
        action: "adjudicators.manual_assignments_updated",
        category: "allocation",
        summary: `Manual adjudicator assignments changed in ${changedAssignments.length} debate(s)`,
        roundId: changedAssignments.length === 1 ? changedAssignments[0].roundId : undefined,
        debateId: changedAssignments.length === 1 ? changedAssignments[0].debateId : undefined,
        details: { assignments: changedAssignments },
      });
    }
  };

  const submitBallot = async (ballot: BallotSubmission, privatePasscode?: string) => {
    // If ballot already exists with same id or debateId
    const existingIdx = ballots.findIndex((b) => b.id === ballot.id || (!ballot.id && b.debateId === ballot.debateId));
    let updatedBallots: BallotSubmission[];

    const finalBallot = {
      ...ballot,
      id: ballot.id || `ballot-${ballot.debateId}-${Date.now()}`,
    };

    if (existingIdx >= 0) {
      updatedBallots = ballots.map((b, idx) => (idx === existingIdx ? finalBallot : b));
    } else {
      updatedBallots = [...ballots, finalBallot];
    }

    setBallots(updatedBallots);
    persistLocal("ballots", updatedBallots);

    const ballotRound = rounds.find((round) => round.id === finalBallot.roundId);
    if (ballotRound?.resultsReleased || ballotRound?.teamSpeaksReleased) {
      await updateRound({ ...ballotRound, resultsReleased: false, teamSpeaksReleased: false });
    }

    // Update debate result status
    const debate = debates.find((d) => d.id === finalBallot.debateId);
    let updatedDebates = debates;
    if (debate) {
      const updatedDebate: Debate = {
        ...debate,
        resultStatus: finalBallot.confirmed ? "confirmed" : "draft",
      };
      updatedDebates = debates.map((d) => (d.id === debate.id ? updatedDebate : d));
      setDebates(updatedDebates);
      persistLocal("debates", updatedDebates);
    }

    await recordAuditEvent({
      action: "ballot.submitted",
      category: "ballot",
      summary: `Ballot v${finalBallot.version} submitted for debate`,
      roundId: finalBallot.roundId,
      debateId: finalBallot.debateId,
      details: {
        ballotId: finalBallot.id,
        version: finalBallot.version,
        submitterType: finalBallot.submitterType,
        confirmed: finalBallot.confirmed,
      },
    });
    if (finalBallot.confirmed) {
      await confirmBallot(finalBallot.id, finalBallot.debateId, finalBallot);
      if (privatePasscode) {
        await queuePrivateRecord(
          { collection: "ballots", record: finalBallot },
          adjudicators.find((adj) => adj.id === finalBallot.submitterId)?.privateUrlKey,
          privatePasscode
        );
      }
    }
  };

  const confirmBallot = async (
    ballotId: string,
    debateId: string,
    submittedBallot?: BallotSubmission
  ) => {
    const nowIso = new Date().toISOString();

    // Confirm ballots in the local working copy; cloud writes happen on explicit upload.
    const confirmedBallot = submittedBallot || ballots.find((b) => b.id === ballotId || b.debateId === debateId);
    const updatedBallots = ballots.map((b) => {
      if (b.id === ballotId || (b.debateId === debateId && b.id === ballotId)) {
        return {
          ...b,
          confirmed: true,
          discarded: false,
          confirmedTimestamp: nowIso,
        };
      }
      if (b.debateId === debateId && b.id !== ballotId) {
        return {
          ...b,
          confirmed: false,
          discarded: true,
        };
      }
      return b;
    });
    if (confirmedBallot && !updatedBallots.some((b) => b.id === ballotId)) {
      updatedBallots.push({
        ...confirmedBallot,
        confirmed: true,
        discarded: false,
        confirmedTimestamp: nowIso,
      });
    }
    setBallots(updatedBallots);
    persistLocal("ballots", updatedBallots);

    const debate = debates.find((d) => d.id === debateId);
    if (debate) {
      const updatedTeams = { ...debate.teams };
      if (confirmedBallot) {
        for (const [key, slot] of Object.entries(updatedTeams)) {
          const sideKey = key as DebateSide;
          if (slot && slot.teamId) {
            const teamScore = confirmedBallot.teamScores?.[sideKey];
            const speakerScores = confirmedBallot.speakerScores?.[sideKey] || [];
            const totalSpeakersScore = speakerScores.reduce((sum, s) => sum + (s.score || 0), 0);
            updatedTeams[sideKey] = {
              ...slot,
              points: teamScore ? teamScore.points : slot.points,
              speakerScoreTotal: totalSpeakersScore || teamScore?.totalSpeakerScore || slot.speakerScoreTotal,
            };
          }
        }
      }

      const updatedDebate: Debate = {
        ...debate,
        resultStatus: "confirmed",
        teams: updatedTeams,
      };
      const updatedDebates = debates.map((d) => (d.id === debateId ? updatedDebate : d));
      setDebates(updatedDebates);
      persistLocal("debates", updatedDebates);
    }
    await recordAuditEvent({
      action: "ballot.confirmed",
      category: "ballot",
      summary: "Ballot confirmed and results recorded",
      roundId: confirmedBallot?.roundId,
      debateId,
      details: {
        ballotId,
        version: confirmedBallot?.version,
        submitterType: confirmedBallot?.submitterType,
      },
    });
  };

  const addInstitutions = async (instData: Omit<Institution, "id" | "tournamentId">[]) => {
    if (instData.length === 0) return;

    const newInstitutions: Institution[] = instData.map((data) => ({
      ...data,
      id: `inst-${typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
      tournamentId: tournament?.id || tournamentSlug,
    }));
    const updated = [...institutions, ...newInstitutions];
    setInstitutions(updated);
    persistLocal("institutions", updated);
    for (const newInstitution of newInstitutions) {
      await recordAuditEvent({
        action: "institution.created",
        category: "tournament",
        summary: `Institution ${newInstitution.name} added`,
        details: {
          institutionId: newInstitution.id,
          name: newInstitution.name,
          code: newInstitution.code,
          region: newInstitution.region,
        },
      });
    }
  };

  const addInstitution = async (instData: Omit<Institution, "id" | "tournamentId">) => {
    await addInstitutions([instData]);
  };

  const updateInstitution = async (inst: Institution) => {
    const previous = institutions.find((item) => item.id === inst.id);
    const updated = institutions.map((i) => (i.id === inst.id ? inst : i));
    setInstitutions(updated);
    persistLocal("institutions", updated);
    await recordAuditEvent({
      action: "institution.updated",
      category: "tournament",
      summary: `Institution ${inst.name} updated`,
      details: {
        institutionId: inst.id,
        previous: previous ? { name: previous.name, code: previous.code, region: previous.region } : undefined,
        current: { name: inst.name, code: inst.code, region: inst.region },
      },
    });
  };

  const deleteInstitution = async (instId: string) => {
    const deleted = institutions.find((item) => item.id === instId);
    const updated = institutions.filter((i) => i.id !== instId);
    setInstitutions(updated);
    persistLocal("institutions", updated);
    await recordAuditEvent({
      action: "institution.deleted",
      category: "tournament",
      summary: `Institution ${deleted?.name || instId} deleted`,
      details: { institutionId: instId, name: deleted?.name },
    });
  };

  const addTeams = async (teamData: Omit<Team, "id" | "tournamentId">[]) => {
    if (teamData.length === 0) return;

    const newTeams: Team[] = teamData.map((data) => ({
      ...data,
      id: `team-${typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
      tournamentId: tournament?.id || tournamentSlug,
      privateUrlKey: data.privateUrlKey || generatePrivateKey("team"),
    }));
    const updated = [...teams, ...newTeams];
    setTeams(updated);
    persistLocal("teams", updated);
    for (const newTeam of newTeams) {
      await recordAuditEvent({
        action: "team.created",
        category: "tournament",
        summary: `Team ${newTeam.name} added`,
        details: {
          teamId: newTeam.id,
          name: newTeam.name,
          institutionId: newTeam.institutionId,
          breakCategories: newTeam.breakCategories,
          speakerCount: newTeam.speakers.length,
        },
      });
    }
  };

  const addTeam = async (teamData: Omit<Team, "id" | "tournamentId">) => {
    await addTeams([teamData]);
  };

  const updateTeam = async (team: Team, _privatePasscode?: string) => {
    const previous = teams.find((item) => item.id === team.id);
    const updated = teams.map((t) => (t.id === team.id ? team : t));
    setTeams(updated);
    persistLocal("teams", updated);
    await recordAuditEvent({
      action: "team.updated",
      category: "tournament",
      summary: `Team ${team.name} updated`,
      details: {
        teamId: team.id,
        previous: previous ? {
          name: previous.name,
          institutionId: previous.institutionId,
          breakCategories: previous.breakCategories,
          speakerCount: previous.speakers.length,
          checkedIn: previous.checkedIn,
        } : undefined,
        current: {
          name: team.name,
          institutionId: team.institutionId,
          breakCategories: team.breakCategories,
          speakerCount: team.speakers.length,
          checkedIn: team.checkedIn,
        },
      },
    });
  };

  const deleteTeam = async (teamId: string) => {
    const deleted = teams.find((item) => item.id === teamId);
    const updated = teams.filter((t) => t.id !== teamId);
    setTeams(updated);
    persistLocal("teams", updated);
    await recordAuditEvent({
      action: "team.deleted",
      category: "tournament",
      summary: `Team ${deleted?.name || teamId} deleted`,
      details: { teamId, name: deleted?.name },
    });
  };

  const addAdjudicators = async (adjData: Omit<Adjudicator, "id" | "tournamentId">[]) => {
    if (adjData.length === 0) return;

    const newAdjudicators: Adjudicator[] = adjData.map((data) => ({
      ...data,
      id: `adj-${typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
      tournamentId: tournament?.id || tournamentSlug,
      privateUrlKey: data.privateUrlKey || generatePrivateKey("adj"),
      privatePasscode: data.privatePasscode || generatePrivateKey(),
    }));
    const updated = [...adjudicators, ...newAdjudicators];
    setAdjudicators(updated);
    persistLocal("adjudicators", updated);
    for (const newAdj of newAdjudicators) {
      await recordAuditEvent({
        action: "adjudicator.created",
        category: "tournament",
        summary: `Adjudicator ${newAdj.name} added`,
        details: {
          adjudicatorId: newAdj.id,
          name: newAdj.name,
          institutionId: newAdj.institutionId,
          baseScore: newAdj.baseScore,
          trainee: newAdj.trainee,
          independent: newAdj.independent,
        },
      });
    }
  };

  const addAdjudicator = async (adjData: Omit<Adjudicator, "id" | "tournamentId">) => {
    await addAdjudicators([adjData]);
  };

  const updateAdjudicator = async (adj: Adjudicator, _privatePasscode?: string) => {
    const previous = adjudicators.find((item) => item.id === adj.id);
    const updated = adjudicators.map((a) => (a.id === adj.id ? adj : a));
    setAdjudicators(updated);
    persistLocal("adjudicators", updated);
    const safeAdj = ({
      privateUrlKey: _privateUrlKey,
      privatePasscode: _privatePasscode,
      ...safe
    }: Adjudicator) => safe;
    await recordAuditEvent({
      action: "adjudicator.updated",
      category: "tournament",
      summary: `Adjudicator ${adj.name} updated`,
      details: {
        adjudicatorId: adj.id,
        previous: previous ? safeAdj(previous) : undefined,
        current: safeAdj(adj),
      },
    });
  };

  const deleteAdjudicator = async (adjId: string) => {
    const deleted = adjudicators.find((item) => item.id === adjId);
    const updated = adjudicators.filter((a) => a.id !== adjId);
    setAdjudicators(updated);
    persistLocal("adjudicators", updated);
    await recordAuditEvent({
      action: "adjudicator.deleted",
      category: "tournament",
      summary: `Adjudicator ${deleted?.name || adjId} deleted`,
      details: { adjudicatorId: adjId, name: deleted?.name },
    });
  };

  const addVenues = async (venueData: Omit<Venue, "id" | "tournamentId">[]) => {
    if (venueData.length === 0) return;

    const newVenues: Venue[] = venueData.map((data) => ({
      ...data,
      id: `ven-${typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
      tournamentId: tournament?.id || tournamentSlug,
    }));
    const updated = [...venues, ...newVenues];
    setVenues(updated);
    persistLocal("venues", updated);
    for (const newVenue of newVenues) {
      await recordAuditEvent({
        action: "venue.created",
        category: "venue",
        summary: `Venue ${newVenue.name} added`,
        details: {
          venueId: newVenue.id,
          name: newVenue.name,
          priority: newVenue.priority,
          category: newVenue.category,
          capacity: newVenue.capacity,
          accessible: newVenue.accessible,
          online: newVenue.online,
        },
      });
    }
  };

  const addVenue = async (venueData: Omit<Venue, "id" | "tournamentId">) => {
    await addVenues([venueData]);
  };

  const updateVenue = async (venue: Venue) => {
    const previous = venues.find((item) => item.id === venue.id);
    const updated = venues.map((v) => (v.id === venue.id ? venue : v));
    setVenues(updated);
    persistLocal("venues", updated);
    await recordAuditEvent({
      action: "venue.updated",
      category: "venue",
      summary: `Venue ${venue.name} updated`,
      details: {
        venueId: venue.id,
        previous: previous ? {
          name: previous.name,
          priority: previous.priority,
          category: previous.category,
          capacity: previous.capacity,
          accessible: previous.accessible,
          online: previous.online,
          available: previous.available,
        } : undefined,
        current: {
          name: venue.name,
          priority: venue.priority,
          category: venue.category,
          capacity: venue.capacity,
          accessible: venue.accessible,
          online: venue.online,
          available: venue.available,
        },
      },
    });
  };

  const deleteVenue = async (venueId: string) => {
    const deleted = venues.find((item) => item.id === venueId);
    const updated = venues.filter((v) => v.id !== venueId);
    setVenues(updated);
    persistLocal("venues", updated);
    await recordAuditEvent({
      action: "venue.deleted",
      category: "venue",
      summary: `Venue ${deleted?.name || venueId} deleted`,
      details: { venueId, name: deleted?.name },
    });
  };

  const addMotions = async (motionData: Omit<Motion, "id" | "tournamentId">[]) => {
    if (motionData.length === 0) return;

    const newMotions: Motion[] = motionData.map((data) => ({
      ...data,
      id: `motion-${typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
      tournamentId: tournament?.id || tournamentSlug,
    }));
    const updated = [...motions, ...newMotions];
    setMotions(updated);
    persistLocal("motions", updated);
    for (const newMotion of newMotions) {
      await recordAuditEvent({
        action: "motion.created",
        category: "tournament",
        summary: "Motion added",
        details: {
          motionId: newMotion.id,
          reference: newMotion.reference,
          roundIds: newMotion.rounds,
          released: newMotion.released,
        },
      });
    }
  };

  const addMotion = async (motionData: Omit<Motion, "id" | "tournamentId">) => {
    await addMotions([motionData]);
  };

  const updateMotion = async (motion: Motion) => {
    const previous = motions.find((item) => item.id === motion.id);
    if (AUTOMATIC_CLOUD_WRITES && db && tournament?.id) {
      await setDoc(
        doc(db, "tournaments", tournament.id, "motions", motion.id),
        cleanUndefined(motion)
      );
    }
    const updated = motions.map((m) => (m.id === motion.id ? motion : m));
    setMotions(updated);
    persistLocal("motions", updated);
    await recordAuditEvent({
      action: "motion.updated",
      category: "tournament",
      summary: "Motion updated",
      details: {
        motionId: motion.id,
        previous: previous ? { reference: previous.reference, rounds: previous.rounds, released: previous.released } : undefined,
        current: { reference: motion.reference, rounds: motion.rounds, released: motion.released },
      },
    });
  };

  const deleteMotion = async (motionId: string) => {
    const deleted = motions.find((item) => item.id === motionId);
    const updated = motions.filter((m) => m.id !== motionId);
    setMotions(updated);
    persistLocal("motions", updated);
    await recordAuditEvent({
      action: "motion.deleted",
      category: "tournament",
      summary: "Motion deleted",
      details: { motionId, reference: deleted?.reference, roundIds: deleted?.rounds },
    });
  };

  const saveBreakCategories = async (cats: BreakCategory[]) => {
    const previousById = new Map(breakCategories.map((category) => [category.id, category]));
    setBreakCategories(cats);
    persistLocal("breaks", cats);
    if (AUTOMATIC_CLOUD_WRITES && db && tournament?.id) {
      const ops: Array<(batch: WriteBatch) => void> = [];
      for (const c of cats) {
        const ref = doc(db, "tournaments", tournament.id, "breakCategories", c.id);
        ops.push((batch) => batch.set(ref, c));
      }
      await commitChunkedBatches(ops);
    }
    const changes: Record<string, unknown>[] = [];
    cats.forEach((category) => {
      const previous = previousById.get(category.id);
      if (!previous) {
        changes.push({
          type: "created",
          category: {
            categoryId: category.id,
            name: category.name,
            breakSize: category.breakSize,
            reserveSize: category.reserveSize,
            priority: category.priority,
            isGeneral: category.isGeneral,
          },
        });
        return;
      }
      if (
        previous.name !== category.name ||
        previous.breakSize !== category.breakSize ||
        previous.reserveSize !== category.reserveSize ||
        previous.priority !== category.priority ||
        previous.isGeneral !== category.isGeneral
      ) {
        changes.push({
          type: "updated",
          categoryId: category.id,
          previous: {
            name: previous.name,
            breakSize: previous.breakSize,
            reserveSize: previous.reserveSize,
            priority: previous.priority,
            isGeneral: previous.isGeneral,
          },
          current: {
            name: category.name,
            breakSize: category.breakSize,
            reserveSize: category.reserveSize,
            priority: category.priority,
            isGeneral: category.isGeneral,
          },
        });
      }
    });
    const deleted = breakCategories.filter((category) => !cats.some((next) => next.id === category.id));
    if (changes.length || deleted.length) {
      await recordAuditEvent({
        action: "break.categories_updated",
        category: "break",
        summary: "Break categories updated",
        details: {
          changes,
          deleted: deleted.map((category) => ({
            categoryId: category.id,
            name: category.name,
            breakSize: category.breakSize,
          })),
        },
      });
    }
  };

  const generateBreak = async (categoryId: string) => {
    if (breakResults.length === 0 || !tournament) return null;
    const category = breakCategories.find((item) => item.id === categoryId);
    if (!category) return null;

    const teamsInDebate = tournament.preferences?.teamsInDebate || (tournament.format === "bp" ? 4 : 2);
    const maxBreakSize = Math.max(0, ...breakCategories.map((item) => item.breakSize));
    const roundCount = eliminationRoundCount(maxBreakSize, teamsInDebate);
    if (roundCount === 0) throw new Error("No valid elimination-round sequence is configured for these break sizes.");

    const eliminationRounds = rounds
      .filter((round) => round.stage === "elimination" && !round.cancelled)
      .sort((a, b) => a.seq - b.seq);
    if (eliminationRounds.length < roundCount) {
      throw new Error("The pre-created elimination rounds do not cover the configured break size.");
    }

    const schedule = buildBreakCategorySchedule(breakCategories, roundCount, teamsInDebate);
    const roundIndexById = new Map(eliminationRounds.map((round, index) => [round.id, index]));
    const updatedRounds = rounds.map((round) => {
      if (round.stage !== "elimination" || round.cancelled) return round;
      const index = roundIndexById.get(round.id);
      if (index === undefined) return round;
      return {
        ...round,
        breakCategoryIds: index < roundCount ? schedule[index] : [],
        eliminationAdvanced: false,
      };
    });
    const firstCategoryRound = updatedRounds.find(
      (round) => round.stage === "elimination" && round.breakCategoryIds?.includes(categoryId)
    );
    if (!firstCategoryRound) throw new Error(`${category.name} does not fit the configured elimination-round sequence.`);

    const updatedTeams = applyBreakStatuses(teams, breakResults);
    setTeams(updatedTeams);
    setRounds(updatedRounds);
    setActiveRound(firstCategoryRound);
    persistLocal("teams", updatedTeams);
    persistLocal("rounds", updatedRounds);
    if (AUTOMATIC_CLOUD_WRITES && db && tournament?.id) {
      const ops: Array<(batch: WriteBatch) => void> = [];
      for (const team of updatedTeams) {
        const ref = doc(db, "tournaments", tournament.id, "teams", team.id);
        ops.push((batch) => batch.set(ref, cleanUndefined(team)));
      }
      for (const round of updatedRounds.filter((item) => item.stage === "elimination")) {
        const ref = doc(db, "tournaments", tournament.id, "rounds", round.id);
        ops.push((batch) => batch.set(ref, cleanUndefined(round)));
      }
      await commitChunkedBatches(ops);
    }
    const categoryResult = breakResults.find((result) => result.category.id === categoryId);
    await recordAuditEvent({
      action: "break.generated",
      category: "break",
      summary: `Generated ${category.name} break`,
      roundId: firstCategoryRound.id,
      details: {
        categoryId: category.id,
        categoryName: category.name,
        breakSize: category.breakSize,
        reserveSize: category.reserveSize,
        breakingTeamIds: categoryResult?.breakingTeams.map((entry) => entry.team.id) ?? [],
        reserveTeamIds: categoryResult?.reserveTeams.map((entry) => entry.team.id) ?? [],
        eliminationRoundIds: updatedRounds
          .filter((round) => round.stage === "elimination" && !round.cancelled)
          .map((round) => round.id),
      },
    });
    return firstCategoryRound;
  };

  const proceedToNextEliminationRound = async (roundId: string) => {
    if (!tournament) return null;
    const round = rounds.find((item) => item.id === roundId && item.stage === "elimination");
    if (!round) throw new Error("Select an elimination round before proceeding.");
    if (round.eliminationAdvanced) {
      return rounds
        .filter((item) => item.stage === "elimination" && item.seq > round.seq && !item.cancelled)
        .sort((a, b) => a.seq - b.seq)
        .find((item) => !round.breakCategoryIds?.length || item.breakCategoryIds?.some((id) => round.breakCategoryIds!.includes(id))) || null;
    }

    const roundDebates = debates.filter((debate) => debate.roundId === round.id);
    if (roundDebates.length === 0) throw new Error("Generate this elimination round's draw before proceeding.");
    const expectedTeamIds = new Set(
      getEligibleTeamsForRound(teams, round)
        .filter((team) => team.checkedIn !== false)
        .map((team) => team.id)
    );
    const assignedTeamIds = new Set(
      roundDebates.flatMap((debate) => Object.values(debate.teams).map((slot) => slot?.teamId).filter(Boolean))
    );
    const missingTeam = [...expectedTeamIds].find((teamId) => !assignedTeamIds.has(teamId));
    if (missingTeam) throw new Error("Every eligible team must be assigned to a debate before proceeding.");

    const nextRound = rounds
      .filter((item) => item.stage === "elimination" && item.seq > round.seq && !item.cancelled)
      .sort((a, b) => a.seq - b.seq)
      .find((item) => !round.breakCategoryIds?.length || item.breakCategoryIds?.some((id) => round.breakCategoryIds!.includes(id))) || null;
    const isFinalRound = nextRound === null;
    const advancingTeamIds = getAdvancingTeamIds(roundDebates, ballots, tournament.format, isFinalRound);
    const participatingTeamIds = new Set(assignedTeamIds);
    const unexpectedTeam = [...participatingTeamIds].find((teamId) => !expectedTeamIds.has(teamId));
    if (unexpectedTeam) throw new Error("This round contains a team that did not qualify for this elimination stage.");
    const updatedTeams = applyEliminationAdvancement(teams, roundDebates, advancingTeamIds, round.id);
    const updatedRound = { ...round, eliminationAdvanced: true, completed: true };
    const updatedRounds = rounds.map((item) => item.id === round.id ? updatedRound : item);
    setTeams(updatedTeams);
    setRounds(updatedRounds);
    setActiveRound(nextRound || updatedRound);
    persistLocal("teams", updatedTeams);
    persistLocal("rounds", updatedRounds);
    if (AUTOMATIC_CLOUD_WRITES && db && tournament.id) {
      const ops: Array<(batch: WriteBatch) => void> = [];
      for (const team of updatedTeams.filter((item) => participatingTeamIds.has(item.id))) {
        const ref = doc(db, "tournaments", tournament.id, "teams", team.id);
        ops.push((batch) => batch.set(ref, cleanUndefined(team)));
      }
      const ref = doc(db, "tournaments", tournament.id, "rounds", updatedRound.id);
      ops.push((batch) => batch.set(ref, cleanUndefined(updatedRound)));
      await commitChunkedBatches(ops);
    }
    await recordAuditEvent({
      action: "elimination.round_advanced",
      category: "break",
      summary: `Advanced teams from ${round.name}`,
      roundId: round.id,
      details: {
        nextRoundId: nextRound?.id,
        isFinalRound,
        advancingTeamIds: [...advancingTeamIds],
        participatingTeamIds: [...participatingTeamIds],
      },
    });
    return nextRound;
  };

  const addFeedback = async (
    fbData: Omit<FeedbackSubmission, "id" | "tournamentId" | "timestamp">,
    privatePasscode?: string,
    privateUrlKey?: string
  ) => {
    const newFb: FeedbackSubmission = {
      ...fbData,
      id: `fb-${Date.now()}`,
      tournamentId: tournament?.id || tournamentSlug,
      timestamp: new Date().toISOString(),
    };
    const updated = [...feedback, newFb];
    setFeedback(updated);
    persistLocal("feedback", updated);
    if (newFb.sourceType === "adjudicator" && privatePasscode) {
      await queuePrivateRecord(
        { collection: "feedback", record: newFb },
        privateUrlKey || adjudicators.find((adj) => adj.id === newFb.sourceId)?.privateUrlKey,
        privatePasscode
      );
    }
    await recordAuditEvent({
      action: "feedback.submitted",
      category: "feedback",
      summary: `Feedback submitted for ${newFb.targetAdjudicatorName}`,
      roundId: newFb.roundId,
      debateId: newFb.debateId,
      details: {
        feedbackId: newFb.id,
        targetAdjudicatorId: newFb.targetAdjudicatorId,
        targetAdjudicatorName: newFb.targetAdjudicatorName,
        sourceType: newFb.sourceType,
        score: newFb.score,
        confirmed: newFb.confirmed,
      },
    });
  };

  const generatePrivateUrlKeys = async (forceRegenerate = false) => {
    let teamsChanged = false;
    const updatedTeams = teams.map((t) => {
      if (forceRegenerate || !t.privateUrlKey) {
        teamsChanged = true;
        return { ...t, privateUrlKey: generatePrivateKey("team") };
      }
      return t;
    });

    let adjsChanged = false;
    const updatedAdjs = adjudicators.map((a) => {
      if (forceRegenerate || !a.privateUrlKey || !a.privatePasscode) {
        adjsChanged = true;
        return {
          ...a,
          privateUrlKey:
            forceRegenerate || !a.privateUrlKey ? generatePrivateKey("adj") : a.privateUrlKey,
          privatePasscode: generatePrivateKey(),
        };
      }
      return a;
    });

    if (teamsChanged) {
      setTeams(updatedTeams);
      persistLocal("teams", updatedTeams);
    }
    if (adjsChanged) {
      setAdjudicators(updatedAdjs);
      persistLocal("adjudicators", updatedAdjs);
    }

    if (AUTOMATIC_CLOUD_WRITES && db && tournament?.id && (teamsChanged || adjsChanged)) {
      const ops: Array<(batch: WriteBatch) => void> = [];
      if (teamsChanged) {
        for (const t of updatedTeams) {
          const ref = doc(db, "tournaments", tournament.id, "teams", t.id);
          ops.push((batch) => batch.set(ref, cleanUndefined(t)));
        }
      }
      if (adjsChanged) {
        for (const a of updatedAdjs) {
          const ref = doc(db, "tournaments", tournament.id, "adjudicators", a.id);
          ops.push((batch) => batch.set(ref, cleanUndefined(a)));
        }
      }
      await commitChunkedBatches(ops);
    }
    if (teamsChanged || adjsChanged) {
      await recordAuditEvent({
        action: "private_urls.regenerated",
        category: "tournament",
        summary: "Private access credentials generated",
        details: {
          forceRegenerate,
          teamsUpdated: updatedTeams.filter((team) => forceRegenerate || !teams.find((old) => old.id === team.id)?.privateUrlKey).length,
          adjudicatorsUpdated: updatedAdjs.filter((adj) => {
            const previous = adjudicators.find((old) => old.id === adj.id);
            return forceRegenerate || !previous?.privateUrlKey || !previous.privatePasscode;
          }).length,
        },
      });
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
    setCloudSyncMessage("Uploading this device's local tournament to Firestore…");
    try {
      const tournamentRef = doc(db, "tournaments", tournament.id);
      const cloudTournament = await getDoc(tournamentRef);
      if (
        cloudTournament.exists() &&
        cloudTournament.data().ownerId !== "director" &&
        cloudTournament.data().ownerId !== user.uid &&
        cloudTournament.data().admins?.[user.uid] !== true
      ) {
        throw new Error("This cloud tournament belongs to another account.");
      }

      const metadata = {
        ...tournament,
        updatedAt: new Date().toISOString(),
      };
      await setDoc(tournamentRef, cleanUndefined(metadata), { merge: true });

      const localCollections: Record<(typeof CLOUD_COLLECTIONS)[number], Array<{ id: string }>> = {
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
      };
      const operations: Array<(batch: WriteBatch) => void> = [];
      for (const collectionName of CLOUD_COLLECTIONS) {
        const collectionRef = collection(db, "tournaments", tournament.id, collectionName);
        const remoteSnapshot = await getDocs(collectionRef);
        const localItems = localCollections[collectionName];
        const localIds = new Set(localItems.map((item) => item.id));
        for (const remoteDoc of remoteSnapshot.docs) {
          if (!localIds.has(remoteDoc.id)) {
            operations.push((batch) => batch.delete(remoteDoc.ref));
          }
        }
        for (const item of localItems) {
          operations.push((batch) => {
            batch.set(
              doc(db!, "tournaments", tournament.id, collectionName, item.id),
              cleanUndefined(item)
            );
          });
        }
      }
      await commitChunkedBatches(operations);
      setCloudSyncState("success");
      setCloudSyncMessage(`Uploaded local tournament at ${new Date().toLocaleTimeString()}.`);
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
    const firestore = db;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("You are offline. Connect to the internet before downloading.");
    }

    setCloudSyncState("syncing");
    setCloudSyncMessage("Downloading the latest tournament data from Firestore…");
    try {
      const tournamentSnapshot = await getDoc(doc(db, "tournaments", tournament.id));
      if (!tournamentSnapshot.exists()) throw new Error("This tournament is not available in Firestore.");
      const cloudTournament = {
        ...tournamentSnapshot.data(),
        id: tournamentSnapshot.id,
        slug: tournament.slug,
      } as Tournament;
      if (
        cloudTournament.ownerId !== "director" &&
        cloudTournament.ownerId !== user.uid &&
        cloudTournament.admins?.[user.uid] !== true
      ) {
        throw new Error("This cloud tournament belongs to another account.");
      }

      const snapshots = await Promise.all(
        CLOUD_COLLECTIONS.map((name) =>
          getDocs(collection(firestore, "tournaments", tournament.id, name))
        )
      );
      const collections = Object.fromEntries(
        CLOUD_COLLECTIONS.map((name, index) => [
          name,
          snapshots[index].docs.map((document) => ({
            ...document.data(),
            id: document.id,
          })),
        ])
      ) as Record<(typeof CLOUD_COLLECTIONS)[number], Array<{ id: string }>>;
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
      setCloudSyncState("success");
      setCloudSyncMessage("Downloaded the latest tournament data, including adjudicator ballots and feedback.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cloud download failed.";
      setCloudSyncState("error");
      setCloudSyncMessage(message);
      throw error;
    }
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
        cloudSyncState,
        cloudSyncMessage,
        privateSyncState,
        privateSyncMessage,
        localSaveError,
        uploadToCloud,
        downloadFromCloud,
        syncPrivatePortal,
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

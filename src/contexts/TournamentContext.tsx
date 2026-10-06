"use client";

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from "react";
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
  deleteDoc,
  onSnapshot,
  query,
  where,
  writeBatch,
  runTransaction,
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
  submitBallot: (ballot: BallotSubmission) => Promise<void>;
  confirmBallot: (ballotId: string, debateId: string, submittedBallot?: BallotSubmission) => Promise<void>;
  addInstitution: (inst: Omit<Institution, "id" | "tournamentId">) => Promise<void>;
  updateInstitution: (inst: Institution) => Promise<void>;
  deleteInstitution: (instId: string) => Promise<void>;
  addTeam: (team: Omit<Team, "id" | "tournamentId">) => Promise<void>;
  updateTeam: (team: Team) => Promise<void>;
  deleteTeam: (teamId: string) => Promise<void>;
  addAdjudicator: (adj: Omit<Adjudicator, "id" | "tournamentId">) => Promise<void>;
  updateAdjudicator: (adj: Adjudicator) => Promise<void>;
  deleteAdjudicator: (adjId: string) => Promise<void>;
  addVenue: (venue: Omit<Venue, "id" | "tournamentId">) => Promise<void>;
  updateVenue: (venue: Venue) => Promise<void>;
  deleteVenue: (venueId: string) => Promise<void>;
  addMotion: (motion: Omit<Motion, "id" | "tournamentId">) => Promise<void>;
  updateMotion: (motion: Motion) => Promise<void>;
  deleteMotion: (motionId: string) => Promise<void>;
  saveBreakCategories: (categories: BreakCategory[]) => Promise<void>;
  generateBreak: (categoryId: string) => Promise<Round | null>;
  proceedToNextEliminationRound: (roundId: string) => Promise<Round | null>;
  addFeedback: (fb: Omit<FeedbackSubmission, "id" | "tournamentId" | "timestamp">) => Promise<void>;
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
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);
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

  const storagePrefix = `crabbytab_t_${tournamentSlug}`;

  // Helper to persist state to local storage
  const persistLocal = useCallback(
    (key: string, data: any) => {
      if (typeof window === "undefined") return;
      try {
        localStorage.setItem(`${storagePrefix}_${key}`, JSON.stringify(data));
      } catch (e) {
        console.warn("LocalStorage save error:", e);
      }
    },
    [storagePrefix]
  );

  // Helper to write single entity to Firestore subcollection
  const setFirestoreDoc = useCallback(
    async (subcollection: string, docId: string, data: any) => {
      if (!db || !tournament?.id) return;
      try {
        await setDoc(doc(db, "tournaments", tournament.id, subcollection, docId), cleanUndefined(data));
      } catch (err) {
        console.warn(`Error writing to ${subcollection}/${docId}:`, err);
      }
    },
    [tournament?.id]
  );

  // Helper to delete single entity from Firestore subcollection
  const deleteFirestoreDoc = useCallback(
    async (subcollection: string, docId: string) => {
      if (!db || !tournament?.id) return;
      try {
        await deleteDoc(doc(db, "tournaments", tournament.id, subcollection, docId));
      } catch (err) {
        console.warn(`Error deleting from ${subcollection}/${docId}:`, err);
      }
    },
    [tournament?.id]
  );

  // Load initial data from LocalStorage & Firestore
  useEffect(() => {
    let isMounted = true;
    const unsubscribers: (() => void)[] = [];

    async function loadData() {
      setLoading(true);
      auditEventsRef.current = [];
      setAuditEvents([]);

      // 1. Read local cache first for instant UI response
      let localTournament: Tournament | null = null;
      try {
        const localT = localStorage.getItem(`${storagePrefix}_meta`);
        const parsedTournament = safeJsonParse<Tournament | null>(localT, null);
        if (parsedTournament) {
          localTournament = parsedTournament;
          if (isMounted) setTournament(localTournament);
        }

        const localRounds = localStorage.getItem(`${storagePrefix}_rounds`);
        if (localRounds && isMounted) {
          const parsed = safeJsonParse<Round[]>(localRounds, []);
          if (Array.isArray(parsed)) {
            setRounds(parsed);
            if (parsed.length > 0) {
              setActiveRound(parsed.find((round: Round) => !round.cancelled) || null);
            }
          }
        }

        const localTeams = localStorage.getItem(`${storagePrefix}_teams`);
        if (localTeams && isMounted) setTeams(safeJsonParse<Team[]>(localTeams, []));

        const localAdjs = localStorage.getItem(`${storagePrefix}_adjudicators`);
        if (localAdjs && isMounted) setAdjudicators(safeJsonParse<Adjudicator[]>(localAdjs, []));

        const localVenues = localStorage.getItem(`${storagePrefix}_venues`);
        if (localVenues && isMounted) setVenues(safeJsonParse<Venue[]>(localVenues, []));

        const localMotions = localStorage.getItem(`${storagePrefix}_motions`);
        if (localMotions && isMounted) setMotions(safeJsonParse<Motion[]>(localMotions, []));

        const localBreaks = localStorage.getItem(`${storagePrefix}_breaks`);
        if (localBreaks && isMounted) setBreakCategories(safeJsonParse<BreakCategory[]>(localBreaks, []));

        const localDebates = localStorage.getItem(`${storagePrefix}_debates`);
        if (localDebates && isMounted) setDebates(safeJsonParse<Debate[]>(localDebates, []));

        const localBallots = localStorage.getItem(`${storagePrefix}_ballots`);
        if (localBallots && isMounted) setBallots(safeJsonParse<BallotSubmission[]>(localBallots, []));

        const localFeedback = localStorage.getItem(`${storagePrefix}_feedback`);
        if (localFeedback && isMounted) setFeedback(safeJsonParse<FeedbackSubmission[]>(localFeedback, []));

        const localAuditEvents = localStorage.getItem(`${storagePrefix}_auditEvents`);
        if (localAuditEvents && isMounted) {
          const parsedAuditEvents = safeJsonParse<AuditEvent[]>(localAuditEvents, []);
          auditEventsRef.current = parsedAuditEvents;
          setAuditEvents(parsedAuditEvents);
        }

        const localInstitutions = localStorage.getItem(`${storagePrefix}_institutions`);
        if (localInstitutions && isMounted) setInstitutions(safeJsonParse<Institution[]>(localInstitutions, []));
      } catch (e) {
        console.warn("Error reading local storage cache:", e);
      }

      // 2. Fetch from Firestore if configured
      let firestoreTournId = `tourn-${tournamentSlug}`;
      let firestoreFound = false;

      if (db) {
        try {
          let tData: Tournament | null = null;

          // Check by standard ID `tourn-<slug>`
          const directSnap = await getDoc(doc(db, "tournaments", firestoreTournId));
          if (directSnap.exists()) {
            tData = directSnap.data() as Tournament;
            firestoreFound = true;
          } else {
            // Also check by raw slug as document ID
            const rawSnap = await getDoc(doc(db, "tournaments", tournamentSlug));
            if (rawSnap.exists()) {
              tData = rawSnap.data() as Tournament;
              firestoreTournId = tournamentSlug;
              firestoreFound = true;
            } else {
              // Query by slug field
              const q = query(collection(db, "tournaments"), where("slug", "==", tournamentSlug));
              const querySnap = await getDocs(q);
              if (!querySnap.empty) {
                tData = querySnap.docs[0].data() as Tournament;
                firestoreTournId = querySnap.docs[0].id;
                firestoreFound = true;
              }
            }
          }

          if (tData && isMounted) {
            setTournament(tData);
            persistLocal("meta", tData);

            // MIGRATION CHECK:
            // Check if per-entity collections are empty while data/bundle exists.
            // Check rounds collection as canonical indicator.
            const roundsSnap = await getDocs(collection(db, "tournaments", firestoreTournId, "rounds"));
            const bundleRef = doc(db, "tournaments", firestoreTournId, "data", "bundle");
            const bundleSnap = await getDoc(bundleRef);

            if (roundsSnap.empty && bundleSnap.exists()) {
              console.log(`Migrating tournament ${firestoreTournId} from data/bundle to subcollections...`);
              const b = bundleSnap.data() || {};
              const ops: Array<(batch: WriteBatch) => void> = [];

              const addBatchOps = <T extends { id: string }>(subcoll: string, items?: T[]) => {
                if (Array.isArray(items)) {
                  for (const item of items) {
                    if (item && item.id) {
                      const itemRef = doc(db!, "tournaments", firestoreTournId, subcoll, item.id);
                      ops.push((batch) => batch.set(itemRef, cleanUndefined(item)));
                    }
                  }
                }
              };

              addBatchOps("rounds", b.rounds);
              addBatchOps("teams", b.teams);
              addBatchOps("adjudicators", b.adjudicators);
              addBatchOps("venues", b.venues);
              addBatchOps("motions", b.motions);
              addBatchOps("breakCategories", b.breakCategories);
              addBatchOps("debates", b.debates);
              addBatchOps("ballots", b.ballots);
              addBatchOps("feedback", b.feedback);
              addBatchOps("institutions", b.institutions);

              const nowIso = new Date().toISOString();
              const tournRef = doc(db, "tournaments", firestoreTournId);
              ops.push((batch) =>
                batch.update(tournRef, {
                  migratedAt: nowIso,
                  updatedAt: nowIso,
                })
              );

              await commitChunkedBatches(ops);
              console.log(`Migration completed for tournament ${firestoreTournId}.`);
            }

            // Set up onSnapshot listeners:
            // 1 listener for tournament doc
            // 10 data subcollections plus metadata, and audit history for admins.
            const canReadAuditEvents = Boolean(
              user &&
              (
                tData.ownerId === user.uid ||
                tData.ownerId === "director" ||
                tData.admins?.[user.uid]
              )
            );
            const totalListeners = 11 + Number(canReadAuditEvents);
            let loadedListenersCount = 0;
            const markListenerReady = () => {
              loadedListenersCount++;
              if (loadedListenersCount >= totalListeners && isMounted) {
                setLoading(false);
              }
            };

            // 1. Tournament metadata listener
            const unsubTourn = onSnapshot(
              doc(db, "tournaments", firestoreTournId),
              (snap) => {
                if (snap.exists() && isMounted) {
                  const fresh = snap.data() as Tournament;
                  setTournament(fresh);
                  persistLocal("meta", fresh);
                }
                markListenerReady();
              },
              (err) => {
                console.warn("Tournament doc listener error:", err);
                markListenerReady();
              }
            );
            unsubscribers.push(unsubTourn);

            // Subcollection listeners:
            // Helper to subscribe to a subcollection
            const subscribeSubcollection = <T extends { id: string }>(
              subcollName: string,
              storageKey: string,
              setter: (items: T[]) => void,
              onFirstLoad?: (items: T[]) => void
            ) => {
              let isFirst = true;
              const unsub = onSnapshot(
                collection(db!, "tournaments", firestoreTournId, subcollName),
                (snapshot) => {
                  if (isMounted) {
                    const items = snapshot.docs.map((d) => d.data() as T);
                    setter(items);
                    persistLocal(storageKey, items);
                    if (isFirst && onFirstLoad) {
                      onFirstLoad(items);
                    }
                  }
                  if (isFirst) {
                    isFirst = false;
                    markListenerReady();
                  }
                },
                (err) => {
                  console.warn(`Subcollection listener error for ${subcollName}:`, err);
                  if (isFirst) {
                    isFirst = false;
                    markListenerReady();
                  }
                }
              );
              unsubscribers.push(unsub);
            };

            // 2. rounds
            subscribeSubcollection<Round>("rounds", "rounds", setRounds, (rList) => {
              if (rList.length > 0) {
                const activeRounds = rList.filter((r) => !r.cancelled);
                setActiveRound((prev) => {
                  if (prev) {
                    const match = rList.find((r) => r.id === prev.id);
                    if (match && !match.cancelled) return match;
                  }
                  return activeRounds[activeRounds.length - 1] || null;
                });
              }
            });

            // 3. teams
            subscribeSubcollection<Team>("teams", "teams", setTeams);

            // 4. adjudicators
            subscribeSubcollection<Adjudicator>("adjudicators", "adjudicators", setAdjudicators);

            // 5. venues
            subscribeSubcollection<Venue>("venues", "venues", setVenues);

            // 6. motions
            subscribeSubcollection<Motion>("motions", "motions", setMotions);

            // 7. breakCategories
            subscribeSubcollection<BreakCategory>("breakCategories", "breaks", setBreakCategories);

            // 8. debates
            subscribeSubcollection<Debate>("debates", "debates", setDebates);

            // 9. ballots
            subscribeSubcollection<BallotSubmission>("ballots", "ballots", setBallots);

            // 10. feedback
            subscribeSubcollection<FeedbackSubmission>("feedback", "feedback", setFeedback);

            // 11. institutions
            subscribeSubcollection<Institution>("institutions", "institutions", setInstitutions);

            // 12. audit events
            if (canReadAuditEvents) {
              subscribeSubcollection<AuditEvent>("auditEvents", "auditEvents", (items) => {
                auditEventsRef.current = items;
                setAuditEvents(items);
              });
            } else {
              auditEventsRef.current = [];
              setAuditEvents([]);
            }
          }
        } catch (err) {
          console.warn("Error fetching tournament from Firestore:", err);
        }
      }

      // 3. Fallback: If tournament was neither in Firestore nor in localStorage
      const curLocalCheck = localStorage.getItem(`${storagePrefix}_meta`);
      if (!firestoreFound && !curLocalCheck && isMounted) {
        // Initialize a fresh tournament
        const defaultT: Tournament = {
          id: `tourn-${tournamentSlug}`,
          name: `${tournamentSlug.toUpperCase()} Tournament`,
          shortName: tournamentSlug.toUpperCase(),
          slug: tournamentSlug,
          format: "bp",
          active: true,
          ownerId: user?.uid || "director",
          admins: user?.uid ? { [user.uid]: true } : { director: true },
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

        setTournament(defaultT);
        persistLocal("meta", defaultT);

        if (db && user) {
          setDoc(doc(db, "tournaments", defaultT.id), defaultT, { merge: true }).catch(console.warn);
        }
      }

      // If Firestore was not configured or not found, set loading to false here
      if (!firestoreFound && isMounted) {
        setLoading(false);
      }
    }

    loadData();

    return () => {
      isMounted = false;
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [tournamentSlug, storagePrefix, persistLocal, user]);

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
      actorType: user ? "user" : "public",
    };
    const updated = [event, ...auditEventsRef.current];
    auditEventsRef.current = updated;
    setAuditEvents(updated);
    persistLocal("auditEvents", updated);
    if (db && tournament?.id) {
      await setDoc(
        doc(db, "tournaments", tournament.id, "auditEvents", event.id),
        cleanUndefined(event)
      );
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
      if (db) {
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

    await setFirestoreDoc("rounds", newRound.id, newRound);
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
    if (db && tournament?.id) {
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
    if (db && tournament?.id) {
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

    if (db && tournament?.id) {
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

    // Auto-allocate judges with intelligent priority-based matching
    const teamsMap = new Map<string, Team>();
    teams.forEach((t) => teamsMap.set(t.id, t));
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
    };

    const allocations = autoAllocateAdjudicators(
      generated, teamsMap, adjudicators, pastAdjTeams,
      {
        panelSize: tournament.preferences?.noPanellistAdjs ? 1 : 1,
        balancePanels: true,
        respectInstitutionConflicts: true,
        respectPersonalConflicts: true,
        respectHistoryConflicts: true,
        preferences: tournament.preferences,
      },
      intelligentContext
    );
    generated.forEach((d, idx) => {
      const alloc = allocations[idx];
      if (alloc) {
        d.adjudicators.chairId = alloc.chairId;
        d.adjudicators.chairName = alloc.chairName;
        d.adjudicators.panellistIds = alloc.panellistIds;
        d.adjudicators.panellistNames = alloc.panellistNames;
        d.adjudicators.traineeIds = alloc.traineeIds;
        d.adjudicators.traineeNames = alloc.traineeNames;
      }
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
    const updatedRound: Round = { ...round, drawStatus: "draft" };
    const updatedRounds = rounds.map((r) => (r.id === round.id ? updatedRound : r));
    setRounds(updatedRounds);
    setActiveRound(updatedRound);
    persistLocal("rounds", updatedRounds);

    // Multi-document write using chunked writeBatch (at most 400 operations per chunk)
    if (db && tournament.id) {
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
        adjudicatorAssignments: allocations.map((allocation) => ({
          debateId: allocation.debateId,
          chairId: allocation.chairId,
          panellistIds: allocation.panellistIds,
          traineeIds: allocation.traineeIds,
          conflicts: allocation.conflicts,
        })),
      },
    });
    await recordAuditEvent({
      action: "adjudicators.allocated",
      category: "allocation",
      summary: `Allocated adjudicators as part of ${round.name} draw generation`,
      roundId: round.id,
      details: {
        panelSize: 1,
        debateCount: allocations.length,
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

    // Batch update allocated debates
    if (db && tournament.id) {
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
    await setFirestoreDoc("debates", debate.id, debate);
    if (previous && JSON.stringify(previous.adjudicators) !== JSON.stringify(debate.adjudicators)) {
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
    if (db && tournament?.id) {
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

  const submitBallot = async (ballot: BallotSubmission) => {
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
      await setFirestoreDoc("debates", updatedDebate.id, updatedDebate);
    }

    await setFirestoreDoc("ballots", finalBallot.id, finalBallot);
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
    }
  };

  const confirmBallot = async (
    ballotId: string,
    debateId: string,
    submittedBallot?: BallotSubmission
  ) => {
    const nowIso = new Date().toISOString();

    // 1. Transactional update in Firestore if available:
    // Read the ballot and its debate; mark this ballot confirmed and other versions for that debate discarded;
    // set debate.resultStatus = "confirmed" and write team points/speaker totals onto the debate slots.
    if (db && tournament?.id) {
      const debateRef = doc(db, "tournaments", tournament.id, "debates", debateId);
      const ballotRef = doc(db, "tournaments", tournament.id, "ballots", ballotId);

      // Query all ballots for this debate to mark other versions discarded
      const ballotsQuery = query(
        collection(db, "tournaments", tournament.id, "ballots"),
        where("debateId", "==", debateId)
      );
      const ballotsSnap = await getDocs(ballotsQuery);

      await runTransaction(db, async (tx) => {
        const debateDoc = await tx.get(debateRef);
        const targetBallotDoc = await tx.get(ballotRef);

        let confirmedBallotData: BallotSubmission;
        if (targetBallotDoc.exists()) {
          confirmedBallotData = targetBallotDoc.data() as BallotSubmission;
        } else {
          // If not in firestore yet, find in local state
          const localB = submittedBallot || ballots.find((b) => b.id === ballotId || b.debateId === debateId);
          if (!localB) throw new Error(`Ballot ${ballotId} not found.`);
          confirmedBallotData = localB;
        }

        // Set target ballot to confirmed and not discarded
        const updatedConfirmedBallot: BallotSubmission = {
          ...confirmedBallotData,
          confirmed: true,
          discarded: false,
          confirmedTimestamp: nowIso,
        };
        tx.set(ballotRef, cleanUndefined(updatedConfirmedBallot));

        // Mark other ballot versions for this debate as discarded
        ballotsSnap.forEach((dSnap) => {
          if (dSnap.id !== ballotId) {
            tx.update(dSnap.ref, { discarded: true, confirmed: false });
          }
        });

        // Update debate slots with team points and speaker totals
        if (debateDoc.exists()) {
          const debData = debateDoc.data() as Debate;
          const updatedTeams = { ...debData.teams };

          for (const [key, slot] of Object.entries(updatedTeams)) {
            const sideKey = key as DebateSide;
            if (slot && slot.teamId) {
              const teamScore = confirmedBallotData.teamScores?.[sideKey];
              const speakerScores = confirmedBallotData.speakerScores?.[sideKey] || [];
              const totalSpeakersScore = speakerScores.reduce(
                (sum, s) => sum + (s.score || 0),
                0
              );
              updatedTeams[sideKey] = {
                ...slot,
                points: teamScore ? teamScore.points : slot.points,
                speakerScoreTotal: totalSpeakersScore || teamScore?.totalSpeakerScore || slot.speakerScoreTotal,
              };
            }
          }

          tx.update(debateRef, cleanUndefined({
            resultStatus: "confirmed",
            teams: updatedTeams,
          }));
        }
      });
    }

    // 2. Update local state
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

  const addInstitution = async (instData: Omit<Institution, "id" | "tournamentId">) => {
    const newInst: Institution = {
      ...instData,
      id: `inst-${Date.now()}-${institutions.length + 1}`,
      tournamentId: tournament?.id || tournamentSlug,
    };
    const updated = [...institutions, newInst];
    setInstitutions(updated);
    persistLocal("institutions", updated);
    await setFirestoreDoc("institutions", newInst.id, newInst);
  };

  const updateInstitution = async (inst: Institution) => {
    const updated = institutions.map((i) => (i.id === inst.id ? inst : i));
    setInstitutions(updated);
    persistLocal("institutions", updated);
    await setFirestoreDoc("institutions", inst.id, inst);
  };

  const deleteInstitution = async (instId: string) => {
    const updated = institutions.filter((i) => i.id !== instId);
    setInstitutions(updated);
    persistLocal("institutions", updated);
    await deleteFirestoreDoc("institutions", instId);
  };

  const addTeam = async (teamData: Omit<Team, "id" | "tournamentId">) => {
    const newTeam: Team = {
      ...teamData,
      id: `team-${Date.now()}-${teams.length + 1}`,
      tournamentId: tournament?.id || tournamentSlug,
      privateUrlKey: teamData.privateUrlKey || generatePrivateKey("team"),
    };
    const updated = [...teams, newTeam];
    setTeams(updated);
    persistLocal("teams", updated);
    await setFirestoreDoc("teams", newTeam.id, newTeam);
  };

  const updateTeam = async (team: Team) => {
    const updated = teams.map((t) => (t.id === team.id ? team : t));
    setTeams(updated);
    persistLocal("teams", updated);
    await setFirestoreDoc("teams", team.id, team);
  };

  const deleteTeam = async (teamId: string) => {
    const updated = teams.filter((t) => t.id !== teamId);
    setTeams(updated);
    persistLocal("teams", updated);
    await deleteFirestoreDoc("teams", teamId);
  };

  const addAdjudicator = async (adjData: Omit<Adjudicator, "id" | "tournamentId">) => {
    const newAdj: Adjudicator = {
      ...adjData,
      id: `adj-${Date.now()}-${adjudicators.length + 1}`,
      tournamentId: tournament?.id || tournamentSlug,
      privateUrlKey: adjData.privateUrlKey || generatePrivateKey("adj"),
    };
    const updated = [...adjudicators, newAdj];
    setAdjudicators(updated);
    persistLocal("adjudicators", updated);
    await setFirestoreDoc("adjudicators", newAdj.id, newAdj);
  };

  const updateAdjudicator = async (adj: Adjudicator) => {
    const updated = adjudicators.map((a) => (a.id === adj.id ? adj : a));
    setAdjudicators(updated);
    persistLocal("adjudicators", updated);
    await setFirestoreDoc("adjudicators", adj.id, adj);
  };

  const deleteAdjudicator = async (adjId: string) => {
    const updated = adjudicators.filter((a) => a.id !== adjId);
    setAdjudicators(updated);
    persistLocal("adjudicators", updated);
    await deleteFirestoreDoc("adjudicators", adjId);
  };

  const addVenue = async (venueData: Omit<Venue, "id" | "tournamentId">) => {
    const newVenue: Venue = {
      ...venueData,
      id: `ven-${Date.now()}-${venues.length + 1}`,
      tournamentId: tournament?.id || tournamentSlug,
    };
    const updated = [...venues, newVenue];
    setVenues(updated);
    persistLocal("venues", updated);
    await setFirestoreDoc("venues", newVenue.id, newVenue);
  };

  const updateVenue = async (venue: Venue) => {
    const updated = venues.map((v) => (v.id === venue.id ? venue : v));
    setVenues(updated);
    persistLocal("venues", updated);
    await setFirestoreDoc("venues", venue.id, venue);
  };

  const deleteVenue = async (venueId: string) => {
    const updated = venues.filter((v) => v.id !== venueId);
    setVenues(updated);
    persistLocal("venues", updated);
    await deleteFirestoreDoc("venues", venueId);
  };

  const addMotion = async (motionData: Omit<Motion, "id" | "tournamentId">) => {
    const newMotion: Motion = {
      ...motionData,
      id: `motion-${Date.now()}-${motions.length + 1}`,
      tournamentId: tournament?.id || tournamentSlug,
    };
    const updated = [...motions, newMotion];
    setMotions(updated);
    persistLocal("motions", updated);
    await setFirestoreDoc("motions", newMotion.id, newMotion);
  };

  const updateMotion = async (motion: Motion) => {
    if (db && tournament?.id) {
      await setDoc(
        doc(db, "tournaments", tournament.id, "motions", motion.id),
        cleanUndefined(motion)
      );
    }
    const updated = motions.map((m) => (m.id === motion.id ? motion : m));
    setMotions(updated);
    persistLocal("motions", updated);
  };

  const deleteMotion = async (motionId: string) => {
    const updated = motions.filter((m) => m.id !== motionId);
    setMotions(updated);
    persistLocal("motions", updated);
    await deleteFirestoreDoc("motions", motionId);
  };

  const saveBreakCategories = async (cats: BreakCategory[]) => {
    setBreakCategories(cats);
    persistLocal("breaks", cats);
    if (db && tournament?.id) {
      const ops: Array<(batch: WriteBatch) => void> = [];
      for (const c of cats) {
        const ref = doc(db, "tournaments", tournament.id, "breakCategories", c.id);
        ops.push((batch) => batch.set(ref, c));
      }
      await commitChunkedBatches(ops);
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
    if (db && tournament?.id) {
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
    if (db && tournament.id) {
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

  const addFeedback = async (fbData: Omit<FeedbackSubmission, "id" | "tournamentId" | "timestamp">) => {
    const newFb: FeedbackSubmission = {
      ...fbData,
      id: `fb-${Date.now()}`,
      tournamentId: tournament?.id || tournamentSlug,
      timestamp: new Date().toISOString(),
    };
    const updated = [...feedback, newFb];
    setFeedback(updated);
    persistLocal("feedback", updated);
    await setFirestoreDoc("feedback", newFb.id, newFb);
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
      if (forceRegenerate || !a.privateUrlKey) {
        adjsChanged = true;
        return { ...a, privateUrlKey: generatePrivateKey("adj") };
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

    if (db && tournament?.id && (teamsChanged || adjsChanged)) {
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
  };

  return (
    <TournamentContext.Provider
      value={{
        tournament,
        loading,
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
        updateInstitution,
        deleteInstitution,
        addTeam,
        updateTeam,
        deleteTeam,
        addAdjudicator,
        updateAdjudicator,
        deleteAdjudicator,
        addVenue,
        updateVenue,
        deleteVenue,
        addMotion,
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

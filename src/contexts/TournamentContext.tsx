"use client";

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from "react";
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
import { generateRoundDraw } from "@/lib/draw/generator";
import { autoAllocateAdjudicators } from "@/lib/draw/allocator";
import { calculateStandings } from "@/lib/standings/calculator";
import { calculateBreaks, BreakCategoryResult } from "@/lib/breakqual/calculator";
import { generateDemoTournament } from "@/lib/demo/generator";

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
  institutions: Institution[];
  teamStandings: TeamStandingRow[];
  speakerStandings: SpeakerStandingRow[];
  replyStandings: SpeakerStandingRow[];
  breakResults: BreakCategoryResult[];
  isOwnerOrAdmin: boolean;

  // Mutations
  saveTournament: (t: Tournament) => Promise<void>;
  createRound: (name: string, abbr: string, stage: "preliminary" | "elimination") => Promise<Round>;
  updateRound: (round: Round) => Promise<void>;
  generateDraw: (roundId: string) => Promise<void>;
  autoAllocate: (roundId: string, panelSize?: number) => Promise<void>;
  updateDebate: (debate: Debate) => Promise<void>;
  updateDebates: (debates: Debate[]) => Promise<void>;
  submitBallot: (ballot: BallotSubmission) => Promise<void>;
  confirmBallot: (ballotId: string, debateId: string) => Promise<void>;
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
  saveBreakCategories: (categories: BreakCategory[]) => Promise<void>;
  addFeedback: (fb: Omit<FeedbackSubmission, "id" | "tournamentId" | "timestamp">) => Promise<void>;
  loadDemoData: () => Promise<void>;
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

      // 1. Read local cache first for instant UI response
      let localTournament: Tournament | null = null;
      try {
        const localT = localStorage.getItem(`${storagePrefix}_meta`);
        if (localT) {
          localTournament = JSON.parse(localT);
          if (isMounted) setTournament(localTournament);
        }

        const localRounds = localStorage.getItem(`${storagePrefix}_rounds`);
        if (localRounds && isMounted) {
          const parsed = JSON.parse(localRounds);
          setRounds(parsed);
          if (parsed.length > 0) setActiveRound(parsed[0]);
        }

        const localTeams = localStorage.getItem(`${storagePrefix}_teams`);
        if (localTeams && isMounted) setTeams(JSON.parse(localTeams));

        const localAdjs = localStorage.getItem(`${storagePrefix}_adjudicators`);
        if (localAdjs && isMounted) setAdjudicators(JSON.parse(localAdjs));

        const localVenues = localStorage.getItem(`${storagePrefix}_venues`);
        if (localVenues && isMounted) setVenues(JSON.parse(localVenues));

        const localMotions = localStorage.getItem(`${storagePrefix}_motions`);
        if (localMotions && isMounted) setMotions(JSON.parse(localMotions));

        const localBreaks = localStorage.getItem(`${storagePrefix}_breaks`);
        if (localBreaks && isMounted) setBreakCategories(JSON.parse(localBreaks));

        const localDebates = localStorage.getItem(`${storagePrefix}_debates`);
        if (localDebates && isMounted) setDebates(JSON.parse(localDebates));

        const localBallots = localStorage.getItem(`${storagePrefix}_ballots`);
        if (localBallots && isMounted) setBallots(JSON.parse(localBallots));

        const localFeedback = localStorage.getItem(`${storagePrefix}_feedback`);
        if (localFeedback && isMounted) setFeedback(JSON.parse(localFeedback));

        const localInstitutions = localStorage.getItem(`${storagePrefix}_institutions`);
        if (localInstitutions && isMounted) setInstitutions(JSON.parse(localInstitutions));
      } catch (e) {
        console.warn("Error reading local storage cache:", e);
      }

      // Check if this is the in-memory/local demo tournament
      if (tournamentSlug === "wudc-demo") {
        if (!localTournament && isMounted) {
          const bundle = generateDemoTournament(
            "World Universities Debating Championship (Demo)",
            "wudc-demo",
            "bp"
          );
          setTournament(bundle.tournament);
          setRounds(bundle.rounds);
          setActiveRound(bundle.rounds[bundle.rounds.length - 1] || null);
          setTeams(bundle.teams);
          setAdjudicators(bundle.adjudicators);
          setInstitutions(bundle.institutions);
          setVenues(bundle.venues);
          setMotions(bundle.motions);
          setBreakCategories(bundle.breakCategories);
          setDebates(bundle.debates);
          setBallots(bundle.ballots);

          persistLocal("meta", bundle.tournament);
          persistLocal("rounds", bundle.rounds);
          persistLocal("teams", bundle.teams);
          persistLocal("adjudicators", bundle.adjudicators);
          persistLocal("institutions", bundle.institutions);
          persistLocal("venues", bundle.venues);
          persistLocal("motions", bundle.motions);
          persistLocal("breaks", bundle.breakCategories);
          persistLocal("debates", bundle.debates);
          persistLocal("ballots", bundle.ballots);
        }
        if (isMounted) setLoading(false);
        return;
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
            // 10 subcollection listeners: institutions, teams, adjudicators, venues, rounds, debates, ballots, motions, feedback, breakCategories
            // Total 11 listeners. Show loading until every listener has delivered its first snapshot!
            const totalListeners = 11;
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
                // Keep existing activeRound if present, or set to latest
                setActiveRound((prev) => {
                  if (prev) {
                    const match = rList.find((r) => r.id === prev.id);
                    return match || rList[rList.length - 1];
                  }
                  return rList[rList.length - 1];
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

  // Dynamic Standings Recalculation (Instantaneous in-browser compute)
  const standingsResult = useMemo(() => {
    if (!tournament) return { teams: [], speakers: [], replies: [] };
    return calculateStandings(tournament, rounds, teams, debates, ballots);
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
    setTournament(t);
    persistLocal("meta", t);
    try {
      if (db) {
        await setDoc(doc(db, "tournaments", t.id), t, { merge: true });
      }
    } catch (e) {
      console.warn("Firestore sync warning:", e);
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
      completed: false,
      createdAt: new Date().toISOString(),
    };

    const updated = [...rounds, newRound];
    setRounds(updated);
    setActiveRound(newRound);
    persistLocal("rounds", updated);

    await setFirestoreDoc("rounds", newRound.id, newRound);
    return newRound;
  };

  const updateRound = async (round: Round) => {
    const updated = rounds.map((r) => (r.id === round.id ? round : r));
    setRounds(updated);
    if (activeRound?.id === round.id) setActiveRound(round);
    persistLocal("rounds", updated);

    await setFirestoreDoc("rounds", round.id, round);
  };

  const generateDraw = async (roundId: string) => {
    const round = rounds.find((r) => r.id === roundId);
    if (!round || !tournament) return;

    // Filter past debates before this round
    const pastDebates = debates.filter((d) => d.roundSeq < round.seq);

    const generated = generateRoundDraw({
      tournament,
      round,
      teams,
      venues,
      pastDebates,
      standings: teamStandings,
    });

    // Auto-allocate judges
    const teamsMap = new Map<string, Team>();
    teams.forEach((t) => teamsMap.set(t.id, t));
    const pastAdjTeams = new Map<string, Set<string>>();

    const allocations = autoAllocateAdjudicators(generated, teamsMap, adjudicators, pastAdjTeams);
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
  };

  const autoAllocate = async (roundId: string, panelSize: number = 1) => {
    const roundDebates = debates.filter((d) => d.roundId === roundId);
    if (roundDebates.length === 0 || !tournament) return;

    const teamsMap = new Map<string, Team>();
    teams.forEach((t) => teamsMap.set(t.id, t));
    const pastAdjTeams = new Map<string, Set<string>>();

    const allocations = autoAllocateAdjudicators(roundDebates, teamsMap, adjudicators, pastAdjTeams, {
      panelSize,
      balancePanels: true,
      respectInstitutionConflicts: true,
      respectPersonalConflicts: true,
      respectHistoryConflicts: true,
    });

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
  };

  const updateDebate = async (debate: Debate) => {
    const updated = debates.map((d) => (d.id === debate.id ? debate : d));
    setDebates(updated);
    persistLocal("debates", updated);
    await setFirestoreDoc("debates", debate.id, debate);
  };

  const updateDebates = async (newDebates: Debate[]) => {
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

    // If ballot was marked confirmed upon submission, use transaction to confirm it
    if (finalBallot.confirmed && db && tournament?.id) {
      await confirmBallot(finalBallot.id, finalBallot.debateId);
      return;
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
  };

  const confirmBallot = async (ballotId: string, debateId: string) => {
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
          const localB = ballots.find((b) => b.id === ballotId || b.debateId === debateId);
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
    const confirmedBallot = ballots.find((b) => b.id === ballotId || b.debateId === debateId);
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
    const updated = motions.map((m) => (m.id === motion.id ? motion : m));
    setMotions(updated);
    persistLocal("motions", updated);
    await setFirestoreDoc("motions", motion.id, motion);
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
  };

  const loadDemoData = async () => {
    const bundle = generateDemoTournament(
      tournament?.name || "World Universities Debating Championship (Demo)",
      tournamentSlug,
      tournament?.format || "bp"
    );

    setTournament(bundle.tournament);
    setRounds(bundle.rounds);
    setActiveRound(bundle.rounds[bundle.rounds.length - 1] || null);
    setTeams(bundle.teams);
    setAdjudicators(bundle.adjudicators);
    setVenues(bundle.venues);
    setMotions(bundle.motions);
    setBreakCategories(bundle.breakCategories);
    setDebates(bundle.debates);
    setBallots(bundle.ballots);

    persistLocal("meta", bundle.tournament);
    persistLocal("rounds", bundle.rounds);
    persistLocal("teams", bundle.teams);
    persistLocal("adjudicators", bundle.adjudicators);
    persistLocal("institutions", bundle.institutions);
    persistLocal("venues", bundle.venues);
    persistLocal("motions", bundle.motions);
    persistLocal("breaks", bundle.breakCategories);
    persistLocal("debates", bundle.debates);
    persistLocal("ballots", bundle.ballots);

    if (db && tournament?.id) {
      const ops: Array<(batch: WriteBatch) => void> = [];

      const addItems = <T extends { id: string }>(subcoll: string, items: T[]) => {
        for (const item of items) {
          const ref = doc(db!, "tournaments", tournament.id, subcoll, item.id);
          ops.push((batch) => batch.set(ref, cleanUndefined(item)));
        }
      };

      addItems("rounds", bundle.rounds);
      addItems("teams", bundle.teams);
      addItems("adjudicators", bundle.adjudicators);
      addItems("institutions", bundle.institutions);
      addItems("venues", bundle.venues);
      addItems("motions", bundle.motions);
      addItems("breakCategories", bundle.breakCategories);
      addItems("debates", bundle.debates);
      addItems("ballots", bundle.ballots);

      await commitChunkedBatches(ops);
    }
  };

  return (
    <TournamentContext.Provider
      value={{
        tournament,
        loading,
        rounds,
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
        teamStandings,
        speakerStandings,
        replyStandings,
        breakResults,
        isOwnerOrAdmin,
        saveTournament,
        createRound,
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
        saveBreakCategories,
        addFeedback,
        loadDemoData,
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

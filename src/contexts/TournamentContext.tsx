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
  TournamentFormat,
} from "@/types";
import { db } from "@/lib/firebase";
import {
  collection,
  doc,
  setDoc,
  getDocs,
  onSnapshot,
  query,
} from "firebase/firestore";
import { generateRoundDraw } from "@/lib/draw/generator";
import { autoAllocateAdjudicators } from "@/lib/draw/allocator";
import { calculateStandings } from "@/lib/standings/calculator";
import { calculateBreaks, BreakCategoryResult } from "@/lib/breakqual/calculator";
import { generateDemoTournament, DemoTournamentBundle } from "@/lib/demo/generator";

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
  teamStandings: TeamStandingRow[];
  speakerStandings: SpeakerStandingRow[];
  replyStandings: SpeakerStandingRow[];
  breakResults: BreakCategoryResult[];

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

export function TournamentProvider({
  tournamentSlug,
  children,
}: {
  tournamentSlug: string;
  children: React.ReactNode;
}) {
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

  const storagePrefix = `crabbytab_t_${tournamentSlug}`;

  // Helper to persist state to local storage
  const persistLocal = useCallback((key: string, data: any) => {
    try {
      localStorage.setItem(`${storagePrefix}_${key}`, JSON.stringify(data));
    } catch (e) {
      console.warn("LocalStorage save error:", e);
    }
  }, [storagePrefix]);

  // Load initial data
  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      setLoading(true);

      // Check LocalStorage cache first
      try {
        const localT = localStorage.getItem(`${storagePrefix}_meta`);
        if (localT) {
          const parsedT = JSON.parse(localT);
          if (isMounted) setTournament(parsedT);
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
      } catch (e) {
        console.warn("Error reading local storage cache:", e);
      }

      // If no tournament exists yet, initialize a default one or demo bundle
      const localTCheck = localStorage.getItem(`${storagePrefix}_meta`);
      if (!localTCheck) {
        // Auto-generate default tournament shell
        const defaultT: Tournament = {
          id: `tourn-${tournamentSlug}`,
          name: tournamentSlug === "wudc-demo" ? "World Universities Debating Championship (Demo)" : `${tournamentSlug.toUpperCase()} Tournament`,
          shortName: tournamentSlug === "wudc-demo" ? "WUDC Demo" : tournamentSlug.toUpperCase(),
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

        if (tournamentSlug === "wudc-demo") {
          const bundle = generateDemoTournament("World Universities Debating Championship (Demo)", "wudc-demo", "bp");
          if (isMounted) {
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
            persistLocal("venues", bundle.venues);
            persistLocal("motions", bundle.motions);
            persistLocal("breaks", bundle.breakCategories);
            persistLocal("debates", bundle.debates);
            persistLocal("ballots", bundle.ballots);
          }
        } else {
          if (isMounted) {
            setTournament(defaultT);
            persistLocal("meta", defaultT);
          }
        }
      }

      if (isMounted) setLoading(false);
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [tournamentSlug, storagePrefix, persistLocal]);

  // Dynamic Standings Recalculation (Memoized, instantaneous in-browser compute)
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

  const createRound = async (name: string, abbr: string, stage: "preliminary" | "elimination") => {
    const nextSeq = rounds.length + 1;
    const newRound: Round = {
      id: `round-${tournament?.id || tournamentSlug}-${nextSeq}`,
      tournamentId: tournament?.id || tournamentSlug,
      seq: nextSeq,
      name,
      abbreviation: abbr,
      stage,
      drawType: nextSeq === 1 ? "random" : "power_paired",
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
    return newRound;
  };

  const updateRound = async (round: Round) => {
    const updated = rounds.map((r) => (r.id === round.id ? round : r));
    setRounds(updated);
    if (activeRound?.id === round.id) setActiveRound(round);
    persistLocal("rounds", updated);
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

    // Replace debates for this round
    const otherDebates = debates.filter((d) => d.roundId !== roundId);
    const updatedDebates = [...otherDebates, ...generated];
    setDebates(updatedDebates);
    persistLocal("debates", updatedDebates);

    // Update round draw status
    const updatedRound: Round = { ...round, drawStatus: "draft" };
    await updateRound(updatedRound);
  };

  const autoAllocate = async (roundId: string, panelSize: number = 1) => {
    const roundDebates = debates.filter((d) => d.roundId === roundId);
    if (roundDebates.length === 0) return;

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
  };

  const updateDebate = async (debate: Debate) => {
    const updated = debates.map((d) => (d.id === debate.id ? debate : d));
    setDebates(updated);
    persistLocal("debates", updated);
  };

  const updateDebates = async (newDebates: Debate[]) => {
    setDebates(newDebates);
    persistLocal("debates", newDebates);
  };

  const submitBallot = async (ballot: BallotSubmission) => {
    const existingIdx = ballots.findIndex((b) => b.debateId === ballot.debateId);
    let updatedBallots: BallotSubmission[];

    if (existingIdx >= 0) {
      updatedBallots = ballots.map((b) => (b.debateId === ballot.debateId ? ballot : b));
    } else {
      updatedBallots = [...ballots, ballot];
    }

    setBallots(updatedBallots);
    persistLocal("ballots", updatedBallots);

    // Update debate result status
    const debate = debates.find((d) => d.id === ballot.debateId);
    if (debate) {
      const updatedDebate: Debate = {
        ...debate,
        resultStatus: ballot.confirmed ? "confirmed" : "draft",
      };
      await updateDebate(updatedDebate);
    }
  };

  const confirmBallot = async (ballotId: string, debateId: string) => {
    const updatedBallots = ballots.map((b) =>
      b.id === ballotId || b.debateId === debateId
        ? {
            ...b,
            confirmed: true,
            confirmedTimestamp: new Date().toISOString(),
          }
        : b
    );
    setBallots(updatedBallots);
    persistLocal("ballots", updatedBallots);

    const debate = debates.find((d) => d.id === debateId);
    if (debate) {
      await updateDebate({ ...debate, resultStatus: "confirmed" });
    }
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
  };

  const updateTeam = async (team: Team) => {
    const updated = teams.map((t) => (t.id === team.id ? team : t));
    setTeams(updated);
    persistLocal("teams", updated);
  };

  const deleteTeam = async (teamId: string) => {
    const updated = teams.filter((t) => t.id !== teamId);
    setTeams(updated);
    persistLocal("teams", updated);
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
  };

  const updateAdjudicator = async (adj: Adjudicator) => {
    const updated = adjudicators.map((a) => (a.id === adj.id ? adj : a));
    setAdjudicators(updated);
    persistLocal("adjudicators", updated);
  };

  const deleteAdjudicator = async (adjId: string) => {
    const updated = adjudicators.filter((a) => a.id !== adjId);
    setAdjudicators(updated);
    persistLocal("adjudicators", updated);
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
  };

  const updateVenue = async (venue: Venue) => {
    const updated = venues.map((v) => (v.id === venue.id ? venue : v));
    setVenues(updated);
    persistLocal("venues", updated);
  };

  const deleteVenue = async (venueId: string) => {
    const updated = venues.filter((v) => v.id !== venueId);
    setVenues(updated);
    persistLocal("venues", updated);
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
  };

  const updateMotion = async (motion: Motion) => {
    const updated = motions.map((m) => (m.id === motion.id ? motion : m));
    setMotions(updated);
    persistLocal("motions", updated);
  };

  const saveBreakCategories = async (cats: BreakCategory[]) => {
    setBreakCategories(cats);
    persistLocal("breaks", cats);
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
    persistLocal("venues", bundle.venues);
    persistLocal("motions", bundle.motions);
    persistLocal("breaks", bundle.breakCategories);
    persistLocal("debates", bundle.debates);
    persistLocal("ballots", bundle.ballots);
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
        saveTournament,
        createRound,
        updateRound,
        generateDraw,
        autoAllocate,
        updateDebate,
        updateDebates,
        submitBallot,
        confirmBallot,
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

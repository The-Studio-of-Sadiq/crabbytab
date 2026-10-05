"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter, useParams } from "next/navigation";
import { useTournament } from "@/contexts/TournamentContext";
import {
  Sliders,
  Save,
  CheckCircle2,
  Shield,
  Eye,
  Shuffle,
  FileCheck2,
  Trash2,
  Clock,
  Trophy,
  Users2,
  UserCheck,
  Scale,
  Calendar,
  AlertTriangle,
} from "lucide-react";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import {
  TournamentPreferences,
  TournamentFormat,
  OddBracketMethod,
  PairingMethod,
  ConflictAvoidance,
  PullupRestriction,
  BPPullupDistribution,
  BPPositionCost,
  BPAssignmentMethod,
  ByeTeamResults,
  ByeTeamSelectionMethod,
} from "@/types";
import { PrecedenceEditor, ExtraMetricsEditor } from "@/components/setup/PrecedenceEditor";
import {
  TEAM_METRIC_LABELS,
  SPEAKER_METRIC_LABELS,
  BP_ONLY_TEAM_METRICS,
  TWO_TEAM_ONLY_TEAM_METRICS,
} from "@/lib/standings/metrics";
import { resolveTeamPrecedence, resolveSpeakerPrecedence } from "@/lib/standings/precedence";

type SettingsCategory = "draw" | "rounds" | "format" | "scoring" | "standings" | "visibility" | "all";

const SETTINGS_CATEGORIES: { id: SettingsCategory; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "draw", label: "Draw rules", icon: Shuffle },
  { id: "rounds", label: "Round settings", icon: Clock },
  { id: "format", label: "Format & Teams", icon: Shield },
  { id: "scoring", label: "Scoring & Ballots", icon: FileCheck2 },
  { id: "standings", label: "Standings rules", icon: Trophy },
  { id: "visibility", label: "Public visibility", icon: Eye },
  { id: "all", label: "All Settings", icon: Sliders },
];

function ConfigFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams();
  const tournamentSlug = params.tournamentSlug as string;

  const {
    tournament,
    saveTournament,
    rounds,
    debates,
    ballots,
    setPreliminaryRoundCount,
    deleteRound,
  } = useTournament();

  const categoryParam = searchParams.get("category") as SettingsCategory | null;
  const initialCategory: SettingsCategory =
    categoryParam && ["draw", "rounds", "format", "scoring", "standings", "visibility", "all"].includes(categoryParam)
      ? categoryParam
      : "all";

  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(initialCategory);

  useEffect(() => {
    if (categoryParam && ["draw", "rounds", "format", "scoring", "standings", "visibility", "all"].includes(categoryParam)) {
      setActiveCategory(categoryParam);
    }
  }, [categoryParam]);

  const handleSelectCategory = (cat: SettingsCategory) => {
    setActiveCategory(cat);
    router.replace(`/${tournamentSlug}/config?category=${cat}`, { scroll: false });
  };

  const defaultPrefs: TournamentPreferences = {
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
    // Tabbycat Draw Rules defaults:
    minAdjScoreToVote: 1.5,
    adjConflictPenalty: 1000000,
    adjHistoryPenalty: 10000,
    importanceMismatchPenalty: 10000000,
    skipAdjCheckins: false,
    noPanellistAdjs: false,
    noTraineeAdjs: false,
    teamInstitutionPenalty: 1,
    teamHistoryPenalty: 1000,
    avoidSameInstitution: true,
    avoidTeamHistory: true,
    previouslySawPullupPenalty: 0,
    sideBalancePenalty: 0,
    pairingDeviationPenalty: 0,
    maxTimesPerSide: 5,
    maxAllowedSideImbalance: 0,
    preliminaryPanelsPerScheduleSlot: 1,
    oddBracketMethod: "intermediate_bubble",
    pairingMethod: "fold",
    conflictAvoidance: "one_up_one_down",
    pullupRestriction: "none",
    pullupPenalty: 0,
    bpPullupDistribution: "anywhere",
    bpPositionCost: "renyi_entropy",
    renyiOrder: 1.0,
    bpPositionCostExponent: 4.0,
    bpAssignmentMethod: "hungarian",
    byeTeamResults: "absent",
    byeTeamSelectionMethod: "none",
    marginIncludesDissenters: true,
    ballotIntroExplanation: "",
    teamScoreIncludesGhosts: false,
  };

  const [format, setFormat] = useState<TournamentFormat>(tournament?.format || "bp");
  const [prefs, setPrefs] = useState<TournamentPreferences>(() => ({
    ...defaultPrefs,
    ...(tournament?.preferences || {}),
  }));

  useEffect(() => {
    if (tournament) {
      setFormat(tournament.format || "bp");
      setPrefs((p) => ({
        ...defaultPrefs,
        ...p,
        ...(tournament.preferences || {}),
      }));
    }
  }, [tournament]);

  const [savedSuccess, setSavedSuccess] = useState(false);
  const [prelimRoundCount, setPrelimRoundCount] = useState(0);
  const [isSavingRoundCount, setIsSavingRoundCount] = useState(false);
  const [roundCountError, setRoundCountError] = useState("");
  const [roundToDeleteId, setRoundToDeleteId] = useState("");
  const [showDeleteRoundConfirm, setShowDeleteRoundConfirm] = useState(false);
  const [isDeletingRound, setIsDeletingRound] = useState(false);
  const [deleteRoundError, setDeleteRoundError] = useState("");
  const activePrelimCount = rounds.filter((round) => round.stage === "preliminary").length;
  const roundToDelete = rounds.find((round) => round.id === roundToDeleteId);
  const debatesToDelete = roundToDelete ? debates.filter((debate) => debate.roundId === roundToDelete.id) : [];
  const ballotsToDelete = roundToDelete
    ? ballots.filter((ballot) => ballot.roundId === roundToDelete.id || debatesToDelete.some((debate) => debate.id === ballot.debateId))
    : [];

  useEffect(() => {
    setPrelimRoundCount(activePrelimCount);
  }, [activePrelimCount]);

  const handleRoundCountSave = async () => {
    if (!Number.isInteger(prelimRoundCount) || prelimRoundCount < 0 || prelimRoundCount > 20) {
      setRoundCountError("Enter a whole number from 0 to 20.");
      return;
    }

    setIsSavingRoundCount(true);
    setRoundCountError("");
    try {
      await setPreliminaryRoundCount(prelimRoundCount);
    } catch {
      setRoundCountError("Could not update the preliminary round count.");
    } finally {
      setIsSavingRoundCount(false);
    }
  };

  const handleRoundDelete = async () => {
    if (!roundToDelete) return;
    setIsDeletingRound(true);
    setDeleteRoundError("");
    try {
      await deleteRound(roundToDelete.id);
      setRoundToDeleteId("");
      setShowDeleteRoundConfirm(false);
    } catch {
      setDeleteRoundError("The round could not be deleted from the database. Please try again.");
    } finally {
      setIsDeletingRound(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tournament) return;

    await saveTournament({
      ...tournament,
      format,
      preferences: prefs,
      updatedAt: new Date().toISOString(),
    });

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const showAll = activeCategory === "all";

  return (
    <div className="max-w-4xl space-y-6 pb-12">
      {/* Header */}
      <div className="border-b border-[#d0d7de] pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center space-x-2">
            <Sliders className="w-6 h-6 text-blue-600" />
            <span>Tournament Configuration</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Configure debate format rules, draw algorithms, scoring parameters, and public visibility.
          </p>
        </div>

        {savedSuccess && (
          <div className="inline-flex items-center space-x-1.5 px-3 py-1 bg-emerald-100 border border-emerald-300 text-emerald-800 text-xs font-bold rounded">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Settings Saved!</span>
          </div>
        )}
      </div>

      {/* Category Tabs Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-[#d0d7de] pb-2 text-xs">
        {SETTINGS_CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => handleSelectCategory(cat.id)}
              className={`px-3 py-1.5 font-semibold rounded-md flex items-center gap-1.5 transition whitespace-nowrap ${
                isActive
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{cat.label}</span>
            </button>
          );
        })}
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* ============================================================ */}
        {/* 1. DRAW RULES (Tabbycat Draw Rules) */}
        {/* ============================================================ */}
        {(showAll || activeCategory === "draw") && (
          <div className="space-y-5">
            {/* Header intro */}
            <div className="border-b border-gray-200 pb-2">
              <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Shuffle className="w-5 h-5 text-blue-600" />
                <span>Draw Rules</span>
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Parameters controlling team pairing, side allocation, conflict penalties, and adjudicator auto-allocation.
              </p>
            </div>

            {/* A. Adjudicator Auto-Allocation & Panels */}
            <div className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-xs space-y-4">
              <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2 border-b border-gray-100 pb-2">
                <UserCheck className="w-4 h-4 text-indigo-600" />
                <span>Adjudicator Allocation & Panel Rules</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Minimum adjudicator score to vote
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={prefs.minAdjScoreToVote ?? 1.5}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, minAdjScoreToVote: parseFloat(e.target.value) || 0 }))
                    }
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    The auto-allocator will only take adjudicators at or above this score as voting panellists
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Adjudicator conflict penalty
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={prefs.adjConflictPenalty ?? 1000000}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, adjConflictPenalty: Math.max(0, parseInt(e.target.value, 10) || 0) }))
                    }
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    Penalty applied by adjudicator auto-allocator for conflicts
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Adjudicator history penalty
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={prefs.adjHistoryPenalty ?? 10000}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, adjHistoryPenalty: Math.max(0, parseInt(e.target.value, 10) || 0) }))
                    }
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    Penalty applied by adjudicator auto-allocator for history
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Importance mismatch penalty
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={prefs.importanceMismatchPenalty ?? 10000000}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, importanceMismatchPenalty: Math.max(0, parseInt(e.target.value, 10) || 0) }))
                    }
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    Penalty applied by preformed panel auto-allocator for priority mismatch
                  </p>
                </div>
              </div>

              <div className="space-y-2 border-t border-gray-100 pt-3 text-xs">
                <label className="flex items-center space-x-2.5 p-2 rounded bg-gray-50 border border-gray-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(prefs.skipAdjCheckins)}
                    onChange={(e) => setPrefs((p) => ({ ...p, skipAdjCheckins: e.target.checked }))}
                    className="rounded border-gray-300 text-blue-600"
                  />
                  <div>
                    <span className="font-semibold text-gray-800 block">Skip adjudicator check-ins</span>
                    <span className="text-[11px] text-gray-500">Automatically make all adjudicators available for all rounds</span>
                  </div>
                </label>

                <label className="flex items-center space-x-2.5 p-2 rounded bg-gray-50 border border-gray-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(prefs.noPanellistAdjs)}
                    onChange={(e) => setPrefs((p) => ({ ...p, noPanellistAdjs: e.target.checked }))}
                    className="rounded border-gray-300 text-blue-600"
                  />
                  <div>
                    <span className="font-semibold text-gray-800 block">No panellist adjudicators</span>
                    <span className="text-[11px] text-gray-500">Hide panellist positions in the UI (and don&apos;t allocate them)</span>
                  </div>
                </label>

                <label className="flex items-center space-x-2.5 p-2 rounded bg-gray-50 border border-gray-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(prefs.noTraineeAdjs)}
                    onChange={(e) => setPrefs((p) => ({ ...p, noTraineeAdjs: e.target.checked }))}
                    className="rounded border-gray-300 text-blue-600"
                  />
                  <div>
                    <span className="font-semibold text-gray-800 block">No trainee adjudicators</span>
                    <span className="text-[11px] text-gray-500">Hide trainee positions in the UI (and don&apos;t allocate them)</span>
                  </div>
                </label>
              </div>
            </div>

            {/* B. Team Clashes & Conflict Avoidance */}
            <div className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-xs space-y-4">
              <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2 border-b border-gray-100 pb-2">
                <Users2 className="w-4 h-4 text-amber-600" />
                <span>Team Conflicts & Clashes</span>
              </h3>

              <div className="space-y-3 text-xs">
                <label className="flex items-center space-x-2.5 p-2.5 rounded bg-gray-50 border border-gray-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={prefs.avoidSameInstitution !== false}
                    onChange={(e) => setPrefs((p) => ({ ...p, avoidSameInstitution: e.target.checked }))}
                    className="rounded border-gray-300 text-blue-600"
                  />
                  <div>
                    <span className="font-semibold text-gray-800 block">Avoid same institution</span>
                    <span className="text-[11px] text-gray-500">If checked, the draw will try to avoid pairing teams against their own institution</span>
                  </div>
                </label>

                <label className="flex items-center space-x-2.5 p-2.5 rounded bg-gray-50 border border-gray-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={prefs.avoidTeamHistory !== false}
                    onChange={(e) => setPrefs((p) => ({ ...p, avoidTeamHistory: e.target.checked }))}
                    className="rounded border-gray-300 text-blue-600"
                  />
                  <div>
                    <span className="font-semibold text-gray-800 block">Avoid team history</span>
                    <span className="text-[11px] text-gray-500">If checked, the draw will try to avoid having teams see each other twice</span>
                  </div>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-gray-100 pt-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Team institution penalty
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={prefs.teamInstitutionPenalty ?? 1}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, teamInstitutionPenalty: Math.max(0, parseInt(e.target.value, 10) || 0) }))
                    }
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    Penalty applied by conflict avoidance method for teams seeing their own institution
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Team history penalty
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={prefs.teamHistoryPenalty ?? 1000}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, teamHistoryPenalty: Math.max(0, parseInt(e.target.value, 10) || 0) }))
                    }
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    Penalty applied by conflict avoidance method for teams seeing each other twice or more
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Previously saw pullup penalty
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={prefs.previouslySawPullupPenalty ?? 0}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, previouslySawPullupPenalty: Math.max(0, parseInt(e.target.value, 10) || 0) }))
                    }
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    Penalty applied by conflict avoidance method for teams being in a pullup many times. Leave 0 for no penalty.
                  </p>
                </div>
              </div>
            </div>

            {/* C. Side Allocations & Balancing */}
            <div className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-xs space-y-4">
              <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2 border-b border-gray-100 pb-2">
                <Scale className="w-4 h-4 text-emerald-600" />
                <span>Side Allocations & Balancing</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Side allocations method
                  </label>
                  <select
                    className="w-full border border-gray-300 rounded px-3 py-2 text-xs bg-white font-medium"
                    value={prefs.sideAllocationRule || "balanced"}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, sideAllocationRule: e.target.value as "balanced" | "random" }))
                    }
                  >
                    <option value="balanced">Balanced (prefer equalizing sides across rounds)</option>
                    <option value="random">Random</option>
                  </select>
                  <p className="text-[11px] text-gray-500 mt-1">
                    How affirmative/negative (or Gov/Opp) positions are assigned
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Maximum number of times per side
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={prefs.maxTimesPerSide ?? 5}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, maxTimesPerSide: Math.max(1, parseInt(e.target.value, 10) || 1) }))
                    }
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    Hard preference applied by minimum cost matching to disallow pairings where a team would debate more than this many times on the same side. WARNING: if you set this to a low value, the draw algorithm may be unable to find a valid draw.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Maximum allowed side imbalance
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={prefs.maxAllowedSideImbalance ?? 0}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, maxAllowedSideImbalance: Math.max(0, parseInt(e.target.value, 10) || 0) }))
                    }
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    A limit for the side imbalance, where a pairing will not be made if that requires a team to debate more times on one side than the selected number. For use with the graph generator, with 0 as disabled.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Side balance penalty
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={prefs.sideBalancePenalty ?? 0}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, sideBalancePenalty: Math.max(0, parseInt(e.target.value, 10) || 0) }))
                    }
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    Penalty applied by minimum cost matching to prefer pairings that balance sides.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Pairing deviation penalty
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={prefs.pairingDeviationPenalty ?? 0}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, pairingDeviationPenalty: Math.max(0, parseInt(e.target.value, 10) || 0) }))
                    }
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    Penalty applied by minimum cost matching to prefer pairings that follow the draw pairing method.
                  </p>
                </div>
              </div>
            </div>

            {/* D. Two-Team Bracket Matching & Conflict Avoidance */}
            <div className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-xs space-y-4">
              <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2 border-b border-gray-100 pb-2">
                <Shuffle className="w-4 h-4 text-blue-600" />
                <span>Two-Team Bracket Pairing & Conflict Avoidance</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Pairing method</label>
                  <select
                    className="w-full border border-gray-300 rounded px-3 py-2 text-xs bg-white font-medium"
                    value={prefs.pairingMethod ?? "fold"}
                    onChange={(e) => setPrefs((p) => ({ ...p, pairingMethod: e.target.value as PairingMethod }))}
                  >
                    <option value="fold">Fold (1 vs 10, 2 vs 9, ...)</option>
                    <option value="slide">Slide (1 vs 6, 2 vs 7, ...)</option>
                    <option value="adjacent">Adjacent (1 vs 2, 3 vs 4, ...)</option>
                    <option value="fold_top_adjacent_rest">Fold top room, adjacent for the rest</option>
                    <option value="random">Random within bracket</option>
                  </select>
                  <p className="text-[11px] text-gray-500 mt-1">
                    Slide: 1 vs 6, 2 vs 7, …. Fold: 1 vs 10, 2 vs 9, …. Adjacent: 1 vs 2, 3 vs 4, ….
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Conflict avoidance method</label>
                  <select
                    className="w-full border border-gray-300 rounded px-3 py-2 text-xs bg-white font-medium"
                    value={prefs.conflictAvoidance ?? "one_up_one_down"}
                    onChange={(e) => setPrefs((p) => ({ ...p, conflictAvoidance: e.target.value as ConflictAvoidance }))}
                  >
                    <option value="one_up_one_down">One-up-one-down (fast, local swaps)</option>
                    <option value="min_cost">Minimum cost (graph matching, finds true global best)</option>
                    <option value="off">Off</option>
                  </select>
                  <p className="text-[11px] text-gray-500 mt-1">
                    Method used to try to avoid teams facing each other multiple times or their own institution
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Odd bracket resolution method</label>
                  <select
                    className="w-full border border-gray-300 rounded px-3 py-2 text-xs bg-white font-medium"
                    value={prefs.oddBracketMethod ?? "intermediate_bubble"}
                    onChange={(e) => setPrefs((p) => ({ ...p, oddBracketMethod: e.target.value as OddBracketMethod }))}
                  >
                    <option value="intermediate_bubble">Intermediate brackets with bubble-up-bubble-down</option>
                    <option value="intermediate">Intermediate bubble room (top team)</option>
                    <option value="pullup_top">Pull up the top team from below</option>
                    <option value="pullup_bottom">Pull up the bottom team from below</option>
                    <option value="pullup_middle">Pull up the middle team from below</option>
                    <option value="pullup_random">Pull up a random team from below</option>
                  </select>
                  <p className="text-[11px] text-gray-500 mt-1">
                    How odd brackets are resolved (see documentation for further details)
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Pullup restriction</label>
                  <select
                    className="w-full border border-gray-300 rounded px-3 py-2 text-xs bg-white font-medium"
                    value={prefs.pullupRestriction ?? "none"}
                    onChange={(e) => setPrefs((p) => ({ ...p, pullupRestriction: e.target.value as PullupRestriction }))}
                  >
                    <option value="none">No restriction</option>
                    <option value="least_pulled">Teams pulled up the fewest times so far</option>
                    <option value="lowest_draw_strength_speaks">Lowest draw strength (speaks)</option>
                    <option value="lowest_draw_strength_wins">Lowest draw strength (wins)</option>
                  </select>
                  <p className="text-[11px] text-gray-500 mt-1">
                    If using pull-ups, restrict which teams can be pulled up. Two-team formats only. Has no effect on BP or intermediate brackets.
                  </p>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Pullup penalty</label>
                  <input
                    type="number"
                    min="0"
                    value={prefs.pullupPenalty ?? 0}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, pullupPenalty: Math.max(0, parseInt(e.target.value, 10) || 0) }))
                    }
                    className="w-full sm:w-64 border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    Penalty applied when determining which teams to pull up (for minimum cost matching). In BP, added to position costs when a team is placed above its points bracket; teams with fewer prior pull-ups are preferred. Set high enough to take precedence over side balance (e.g. 100000 with the default position cost exponent). Leave 0 for no preference.
                  </p>
                </div>
              </div>
            </div>

            {/* E. British Parliamentary (BP) Specific Draw Rules */}
            <div className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-xs space-y-4">
              <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2 border-b border-gray-100 pb-2">
                <Shield className="w-4 h-4 text-purple-600" />
                <span>British Parliamentary (BP) Draw Rules</span>
              </h3>
              <p className="text-xs text-gray-600">
                WUDC and standard BP position cost optimization, Hungarian assignment, and pullup distributions.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    BP pullup distribution
                  </label>
                  <select
                    className="w-full border border-gray-300 rounded px-3 py-2 text-xs bg-white font-medium"
                    value={prefs.bpPullupDistribution ?? "anywhere"}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, bpPullupDistribution: e.target.value as BPPullupDistribution }))
                    }
                  >
                    <option value="anywhere">Anywhere in bracket (WUDC-compliant)</option>
                    <option value="top">Top of bracket</option>
                    <option value="bottom">Bottom of bracket</option>
                  </select>
                  <p className="text-[11px] text-gray-500 mt-1">
                    In BP, how pullups are distributed. Only &quot;Anywhere&quot; is WUDC-compliant.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    BP position cost
                  </label>
                  <select
                    className="w-full border border-gray-300 rounded px-3 py-2 text-xs bg-white font-medium"
                    value={prefs.bpPositionCost ?? "renyi_entropy"}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, bpPositionCost: e.target.value as BPPositionCost }))
                    }
                  >
                    <option value="renyi_entropy">Rényi entropy</option>
                    <option value="std_dev">Standard deviation</option>
                  </select>
                  <p className="text-[11px] text-gray-500 mt-1">
                    In BP, which position cost function to use (see documentation for details)
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Rényi order (BP)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={prefs.renyiOrder ?? 1.0}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, renyiOrder: parseFloat(e.target.value) || 1.0 }))
                    }
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    Rényi order α, if BP position cost uses Rényi entropy. Shannon is α = 1, Hartley is α = 0, collision is α = 2. See documentation for details.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    BP position cost exponent
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={prefs.bpPositionCostExponent ?? 4.0}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, bpPositionCostExponent: parseFloat(e.target.value) || 4.0 }))
                    }
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    The BP position cost is raised to this power; higher exponents bias towards resolving fewer large position imbalances over more small ones. See documentation for details.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    BP assignment method
                  </label>
                  <select
                    className="w-full border border-gray-300 rounded px-3 py-2 text-xs bg-white font-medium"
                    value={prefs.bpAssignmentMethod ?? "hungarian"}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, bpAssignmentMethod: e.target.value as BPAssignmentMethod }))
                    }
                  >
                    <option value="hungarian">Hungarian algorithm with preshuffling (WUDC-compliant)</option>
                    <option value="random">Random assignment</option>
                  </select>
                  <p className="text-[11px] text-gray-500 mt-1">
                    In BP, which method to use to solve the assignment problem. Only Hungarian with preshuffling is WUDC-compliant.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Repeat matchup penalty</label>
                  <input
                    type="number"
                    min="0"
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                    value={prefs.repeatMatchupPenalty ?? 1000}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, repeatMatchupPenalty: Math.max(0, Number(e.target.value) || 0) }))
                    }
                  />
                  <p className="text-[11px] text-gray-500 mt-1">Clash penalty for 4-team BP room rematches</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Institution clash penalty</label>
                  <input
                    type="number"
                    min="0"
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                    value={prefs.institutionClashPenalty ?? 200}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, institutionClashPenalty: Math.max(0, Number(e.target.value) || 0) }))
                    }
                  />
                  <p className="text-[11px] text-gray-500 mt-1">Clash penalty for placing same-institution teams in a BP room</p>
                </div>
              </div>
            </div>

            {/* F. Scheduling & Byes */}
            <div className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-xs space-y-4">
              <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2 border-b border-gray-100 pb-2">
                <Calendar className="w-4 h-4 text-blue-600" />
                <span>Scheduling & Byes</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Preliminary panels per schedule slot
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={prefs.preliminaryPanelsPerScheduleSlot ?? 1}
                    onChange={(e) =>
                      setPrefs((p) => ({
                        ...p,
                        preliminaryPanelsPerScheduleSlot: Math.max(1, parseInt(e.target.value, 10) || 1),
                      }))
                    }
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    When greater than 1, consecutive preliminary rounds are treated as parallel panels in the same schedule slot (e.g. A and B). Current-round navigation and feedback eligibility use the shared slot. Round creation assigns schedule groups from this value.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Bye team results
                  </label>
                  <select
                    className="w-full border border-gray-300 rounded px-3 py-2 text-xs bg-white font-medium"
                    value={prefs.byeTeamResults ?? "absent"}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, byeTeamResults: e.target.value as ByeTeamResults }))
                    }
                  >
                    <option value="absent">Treat bye teams as absent</option>
                    <option value="win">Award win and average speaker score</option>
                  </select>
                  <p className="text-[11px] text-gray-500 mt-1">
                    How to handle teams who were marked available yet excluded from a round (a bye)
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Bye team selection method
                  </label>
                  <select
                    className="w-full border border-gray-300 rounded px-3 py-2 text-xs bg-white font-medium"
                    value={prefs.byeTeamSelectionMethod ?? "none"}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, byeTeamSelectionMethod: e.target.value as ByeTeamSelectionMethod }))
                    }
                  >
                    <option value="none">Don&apos;t choose bye teams</option>
                    <option value="lowest_ranked">Lowest ranked team</option>
                    <option value="random">Random team</option>
                  </select>
                  <p className="text-[11px] text-gray-500 mt-1">
                    If creating a draw with an uneven number of teams, how to decide who gets the bye (won&apos;t be allocated)
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* 2. ROUND SETTINGS */}
        {/* ============================================================ */}
        {(showAll || activeCategory === "rounds") && (
          <div className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2 border-b border-gray-100 pb-2">
              <Clock className="w-4 h-4 text-blue-600" />
              <span>Round Settings & Management</span>
            </h3>
            <p className="text-xs text-gray-600">
              Set the total number of preliminary rounds or safely delete specific individual rounds.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1" htmlFor="prelim-round-count">
                  Number of Preliminary Rounds
                </label>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <input
                    id="prelim-round-count"
                    type="number"
                    min={0}
                    max={20}
                    step={1}
                    value={prelimRoundCount}
                    onChange={(event) => setPrelimRoundCount(Number(event.target.value))}
                    className="w-32 border border-gray-300 rounded px-3 py-1.5 text-sm font-mono font-bold"
                  />
                  <button
                    type="button"
                    onClick={handleRoundCountSave}
                    disabled={isSavingRoundCount || prelimRoundCount === activePrelimCount}
                    className="px-3.5 py-1.5 bg-gray-900 hover:bg-black text-white rounded text-xs font-semibold disabled:opacity-50 transition"
                  >
                    {isSavingRoundCount ? "Updating..." : "Update Round Count"}
                  </button>
                </div>
                <p className="text-[11px] text-gray-500 mt-1.5">
                  Canceled rounds preserve their ballots and can be restored by increasing this count. Elimination rounds remain intact.
                </p>
                {roundCountError && <p className="text-xs text-red-600 mt-1">{roundCountError}</p>}
              </div>

              <div className="border-t border-gray-100 pt-4 space-y-2">
                <label className="block text-xs font-semibold text-gray-700" htmlFor="delete-round-select">
                  Delete an Individual Round
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    id="delete-round-select"
                    value={roundToDeleteId}
                    onChange={(event) => setRoundToDeleteId(event.target.value)}
                    className="w-full sm:max-w-xs border border-gray-300 rounded px-3 py-2 text-xs bg-white"
                  >
                    <option value="">Choose a round to delete...</option>
                    {rounds.map((round) => (
                      <option key={round.id} value={round.id}>
                        {round.name} ({round.stage})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowDeleteRoundConfirm(true)}
                    disabled={!roundToDelete || isDeletingRound}
                    className="inline-flex items-center justify-center gap-1.5 rounded border border-red-300 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 transition"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Delete Round</span>
                  </button>
                </div>
                {deleteRoundError && <p role="alert" className="text-xs text-red-600">{deleteRoundError}</p>}
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* 3. FORMAT & TEAMS */}
        {/* ============================================================ */}
        {(showAll || activeCategory === "format") && (
          <div className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2 border-b border-gray-100 pb-2">
              <Shield className="w-4 h-4 text-blue-600" />
              <span>Debate Format & Team Structure</span>
            </h3>
            <p className="text-xs text-gray-600">
              Define the parliamentary debate style, number of teams per debate, and speaker requirements.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Parliamentary Format
                </label>
                <select
                  value={format}
                  onChange={(e) => {
                    const newFmt = e.target.value as TournamentFormat;
                    setFormat(newFmt);
                    if (newFmt === "bp") {
                      setPrefs((p) => ({
                        ...p,
                        teamsInDebate: 4,
                        substantiveSpeakers: 2,
                        replyScoresEnabled: false,
                      }));
                    } else {
                      setPrefs((p) => ({
                        ...p,
                        teamsInDebate: 2,
                        substantiveSpeakers: 3,
                        replyScoresEnabled: true,
                      }));
                    }
                  }}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-xs font-semibold bg-white"
                >
                  <option value="bp">British Parliamentary (BP) — 4 Teams, 2 Speakers/Team</option>
                  <option value="uadc">Asian Parliamentary (UADC) — 2 Teams, 3 Speakers + Reply</option>
                  <option value="australs">Australs — 2 Teams, 3 Speakers + Reply</option>
                  <option value="wsdc">World Schools (WSDC) — 2 Teams, 3 Speakers + Reply</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Substantive Speakers per Team
                </label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={prefs.substantiveSpeakers}
                  onChange={(e) =>
                    setPrefs((p) => ({
                      ...p,
                      substantiveSpeakers: parseInt(e.target.value, 10),
                    }))
                  }
                  className="w-full border border-gray-300 rounded px-3 py-2 text-xs font-mono font-bold"
                />
              </div>

              <div className="md:col-span-2">
                <label className="flex items-center space-x-2.5 p-2 rounded bg-gray-50 border border-gray-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(prefs.replyScoresEnabled)}
                    onChange={(e) => setPrefs((p) => ({ ...p, replyScoresEnabled: e.target.checked }))}
                    className="rounded border-gray-300 text-blue-600"
                  />
                  <div>
                    <span className="font-semibold text-gray-800 text-xs block">Enable Reply Speech Scoring</span>
                    <span className="text-[11px] text-gray-500">
                      Standard for 3-speaker formats (Australs, UADC, WSDC) where a 4th speech is delivered as a half-length reply.
                    </span>
                  </div>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* 4. SCORING & BALLOTS */}
        {/* ============================================================ */}
        {(showAll || activeCategory === "scoring") && (
          <div className="space-y-4">
            <div className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-xs space-y-4">
              <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2 border-b border-gray-100 pb-2">
                <FileCheck2 className="w-4 h-4 text-emerald-600" />
                <span>Speaker Scoring Parameters</span>
              </h3>
              <p className="text-xs text-gray-600">
                Define the allowed bounds and step increments for substantive and reply speeches.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Minimum Speaker Score
                  </label>
                  <input
                    type="number"
                    value={prefs.minSpeakerScore}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, minSpeakerScore: parseFloat(e.target.value) || 68 }))
                    }
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">Default 68</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Maximum Speaker Score
                  </label>
                  <input
                    type="number"
                    value={prefs.maxSpeakerScore}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, maxSpeakerScore: parseFloat(e.target.value) || 84 }))
                    }
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">Default 84</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Score Step Increment
                  </label>
                  <select
                    value={prefs.stepSpeakerScore}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, stepSpeakerScore: parseFloat(e.target.value) || 1 }))
                    }
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono bg-white"
                  >
                    <option value={1}>1.0 (Integers only: 74, 75, 76...)</option>
                    <option value={0.5}>0.5 (Half points: 74.5, 75.0...)</option>
                  </select>
                  <p className="text-[11px] text-gray-500 mt-1">Allowed increments</p>
                </div>
              </div>

              {prefs.replyScoresEnabled && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-gray-100 pt-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Minimum Reply Score
                    </label>
                    <input
                      type="number"
                      value={prefs.minReplyScore ?? 34}
                      onChange={(e) =>
                        setPrefs((p) => ({ ...p, minReplyScore: parseFloat(e.target.value) || 34 }))
                      }
                      className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                    />
                    <p className="text-[11px] text-gray-500 mt-1">Default 34 (typically half of substantive min)</p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Maximum Reply Score
                    </label>
                    <input
                      type="number"
                      value={prefs.maxReplyScore ?? 42}
                      onChange={(e) =>
                        setPrefs((p) => ({ ...p, maxReplyScore: parseFloat(e.target.value) || 42 }))
                      }
                      className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                    />
                    <p className="text-[11px] text-gray-500 mt-1">Default 42 (typically half of substantive max)</p>
                  </div>
                </div>
              )}
            </div>

            {/* Ballot Rules & Options */}
            <div className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-xs space-y-4">
              <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2 border-b border-gray-100 pb-2">
                <FileCheck2 className="w-4 h-4 text-emerald-600" />
                <span>Ballot Rules & Options</span>
              </h3>

              <div className="space-y-4 text-xs">
                {/* Ballot introduction/explanation */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Ballot introduction/explanation
                  </label>
                  <textarea
                    rows={3}
                    value={prefs.ballotIntroExplanation ?? ""}
                    onChange={(e) => setPrefs((p) => ({ ...p, ballotIntroExplanation: e.target.value }))}
                    placeholder="Any explanatory text needed to introduce the ballot form, e.g. speaker scale"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    Any explanatory text needed to introduce the ballot form, e.g. speaker scale
                  </p>
                </div>

                {/* Margin includes dissenters */}
                <label className="flex items-center space-x-2.5 p-3 rounded bg-gray-50 border border-gray-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={prefs.marginIncludesDissenters ?? true}
                    onChange={(e) => setPrefs((p) => ({ ...p, marginIncludesDissenters: e.target.checked }))}
                    className="rounded border-gray-300 text-blue-600"
                  />
                  <div>
                    <span className="font-semibold text-gray-800 block">Margin includes dissenters</span>
                    <span className="text-[11px] text-gray-500">
                      If checked, a team&apos;s winning margin includes dissenting adjudicators
                    </span>
                  </div>
                </label>

                {/* Team score includes ghosts */}
                <label className="flex items-center space-x-2.5 p-3 rounded bg-gray-50 border border-gray-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(prefs.teamScoreIncludesGhosts)}
                    onChange={(e) => setPrefs((p) => ({ ...p, teamScoreIncludesGhosts: e.target.checked }))}
                    className="rounded border-gray-300 text-blue-600"
                  />
                  <div>
                    <span className="font-semibold text-gray-800 block">Team score includes ghosts</span>
                    <span className="text-[11px] text-gray-500">
                      If checked, all speaker scores, including for duplicate speeches, will be counted for team scores
                    </span>
                  </div>
                </label>

                {/* Require Double-Entry Ballot Verification */}
                <label className="flex items-center space-x-2.5 p-3 rounded bg-gray-50 border border-gray-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(prefs.ballotDoubleEntry)}
                    onChange={(e) => setPrefs((p) => ({ ...p, ballotDoubleEntry: e.target.checked }))}
                    className="rounded border-gray-300 text-blue-600"
                  />
                  <div>
                    <span className="font-semibold text-gray-800 block">Require Double-Entry Ballot Verification</span>
                    <span className="text-[11px] text-gray-500">
                      Two separate scorekeepers must enter ballots independently; differences are flagged for tabroom resolution.
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {/* Adjudicator Feedback */}
            <div className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-xs space-y-4">
              <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2 border-b border-gray-100 pb-2">
                <FileCheck2 className="w-4 h-4 text-emerald-600" />
                <span>Adjudicator Feedback</span>
              </h3>

              <div className="space-y-4 text-xs">
                <div className="p-3 rounded bg-gray-50 border border-gray-200 space-y-3">
                  <label className="flex items-center space-x-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={prefs.feedbackEnabled !== false}
                      onChange={(e) => setPrefs((p) => ({ ...p, feedbackEnabled: e.target.checked }))}
                      className="rounded border-gray-300 text-blue-600"
                    />
                    <span className="font-semibold text-gray-800">Enable Adjudicator Feedback Submission</span>
                  </label>

                  {prefs.feedbackEnabled !== false && (
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-200">
                      <div>
                        <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                          Minimum Feedback Score
                        </label>
                        <input
                          type="number"
                          value={prefs.feedbackMinScore ?? 1}
                          onChange={(e) =>
                            setPrefs((p) => ({ ...p, feedbackMinScore: parseInt(e.target.value, 10) || 1 }))
                          }
                          className="w-full border border-gray-300 rounded px-2.5 py-1 text-xs font-mono font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                          Maximum Feedback Score
                        </label>
                        <input
                          type="number"
                          value={prefs.feedbackMaxScore ?? 10}
                          onChange={(e) =>
                            setPrefs((p) => ({ ...p, feedbackMaxScore: parseInt(e.target.value, 10) || 10 }))
                          }
                          className="w-full border border-gray-300 rounded px-2.5 py-1 text-xs font-mono font-bold"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* 5. STANDINGS RULES */}
        {/* ============================================================ */}
        {(showAll || activeCategory === "standings") && (
          <div className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-xs space-y-5">
            <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2 border-b border-gray-100 pb-2">
              <Trophy className="w-4 h-4 text-amber-600" />
              <span>Standings Rules & Ranking Precedence</span>
            </h3>
            <p className="text-xs text-gray-600">
              The order teams and speakers are ranked in. Leave empty to use the format&apos;s standard default.
              This also dictates Swiss power-pairing brackets and breaking team qualifications.
            </p>

            <div>
              <h4 className="text-xs font-bold text-gray-800 mb-2">Team ranking precedence chain</h4>
              <PrecedenceEditor
                value={prefs.teamStandingsPrecedence ?? []}
                onChange={(teamStandingsPrecedence) => setPrefs((p) => ({ ...p, teamStandingsPrecedence }))}
                labels={TEAM_METRIC_LABELS}
                disabledIds={format === "bp" ? TWO_TEAM_ONLY_TEAM_METRICS : BP_ONLY_TEAM_METRICS}
              />
              <p className="text-[11px] text-gray-500 mt-1">
                Default for this format: {resolveTeamPrecedence(format, {}).map((m) => TEAM_METRIC_LABELS[m]).join(" \u2192 ")}
              </p>
            </div>

            <div>
              <h4 className="text-xs font-bold text-gray-800 mb-2">Extra team metrics (displayed, not ranked on)</h4>
              <ExtraMetricsEditor
                value={prefs.teamStandingsExtra ?? []}
                onChange={(teamStandingsExtra) => setPrefs((p) => ({ ...p, teamStandingsExtra }))}
                labels={TEAM_METRIC_LABELS}
                exclude={prefs.teamStandingsPrecedence ?? []}
              />
            </div>

            <div className="border-t border-gray-100 pt-4">
              <h4 className="text-xs font-bold text-gray-800 mb-2">Speaker ranking precedence chain</h4>
              <PrecedenceEditor
                value={prefs.speakerStandingsPrecedence ?? []}
                onChange={(speakerStandingsPrecedence) => setPrefs((p) => ({ ...p, speakerStandingsPrecedence }))}
                labels={SPEAKER_METRIC_LABELS}
              />
              <p className="text-[11px] text-gray-500 mt-1">
                Default: {resolveSpeakerPrecedence({}).map((m) => SPEAKER_METRIC_LABELS[m]).join(" \u2192 ")}
              </p>
            </div>

            <div>
              <h4 className="text-xs font-bold text-gray-800 mb-2">Extra speaker metrics (displayed, not ranked on)</h4>
              <ExtraMetricsEditor
                value={prefs.speakerStandingsExtra ?? []}
                onChange={(speakerStandingsExtra) => setPrefs((p) => ({ ...p, speakerStandingsExtra }))}
                labels={SPEAKER_METRIC_LABELS}
                exclude={prefs.speakerStandingsPrecedence ?? []}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Speaker score trim (for speaks_trimmed_mean)
              </label>
              <input
                type="number"
                min={0}
                className="w-32 border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                value={prefs.speakerTrim ?? 0}
                onChange={(e) => setPrefs((p) => ({ ...p, speakerTrim: Math.max(0, Number(e.target.value) || 0) }))}
              />
              <p className="text-[11px] text-gray-500 mt-1">Number of a speaker&apos;s lowest scores dropped before averaging.</p>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* 6. PUBLIC VISIBILITY */}
        {/* ============================================================ */}
        {(showAll || activeCategory === "visibility") && (
          <div className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2 border-b border-gray-100 pb-2">
              <Eye className="w-4 h-4 text-purple-600" />
              <span>Public Website Visibility Controls</span>
            </h3>
            <p className="text-xs text-gray-600">
              Control which sections of the tournament website are visible to debaters and the general public.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <label className="flex items-center space-x-2.5 p-3 rounded bg-gray-50 border border-gray-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.publicDraw !== false}
                  onChange={(e) => setPrefs((p) => ({ ...p, publicDraw: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600"
                />
                <div>
                  <span className="font-semibold text-gray-800 block">Public Draw Display</span>
                  <span className="text-[11px] text-gray-500">Allow public viewers to see confirmed round pairings and room allocations.</span>
                </div>
              </label>

              <label className="flex items-center space-x-2.5 p-3 rounded bg-gray-50 border border-gray-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.publicResults !== false}
                  onChange={(e) => setPrefs((p) => ({ ...p, publicResults: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600"
                />
                <div>
                  <span className="font-semibold text-gray-800 block">Public Results & Scores</span>
                  <span className="text-[11px] text-gray-500">Allow public viewers to view ballot results for non-silent rounds.</span>
                </div>
              </label>

              <label className="flex items-center space-x-2.5 p-3 rounded bg-gray-50 border border-gray-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.publicStandings !== false}
                  onChange={(e) => setPrefs((p) => ({ ...p, publicStandings: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600"
                />
                <div>
                  <span className="font-semibold text-gray-800 block">Public Standings Tab</span>
                  <span className="text-[11px] text-gray-500">Allow public tab spectators to see team and speaker leaderboards.</span>
                </div>
              </label>

              <label className="flex items-center space-x-2.5 p-3 rounded bg-gray-50 border border-gray-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.publicMotions !== false}
                  onChange={(e) => setPrefs((p) => ({ ...p, publicMotions: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600"
                />
                <div>
                  <span className="font-semibold text-gray-800 block">Public Motions Page</span>
                  <span className="text-[11px] text-gray-500">Publish released debate motions and information slides on the public page.</span>
                </div>
              </label>
            </div>
          </div>
        )}

        {/* Submit */}
        <div className="flex items-center justify-between pt-3 border-t border-[#d0d7de]">
          <span className="text-xs text-gray-500">
            Changes apply to <strong>{tournament?.name}</strong>.
          </span>
          <button
            type="submit"
            className="inline-flex items-center space-x-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded shadow-xs transition"
          >
            <Save className="w-4 h-4" />
            <span>Save Tournament Settings</span>
          </button>
        </div>
      </form>

      {showDeleteRoundConfirm && roundToDelete && (
        <ConfirmActionDialog
          title={`Delete ${roundToDelete.name}?`}
          description={`This permanently deletes the round, ${debatesToDelete.length} debate(s), and ${ballotsToDelete.length} ballot(s), and removes motion assignments to this round. This cannot be undone.`}
          confirmLabel="Yes, delete round"
          onConfirm={handleRoundDelete}
          onCancel={() => setShowDeleteRoundConfirm(false)}
          variant="danger"
          isBusy={isDeletingRound}
          error={deleteRoundError}
        />
      )}
    </div>
  );
}

export default function ConfigPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-4xl p-6 text-sm text-gray-500">
          Loading tournament configuration...
        </div>
      }
    >
      <ConfigFormContent />
    </Suspense>
  );
}

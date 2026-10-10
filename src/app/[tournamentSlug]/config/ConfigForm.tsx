"use client";

import React, { useEffect, useState } from "react";
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
  FeedbackQuestion,
} from "@/types";
import { PrecedenceEditor, ExtraMetricsEditor } from "@/components/setup/PrecedenceEditor";
import {
  TEAM_METRIC_LABELS,
  SPEAKER_METRIC_LABELS,
  BP_ONLY_TEAM_METRICS,
  TWO_TEAM_ONLY_TEAM_METRICS,
} from "@/lib/standings/metrics";
import { resolveTeamPrecedence, resolveSpeakerPrecedence } from "@/lib/standings/precedence";
import { validateFeedbackQuestions } from "@/lib/feedback/questions";

type SettingsCategory = "draw" | "rounds" | "format" | "scoring" | "standings" | "visibility";

const SETTINGS_CATEGORIES: Record<SettingsCategory, string> = {
  draw: "Draw Rules",
  rounds: "Round Settings",
  format: "Format & Teams",
  scoring: "Scoring & Ballots",
  standings: "Standings Rules",
  visibility: "Public Visibility",
};

function ConfigFormContent({ category }: { category: SettingsCategory }) {
  const {
    tournament,
    saveTournament,
    rounds,
    debates,
    ballots,
    updateRound,
    setPreliminaryRoundCount,
    deleteRound,
  } = useTournament();

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
    publicCheckInStatus: false,
    checkInExpiresAfterHours: 0,
    feedbackEnabled: true,
    feedbackMinScore: 1,
    feedbackMaxScore: 10,
    feedbackQuestions: [],
    // Tabbycat Draw Rules defaults:
    minAdjScoreToVote: 1.5,
    adjConflictPenalty: 1000000,
    adjHistoryPenalty: 10000,
    importanceMismatchPenalty: 10000000,
    adjudicatorPanelStrategy: "crabbytab_v1",
    usePreformedPanels: false,
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
  const [feedbackQuestionError, setFeedbackQuestionError] = useState("");
  const [questionnaireSource, setQuestionnaireSource] = useState<"team" | "adjudicator">("team");
  const currentFeedbackQuestions = questionnaireSource === "team"
    ? prefs.teamFeedbackQuestions ?? prefs.feedbackQuestions ?? []
    : prefs.adjudicatorFeedbackQuestions ?? prefs.feedbackQuestions ?? [];
  const [prelimRoundCount, setPrelimRoundCount] = useState(0);
  const [isSavingRoundCount, setIsSavingRoundCount] = useState(false);
  const [roundCountError, setRoundCountError] = useState("");
  const [roundToDeleteId, setRoundToDeleteId] = useState("");
  const [showDeleteRoundConfirm, setShowDeleteRoundConfirm] = useState(false);
  const [isDeletingRound, setIsDeletingRound] = useState(false);
  const [deleteRoundError, setDeleteRoundError] = useState("");
  const [roundFeedbackError, setRoundFeedbackError] = useState("");
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
    if (prefs.feedbackEnabled !== false) {
      const questionError = validateFeedbackQuestions(prefs.teamFeedbackQuestions ?? prefs.feedbackQuestions ?? []) ||
        validateFeedbackQuestions(prefs.adjudicatorFeedbackQuestions ?? prefs.feedbackQuestions ?? []);
      if (questionError) {
        setFeedbackQuestionError(questionError);
        return;
      }
    }
    setFeedbackQuestionError("");

    await saveTournament({
      ...tournament,
      format,
      preferences: prefs,
      updatedAt: new Date().toISOString(),
    });

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const updateFeedbackQuestion = (id: string, updates: Partial<FeedbackQuestion>) => {
    setPrefs((current) => ({
      ...current,
      ...(questionnaireSource === "team"
        ? {
            teamFeedbackQuestions: (current.teamFeedbackQuestions ?? current.feedbackQuestions ?? []).map((question) =>
              question.id === id ? { ...question, ...updates } : question
            ),
          }
        : {
            adjudicatorFeedbackQuestions: (current.adjudicatorFeedbackQuestions ?? current.feedbackQuestions ?? []).map((question) =>
              question.id === id ? { ...question, ...updates } : question
            ),
          }),
    }));
  };

  const addFeedbackQuestion = () => {
    const question: FeedbackQuestion = {
      id: `feedback-${globalThis.crypto.randomUUID()}`,
      label: "",
      type: "text",
      required: false,
    };
    setPrefs((current) => ({
      ...current,
      ...(questionnaireSource === "team"
        ? { teamFeedbackQuestions: [...(current.teamFeedbackQuestions ?? current.feedbackQuestions ?? []), question] }
        : { adjudicatorFeedbackQuestions: [...(current.adjudicatorFeedbackQuestions ?? current.feedbackQuestions ?? []), question] }),
    }));
  };

  return (
    <div className="max-w-4xl space-y-6 pb-12">
      {/* Header */}
      <div className="border-b border-[#d0d7de] pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center space-x-2">
            <Sliders className="w-6 h-6 text-blue-600" />
            <span>{SETTINGS_CATEGORIES[category]}</span>
          </h1>
        </div>

        {savedSuccess && (
          <div className="inline-flex items-center space-x-1.5 px-3 py-1 bg-emerald-100 border border-emerald-300 text-emerald-800 text-xs font-bold rounded">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Settings Saved!</span>
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* ============================================================ */}
        {/* 1. DRAW RULES (Tabbycat Draw Rules) */}
        {/* ============================================================ */}
        {category === "draw" && (
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
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Adjudicator allocation strategy
                  </label>
                  <select
                    className="w-full border border-gray-300 rounded px-3 py-2 text-xs bg-white font-medium"
                    value={prefs.adjudicatorPanelStrategy ?? "crabbytab_v1"}
                    onChange={(e) =>
                      setPrefs((p) => ({
                        ...p,
                        adjudicatorPanelStrategy: e.target.value as TournamentPreferences["adjudicatorPanelStrategy"],
                      }))
                    }
                  >
                    <option value="crabbytab_v1">Preset 1 — Current CrabbyTab allocation</option>
                    <option value="panel_average">Panel average — match each panel to debate priority</option>
                  </select>
                  <p className="text-[11px] text-gray-500 mt-1">
                    Preset 1 preserves the existing strength-ranking behavior. Panel average instead matches the
                    average strength of each complete voting panel to its debate priority; the strongest eligible
                    panel member is still promoted to chair.
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <label className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 p-3">
                    <input
                      type="checkbox"
                      checked={Boolean(prefs.usePreformedPanels)}
                      onChange={(event) => setPrefs((current) => ({
                        ...current,
                        usePreformedPanels: event.target.checked,
                      }))}
                      className="mt-0.5 rounded border-gray-300 text-blue-600"
                    />
                    <span>
                      <span className="block text-xs font-semibold text-gray-800">Allocate preformed panels as a unit</span>
                      <span className="mt-1 block text-[11px] text-gray-500">
                        Assign adjudicators a shared <code>preformed_panel_id</code> in their CSV. Each group must have
                        exactly the configured number of available voting adjudicators; the group remains together and
                        is matched to debates by panel-average strength. A group with unavailable members is not split.
                      </span>
                    </span>
                  </label>
                </div>

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
                    Absolute limit: a side assignment that would exceed this count is rejected. Draw generation reports an error if no valid assignment exists.
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
                    Absolute limit on the difference between a team&apos;s most- and least-used sides after assignment. An assignment that exceeds it is rejected; 0 disables this limit.
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
                    Retained for saved preferences; current draw generation does not apply this setting.
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
                    <option value="one_up_one_down">One-up-one-down (local swaps may change matchups)</option>
                    <option value="min_cost">Minimum cost (legacy; preserves configured matchups)</option>
                    <option value="off">Off</option>
                  </select>
                  <p className="text-[11px] text-gray-500 mt-1">
                    One-up-one-down can change the selected pairing method&apos;s matchups to avoid clashes. Minimum cost is retained for saved preferences but preserves the selected method&apos;s exact matchups.
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
                    <option value="sum_squared_deviations">Sum of squared deviations</option>
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
        {category === "rounds" && (
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
                <div>
                  <h4 className="text-xs font-semibold text-gray-700">Feedback by round</h4>
                  <p className="text-[11px] text-gray-500 mt-1">
                    Override the tournament feedback setting for individual rounds.
                  </p>
                  <div className="mt-2 space-y-1">
                    {rounds.map((round) => (
                      <label key={round.id} className="flex items-center gap-2 rounded border border-gray-200 px-3 py-2 text-xs">
                        <input
                          type="checkbox"
                          checked={round.feedbackEnabled ?? (
                            round.stage !== "elimination" || prefs.feedbackInEliminationRounds !== false
                          )}
                          onChange={(event) => {
                            setRoundFeedbackError("");
                            void updateRound({ ...round, feedbackEnabled: event.target.checked })
                              .catch(() => setRoundFeedbackError(`Could not update feedback for ${round.name}.`));
                          }}
                          className="rounded border-gray-300 text-blue-600"
                        />
                        <span>{round.name} ({round.stage})</span>
                      </label>
                    ))}
                  </div>
                  {roundFeedbackError && <p role="alert" className="mt-2 text-xs text-red-600">{roundFeedbackError}</p>}
                </div>
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
        {category === "format" && (
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
        {category === "scoring" && (
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
                    <div className="space-y-4 pt-2 border-t border-gray-200">
                    <div className="grid grid-cols-2 gap-3">
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
                    </div>
                  )}
                </div>
                {prefs.feedbackEnabled !== false && (
                  <div className="space-y-3 rounded border border-gray-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-bold text-gray-800">Custom feedback questions</h4>
                        <p className="text-[11px] text-gray-500">Configure separate questionnaires by feedback submitter.</p>
                      </div>
                      <button
                        type="button"
                        onClick={addFeedbackQuestion}
                        className="rounded border border-blue-300 bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-blue-800 hover:bg-blue-100"
                      >
                        Add question
                      </button>
                    </div>
                    <label className="block max-w-xs text-[11px] font-semibold text-gray-700">
                      Questionnaire
                      <select
                        value={questionnaireSource}
                        onChange={(event) => {
                          if (event.target.value === "team" || event.target.value === "adjudicator") {
                            setQuestionnaireSource(event.target.value);
                          }
                        }}
                        className="mt-1 w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs"
                      >
                        <option value="team">Team feedback</option>
                        <option value="adjudicator">Adjudicator feedback</option>
                      </select>
                    </label>
                    {feedbackQuestionError && <p role="alert" className="text-xs text-red-700">{feedbackQuestionError}</p>}
                    {currentFeedbackQuestions.map((question, index) => (
                      <div key={question.id} className="grid grid-cols-1 gap-2 rounded bg-gray-50 p-3 sm:grid-cols-2">
                        <label className="text-[11px] font-semibold text-gray-700">
                          Question {index + 1}
                          <input
                            value={question.label}
                            onChange={(event) => updateFeedbackQuestion(question.id, { label: event.target.value })}
                            className="mt-1 w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs"
                            placeholder="Enter a question"
                          />
                        </label>
                        <label className="text-[11px] font-semibold text-gray-700">
                          Answer type
                          <select
                            value={question.type}
                            onChange={(event) => updateFeedbackQuestion(question.id, {
                              type: event.target.value as FeedbackQuestion["type"],
                            })}
                            className="mt-1 w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs"
                          >
                            <option value="text">Short text</option>
                            <option value="textarea">Long text</option>
                            <option value="scale">Number scale</option>
                            <option value="yes_no">Yes / No</option>
                            <option value="select_one">Select one</option>
                            <option value="select_many">Select many</option>
                          </select>
                        </label>
                        {(question.type === "select_one" || question.type === "select_many") && (
                          <label className="text-[11px] font-semibold text-gray-700 sm:col-span-2">
                            Options (comma-separated)
                            <input
                              value={(question.options ?? []).join(", ")}
                              onChange={(event) => updateFeedbackQuestion(question.id, {
                                options: event.target.value.split(",").map((value) => value.trim()).filter(Boolean),
                              })}
                              className="mt-1 w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs"
                              placeholder="Option one, Option two"
                            />
                          </label>
                        )}
                        {question.type === "scale" && (
                          <div className="flex gap-2">
                            <label className="flex-1 text-[11px] font-semibold text-gray-700">
                              Minimum
                              <input
                                type="number"
                                value={question.min ?? 1}
                                onChange={(event) => updateFeedbackQuestion(question.id, { min: Number(event.target.value) })}
                                className="mt-1 w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs"
                              />
                            </label>
                            <label className="flex-1 text-[11px] font-semibold text-gray-700">
                              Maximum
                              <input
                                type="number"
                                value={question.max ?? 5}
                                onChange={(event) => updateFeedbackQuestion(question.id, { max: Number(event.target.value) })}
                                className="mt-1 w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs"
                              />
                            </label>
                          </div>
                        )}
                        <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
                          <input
                            type="checkbox"
                            checked={question.required}
                            onChange={(event) => updateFeedbackQuestion(question.id, { required: event.target.checked })}
                          />
                          Required
                        </label>
                        <button
                          type="button"
                          onClick={() => setPrefs((current) => questionnaireSource === "team"
                            ? {
                                ...current,
                                teamFeedbackQuestions: (current.teamFeedbackQuestions ?? current.feedbackQuestions ?? [])
                                  .filter((item) => item.id !== question.id),
                              }
                            : {
                                ...current,
                                adjudicatorFeedbackQuestions: (current.adjudicatorFeedbackQuestions ?? current.feedbackQuestions ?? [])
                                  .filter((item) => item.id !== question.id),
                              })}
                          className="justify-self-end text-xs font-semibold text-red-700 hover:text-red-900"
                        >
                          Remove question
                        </button>
                      </div>
                    ))}
                    <div className="grid gap-3 border-t border-gray-200 pt-3 sm:grid-cols-2">
                      <label className="text-[11px] font-semibold text-gray-700">
                        Feedback path
                        <select
                          value={prefs.feedbackPath || "two_way"}
                          onChange={(event) => {
                            const path = event.target.value;
                            if (path === "chairs_to_panel" || path === "two_way" || path === "everyone") {
                              setPrefs((current) => ({ ...current, feedbackPath: path }));
                            }
                          }}
                          className="mt-1 w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs"
                        >
                          <option value="chairs_to_panel">Chair to panel (team feedback remains open)</option>
                          <option value="two_way">Chair and panel two-way (team feedback remains open)</option>
                          <option value="everyone">Everyone in the debate</option>
                        </select>
                      </label>
                      <label className="flex items-start gap-2 text-[11px] font-medium text-gray-700">
                        <input
                          type="checkbox"
                          checked={prefs.feedbackInEliminationRounds !== false}
                          onChange={(event) => setPrefs((current) => ({
                            ...current,
                            feedbackInEliminationRounds: event.target.checked,
                          }))}
                        />
                        Collect feedback in elimination rounds
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* 5. STANDINGS RULES */}
        {/* ============================================================ */}
        {category === "standings" && (
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
        {category === "visibility" && (
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

              <label className="flex items-center space-x-2.5 p-3 rounded bg-gray-50 border border-gray-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.publicCheckInStatus === true}
                  onChange={(e) => setPrefs((p) => ({ ...p, publicCheckInStatus: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-600"
                />
                <div>
                  <span className="font-semibold text-gray-800 block">Public check-in counts</span>
                  <span className="text-[11px] text-gray-500">Publish round totals only; no participant names or individual check-in details.</span>
                </div>
              </label>
            </div>

            <label className="block max-w-xs text-xs font-semibold text-gray-700">
              Check-in expiry (hours; 0 means never)
              <input
                type="number"
                min="0"
                step="1"
                value={prefs.checkInExpiresAfterHours ?? 0}
                onChange={(event) => setPrefs((current) => ({
                  ...current,
                  checkInExpiresAfterHours: Math.max(0, Number(event.target.value) || 0),
                }))}
                className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 font-mono text-xs"
              />
              <span className="mt-1 block text-[11px] font-normal text-gray-500">
                Applies to timestamped check-ins. Legacy records without check-in timestamps remain unchanged.
              </span>
            </label>
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

export default function ConfigForm({ category }: { category: SettingsCategory }) {
  return <ConfigFormContent category={category} />;
}

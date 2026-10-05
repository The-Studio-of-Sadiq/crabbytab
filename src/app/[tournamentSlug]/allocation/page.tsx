"use client";

import React, { useState, useMemo } from "react";
import { useTournament } from "@/contexts/TournamentContext";
import { Adjudicator, Debate, Team } from "@/types";
import {
  calculateAdjDebateConflict,
  calculateAdjudicatorFeedbackScores,
  calculateDebatePriorities,
  computeBreakLiveness,
  effectiveAdjScore,
  DebatePriorityInfo,
} from "@/lib/draw/allocator";
import {
  Users2,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  X,
  UserPlus,
  ShieldAlert,
  Search,
  ArrowRightLeft,
  GripVertical,
  Building2,
  Trash2,
  RotateCcw,
  Layers,
  Gauge,
  Zap,
  TrendingUp,
} from "lucide-react";
import { safeJsonParse } from "@/lib/safeJson";

interface JudgeDragPayload {
  type: "judge";
  sourceType: "available" | "chair" | "panellist" | "trainee";
  adjId: string;
  adjName: string;
  sourceDebateId?: string;
}

export default function AllocationPage() {
  const {
    tournament,
    activeRound,
    rounds,
    setActiveRound,
    debates,
    adjudicators,
    feedback,
    teams,
    autoAllocate,
    updateDebate,
    updateDebates,
    teamStandings,
    breakCategories,
  } = useTournament();

  const [searchQuery, setSearchQuery] = useState("");
  const [panelSize, setPanelSize] = useState<number>(1);
  const [isAllocating, setIsAllocating] = useState(false);
  const [selectedAdjForManual, setSelectedAdjForManual] = useState<Adjudicator | null>(null);
  const [showPriorityPanel, setShowPriorityPanel] = useState(true);

  // Drag & drop state
  const [draggingJudge, setDraggingJudge] = useState<JudgeDragPayload | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  const roundDebates = useMemo(
    () => (activeRound ? debates.filter((d) => d.roundId === activeRound.id && !d.byeTeamId) : []),
    [debates, activeRound]
  );

  const teamsMap = useMemo(() => {
    const map = new Map<string, Team>();
    teams.forEach((t) => map.set(t.id, t));
    return map;
  }, [teams]);

  const adjsMap = useMemo(() => {
    const map = new Map<string, Adjudicator>();
    adjudicators.forEach((a) => map.set(a.id, a));
    return map;
  }, [adjudicators]);

  const feedbackScores = useMemo(
    () => calculateAdjudicatorFeedbackScores(feedback),
    [feedback]
  );

  // ─── Debate Priorities ───
  const debatePriorities = useMemo(() => {
    if (roundDebates.length === 0 || !tournament) return new Map<string, DebatePriorityInfo>();

    const completedPrelimRounds = rounds.filter(
      (r) => r.stage === "preliminary" && !r.cancelled && r.completed
    ).length;
    const totalPrelimRounds = rounds.filter(
      (r) => r.stage === "preliminary" && !r.cancelled
    ).length;

    const breakLiveness = computeBreakLiveness(
      teams,
      teamStandings,
      breakCategories,
      completedPrelimRounds,
      totalPrelimRounds,
      tournament.format === "bp"
    );

    const priorities = calculateDebatePriorities(roundDebates, teamsMap, breakLiveness);
    const map = new Map<string, DebatePriorityInfo>();
    priorities.forEach((p) => map.set(p.debateId, p));
    return map;
  }, [roundDebates, tournament, teams, teamStandings, breakCategories, rounds, teamsMap]);

  // Sort debates by priority
  const sortedRoundDebates = useMemo(() => {
    return [...roundDebates].sort((a, b) => {
      const pa = debatePriorities.get(a.id)?.priorityScore ?? 0;
      const pb = debatePriorities.get(b.id)?.priorityScore ?? 0;
      return pb - pa;
    });
  }, [roundDebates, debatePriorities]);

  // Determine which adjudicators are currently assigned in this round
  const assignedAdjIds = useMemo(() => {
    const set = new Set<string>();
    roundDebates.forEach((d) => {
      if (d.adjudicators?.chairId) set.add(d.adjudicators.chairId);
      (d.adjudicators?.panellistIds || []).forEach((id) => set.add(id));
      (d.adjudicators?.traineeIds || []).forEach((id) => set.add(id));
    });
    return set;
  }, [roundDebates]);

  const availableAdjs = useMemo(
    () => adjudicators.filter((a) => !assignedAdjIds.has(a.id) && a.checkedIn !== false),
    [adjudicators, assignedAdjIds]
  );

  const filteredAdjs = availableAdjs.filter((a) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      a.name.toLowerCase().includes(q) ||
      (a.institutionName || "").toLowerCase().includes(q)
    );
  });

  // Sort available adjs by effective score (highest first)
  const sortedFilteredAdjs = useMemo(
    () => [...filteredAdjs].sort(
      (a, b) => effectiveAdjScore(b, feedbackScores) - effectiveAdjScore(a, feedbackScores)
    ),
    [filteredAdjs, feedbackScores]
  );

  // ─── Panel Strength per Debate ───
  const debatePanelStrengths = useMemo(() => {
    const map = new Map<string, number>();
    for (const debate of roundDebates) {
      const adjs = debate.adjudicators;
      if (!adjs) { map.set(debate.id, 0); continue; }
      const panelAdjIds: string[] = [];
      if (adjs.chairId) panelAdjIds.push(adjs.chairId);
      panelAdjIds.push(...(adjs.panellistIds || []));
      if (panelAdjIds.length === 0) { map.set(debate.id, 0); continue; }
      const scores = panelAdjIds
        .map((id) => adjsMap.get(id))
        .filter((a): a is Adjudicator => a !== undefined)
        .map((a) => effectiveAdjScore(a, feedbackScores));
      const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
      map.set(debate.id, Math.round(avg * 10) / 10);
    }
    return map;
  }, [roundDebates, adjsMap, feedbackScores]);

  // Priority score color coding
  const getPriorityColor = (score: number) => {
    if (score >= 7) return "bg-red-100 text-red-800 border-red-300";
    if (score >= 4) return "bg-amber-100 text-amber-800 border-amber-300";
    return "bg-green-100 text-green-800 border-green-300";
  };

  const getStrengthColor = (strength: number) => {
    if (strength >= 7) return "text-emerald-700 bg-emerald-50";
    if (strength >= 4) return "text-blue-700 bg-blue-50";
    return "text-gray-600 bg-gray-50";
  };

  // Assign Chair to Debate
  const assignChair = async (debateId: string, adj: Adjudicator) => {
    const debate = roundDebates.find((d) => d.id === debateId);
    if (!debate) return;

    const updatedDebatesList = debates.map((d) => {
      if (d.roundId !== activeRound?.id) return d;
      let newAdjSlots = { ...d.adjudicators };

      if (newAdjSlots.chairId === adj.id) {
        newAdjSlots.chairId = undefined;
        newAdjSlots.chairName = undefined;
      }
      if (newAdjSlots.panellistIds?.includes(adj.id)) {
        const idx = newAdjSlots.panellistIds.indexOf(adj.id);
        const pIds = [...newAdjSlots.panellistIds];
        const pNames = [...newAdjSlots.panellistNames];
        pIds.splice(idx, 1);
        pNames.splice(idx, 1);
        newAdjSlots.panellistIds = pIds;
        newAdjSlots.panellistNames = pNames;
      }
      if (newAdjSlots.traineeIds?.includes(adj.id)) {
        const idx = newAdjSlots.traineeIds.indexOf(adj.id);
        const tIds = [...newAdjSlots.traineeIds];
        const tNames = [...newAdjSlots.traineeNames];
        tIds.splice(idx, 1);
        tNames.splice(idx, 1);
        newAdjSlots.traineeIds = tIds;
        newAdjSlots.traineeNames = tNames;
      }

      if (d.id === debateId) {
        newAdjSlots.chairId = adj.id;
        newAdjSlots.chairName = adj.name;
      }

      return { ...d, adjudicators: newAdjSlots };
    });

    await updateDebates(updatedDebatesList);
    setSelectedAdjForManual(null);
  };

  const removeChair = async (debateId: string) => {
    const debate = roundDebates.find((d) => d.id === debateId);
    if (!debate) return;
    const updatedDebate: Debate = {
      ...debate,
      adjudicators: {
        ...debate.adjudicators,
        chairId: undefined,
        chairName: undefined,
      },
    };
    await updateDebate(updatedDebate);
  };

  const addPanellist = async (debateId: string, adj: Adjudicator) => {
    const debate = roundDebates.find((d) => d.id === debateId);
    if (!debate) return;
    if (debate.adjudicators?.panellistIds?.includes(adj.id)) return;

    const updatedDebatesList = debates.map((d) => {
      if (d.roundId !== activeRound?.id) return d;
      let newAdjSlots = { ...d.adjudicators };

      if (newAdjSlots.chairId === adj.id) {
        newAdjSlots.chairId = undefined;
        newAdjSlots.chairName = undefined;
      }
      if (newAdjSlots.panellistIds?.includes(adj.id)) {
        const idx = newAdjSlots.panellistIds.indexOf(adj.id);
        const pIds = [...newAdjSlots.panellistIds];
        const pNames = [...newAdjSlots.panellistNames];
        pIds.splice(idx, 1);
        pNames.splice(idx, 1);
        newAdjSlots.panellistIds = pIds;
        newAdjSlots.panellistNames = pNames;
      }
      if (newAdjSlots.traineeIds?.includes(adj.id)) {
        const idx = newAdjSlots.traineeIds.indexOf(adj.id);
        const tIds = [...newAdjSlots.traineeIds];
        const tNames = [...newAdjSlots.traineeNames];
        tIds.splice(idx, 1);
        tNames.splice(idx, 1);
        newAdjSlots.traineeIds = tIds;
        newAdjSlots.traineeNames = tNames;
      }

      if (d.id === debateId) {
        newAdjSlots.panellistIds = [...(newAdjSlots.panellistIds || []), adj.id];
        newAdjSlots.panellistNames = [...(newAdjSlots.panellistNames || []), adj.name];
      }

      return { ...d, adjudicators: newAdjSlots };
    });

    await updateDebates(updatedDebatesList);
    setSelectedAdjForManual(null);
  };

  const removePanellist = async (debateId: string, adjId: string) => {
    const debate = roundDebates.find((d) => d.id === debateId);
    if (!debate) return;
    const panellistIdx = (debate.adjudicators.panellistIds || []).indexOf(adjId);
    if (panellistIdx < 0) return;
    const newIds = [...debate.adjudicators.panellistIds];
    const newNames = [...debate.adjudicators.panellistNames];
    newIds.splice(panellistIdx, 1);
    newNames.splice(panellistIdx, 1);
    const updatedDebate: Debate = {
      ...debate,
      adjudicators: {
        ...debate.adjudicators,
        panellistIds: newIds,
        panellistNames: newNames,
      },
    };
    await updateDebate(updatedDebate);
  };

  const addTrainee = async (debateId: string, adj: Adjudicator) => {
    const debate = roundDebates.find((d) => d.id === debateId);
    if (!debate) return;
    if (debate.adjudicators?.traineeIds?.includes(adj.id)) return;

    const updatedDebatesList = debates.map((d) => {
      if (d.roundId !== activeRound?.id) return d;
      let newAdjSlots = { ...d.adjudicators };

      if (newAdjSlots.chairId === adj.id) {
        newAdjSlots.chairId = undefined;
        newAdjSlots.chairName = undefined;
      }
      if (newAdjSlots.panellistIds?.includes(adj.id)) {
        const idx = newAdjSlots.panellistIds.indexOf(adj.id);
        const pIds = [...newAdjSlots.panellistIds];
        const pNames = [...newAdjSlots.panellistNames];
        pIds.splice(idx, 1);
        pNames.splice(idx, 1);
        newAdjSlots.panellistIds = pIds;
        newAdjSlots.panellistNames = pNames;
      }
      if (newAdjSlots.traineeIds?.includes(adj.id)) {
        const idx = newAdjSlots.traineeIds.indexOf(adj.id);
        const tIds = [...newAdjSlots.traineeIds];
        const tNames = [...newAdjSlots.traineeNames];
        tIds.splice(idx, 1);
        tNames.splice(idx, 1);
        newAdjSlots.traineeIds = tIds;
        newAdjSlots.traineeNames = tNames;
      }

      if (d.id === debateId) {
        newAdjSlots.traineeIds = [...(newAdjSlots.traineeIds || []), adj.id];
        newAdjSlots.traineeNames = [...(newAdjSlots.traineeNames || []), adj.name];
      }

      return { ...d, adjudicators: newAdjSlots };
    });

    await updateDebates(updatedDebatesList);
    setSelectedAdjForManual(null);
  };

  const removeTrainee = async (debateId: string, adjId: string) => {
    const debate = roundDebates.find((d) => d.id === debateId);
    if (!debate) return;
    const traineeIdx = (debate.adjudicators.traineeIds || []).indexOf(adjId);
    if (traineeIdx < 0) return;
    const newIds = [...debate.adjudicators.traineeIds];
    const newNames = [...debate.adjudicators.traineeNames];
    newIds.splice(traineeIdx, 1);
    newNames.splice(traineeIdx, 1);
    const updatedDebate: Debate = {
      ...debate,
      adjudicators: {
        ...debate.adjudicators,
        traineeIds: newIds,
        traineeNames: newNames,
      },
    };
    await updateDebate(updatedDebate);
  };

  // ─── Manual Priority Update ───
  const updateDebateImportance = async (debateId: string, importance: number) => {
    const debate = debates.find((d) => d.id === debateId);
    if (!debate) return;
    await updateDebate({ ...debate, importance });
  };

  const handleClearAllocations = async () => {
    if (!confirm("Clear all judge allocations for this round?")) return;
    const updatedDebatesList = debates.map((d) => {
      if (d.roundId !== activeRound?.id) return d;
      return {
        ...d,
        adjudicators: {
          chairId: undefined,
          chairName: undefined,
          panellistIds: [],
          panellistNames: [],
          traineeIds: [],
          traineeNames: [],
        },
      };
    });
    await updateDebates(updatedDebatesList);
  };

  const handleAutoAllocate = async () => {
    if (!activeRound) return;
    setIsAllocating(true);
    try {
      await autoAllocate(activeRound.id, panelSize);
    } finally {
      setIsAllocating(false);
    }
  };

  // --- Drag and Drop Handlers for Judges ---
  const handleDragStartJudge = (e: React.DragEvent, payload: JudgeDragPayload) => {
    setDraggingJudge(payload);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/json", JSON.stringify(payload));
  };

  const handleDragOverJudgeSlot = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverTarget !== targetKey) {
      setDragOverTarget(targetKey);
    }
  };

  const handleDragLeaveJudgeSlot = (e: React.DragEvent, targetKey: string) => {
    if (dragOverTarget === targetKey) {
      setDragOverTarget(null);
    }
  };

  const handleDropJudgeSlot = async (
    e: React.DragEvent,
    targetDebateId: string,
    targetRole: "chair" | "panellist" | "trainee"
  ) => {
    e.preventDefault();
    setDragOverTarget(null);

    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;
    const payload = safeJsonParse<JudgeDragPayload | null>(raw, null);
    if (!payload) return;

    const adj = adjsMap.get(payload.adjId);
    if (!adj) return;

    if (targetRole === "chair") {
      await assignChair(targetDebateId, adj);
    } else if (targetRole === "panellist") {
      await addPanellist(targetDebateId, adj);
    } else if (targetRole === "trainee") {
      await addTrainee(targetDebateId, adj);
    }

    setDraggingJudge(null);
  };

  const handleDropUnassignJudge = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverTarget(null);

    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;
    const payload = safeJsonParse<JudgeDragPayload | null>(raw, null);
    if (!payload) return;

    if (payload.sourceDebateId) {
      if (payload.sourceType === "chair") {
        await removeChair(payload.sourceDebateId);
      } else if (payload.sourceType === "panellist") {
        await removePanellist(payload.sourceDebateId, payload.adjId);
      } else if (payload.sourceType === "trainee") {
        await removeTrainee(payload.sourceDebateId, payload.adjId);
      }
    }
    setDraggingJudge(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-[#d0d7de] pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center space-x-2">
            <Users2 className="w-6 h-6 text-indigo-600" />
            <span>Adjudicator Allocation</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Intelligent priority-based allocation with break liveness, bracket importance, and multi-factor clash detection.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center space-x-1.5 bg-gray-100 p-1 rounded-md border border-gray-300 text-xs">
            <span className="font-semibold text-gray-700 px-1">Panel Size:</span>
            <select
              value={panelSize}
              onChange={(e) => setPanelSize(parseInt(e.target.value, 10))}
              className="bg-white border border-gray-300 rounded px-2 py-0.5 font-semibold text-gray-900 text-xs"
            >
              <option value={1}>1 (Solo Chair)</option>
              <option value={3}>3 (Chair + 2 Panellists)</option>
              <option value={5}>5 (Chair + 4 Panellists)</option>
            </select>
          </div>

          <button
            onClick={handleAutoAllocate}
            disabled={isAllocating || roundDebates.length === 0}
            className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-bold shadow-xs transition disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isAllocating ? "Optimizing..." : "Auto-Allocate All"}</span>
          </button>

          <button
            onClick={() => setShowPriorityPanel(!showPriorityPanel)}
            className={`inline-flex items-center space-x-1.5 px-3 py-1.5 font-semibold border rounded text-xs shadow-2xs transition ${
              showPriorityPanel
                ? "bg-indigo-50 text-indigo-700 border-indigo-300"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}
          >
            <Gauge className="w-3.5 h-3.5" />
            <span>Priority Info</span>
          </button>

          <button
            onClick={handleClearAllocations}
            disabled={roundDebates.length === 0 || assignedAdjIds.size === 0}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-700 font-semibold border border-gray-300 rounded text-xs shadow-2xs transition disabled:opacity-50"
            title="Reset all judge assignments for this round"
          >
            <RotateCcw className="w-3.5 h-3.5 text-gray-500" />
            <span>Clear Allocations</span>
          </button>
        </div>
      </div>

      {/* Round Selector Bar */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-1">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mr-1">
          Select Round:
        </span>
        {rounds.map((r) => (
          <button
            key={r.id}
            onClick={() => setActiveRound(r)}
            className={`px-3 py-1 text-xs font-semibold rounded-md border transition ${
              activeRound?.id === r.id
                ? "bg-indigo-600 text-white border-indigo-700 shadow-xs"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}
          >
            {r.name}
          </button>
        ))}
      </div>

      {/* Main Allocation Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Available Adjudicators Drawer */}
        <div className="lg:col-span-4 space-y-4">
          <div
            onDragOver={(e) => handleDragOverJudgeSlot(e, "available-drawer")}
            onDragLeave={(e) => handleDragLeaveJudgeSlot(e, "available-drawer")}
            onDrop={handleDropUnassignJudge}
            className={`bg-white border rounded-lg p-4 shadow-xs transition ${
              dragOverTarget === "available-drawer"
                ? "border-amber-500 bg-amber-50/50 border-dashed ring-2 ring-amber-300"
                : "border-[#d0d7de]"
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-1.5">
                <span>Available Adjudicators</span>
                <span className="bg-indigo-100 text-indigo-800 text-xs px-2 py-0.2 rounded-full font-bold">
                  {availableAdjs.length}
                </span>
              </h3>
              <span className="text-[11px] text-gray-500">(Drag into rooms)</span>
            </div>

            <div className="relative mb-3">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-gray-400" />
              <input
                type="text"
                placeholder="Filter judges or institution..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {selectedAdjForManual && (
              <div className="mb-3 p-2.5 bg-indigo-50 border border-indigo-200 rounded text-xs text-indigo-900 flex items-center justify-between">
                <div>
                  <span className="font-bold">Selected: </span>
                  <span>{selectedAdjForManual.name}</span>
                  <span className="text-[10px] text-indigo-700 block">Click on any room to assign as Chair or Panellist</span>
                </div>
                <button
                  onClick={() => setSelectedAdjForManual(null)}
                  className="p-1 hover:bg-indigo-100 rounded text-indigo-700"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {sortedFilteredAdjs.map((adj) => {
                const isSelected = selectedAdjForManual?.id === adj.id;
                const score = effectiveAdjScore(adj, feedbackScores);

                return (
                  <div
                    key={adj.id}
                    draggable
                    onDragStart={(e) =>
                      handleDragStartJudge(e, {
                        type: "judge",
                        sourceType: "available",
                        adjId: adj.id,
                        adjName: adj.name,
                      })
                    }
                    onClick={() => setSelectedAdjForManual(isSelected ? null : adj)}
                    className={`p-2.5 rounded-lg border text-xs cursor-grab active:cursor-grabbing transition flex items-center justify-between ${
                      isSelected
                        ? "bg-indigo-50 border-indigo-500 shadow-xs ring-1 ring-indigo-400"
                        : "bg-gray-50/70 border-gray-200 hover:border-indigo-300 hover:bg-white"
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <GripVertical className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      <div>
                        <div className="font-bold text-gray-900 flex items-center space-x-1.5">
                          <span>{adj.name}</span>
                          {adj.trainee && (
                            <span className="bg-amber-100 text-amber-800 text-[9px] px-1.5 py-0.2 rounded font-semibold uppercase">
                              Trainee
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-500 flex items-center space-x-1">
                          <Building2 className="w-3 h-3 text-gray-400" />
                          <span>{adj.institutionName || "Independent / Unaffiliated"}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <span className={`font-mono font-bold text-xs px-2 py-0.5 rounded ${
                        score >= 7 ? "bg-emerald-100 text-emerald-800" :
                        score >= 4 ? "bg-blue-100 text-blue-800" :
                        "bg-gray-200 text-gray-800"
                      }`}>
                        {score.toFixed(1)}
                      </span>
                    </div>
                  </div>
                );
              })}

              {filteredAdjs.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-6">
                  No available adjudicators matching query.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right: Debates Allocation Board */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">
              Debates for {activeRound?.name} ({roundDebates.length} rooms)
            </h3>
            <span className="text-xs text-gray-500">
              {roundDebates.filter((d) => d.adjudicators?.chairId).length} of {roundDebates.length} Chairs Assigned
            </span>
          </div>

          <div className="space-y-4">
            {sortedRoundDebates.map((debate, dIdx) => {
              const debateTeams: Team[] = Object.values(debate.teams || {})
                .map((t) => (t?.teamId ? teamsMap.get(t.teamId) : undefined))
                .filter((t): t is Team => t !== undefined);

              const priority = debatePriorities.get(debate.id);
              const panelStrength = debatePanelStrengths.get(debate.id) ?? 0;

              // Check clashes for dragging judge if hovered over this room
              let dragJudgeClashPreview: string[] = [];
              if (draggingJudge) {
                const draggedAdj = adjsMap.get(draggingJudge.adjId);
                if (draggedAdj) {
                  const check = calculateAdjDebateConflict(draggedAdj, debateTeams);
                  if (check.hasClash) {
                    dragJudgeClashPreview = check.reasons;
                  }
                }
              }

              // Check clashes for currently assigned chair
              let chairConflicts: string[] = [];
              if (debate.adjudicators?.chairId) {
                const chairAdj = adjsMap.get(debate.adjudicators.chairId);
                if (chairAdj) {
                  chairConflicts = calculateAdjDebateConflict(chairAdj, debateTeams).reasons;
                }
              }

              const chairDropKey = `${debate.id}-chair`;
              const panellistDropKey = `${debate.id}-panellist`;
              const traineeDropKey = `${debate.id}-trainee`;

              const isChairHovered = dragOverTarget === chairDropKey;
              const isPanellistHovered = dragOverTarget === panellistDropKey;
              const isTraineeHovered = dragOverTarget === traineeDropKey;

              return (
                <div
                  key={debate.id}
                  className="bg-white border border-[#d0d7de] rounded-lg shadow-2xs overflow-hidden"
                >
                  {/* Room & Teams Bar with Priority Info */}
                  <div className="p-3 bg-[#f6f8fa] border-b border-[#d0d7de] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center space-x-3">
                      <span className="font-bold text-gray-900 text-xs mr-1">
                        {debate.venueName || `Room ${dIdx + 1}`}
                      </span>

                      {showPriorityPanel && priority && (
                        <div className="flex items-center space-x-2">
                          <span className={`inline-flex items-center space-x-1 text-[10px] font-bold px-2 py-0.5 rounded border ${getPriorityColor(priority.priorityScore)}`}>
                            <Gauge className="w-3 h-3" />
                            <span>P:{priority.priorityScore.toFixed(1)}</span>
                          </span>
                          {panelStrength > 0 && (
                            <span className={`inline-flex items-center space-x-1 text-[10px] font-bold px-2 py-0.5 rounded ${getStrengthColor(panelStrength)}`}>
                              <Zap className="w-3 h-3" />
                              <span>S:{panelStrength.toFixed(1)}</span>
                            </span>
                          )}
                          <span className="text-[10px] text-gray-400" title="Break liveness average for teams in this debate">
                            🔥{(priority.breakLiveness * 100).toFixed(0)}%
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center space-x-2">
                      <span className="text-xs text-gray-600">
                        {debateTeams.map((t) => `${t.name} (${t.institutionName || "Indep"})`).join(" vs ")}
                      </span>

                      {showPriorityPanel && (
                        <div className="flex items-center space-x-1">
                          <label className="text-[10px] text-gray-500 font-semibold" title="Manual priority override (0-10)">
                            ±
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={10}
                            step={0.5}
                            value={debate.importance || 0}
                            onChange={(e) => updateDebateImportance(debate.id, parseFloat(e.target.value) || 0)}
                            className="w-12 text-[10px] font-mono font-bold text-center border border-gray-300 rounded px-1 py-0.5"
                            title="Manual priority (higher = more important debate)"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {chairConflicts.length > 0 && (
                    <div className="px-3 py-1.5 bg-red-50 border-b border-red-200">
                      <span className="inline-flex items-center space-x-1 text-[11px] font-bold text-red-700">
                        <AlertTriangle className="w-3 h-3 text-red-600" />
                        <span>Clash: {chairConflicts.join("; ")}</span>
                      </span>
                    </div>
                  )}

                  {/* Drag-and-Drop Allocation Slots */}
                  <div className="p-4 space-y-3">
                    {/* Chair Slot */}
                    <div
                      onDragOver={(e) => handleDragOverJudgeSlot(e, chairDropKey)}
                      onDragLeave={(e) => handleDragLeaveJudgeSlot(e, chairDropKey)}
                      onDrop={(e) => handleDropJudgeSlot(e, debate.id, "chair")}
                      className={`p-2.5 rounded-lg border transition ${
                        isChairHovered
                          ? dragJudgeClashPreview.length > 0
                            ? "bg-red-50 border-red-500 border-dashed ring-2 ring-red-300"
                            : "bg-blue-50 border-blue-500 border-dashed ring-2 ring-blue-300"
                          : "bg-blue-50/40 border-blue-200"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-blue-900 uppercase text-[10px] tracking-wide bg-blue-200 px-1.5 py-0.5 rounded">
                            Chair
                          </span>
                          {debate.adjudicators?.chairName ? (
                            <div
                              draggable
                              onDragStart={(e) =>
                                handleDragStartJudge(e, {
                                  type: "judge",
                                  sourceType: "chair",
                                  adjId: debate.adjudicators.chairId!,
                                  adjName: debate.adjudicators.chairName!,
                                  sourceDebateId: debate.id,
                                })
                              }
                              className="cursor-grab active:cursor-grabbing inline-flex items-center space-x-1.5 bg-white px-2 py-0.5 rounded border border-blue-300 text-xs font-bold text-gray-900"
                            >
                              <GripVertical className="w-3 h-3 text-gray-400" />
                              <span>{debate.adjudicators.chairName}</span>
                              {adjsMap.get(debate.adjudicators.chairId!)?.institutionName && (
                                <span className="text-[10px] text-gray-500 font-normal">
                                  ({adjsMap.get(debate.adjudicators.chairId!)?.institutionName})
                                </span>
                              )}
                              <span className="font-mono text-[10px] text-blue-600">
                                {effectiveAdjScore(
                                  adjsMap.get(debate.adjudicators.chairId!)!,
                                  feedbackScores
                                ).toFixed(1)}
                              </span>
                            </div>
                          ) : (
                            <span className="text-red-500 italic text-xs">
                              {isChairHovered
                                ? dragJudgeClashPreview.length > 0
                                  ? `⚠️ Clash Detected: ${dragJudgeClashPreview.join(", ")}`
                                  : "Drop to Assign as Chair"
                                : "No chair assigned (drag judge here)"}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center space-x-2">
                          {selectedAdjForManual && (
                            <button
                              onClick={() => assignChair(debate.id, selectedAdjForManual)}
                              className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded text-[11px] transition"
                            >
                              Assign Selected
                            </button>
                          )}
                          {debate.adjudicators?.chairId && (
                            <button
                              onClick={() => removeChair(debate.id)}
                              className="p-1 text-gray-400 hover:text-red-600 rounded"
                              title="Unassign Chair"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Panellists Drop Zone */}
                    <div
                      onDragOver={(e) => handleDragOverJudgeSlot(e, panellistDropKey)}
                      onDragLeave={(e) => handleDragLeaveJudgeSlot(e, panellistDropKey)}
                      onDrop={(e) => handleDropJudgeSlot(e, debate.id, "panellist")}
                      className={`p-2.5 rounded-lg border transition ${
                        isPanellistHovered
                          ? dragJudgeClashPreview.length > 0
                            ? "bg-red-50 border-red-500 border-dashed ring-2 ring-red-300"
                            : "bg-indigo-50 border-indigo-500 border-dashed ring-2 ring-indigo-300"
                          : "bg-gray-50/50 border-gray-200"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wide">
                          Panellists ({(debate.adjudicators?.panellistIds || []).length})
                        </span>
                        {selectedAdjForManual && (
                          <button
                            onClick={() => addPanellist(debate.id, selectedAdjForManual)}
                            className="inline-flex items-center space-x-1 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded border border-indigo-200"
                          >
                            <UserPlus className="w-3 h-3" />
                            <span>Add {selectedAdjForManual.name}</span>
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {(debate.adjudicators?.panellistIds || []).map((pId, pIdx) => {
                          const pName = debate.adjudicators.panellistNames[pIdx];
                          const pAdj = adjsMap.get(pId);
                          const pClashes = pAdj ? calculateAdjDebateConflict(pAdj, debateTeams).reasons : [];

                          return (
                            <div
                              key={pId}
                              draggable
                              onDragStart={(e) =>
                                handleDragStartJudge(e, {
                                  type: "judge",
                                  sourceType: "panellist",
                                  adjId: pId,
                                  adjName: pName,
                                  sourceDebateId: debate.id,
                                })
                              }
                              className={`flex items-center justify-between p-1.5 rounded border text-xs cursor-grab active:cursor-grabbing bg-white ${
                                pClashes.length > 0 ? "border-red-400 bg-red-50/50" : "border-gray-200"
                              }`}
                            >
                              <div className="flex items-center space-x-1.5">
                                <GripVertical className="w-3 h-3 text-gray-400" />
                                <div>
                                  <span className="font-semibold text-gray-900">{pName}</span>
                                  {pAdj?.institutionName && (
                                    <span className="text-[10px] text-gray-500 block">
                                      {pAdj.institutionName}
                                    </span>
                                  )}
                                  {pAdj && (
                                    <span className="text-[10px] font-mono text-blue-600">
                                      {effectiveAdjScore(pAdj, feedbackScores).toFixed(1)}
                                    </span>
                                  )}
                                  {pClashes.length > 0 && (
                                    <span className="text-[10px] text-red-600 font-bold block">
                                      ⚠️ Clash: {pClashes.join(", ")}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <button
                                onClick={() => removePanellist(debate.id, pId)}
                                className="p-0.5 text-gray-400 hover:text-red-600 rounded"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}

                        {(debate.adjudicators?.panellistIds || []).length === 0 && (
                          <div className="col-span-2 py-2 border border-dashed border-gray-300 rounded text-center text-[11px] text-gray-400 italic">
                            {isPanellistHovered ? "Drop to Add as Panellist" : "Drag judges here to add panellists"}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Trainees Drop Zone */}
                    <div
                      onDragOver={(e) => handleDragOverJudgeSlot(e, traineeDropKey)}
                      onDragLeave={(e) => handleDragLeaveJudgeSlot(e, traineeDropKey)}
                      onDrop={(e) => handleDropJudgeSlot(e, debate.id, "trainee")}
                      className={`p-2 rounded-lg border transition ${
                        isTraineeHovered
                          ? "bg-amber-50 border-amber-500 border-dashed ring-2 ring-amber-300"
                          : "bg-gray-50/30 border-gray-100"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">
                          Trainees ({(debate.adjudicators?.traineeIds || []).length})
                        </span>
                        {selectedAdjForManual && (
                          <button
                            onClick={() => addTrainee(debate.id, selectedAdjForManual)}
                            className="text-[10px] text-amber-800 font-semibold hover:underline"
                          >
                            + Add as Trainee
                          </button>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {(debate.adjudicators?.traineeIds || []).map((tId, tIdx) => {
                          const tName = debate.adjudicators.traineeNames[tIdx];
                          return (
                            <div
                              key={tId}
                              draggable
                              onDragStart={(e) =>
                                handleDragStartJudge(e, {
                                  type: "judge",
                                  sourceType: "trainee",
                                  adjId: tId,
                                  adjName: tName,
                                  sourceDebateId: debate.id,
                                })
                              }
                              className="inline-flex items-center space-x-1 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded text-[11px] text-amber-900 cursor-grab"
                            >
                              <GripVertical className="w-2.5 h-2.5 text-amber-500" />
                              <span>{tName}</span>
                              <button
                                onClick={() => removeTrainee(debate.id, tId)}
                                className="text-amber-600 hover:text-red-600 ml-1"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          );
                        })}

                        {(debate.adjudicators?.traineeIds || []).length === 0 && (
                          <span className="text-[10px] text-gray-400 italic">No trainees allocated.</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

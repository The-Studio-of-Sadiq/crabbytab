"use client";

import React, { useState, useMemo, useId } from "react";
import { useTournament } from "@/contexts/TournamentContext";
import { SideBadge } from "@/components/ui/SideBadge";
import {
  Shuffle,
  Users2,
  Printer,
  Download,
  CheckCircle2,
  AlertTriangle,
  Send,
  Lock,
  Unlock,
  Settings2,
  Sparkles,
  MapPin,
  Search,
  Plus,
  Trash2,
  GripVertical,
  ArrowRightLeft,
  X,
  UserX,
  Layers,
} from "lucide-react";
import { DebateSide, Debate, Team, Venue, Adjudicator } from "@/types";
import { calculateAdjDebateConflict } from "@/lib/draw/allocator";

interface DragPayload {
  type: "team";
  sourceType: "debate" | "unassigned";
  debateId?: string;
  side?: DebateSide;
  teamId: string;
  teamName: string;
  institutionId?: string;
  institutionName?: string;
}

export default function DrawPage() {
  const {
    tournament,
    activeRound,
    rounds,
    setActiveRound,
    debates,
    teams,
    venues,
    adjudicators,
    generateDraw,
    autoAllocate,
    updateRound,
    updateDebate,
    updateDebates,
  } = useTournament();

  const [searchQuery, setSearchQuery] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAllocating, setIsAllocating] = useState(false);
  const [showUnassigned, setShowUnassigned] = useState(true);

  // Drag & Drop state
  const [draggingItem, setDraggingItem] = useState<DragPayload | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  const isBP = tournament?.format === "bp";
  const roundDebates = useMemo(
    () => (activeRound ? debates.filter((d) => d.roundId === activeRound.id) : []),
    [debates, activeRound]
  );

  const teamsMap = useMemo(() => {
    const map = new Map<string, Team>();
    teams.forEach((t) => map.set(t.id, t));
    return map;
  }, [teams]);

  // Find teams assigned in current round
  const assignedTeamIds = useMemo(() => {
    const set = new Set<string>();
    roundDebates.forEach((d) => {
      Object.values(d.teams || {}).forEach((slot) => {
        if (slot?.teamId) set.add(slot.teamId);
      });
    });
    return set;
  }, [roundDebates]);

  // Unassigned teams list
  const unassignedTeams = useMemo(() => {
    return teams.filter((t) => !assignedTeamIds.has(t.id) && t.checkedIn !== false);
  }, [teams, assignedTeamIds]);

  const filteredDebates = roundDebates.filter((d) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const venueMatch = (d.venueName || "").toLowerCase().includes(query);
    const chairMatch = (d.adjudicators?.chairName || "").toLowerCase().includes(query);
    const teamMatch = Object.values(d.teams || {}).some((t) => (t?.teamName || "").toLowerCase().includes(query));
    return venueMatch || chairMatch || teamMatch;
  });

  // Calculate Clashes for a debate
  const getDebateClashes = (debate: Debate) => {
    const debateTeams: Team[] = Object.values(debate.teams || {})
      .map((slot) => (slot?.teamId ? teamsMap.get(slot.teamId) : undefined))
      .filter((t): t is Team => t !== undefined);

    const teamClashes: string[] = [];
    const judgeClashes: string[] = [];

    // 1. Team-Team Institutional Clashes
    const instCounts = new Map<string, string[]>();
    debateTeams.forEach((t) => {
      const key = t.institutionId || (t.institutionName ? t.institutionName.toLowerCase() : null);
      if (key) {
        const existing = instCounts.get(key) || [];
        existing.push(t.name);
        instCounts.set(key, existing);
      }
    });

    instCounts.forEach((teamNames) => {
      if (teamNames.length > 1) {
        teamClashes.push(`Same Institution: ${teamNames.join(" & ")}`);
      }
    });

    // 2. Chair / Panellist Clashes
    if (debate.adjudicators?.chairId) {
      const chair = adjudicators.find((a) => a.id === debate.adjudicators.chairId);
      if (chair) {
        const res = calculateAdjDebateConflict(chair, debateTeams);
        if (res.hasClash) {
          judgeClashes.push(`Chair ${chair.name}: ${res.reasons.join(", ")}`);
        }
      }
    }

    (debate.adjudicators?.panellistIds || []).forEach((pId) => {
      const panellist = adjudicators.find((a) => a.id === pId);
      if (panellist) {
        const res = calculateAdjDebateConflict(panellist, debateTeams);
        if (res.hasClash) {
          judgeClashes.push(`Panellist ${panellist.name}: ${res.reasons.join(", ")}`);
        }
      }
    });

    return { teamClashes, judgeClashes, hasAny: teamClashes.length > 0 || judgeClashes.length > 0 };
  };

  // Generate draw
  const handleGenerate = async () => {
    if (!activeRound) return;
    if (roundDebates.length > 0) {
      if (!confirm("A draw already exists for this round. Regenerating will overwrite all current matchups. Proceed?")) {
        return;
      }
    }
    setIsGenerating(true);
    try {
      await generateDraw(activeRound.id);
    } finally {
      setIsGenerating(false);
    }
  };

  // Auto Allocate Judges
  const handleAutoAllocate = async () => {
    if (!activeRound || roundDebates.length === 0) return;
    setIsAllocating(true);
    try {
      await autoAllocate(activeRound.id, 1);
    } finally {
      setIsAllocating(false);
    }
  };

  // Toggle release
  const toggleReleaseDraw = async () => {
    if (!activeRound) return;
    const updated = {
      ...activeRound,
      drawStatus: (activeRound.drawStatus === "confirmed" ? "draft" : "confirmed") as any,
    };
    await updateRound(updated);
  };

  // Add new empty debate room
  const handleAddDebateRoom = async () => {
    if (!activeRound) return;
    const nextRoomIdx = roundDebates.length + 1;
    const freeVenue = venues.find((v) => !roundDebates.some((d) => d.venueId === v.id));

    const sides: DebateSide[] = isBP ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"];
    const emptyTeams: Record<string, any> = {};
    sides.forEach((side) => {
      emptyTeams[side] = { teamId: "", teamName: "", side };
    });

    const newDebate: Debate = {
      id: `debate-${activeRound.id}-${Date.now()}-${nextRoomIdx}`,
      tournamentId: tournament?.id || "",
      roundId: activeRound.id,
      roundSeq: activeRound.seq,
      venueId: freeVenue?.id,
      venueName: freeVenue?.name || `Room ${nextRoomIdx}`,
      bracket: 0,
      roomRank: nextRoomIdx,
      importance: 0,
      resultStatus: "none",
      sidesConfirmed: false,
      flags: [],
      teams: emptyTeams as any,
      adjudicators: {
        chairId: undefined,
        chairName: undefined,
        panellistIds: [],
        panellistNames: [],
        traineeIds: [],
        traineeNames: [],
      },
    };

    const updated = [...debates, newDebate];
    await updateDebates(updated);
  };

  // Delete a debate room
  const handleDeleteDebate = async (debateId: string) => {
    if (!confirm("Are you sure you want to delete this debate room? Assigned teams will return to the unassigned pool.")) return;
    const updated = debates.filter((d) => d.id !== debateId);
    await updateDebates(updated);
  };

  // Change Venue
  const handleChangeVenue = async (debateId: string, venueId: string) => {
    const debate = roundDebates.find((d) => d.id === debateId);
    if (!debate) return;
    const venue = venues.find((v) => v.id === venueId);
    const updated: Debate = {
      ...debate,
      venueId: venue?.id,
      venueName: venue?.name || debate.venueName,
    };
    await updateDebate(updated);
  };

  // Remove team from debate slot
  const handleRemoveTeamFromSlot = async (debateId: string, side: DebateSide) => {
    const debate = roundDebates.find((d) => d.id === debateId);
    if (!debate) return;

    const updatedTeams = { ...debate.teams };
    updatedTeams[side] = {
      teamId: "",
      teamName: "",
      side,
    };

    await updateDebate({ ...debate, teams: updatedTeams });
  };

  // --- Drag and Drop Handlers ---
  const handleDragStartTeam = (
    e: React.DragEvent,
    payload: DragPayload
  ) => {
    setDraggingItem(payload);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/json", JSON.stringify(payload));
  };

  const handleDragOverSlot = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverTarget !== targetKey) {
      setDragOverTarget(targetKey);
    }
  };

  const handleDragLeaveSlot = (e: React.DragEvent, targetKey: string) => {
    if (dragOverTarget === targetKey) {
      setDragOverTarget(null);
    }
  };

  const handleDropOnSlot = async (
    e: React.DragEvent,
    targetDebateId: string,
    targetSide: DebateSide
  ) => {
    e.preventDefault();
    setDragOverTarget(null);

    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;
    const payload: DragPayload = JSON.parse(raw);

    const targetDebate = roundDebates.find((d) => d.id === targetDebateId);
    if (!targetDebate) return;

    const currentTargetSlot = targetDebate.teams[targetSide];
    const targetHasTeam = Boolean(currentTargetSlot?.teamId);

    // Case 1: Dragged from Unassigned Pool into a Slot
    if (payload.sourceType === "unassigned") {
      const updatedTargetTeams = { ...targetDebate.teams };
      updatedTargetTeams[targetSide] = {
        teamId: payload.teamId,
        teamName: payload.teamName,
        side: targetSide,
      };

      const updatedDebatesList = debates.map((d) =>
        d.id === targetDebateId ? { ...d, teams: updatedTargetTeams } : d
      );
      await updateDebates(updatedDebatesList);
      setDraggingItem(null);
      return;
    }

    // Case 2: Dragged from another Debate Slot (or same debate, different slot)
    if (payload.sourceType === "debate" && payload.debateId && payload.side) {
      const sourceDebateId = payload.debateId;
      const sourceSide = payload.side;

      // Same slot: do nothing
      if (sourceDebateId === targetDebateId && sourceSide === targetSide) {
        setDraggingItem(null);
        return;
      }

      const sourceDebate = roundDebates.find((d) => d.id === sourceDebateId);
      if (!sourceDebate) return;

      // Swap logic:
      const updatedDebatesList = debates.map((d) => {
        if (d.id === sourceDebateId && d.id === targetDebateId) {
          // Same debate, different sides (e.g. OG <-> OO)
          const newTeams = { ...d.teams };
          const srcTeam = newTeams[sourceSide];
          const tgtTeam = newTeams[targetSide];

          newTeams[sourceSide] = {
            teamId: tgtTeam?.teamId || "",
            teamName: tgtTeam?.teamName || "",
            side: sourceSide,
          };
          newTeams[targetSide] = {
            teamId: srcTeam?.teamId || "",
            teamName: srcTeam?.teamName || "",
            side: targetSide,
          };
          return { ...d, teams: newTeams };
        } else if (d.id === sourceDebateId) {
          // Source debate: place target's previous team here (or blank)
          const newTeams = { ...d.teams };
          newTeams[sourceSide] = {
            teamId: currentTargetSlot?.teamId || "",
            teamName: currentTargetSlot?.teamName || "",
            side: sourceSide,
          };
          return { ...d, teams: newTeams };
        } else if (d.id === targetDebateId) {
          // Target debate: place dragged team here
          const newTeams = { ...d.teams };
          newTeams[targetSide] = {
            teamId: payload.teamId,
            teamName: payload.teamName,
            side: targetSide,
          };
          return { ...d, teams: newTeams };
        }
        return d;
      });

      await updateDebates(updatedDebatesList);
      setDraggingItem(null);
    }
  };

  const handleDropOnUnassigned = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverTarget(null);

    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;
    const payload: DragPayload = JSON.parse(raw);

    if (payload.sourceType === "debate" && payload.debateId && payload.side) {
      await handleRemoveTeamFromSlot(payload.debateId, payload.side);
    }
    setDraggingItem(null);
  };

  return (
    <div className="space-y-6">
      {/* Header & Action Controls */}
      <div className="border-b border-[#d0d7de] pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center space-x-2">
            <Shuffle className="w-6 h-6 text-blue-600" />
            <span>Draw & Matchups</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Generate Swiss pairings, manually edit draw via drag-and-drop, and detect institutional bias in real time.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleAddDebateRoom}
            disabled={!activeRound}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-800 font-semibold border border-gray-300 rounded text-xs shadow-2xs transition disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5 text-blue-600" />
            <span>Add Room</span>
          </button>

          <button
            onClick={handleGenerate}
            disabled={isGenerating || !activeRound}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold shadow-xs transition disabled:opacity-50"
          >
            <Shuffle className="w-3.5 h-3.5" />
            <span>{isGenerating ? "Generating..." : "Generate Draw"}</span>
          </button>

          <button
            onClick={handleAutoAllocate}
            disabled={isAllocating || roundDebates.length === 0}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-bold shadow-xs transition disabled:opacity-50"
          >
            <Users2 className="w-3.5 h-3.5" />
            <span>{isAllocating ? "Allocating..." : "Auto-Allocate Judges"}</span>
          </button>

          <button
            onClick={toggleReleaseDraw}
            disabled={roundDebates.length === 0}
            className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-bold border transition disabled:opacity-50 ${
              activeRound?.drawStatus === "confirmed"
                ? "bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100"
                : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200"
            }`}
          >
            {activeRound?.drawStatus === "confirmed" ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Draw Released to Public</span>
              </>
            ) : (
              <>
                <Lock className="w-3.5 h-3.5" />
                <span>Release Draw to Public</span>
              </>
            )}
          </button>

          <button
            onClick={() => window.print()}
            className="p-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300 rounded text-xs transition"
            title="Print Draw Sheet"
          >
            <Printer className="w-4 h-4" />
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
                ? "bg-blue-600 text-white border-blue-700 shadow-xs"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}
          >
            {r.name}
          </button>
        ))}
      </div>

      {/* Unassigned Teams Bar & Search */}
      <div className="space-y-3">
        {/* Unassigned Teams Pool (Collapsible & Drop Zone) */}
        <div
          onDragOver={(e) => handleDragOverSlot(e, "unassigned-pool")}
          onDragLeave={(e) => handleDragLeaveSlot(e, "unassigned-pool")}
          onDrop={handleDropOnUnassigned}
          className={`p-3 rounded-lg border transition ${
            dragOverTarget === "unassigned-pool"
              ? "bg-amber-50 border-amber-500 border-dashed ring-2 ring-amber-300"
              : "bg-slate-50 border-slate-200"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-gray-800 uppercase tracking-wide flex items-center space-x-1.5">
                <Layers className="w-3.5 h-3.5 text-blue-600" />
                <span>Unassigned Teams Pool ({unassignedTeams.length})</span>
              </span>
              <span className="text-[11px] text-gray-500">
                (Drag teams to/from rooms below to re-pair manually)
              </span>
            </div>
            <button
              onClick={() => setShowUnassigned(!showUnassigned)}
              className="text-xs text-blue-600 hover:underline font-semibold"
            >
              {showUnassigned ? "Hide" : "Show"}
            </button>
          </div>

          {showUnassigned && (
            <div className="flex flex-wrap gap-2 pt-1">
              {unassignedTeams.map((team) => (
                <div
                  key={team.id}
                  draggable
                  onDragStart={(e) =>
                    handleDragStartTeam(e, {
                      type: "team",
                      sourceType: "unassigned",
                      teamId: team.id,
                      teamName: team.name,
                      institutionId: team.institutionId,
                      institutionName: team.institutionName,
                    })
                  }
                  className="inline-flex items-center space-x-1.5 px-2.5 py-1 bg-white border border-gray-300 rounded shadow-2xs hover:border-blue-500 hover:shadow-xs cursor-grab active:cursor-grabbing text-xs text-gray-900 transition"
                >
                  <GripVertical className="w-3 h-3 text-gray-400" />
                  <span className="font-bold">{team.name}</span>
                  {team.institutionName && (
                    <span className="text-[10px] text-gray-500">({team.institutionName})</span>
                  )}
                </div>
              ))}

              {unassignedTeams.length === 0 && (
                <span className="text-xs text-gray-400 italic">
                  All checked-in teams are currently allocated to debate rooms.
                </span>
              )}
            </div>
          )}
        </div>

        {/* Search & Counter Filter */}
        {roundDebates.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="relative w-full max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                placeholder="Filter room, team, or judge..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <span className="text-xs text-gray-500">
              Showing {filteredDebates.length} of {roundDebates.length} debates
            </span>
          </div>
        )}
      </div>

      {/* Debates List */}
      {roundDebates.length === 0 ? (
        <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-10 text-center">
          <Shuffle className="w-10 h-10 text-gray-400 mx-auto mb-3" />
          <h3 className="text-base font-bold text-gray-800 mb-1">No Draw Generated for {activeRound?.name}</h3>
          <p className="text-xs text-gray-500 max-w-md mx-auto mb-4">
            Generate power-paired pairings or click &quot;Add Room&quot; to manually construct the draw by dragging teams.
          </p>
          <div className="flex justify-center items-center gap-3">
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="inline-flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold shadow-xs transition"
            >
              <Shuffle className="w-4 h-4" />
              <span>Generate {activeRound?.name} Draw</span>
            </button>
            <button
              onClick={handleAddDebateRoom}
              className="inline-flex items-center space-x-1.5 px-4 py-2 bg-white hover:bg-gray-50 text-gray-800 font-bold border border-gray-300 rounded text-xs shadow-xs transition"
            >
              <Plus className="w-4 h-4 text-blue-600" />
              <span>Manually Build Rooms</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredDebates.map((debate, dIdx) => {
            const clashes = getDebateClashes(debate);

            return (
              <div
                key={debate.id}
                className="bg-white border border-[#d0d7de] rounded-lg shadow-2xs hover:border-blue-400 transition overflow-hidden"
              >
                {/* Room Header */}
                <div className="bg-[#f6f8fa] px-4 py-2.5 border-b border-[#d0d7de] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center space-x-1.5 text-xs font-bold text-gray-900">
                      <MapPin className="w-3.5 h-3.5 text-blue-600" />
                      <select
                        value={debate.venueId || ""}
                        onChange={(e) => handleChangeVenue(debate.id, e.target.value)}
                        className="bg-transparent font-bold text-xs text-gray-900 border border-transparent hover:border-gray-300 rounded px-1 py-0.5 cursor-pointer"
                      >
                        <option value="">{debate.venueName || `Room ${dIdx + 1}`}</option>
                        {venues.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {debate.bracket !== undefined && debate.bracket > 0 && (
                      <span className="text-[10px] font-semibold bg-gray-200 text-gray-700 px-2 py-0.2 rounded">
                        Bracket: {debate.bracket} pts
                      </span>
                    )}

                    {/* Clash Badges */}
                    {clashes.teamClashes.map((c, cIdx) => (
                      <span
                        key={cIdx}
                        className="inline-flex items-center space-x-1 text-[10px] font-bold text-amber-800 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded"
                      >
                        <AlertTriangle className="w-3 h-3 text-amber-600" />
                        <span>{c}</span>
                      </span>
                    ))}

                    {clashes.judgeClashes.map((c, cIdx) => (
                      <span
                        key={cIdx}
                        className="inline-flex items-center space-x-1 text-[10px] font-bold text-red-800 bg-red-100 border border-red-300 px-2 py-0.5 rounded"
                      >
                        <AlertTriangle className="w-3 h-3 text-red-600" />
                        <span>{c}</span>
                      </span>
                    ))}
                  </div>

                  {/* Chair Info & Delete Room */}
                  <div className="flex items-center space-x-3 text-xs">
                    <div className="flex items-center space-x-1.5">
                      <span className="text-gray-500 font-medium">Chair:</span>
                      {debate.adjudicators?.chairName ? (
                        <span className="font-bold text-gray-900 bg-blue-50 text-blue-800 px-2 py-0.5 rounded border border-blue-200">
                          {debate.adjudicators.chairName}
                        </span>
                      ) : (
                        <span className="text-red-500 font-semibold text-[11px] italic">Unassigned</span>
                      )}
                    </div>

                    <button
                      onClick={() => handleDeleteDebate(debate.id)}
                      className="p-1 text-gray-400 hover:text-red-600 rounded transition"
                      title="Delete this debate room"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Matchup Grid (Interactive Drag & Drop Zones) */}
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  {isBP ? (
                    <>
                      {(["OG", "OO", "CG", "CO"] as DebateSide[]).map((side) => {
                        const slot = debate.teams?.[side];
                        const hasTeam = Boolean(slot?.teamId);
                        const teamData = slot?.teamId ? teamsMap.get(slot.teamId) : null;
                        const dropKey = `${debate.id}-${side}`;
                        const isHovered = dragOverTarget === dropKey;

                        return (
                          <div
                            key={side}
                            onDragOver={(e) => handleDragOverSlot(e, dropKey)}
                            onDragLeave={(e) => handleDragLeaveSlot(e, dropKey)}
                            onDrop={(e) => handleDropOnSlot(e, debate.id, side)}
                            className={`p-2.5 rounded-lg border transition relative ${
                              isHovered
                                ? "bg-blue-50 border-blue-500 border-dashed ring-2 ring-blue-300"
                                : side === "OG"
                                ? "bg-rose-50/50 border-rose-200"
                                : side === "OO"
                                ? "bg-sky-50/50 border-sky-200"
                                : side === "CG"
                                ? "bg-amber-50/50 border-amber-200"
                                : "bg-purple-50/50 border-purple-200"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <SideBadge side={side} />
                              {hasTeam && (
                                <button
                                  onClick={() => handleRemoveTeamFromSlot(debate.id, side)}
                                  className="text-gray-400 hover:text-red-600 p-0.5"
                                  title="Remove team from slot"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>

                            {hasTeam ? (
                              <div
                                draggable
                                onDragStart={(e) =>
                                  handleDragStartTeam(e, {
                                    type: "team",
                                    sourceType: "debate",
                                    debateId: debate.id,
                                    side,
                                    teamId: slot.teamId,
                                    teamName: slot.teamName,
                                    institutionId: teamData?.institutionId,
                                    institutionName: teamData?.institutionName,
                                  })
                                }
                                className="cursor-grab active:cursor-grabbing p-1 rounded hover:bg-white/60 transition flex items-center justify-between"
                              >
                                <div>
                                  <div className="font-bold text-gray-900 text-sm">{slot.teamName}</div>
                                  <div className="text-[11px] text-gray-500">
                                    {teamData?.institutionName || "Independent"}
                                  </div>
                                </div>
                                <GripVertical className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                              </div>
                            ) : (
                              <div className="h-10 flex items-center justify-center border border-dashed border-gray-300 rounded text-[11px] text-gray-400 italic">
                                Drop Team Here
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  ) : (
                    <>
                      {(["AFF", "NEG"] as DebateSide[]).map((side) => {
                        const slot = debate.teams?.[side];
                        const hasTeam = Boolean(slot?.teamId);
                        const teamData = slot?.teamId ? teamsMap.get(slot.teamId) : null;
                        const dropKey = `${debate.id}-${side}`;
                        const isHovered = dragOverTarget === dropKey;

                        return (
                          <div
                            key={side}
                            onDragOver={(e) => handleDragOverSlot(e, dropKey)}
                            onDragLeave={(e) => handleDragLeaveSlot(e, dropKey)}
                            onDrop={(e) => handleDropOnSlot(e, debate.id, side)}
                            className={`p-3 rounded-lg border md:col-span-2 transition relative ${
                              isHovered
                                ? "bg-blue-50 border-blue-500 border-dashed ring-2 ring-blue-300"
                                : side === "AFF"
                                ? "bg-emerald-50/50 border-emerald-200"
                                : "bg-slate-50 border-slate-200"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <SideBadge side={side} />
                              {hasTeam && (
                                <button
                                  onClick={() => handleRemoveTeamFromSlot(debate.id, side)}
                                  className="text-gray-400 hover:text-red-600 p-0.5"
                                  title="Remove team from slot"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>

                            {hasTeam ? (
                              <div
                                draggable
                                onDragStart={(e) =>
                                  handleDragStartTeam(e, {
                                    type: "team",
                                    sourceType: "debate",
                                    debateId: debate.id,
                                    side,
                                    teamId: slot.teamId,
                                    teamName: slot.teamName,
                                    institutionId: teamData?.institutionId,
                                    institutionName: teamData?.institutionName,
                                  })
                                }
                                className="cursor-grab active:cursor-grabbing p-1.5 rounded hover:bg-white/60 transition flex items-center justify-between"
                              >
                                <div>
                                  <div className="font-bold text-gray-900 text-base">{slot.teamName}</div>
                                  <div className="text-xs text-gray-500">
                                    {teamData?.institutionName || "Independent"}
                                  </div>
                                </div>
                                <GripVertical className="w-4 h-4 text-gray-400 shrink-0" />
                              </div>
                            ) : (
                              <div className="h-12 flex items-center justify-center border border-dashed border-gray-300 rounded text-xs text-gray-400 italic">
                                Drop Team Here
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>

                {/* Panellists and Trainees footer */}
                {((debate.adjudicators?.panellistNames?.length || 0) > 0 ||
                  (debate.adjudicators?.traineeNames?.length || 0) > 0) && (
                  <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex flex-wrap items-center gap-3 text-xs text-gray-600">
                    {debate.adjudicators?.panellistNames?.length > 0 && (
                      <div>
                        <span className="font-semibold text-gray-700 mr-1">Panellists:</span>
                        <span>{debate.adjudicators.panellistNames.join(", ")}</span>
                      </div>
                    )}
                    {debate.adjudicators?.traineeNames?.length > 0 && (
                      <div>
                        <span className="font-semibold text-gray-700 mr-1">Trainees:</span>
                        <span className="italic">{debate.adjudicators.traineeNames.join(", ")}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

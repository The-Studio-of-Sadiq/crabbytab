"use client";

import React, { useState, useMemo } from "react";
import { useTournament } from "@/contexts/TournamentContext";
import { SideBadge } from "@/components/ui/SideBadge";
import {
  Shuffle,
  Printer,
  CheckCircle2,
  AlertTriangle,
  Lock,
  MapPin,
  Search,
  Plus,
  Trash2,
  GripVertical,
  ArrowRightLeft,
  X,
  UserX,
  RefreshCw,
} from "lucide-react";
import { safeJsonParse } from "@/lib/safeJson";
import { DebateSide, Debate, Team, Venue } from "@/types";
import { getEligibleTeamsForRound, getRequiredVenueCount } from "@/lib/draw/generator";
import { allocateVenuesToDebates, getVenueIncompatibilities } from "@/lib/draw/venueAllocator";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { UnassignedTeamsPool, type TeamDragPayload } from "@/features/tournament/components/UnassignedTeamsPool";

export default function DrawPage() {
  const {
    tournament,
    activeRound,
    rounds,
    setActiveRound,
    debates,
    teams,
    venues,
    generateDraw,
    updateRound,
    updateDebate,
    updateDebates,
  } = useTournament();

  const [searchQuery, setSearchQuery] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [showUnassigned, setShowUnassigned] = useState(true);
  const [pendingDrawRelease, setPendingDrawRelease] = useState<boolean | null>(null);
  const [isSavingDrawRelease, setIsSavingDrawRelease] = useState(false);
  const [drawReleaseError, setDrawReleaseError] = useState("");
  const [venueAssignmentError, setVenueAssignmentError] = useState("");

  // Drag & Drop state
  const [draggingItem, setDraggingItem] = useState<TeamDragPayload | null>(null);
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
    const eligibleTeams = getEligibleTeamsForRound(teams, activeRound);
    return eligibleTeams.filter((t) => !assignedTeamIds.has(t.id) && t.checkedIn !== false);
  }, [teams, assignedTeamIds, activeRound]);

  const filteredDebates = roundDebates.filter((d) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const venueMatch = (d.venueName || "").toLowerCase().includes(query);
    const teamMatch = Object.values(d.teams || {}).some((t) => (t?.teamName || "").toLowerCase().includes(query));
    return venueMatch || teamMatch;
  });

  // Calculate Clashes for a debate
  const getDebateClashes = (debate: Debate) => {
    const debateTeams: Team[] = Object.values(debate.teams || {})
      .map((slot) => (slot?.teamId ? teamsMap.get(slot.teamId) : undefined))
      .filter((t): t is Team => t !== undefined);

    const teamClashes: string[] = [];

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

    return { teamClashes };
  };

  // Generate draw
  const handleGenerate = async () => {
    if (!activeRound) return;
    if (!tournament) {
      window.alert("Tournament details are not available yet. Please try again.");
      return;
    }
    const requiredVenues = getRequiredVenueCount(tournament, activeRound, teams);
    const availableVenueCount = venues.filter((venue) => venue.available !== false).length;
    if (availableVenueCount < requiredVenues) {
      window.alert(
        `Not enough available venues for this draw. ${requiredVenues} venues are required for the checked-in teams, but only ${availableVenueCount} are available. Add or enable venues before generating the draw.`
      );
      return;
    }
    if (roundDebates.length > 0) {
      if (!confirm("A draw already exists for this round. Regenerating will overwrite all current matchups. Proceed?")) {
        return;
      }
    }
    setIsGenerating(true);
    try {
      await generateDraw(activeRound.id);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not generate the draw.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Toggle release
  const confirmDrawRelease = async () => {
    if (!activeRound || pendingDrawRelease === null) return;
    setIsSavingDrawRelease(true);
    setDrawReleaseError("");
    try {
      await updateRound({
        ...activeRound,
        drawStatus: pendingDrawRelease ? "confirmed" : "draft",
      });
      setPendingDrawRelease(null);
    } catch {
      setDrawReleaseError("The draw visibility change could not be saved. Please try again.");
    } finally {
      setIsSavingDrawRelease(false);
    }
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
    setVenueAssignmentError("");
    if (venue) {
      if (venue.available === false) {
        setVenueAssignmentError(`${venue.name} is unavailable.`);
        return;
      }
      const occupiedBy = roundDebates.find(
        (other) => other.id !== debate.id && other.venueId === venue.id
      );
      if (occupiedBy) {
        setVenueAssignmentError(`${venue.name} is already assigned to ${occupiedBy.venueName || occupiedBy.id}.`);
        return;
      }
      const incompatibilities = getVenueIncompatibilities(debate, venue);
      if (incompatibilities.length > 0) {
        setVenueAssignmentError(`${venue.name} is incompatible: ${incompatibilities.join("; ")}.`);
        return;
      }
    }
    const updated: Debate = {
      ...debate,
      venueId: venue?.id,
      venueName: venue?.name || debate.venueName,
    };
    await updateDebate(updated);
  };

  const handleUpdateVenueRequirements = async (
    debate: Debate,
    requirements: Partial<Pick<
      Debate,
      "requiredVenueCategory" | "requiredVenueCapacity" | "requiresAccessibleVenue" | "requiresOnlineVenue"
    >>
  ) => {
    setVenueAssignmentError("");
    try {
      await updateDebate({ ...debate, ...requirements });
    } catch (error) {
      setVenueAssignmentError(
        error instanceof Error ? error.message : "Could not save debate venue requirements."
      );
    }
  };

  const handleAutoAllocateVenues = async () => {
    setVenueAssignmentError("");
    try {
      const assignedVenues = allocateVenuesToDebates(roundDebates, venues);
      const assignmentsByDebateId = new Map(
        [...assignedVenues].map(([debateId, venue]) => [debateId, venue])
      );
      await updateDebates(debates.map((debate) => {
        const venue = assignmentsByDebateId.get(debate.id);
        return venue ? { ...debate, venueId: venue.id, venueName: venue.name } : debate;
      }));
    } catch (error) {
      setVenueAssignmentError(
        error instanceof Error ? error.message : "Could not allocate venues for this round."
      );
    }
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
    payload: TeamDragPayload
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
    const payload = safeJsonParse<TeamDragPayload | null>(raw, null);
    if (!payload) return;

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
      if (
        activeRound?.stage === "elimination" &&
        !getEligibleTeamsForRound(teams, activeRound).some((team) => team.id === payload.teamId)
      ) {
        setDraggingItem(null);
        return;
      }
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
    const payload = safeJsonParse<TeamDragPayload | null>(raw, null);
    if (!payload) return;

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
            Generate and edit team matchups here. Assign adjudicators separately on the Allocation page.
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
            onClick={handleAutoAllocateVenues}
            disabled={roundDebates.length === 0}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded text-xs font-bold shadow-2xs transition disabled:opacity-50"
            title="Assign compatible available venues by debate priority"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Allocate Venues</span>
          </button>

          <button
            onClick={() => setPendingDrawRelease(activeRound?.drawStatus !== "confirmed")}
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
          {drawReleaseError && <p role="alert" className="text-xs text-red-600">{drawReleaseError}</p>}

          <button
            onClick={() => window.print()}
            className="p-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300 rounded text-xs transition"
            title="Print Draw Sheet"
          >
            <Printer className="w-4 h-4" />
          </button>
        </div>
      </div>

      {venueAssignmentError && (
        <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {venueAssignmentError}
        </p>
      )}

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
        <UnassignedTeamsPool
          teams={unassignedTeams}
          expanded={showUnassigned}
          dragOverTarget={dragOverTarget}
          onToggle={() => setShowUnassigned(!showUnassigned)}
          onDragOver={handleDragOverSlot}
          onDragLeave={handleDragLeaveSlot}
          onDrop={handleDropOnUnassigned}
          onDragStart={handleDragStartTeam}
        />

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
            const assignedVenue = venues.find((venue) => venue.id === debate.venueId);
            const assignedVenueIssues = assignedVenue
              ? getVenueIncompatibilities(debate, assignedVenue)
              : [];

            if (debate.byeTeamId) {
              const byeTeam = Object.values(debate.teams || {}).find((slot) => slot?.teamId === debate.byeTeamId);
              return (
                <div
                  key={debate.id}
                  className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wide text-blue-700">Bye</span>
                    <div className="font-semibold text-gray-900 text-sm">{byeTeam?.teamName || "Team"}</div>
                  </div>
                  <span className="text-xs font-semibold text-blue-800">
                    {debate.byeResult === "win" ? "Full win awarded" : "Absent — no standings result"}
                  </span>
                </div>
              );
            }

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
                        <option value="">{debate.venueName || `Room ${dIdx + 1}`} (unassigned)</option>
                        {venues.map((v) => (
                          <option
                            key={v.id}
                            value={v.id}
                            disabled={
                              v.available === false ||
                              getVenueIncompatibilities(debate, v).length > 0 ||
                              roundDebates.some((other) => other.id !== debate.id && other.venueId === v.id)
                            }
                          >
                            {v.name}{v.category ? ` · ${v.category}` : ""}{v.capacity !== undefined ? ` · ${v.capacity} seats` : ""}{v.available === false ? " · unavailable" : ""}
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

                  </div>

                  {/* Delete Room */}
                  <div className="flex items-center space-x-3 text-xs">
                    <button
                      onClick={() => handleDeleteDebate(debate.id)}
                      className="p-1 text-gray-400 hover:text-red-600 rounded transition"
                      title="Delete this debate room"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="px-4 py-3 border-b border-gray-100 bg-white">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1 text-[10px] font-semibold text-gray-600">
                      Required category
                      <select
                        aria-label={`${debate.venueName || `Room ${dIdx + 1}`} required venue category`}
                        value={debate.requiredVenueCategory || ""}
                        onChange={(e) => void handleUpdateVenueRequirements(debate, {
                          requiredVenueCategory: e.target.value || undefined,
                        })}
                        className="min-w-32 rounded border border-gray-300 px-2 py-1 text-xs text-gray-800"
                      >
                        <option value="">Any category</option>
                        {[...new Set([
                          ...venues.map((venue) => venue.category?.trim()).filter((category): category is string => Boolean(category)),
                          ...(debate.requiredVenueCategory ? [debate.requiredVenueCategory] : []),
                        ])].sort((a, b) => a.localeCompare(b)).map((category) => (
                          <option key={category} value={category}>{category}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-[10px] font-semibold text-gray-600">
                      Minimum seats
                      <input
                        aria-label={`${debate.venueName || `Room ${dIdx + 1}`} minimum venue capacity`}
                        type="number"
                        min="0"
                        defaultValue={debate.requiredVenueCapacity ?? ""}
                        onBlur={(e) => {
                          if (!e.currentTarget.checkValidity()) {
                            e.currentTarget.reportValidity();
                            return;
                          }
                          const value = e.currentTarget.value;
                          const requiredVenueCapacity = value ? Number(value) : undefined;
                          if (requiredVenueCapacity === debate.requiredVenueCapacity) return;
                          void handleUpdateVenueRequirements(debate, {
                            requiredVenueCapacity,
                          });
                        }}
                        className="w-24 rounded border border-gray-300 px-2 py-1 text-xs text-gray-800"
                      />
                    </label>
                    <label className="inline-flex items-center gap-1.5 pb-1 text-[10px] font-semibold text-gray-700">
                      <input
                        type="checkbox"
                        checked={debate.requiresAccessibleVenue === true}
                        onChange={(e) => void handleUpdateVenueRequirements(debate, {
                          requiresAccessibleVenue: e.target.checked,
                        })}
                      />
                      Accessible
                    </label>
                    <label className="inline-flex items-center gap-1.5 pb-1 text-[10px] font-semibold text-gray-700">
                      <input
                        type="checkbox"
                        checked={debate.requiresOnlineVenue === true}
                        onChange={(e) => void handleUpdateVenueRequirements(debate, {
                          requiresOnlineVenue: e.target.checked,
                        })}
                      />
                      Online-capable
                    </label>
                    {assignedVenueIssues.length > 0 && (
                      <span className="basis-full text-[11px] font-semibold text-red-700" role="status">
                        Assigned venue does not meet requirements: {assignedVenueIssues.join("; ")}.
                      </span>
                    )}
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

              </div>
            );
          })}
        </div>
      )}
      {pendingDrawRelease !== null && activeRound && (
        <ConfirmActionDialog
          title={pendingDrawRelease ? "Publish this draw?" : "Unpublish this draw?"}
          description={pendingDrawRelease
            ? `Publishing ${activeRound.name} makes its room and team assignments visible on the public tab.`
            : `Unpublishing ${activeRound.name} immediately hides its draw from the public tab.`}
          confirmLabel={pendingDrawRelease ? "Yes, publish draw" : "Yes, unpublish draw"}
          onConfirm={confirmDrawRelease}
          onCancel={() => setPendingDrawRelease(null)}
          isBusy={isSavingDrawRelease}
          error={drawReleaseError}
        />
      )}
    </div>
  );
}

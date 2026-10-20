"use client";

import React, { useEffect, useState, useMemo } from "react";
import { ComputeStatus } from "@/features/tournament/components/ComputeStatus";
import { ComputeCancelledError } from "@/features/tournament/compute/computeClient";
import { useTournament } from "@/contexts/TournamentContext";
import {
  Shuffle,
  Printer,
  Download,
  CheckCircle2,
  AlertTriangle,
  Lock,
  MapPin,
  Search,
  Plus,
  Trash2,
  RefreshCw,
  Table2,
} from "lucide-react";
import { safeJsonParse } from "@/lib/safeJson";
import { csvFileStem, drawCsv } from "@/lib/csv/exporters";
import { downloadCsv } from "@/lib/csv/download";
import { DebateSide, Debate, Team, Venue } from "@/types";
import { getEligibleTeamsForRound, getRequiredVenueCount } from "@/lib/draw/generator";
import { allocateVenuesToDebates, getVenueIncompatibilities } from "@/lib/draw/venueAllocator";
import { isVenueAvailableForRound, safeVenueUrl, venueDisplayName, venueTooltip } from "@/lib/venues/venues";
import { ReleaseActionDialog } from "@/features/tournament/components/ReleaseActionDialog";
import { UnassignedTeamsPool, type TeamDragPayload } from "@/features/tournament/components/UnassignedTeamsPool";
import { DrawSetupPanel } from "@/features/tournament/components/DrawSetupPanel";
import { DrawCheckPanel } from "@/features/tournament/components/DrawCheckPanel";
import { DrawTeamSlot } from "@/features/tournament/components/DrawTeamSlot";
import { DrawDetailsPanel } from "@/features/tournament/components/DrawDetailsPanel";
import { SwingTeamPanel } from "@/features/tournament/components/SwingTeamPanel";
import { roundResults } from "@/features/tournament/application/draws";
import { buildDrawDetails, computeDrawFlags, type DebateFlags } from "@/lib/draw/drawFlags";
import { moveTeam, type PickedTeam, type TeamLocation } from "@/lib/draw/drawEditing";
import { MANUAL_SIDES_FLAG, sidesPending } from "@/lib/draw/manualSides";
import { CurrentRoundsBar } from "@/features/tournament/components/CurrentRoundsBar";

export default function DrawPage() {
  const {
    tournament,
    activeRound,
    rounds,
    setActiveRound,
    debates,
    ballots,
    teams,
    adjudicators,
    venues,
    institutions,
    generateDraw,
    updateRound,
    updateTeam,
    updateDebate,
    updateDebates,
    addTeam,
    teamStandings,
  } = useTournament();

  const [searchQuery, setSearchQuery] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [showUnassigned, setShowUnassigned] = useState(true);
  const [pendingDrawRelease, setPendingDrawRelease] = useState<boolean | null>(null);
  const [venueAssignmentError, setVenueAssignmentError] = useState("");

  // Drag & drop, and keyboard/touch "pick, then place" editing
  const [, setDraggingItem] = useState<TeamDragPayload | null>(null);
  const [picked, setPicked] = useState<PickedTeam | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [drawEditError, setDrawEditError] = useState("");

  /** Shows why a manual draw edit was refused (e.g. a debate that already has a ballot). */
  function reportingErrors<A extends unknown[]>(handler: (...args: A) => Promise<void>) {
    return async (...args: A) => {
      setDrawEditError("");
      try {
        await handler(...args);
      } catch (error) {
        setDraggingItem(null);
        setPicked(null);
        setDrawEditError(error instanceof Error ? error.message : "Could not change the draw.");
      }
    };
  }
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

  const drawInput = useMemo(
    () => tournament && activeRound
      ? { tournament, round: activeRound, rounds, debates, ballots, teams, adjudicators, venues, standings: teamStandings }
      : null,
    [tournament, activeRound, rounds, debates, ballots, teams, adjudicators, venues, teamStandings]
  );
  const drawFlags = useMemo(
    () => (drawInput && roundDebates.length > 0 ? computeDrawFlags(drawInput) : new Map<string, DebateFlags>()),
    [drawInput, roundDebates.length]
  );
  const drawDetails = useMemo(() => (drawInput && showDetails ? buildDrawDetails(drawInput) : []), [drawInput, showDetails]);
  const pointsByTeam = useMemo(() => new Map(teamStandings.map((row) => [row.teamId, row.points])), [teamStandings]);
  const sidesOnBallot = !isBP && tournament?.preferences?.sideAllocationRule === "manual_ballot";

  // Escape cancels a pick; switching rounds drops it.
  useEffect(() => {
    if (!picked) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPicked(null);
        setAnnouncement("Move cancelled.");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [picked]);
  useEffect(() => setPicked(null), [activeRound?.id]);

  // Generate draw
  const handleGenerate = async () => {
    if (!activeRound) return;
    if (!tournament) {
      window.alert("Tournament details are not available yet. Please try again.");
      return;
    }
    const requiredVenues = getRequiredVenueCount(tournament, activeRound, teams);
    const availableVenueCount = venues.filter((venue) => isVenueAvailableForRound(venue, activeRound.id)).length;
    if (availableVenueCount < requiredVenues) {
      window.alert(
        `Not enough available venues for this draw. ${requiredVenues} venues are required for the checked-in teams, but only ${availableVenueCount} are available. Add or enable venues before generating the draw.`
      );
      return;
    }
    const existingResults = roundResults(activeRound.id, debates, ballots);
    if (existingResults.length > 0) {
      const resultDebates = new Set(existingResults.map((ballot) => ballot.debateId)).size;
      if (!confirm(
        `This round already has ${existingResults.length} ballot(s) for ${resultDebates} debate(s). ` +
        "Regenerating the draw will DISCARD these results (they stay in each ballot's history but will no longer count). " +
        "Only do this if the round has not actually been debated as drawn. Discard results and regenerate?"
      )) {
        return;
      }
    } else if (roundDebates.length > 0) {
      if (!confirm("A draw already exists for this round. Regenerating will overwrite all current matchups. Proceed?")) {
        return;
      }
    }
    setIsGenerating(true);
    try {
      await generateDraw(activeRound.id, { discardExistingResults: existingResults.length > 0 });
    } catch (error) {
      if (!(error instanceof ComputeCancelledError)) {
        window.alert(error instanceof Error ? error.message : "Could not generate the draw.");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // Toggle release
  // Add new empty debate room
  const handleAddDebateRoom = reportingErrors(async () => {
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
      // Sides chosen on the ballot apply to hand-built rooms too.
      flags: sidesOnBallot ? [MANUAL_SIDES_FLAG] : [],
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
  });

  // Delete a debate room
  const handleDeleteDebate = async (debateId: string) => {
    if (!confirm("Are you sure you want to delete this debate room? Assigned teams will return to the unassigned pool.")) return;
    const updated = debates.filter((d) => d.id !== debateId);
    try {
      await updateDebates(updated);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not delete the debate room.");
    }
  };

  // Change Venue
  const handleChangeVenue = async (debateId: string, venueId: string) => {
    const debate = roundDebates.find((d) => d.id === debateId);
    if (!debate) return;
    const venue = venues.find((v) => v.id === venueId);
    setVenueAssignmentError("");
    if (venue) {
      if (!isVenueAvailableForRound(venue, debate.roundId)) {
        setVenueAssignmentError(`${venue.name} is unavailable in this round.`);
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
    try {
      await updateDebate(updated);
    } catch (error) {
      setVenueAssignmentError(error instanceof Error ? error.message : "Could not change the venue.");
    }
  };

  const handleUpdateVenueRequirements = async (
    debate: Debate,
    requirements: Partial<Pick<
      Debate,
      "requiredVenueCategory" | "requiredVenueCapacity" | "requiresAccessibleVenue" | "requiresOnlineVenue" | "requiresNearTabRoom"
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
      const assignedVenues = allocateVenuesToDebates(roundDebates, venues, { teams, adjudicators, institutions });
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

  /** Applies a move through the draw commands (state rules, live sync) and announces it. */
  const applyMove = reportingErrors(async (pick: PickedTeam, target: TeamLocation) => {
    if (
      pick.from.kind === "slot" &&
      target.kind === "slot" &&
      pick.from.debateId !== target.debateId &&
      activeRound?.stage === "elimination" &&
      !getEligibleTeamsForRound(teams, activeRound).some((team) => team.id === pick.teamId)
    ) {
      setPicked(null);
      setDrawEditError(`${pick.teamName} did not qualify for ${activeRound.name}.`);
      return;
    }
    const move = moveTeam(debates, pick, target);
    setPicked(null);
    setDraggingItem(null);
    if (!move.announcement) {
      setAnnouncement("Nothing changed.");
      return;
    }
    await updateDebates(move.debates);
    setAnnouncement(move.announcement);
  });

  const roomLabelFor = (debateId: string) => {
    const debate = roundDebates.find((item) => item.id === debateId);
    return debate?.venueName || `Room ${debate?.roomRank ?? ""}`;
  };

  const pickTeam = (pick: PickedTeam) => {
    setDrawEditError("");
    setPicked(pick);
    setAnnouncement(
      `${pick.teamName} picked${pick.from.kind === "slot" ? ` from ${roomLabelFor(pick.from.debateId)}` : " from the unassigned pool"}. ` +
      "Choose Place here or Swap here on a slot" + (pick.from.kind === "slot" ? ", or return it to the pool" : "") +
      ". Press Escape to cancel."
    );
  };

  const handleRemoveTeamFromSlot = (debateId: string, side: DebateSide) => {
    const slot = roundDebates.find((debate) => debate.id === debateId)?.teams[side];
    if (!slot?.teamId) return;
    void applyMove({ teamId: slot.teamId, teamName: slot.teamName, from: { kind: "slot", debateId, side } }, { kind: "pool" });
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

  const pickFromPayload = (e: React.DragEvent): PickedTeam | null => {
    e.preventDefault();
    setDragOverTarget(null);
    const raw = e.dataTransfer.getData("application/json");
    const payload = raw ? safeJsonParse<TeamDragPayload | null>(raw, null) : null;
    if (!payload) return null;
    return {
      teamId: payload.teamId,
      teamName: payload.teamName,
      from: payload.sourceType === "debate" && payload.debateId && payload.side
        ? { kind: "slot", debateId: payload.debateId, side: payload.side }
        : { kind: "pool" },
    };
  };

  const handleDropOnSlot = (e: React.DragEvent, targetDebateId: string, targetSide: DebateSide) => {
    const pick = pickFromPayload(e);
    if (pick) void applyMove(pick, { kind: "slot", debateId: targetDebateId, side: targetSide });
  };

  const handleDropOnUnassigned = (e: React.DragEvent) => {
    const pick = pickFromPayload(e);
    if (pick) void applyMove(pick, { kind: "pool" });
  };

  const handleExportDrawCsv = () => {
    if (!tournament || !activeRound) return;
    downloadCsv(
      `${csvFileStem(tournament.name, activeRound.abbreviation || activeRound.name)}_Draw.csv`,
      drawCsv(roundDebates, { format: tournament.format, includeAdjudicators: true, includeMotion: true })
    );
  };

  return (
    <div className="space-y-6">
      <CurrentRoundsBar />
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
          <ComputeStatus kind="draw" />

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

          <button
            type="button"
            onClick={() => setShowDetails((value) => !value)}
            disabled={roundDebates.length === 0}
            aria-pressed={showDetails}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 rounded text-xs font-semibold transition disabled:opacity-50"
            title="Per team: points, sides by round, previous opponents and pull-ups"
          >
            <Table2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{showDetails ? "Hide draw details" : "Draw details"}</span>
          </button>

          <button
            onClick={handleExportDrawCsv}
            disabled={roundDebates.length === 0}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 rounded text-xs font-semibold transition disabled:opacity-50"
            title="Download this round's draw, with adjudicators and motion, as CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
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

      {tournament && activeRound && (
        <DrawSetupPanel
          tournament={tournament}
          round={activeRound}
          teams={teams}
          updateRound={updateRound}
          updateTeam={(team) => updateTeam(team)}
        />
      )}

      {tournament && activeRound && activeRound.stage === "preliminary" && (
        <SwingTeamPanel
          tournament={tournament}
          round={activeRound}
          teams={teams}
          addTeam={addTeam}
          updateTeam={(team) => updateTeam(team)}
        />
      )}

      {tournament && activeRound && (
        <DrawCheckPanel
          tournament={tournament}
          round={activeRound}
          rounds={rounds}
          debates={debates}
          teams={teams}
          adjudicators={adjudicators}
          venues={venues}
          ballots={ballots}
          institutions={institutions}
        />
      )}

      {showDetails && drawDetails.length > 0 && (
        <DrawDetailsPanel rows={drawDetails} sides={isBP ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"]} />
      )}

      {venueAssignmentError && (
        <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {venueAssignmentError}
        </p>
      )}
      {drawEditError && (
        <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {drawEditError}
        </p>
      )}
      <p aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</p>
      {picked && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded border border-blue-300 bg-blue-50 px-3 py-2 text-xs text-blue-900 shadow-sm">
          <span>
            <span className="font-bold">{picked.teamName}</span> picked. Choose <span className="font-semibold">Place here</span> or{" "}
            <span className="font-semibold">Swap here</span> on a slot{picked.from.kind === "slot" ? ", or return it to the pool" : ""}.
          </span>
          <button
            type="button"
            onClick={() => {
              setPicked(null);
              setAnnouncement("Move cancelled.");
            }}
            className="rounded border border-blue-300 bg-white px-2 py-1 font-semibold text-blue-800 hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Cancel (Esc)
          </button>
        </div>
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
      {activeRound && teams.some((team) => team.divisionId || team.divisionName) && (
        <label className="flex max-w-md items-center gap-2 text-xs font-semibold text-gray-700">
          Division
          <select
            value={activeRound.divisionId || ""}
            onChange={(event) => void updateRound({
              ...activeRound,
              divisionId: event.target.value || undefined,
            })}
            className="min-w-48 rounded border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">All divisions</option>
            {[...new Map(teams
              .filter((team) => team.divisionId || team.divisionName)
              .map((team) => [team.divisionId || team.divisionName || "", {
                id: team.divisionId || team.divisionName || "",
                name: team.divisionName || team.divisionId || "",
              }])).values()]
              .sort((left, right) => left.name.localeCompare(right.name))
              .map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}
          </select>
          <span className="font-normal text-gray-500">This round will draw only teams in the selected division.</span>
        </label>
      )}

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
          pickedTeamId={picked?.teamId}
          pickedFromDebate={picked?.from.kind === "slot"}
          onPick={(team) => pickTeam({ teamId: team.id, teamName: team.name, from: { kind: "pool" } })}
          onReturnToPool={() => picked && void applyMove(picked, { kind: "pool" })}
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
            const flags = drawFlags.get(debate.id);
            const pending = sidesPending(debate);
            const errorCount = flags?.issues.filter((issue) => issue.severity === "error").length ?? 0;
            const warningCount = (flags?.issues.length ?? 0) - errorCount;
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
                              !isVenueAvailableForRound(v, debate.roundId) ||
                              getVenueIncompatibilities(debate, v).length > 0 ||
                              roundDebates.some((other) => other.id !== debate.id && other.venueId === v.id)
                            }
                          >
                            {venueDisplayName(v, tournament?.preferences?.venueCategories)}{v.category ? ` · ${v.category}` : ""}{v.capacity !== undefined ? ` · ${v.capacity} seats` : ""}{!isVenueAvailableForRound(v, debate.roundId) ? " · unavailable" : ""}
                          </option>
                        ))}
                      </select>
                      {(() => {
                        const assigned = venues.find((v) => v.id === debate.venueId);
                        const url = safeVenueUrl(assigned?.url);
                        const tooltip = assigned ? venueTooltip(assigned, tournament?.preferences?.venueCategories, "admin") : undefined;
                        return (
                          <>
                            {tooltip && <span className="text-[10px] font-normal text-gray-500">{tooltip}</span>}
                            {url && (
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] font-semibold text-blue-700 underline"
                                aria-label={`Open the room link for ${assigned?.name}`}
                              >
                                Room link
                              </a>
                            )}
                          </>
                        );
                      })()}
                    </div>

                    {activeRound?.stage !== "elimination" && (
                      <span className="text-[10px] font-semibold bg-gray-200 text-gray-700 px-2 py-0.5 rounded" title="Points bracket of this debate">
                        Bracket {debate.bracket ?? 0}
                      </span>
                    )}
                    <span className="text-[10px] font-semibold bg-gray-200 text-gray-700 px-2 py-0.5 rounded" title="Room rank (1 is the top room)">
                      Room rank {debate.roomRank}
                    </span>
                    {pending && (
                      <span className="text-[10px] font-semibold border border-dashed border-gray-400 text-gray-700 px-2 py-0.5 rounded" title="Sides are chosen on the ballot">
                        Sides on ballot
                      </span>
                    )}
                    {errorCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-800 bg-red-50 border border-red-300 px-2 py-0.5 rounded">
                        <AlertTriangle className="w-3 h-3 text-red-600" aria-hidden="true" />
                        {errorCount} problem{errorCount === 1 ? "" : "s"}
                      </span>
                    )}
                    {warningCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-300 px-2 py-0.5 rounded">
                        <AlertTriangle className="w-3 h-3 text-amber-600" aria-hidden="true" />
                        {warningCount} warning{warningCount === 1 ? "" : "s"}
                      </span>
                    )}

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
                    <label className="inline-flex items-center gap-1.5 pb-1 text-[10px] font-semibold text-gray-700">
                      <input
                        type="checkbox"
                        checked={debate.postponed === true}
                        onChange={(event) => void updateDebate({
                          ...debate,
                          postponed: event.target.checked || undefined,
                          postponedReason: event.target.checked ? debate.postponedReason : undefined,
                        })}
                      />
                      Postponed (exclude from standings and history)
                    </label>
                    {debate.postponed && (
                      <input
                        type="text"
                        aria-label="Postponement reason"
                        maxLength={500}
                        value={debate.postponedReason || ""}
                        onChange={(event) => void updateDebate({
                          ...debate,
                          postponedReason: event.target.value || undefined,
                        })}
                        placeholder="Reason (optional)"
                        className="min-w-48 rounded border border-gray-300 px-2 py-1 text-xs text-gray-800"
                      />
                    )}
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
                    <label className="inline-flex items-center gap-1.5 pb-1 text-[10px] font-semibold text-gray-700">
                      <input
                        type="checkbox"
                        checked={debate.requiresNearTabRoom === true}
                        onChange={(e) => void handleUpdateVenueRequirements(debate, {
                          requiresNearTabRoom: e.target.checked,
                        })}
                      />
                      Near tab room
                    </label>
                    {assignedVenueIssues.length > 0 && (
                      <span className="basis-full text-[11px] font-semibold text-red-700" role="status">
                        Assigned venue does not meet requirements: {assignedVenueIssues.join("; ")}.
                      </span>
                    )}
                  </div>
                </div>

                {/* Matchup grid: drag and drop, or Move then Place / Swap */}
                {flags && flags.issues.length > 0 && (
                  <ul className="mx-4 mt-3 space-y-0.5 text-[11px] text-gray-700" aria-label={`Draw check for ${debate.venueName || `Room ${dIdx + 1}`}`}>
                    {flags.issues.map((issue: DebateFlags["issues"][number], index: number) => (
                      <li key={`${issue.code}-${index}`}>
                        <span className={`font-semibold ${issue.severity === "error" ? "text-red-700" : "text-amber-800"}`}>
                          {issue.severity === "error" ? "Problem:" : "Warning:"}
                        </span>{" "}
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  {(isBP ? (["OG", "OO", "CG", "CO"] as DebateSide[]) : (["AFF", "NEG"] as DebateSide[])).map((side, sideIndex) => {
                    const slot = debate.teams?.[side];
                    const dropKey = `${debate.id}-${side}`;
                    const location: TeamLocation = { kind: "slot", debateId: debate.id, side };
                    return (
                      <DrawTeamSlot
                        key={side}
                        debateId={debate.id}
                        side={side}
                        pendingLabel={pending ? `Team ${sideIndex + 1}` : undefined}
                        roomLabel={debate.venueName || `Room ${dIdx + 1}`}
                        slot={slot}
                        team={slot?.teamId ? teamsMap.get(slot.teamId) : undefined}
                        points={slot?.teamId ? pointsByTeam.get(slot.teamId) : undefined}
                        flags={(slot?.teamId && flags?.teams[slot.teamId]) || []}
                        compact={isBP}
                        isDragTarget={dragOverTarget === dropKey}
                        isPicked={Boolean(picked && picked.from.kind === "slot" && picked.from.debateId === debate.id && picked.from.side === side)}
                        pickActive={Boolean(picked)}
                        onPick={() => slot?.teamId && pickTeam({ teamId: slot.teamId, teamName: slot.teamName, from: location })}
                        onPlace={() => picked && void applyMove(picked, location)}
                        onRemove={() => handleRemoveTeamFromSlot(debate.id, side)}
                        onDragStart={handleDragStartTeam}
                        onDragOver={(e) => handleDragOverSlot(e, dropKey)}
                        onDragLeave={(e) => handleDragLeaveSlot(e, dropKey)}
                        onDrop={(e) => handleDropOnSlot(e, debate.id, side)}
                      />
                    );
                  })}
                </div>

              </div>
            );
          })}
        </div>
      )}
      {pendingDrawRelease !== null && activeRound && (
        <ReleaseActionDialog
          title={pendingDrawRelease ? "Publish this draw?" : "Unpublish this draw?"}
          description={pendingDrawRelease
            ? `Publishing ${activeRound.name} makes its room and team assignments visible on the public tab.`
            : `Unpublishing ${activeRound.name} hides its draw from the public tab.`}
          confirmLabel={pendingDrawRelease ? "Publish draw" : "Unpublish draw"}
          apply={() => updateRound({ ...activeRound, drawStatus: pendingDrawRelease ? "confirmed" : "draft" })}
          onClose={() => setPendingDrawRelease(null)}
        />
      )}
    </div>
  );
}

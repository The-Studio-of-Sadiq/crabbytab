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
import { DebateSide, Debate, Team } from "@/types";
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
import { slotPickKey } from "@/features/tournament/components/DrawTeamSlot";
import { poolPickKey } from "@/features/tournament/components/UnassignedTeamsPool";
import { usePlaceTargetNavigation } from "@/features/tournament/components/usePlaceTargetNavigation";
import type { RoomRef, SlotRef, TeamMoveEvent } from "@/lib/draw/drawEditing";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button, IconButton } from "@/components/ui/Button";
import { Badge, StatusPill } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Checkbox, Input, Select } from "@/components/ui/Field";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";

type T = ReturnType<typeof useI18n>["t"];

function roomText(ref: RoomRef, t: T): string {
  return ref.venueName || t("tabroom.draw.roomFallback", { number: ref.roomRank });
}

function slotText(ref: SlotRef, t: T): string {
  const room = roomText(ref, t);
  return ref.side ? t("tabroom.draw.slot.where", { room, side: ref.side }) : room;
}

/** The live-region sentence for a draw edit, in the viewer's language. */
function describeMove(event: TeamMoveEvent, t: T): string {
  switch (event.kind) {
    case "returned_to_pool":
      return t("tabroom.draw.move.returnedToPool", { team: event.team, from: slotText(event.from, t) });
    case "placed":
      return event.displaced
        ? t("tabroom.draw.move.placedDisplacing", { team: event.team, to: slotText(event.to, t), displaced: event.displaced })
        : t("tabroom.draw.move.placed", { team: event.team, to: slotText(event.to, t) });
    case "swapped_sides":
      return t("tabroom.draw.move.swappedSides", { team: event.team, other: event.other, room: roomText(event.room, t) });
    case "moved_side":
      return t("tabroom.draw.move.movedSide", { team: event.team, side: event.side, room: roomText(event.room, t) });
    case "swapped":
      return t("tabroom.draw.move.swapped", {
        team: event.team,
        teamNow: slotText(event.teamNow, t),
        other: event.other,
        otherNow: slotText(event.otherNow, t),
      });
    case "moved":
      return t("tabroom.draw.move.moved", { team: event.team, from: slotText(event.from, t), to: slotText(event.to, t) });
  }
}

type PendingGenerate = { kind: "discard"; ballots: number; debates: number } | { kind: "overwrite" };

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
  const { t, plural, rich } = useI18n();

  const [searchQuery, setSearchQuery] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [showUnassigned, setShowUnassigned] = useState(true);
  const [pendingDrawRelease, setPendingDrawRelease] = useState<boolean | null>(null);
  const [venueAssignmentError, setVenueAssignmentError] = useState("");
  const [generateError, setGenerateError] = useState("");
  const [pendingGenerate, setPendingGenerate] = useState<PendingGenerate | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  /** Where focus lands when a pick ends and its own Move button is gone (the slot the team went to). */
  const [focusAfterPick, setFocusAfterPick] = useState<string | null>(null);

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
        setDrawEditError(error instanceof Error ? error.message : t("tabroom.draw.error.editFailed"));
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

  const cancelPick = () => {
    setPicked(null);
    setAnnouncement(t("tabroom.common.moveCancelled"));
  };
  // Escape cancels a pick, arrows/Home/End move between targets, focus returns afterwards.
  usePlaceTargetNavigation(Boolean(picked), cancelPick, focusAfterPick);
  // Switching rounds drops a pick.
  useEffect(() => setPicked(null), [activeRound?.id]);

  const runGenerate = async (discardExistingResults: boolean) => {
    if (!activeRound) return;
    setIsGenerating(true);
    try {
      await generateDraw(activeRound.id, { discardExistingResults });
    } catch (error) {
      if (!(error instanceof ComputeCancelledError)) {
        setGenerateError(error instanceof Error ? error.message : t("tabroom.draw.error.generateFailed"));
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // Generate draw: a venue shortage blocks; existing results or an existing draw are confirmed first.
  const handleGenerate = () => {
    if (!activeRound) return;
    setGenerateError("");
    if (!tournament) {
      setGenerateError(t("tabroom.draw.error.tournamentUnavailable"));
      return;
    }
    const requiredVenues = getRequiredVenueCount(tournament, activeRound, teams);
    const availableVenueCount = venues.filter((venue) => isVenueAvailableForRound(venue, activeRound.id)).length;
    if (availableVenueCount < requiredVenues) {
      setGenerateError(t("tabroom.draw.error.venueShortage", { required: requiredVenues, available: availableVenueCount }));
      return;
    }
    const existingResults = roundResults(activeRound.id, debates, ballots);
    if (existingResults.length > 0) {
      const resultDebates = new Set(existingResults.map((ballot) => ballot.debateId)).size;
      setPendingGenerate({ kind: "discard", ballots: existingResults.length, debates: resultDebates });
      return;
    }
    if (roundDebates.length > 0) {
      setPendingGenerate({ kind: "overwrite" });
      return;
    }
    void runGenerate(false);
  };

  const confirmGenerate = () => {
    const pending = pendingGenerate;
    setPendingGenerate(null);
    // Results are discarded only when the user confirmed discarding them.
    if (pending) void runGenerate(pending.kind === "discard");
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

  // Delete a debate room (after the confirmation dialog)
  const handleDeleteDebate = async (debateId: string) => {
    setDrawEditError("");
    const updated = debates.filter((d) => d.id !== debateId);
    try {
      await updateDebates(updated);
    } catch (error) {
      setDrawEditError(error instanceof Error ? error.message : t("tabroom.draw.error.deleteFailed"));
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
        setVenueAssignmentError(t("tabroom.draw.error.venueUnavailable", { venue: venue.name }));
        return;
      }
      const occupiedBy = roundDebates.find(
        (other) => other.id !== debate.id && other.venueId === venue.id
      );
      if (occupiedBy) {
        setVenueAssignmentError(t("tabroom.draw.error.venueOccupied", { venue: venue.name, room: occupiedBy.venueName || occupiedBy.id }));
        return;
      }
      const incompatibilities = getVenueIncompatibilities(debate, venue);
      if (incompatibilities.length > 0) {
        setVenueAssignmentError(t("tabroom.draw.error.venueIncompatible", { venue: venue.name, reasons: incompatibilities.join("; ") }));
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
      setVenueAssignmentError(error instanceof Error ? error.message : t("tabroom.draw.error.venueChangeFailed"));
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
        error instanceof Error ? error.message : t("tabroom.draw.error.venueRequirementsFailed")
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
        error instanceof Error ? error.message : t("tabroom.draw.error.venueAllocateFailed")
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
      setDrawEditError(t("tabroom.draw.error.notQualified", { team: pick.teamName, round: activeRound.name }));
      return;
    }
    const move = moveTeam(debates, pick, target);
    setFocusAfterPick(target.kind === "slot" ? slotPickKey(target.debateId, target.side) : poolPickKey(pick.teamId));
    setPicked(null);
    setDraggingItem(null);
    if (!move.announcement) {
      setAnnouncement(t("tabroom.common.nothingChanged"));
      return;
    }
    await updateDebates(move.debates);
    setAnnouncement(move.event ? describeMove(move.event, t) : move.announcement);
  });

  const roomLabelFor = (debateId: string) => {
    const debate = roundDebates.find((item) => item.id === debateId);
    return debate?.venueName || t("tabroom.draw.roomFallback", { number: debate?.roomRank ?? "" });
  };

  const pickTeam = (pick: PickedTeam) => {
    setDrawEditError("");
    setPicked(pick);
    setAnnouncement(
      pick.from.kind === "slot"
        ? t("tabroom.draw.announce.pickedFromRoom", { team: pick.teamName, room: roomLabelFor(pick.from.debateId) })
        : t("tabroom.draw.announce.pickedFromPool", { team: pick.teamName })
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

  const drawReleased = activeRound?.drawStatus === "confirmed";
  const sideOrder: DebateSide[] = isBP ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"];
  const pendingDeleteDebate = pendingDeleteId ? roundDebates.find((debate) => debate.id === pendingDeleteId) : undefined;
  const divisions = [...new Map(teams
    .filter((team) => team.divisionId || team.divisionName)
    .map((team) => [team.divisionId || team.divisionName || "", {
      id: team.divisionId || team.divisionName || "",
      name: team.divisionName || team.divisionId || "",
    }])).values()]
    .sort((left, right) => left.name.localeCompare(right.name));
  const bold = { b: (text: string) => <strong className="font-semibold">{text}</strong> };

  return (
    <div className="space-y-6">
      <CurrentRoundsBar />
      <PageHeader
        title={t("tabroom.draw.title")}
        description={t("tabroom.draw.description")}
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={handleAddDebateRoom} disabled={!activeRound}>
              <Plus aria-hidden="true" />
              {t("tabroom.draw.action.addRoom")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={handleGenerate}
              disabled={!activeRound}
              loading={isGenerating}
              loadingText={t("tabroom.draw.action.generating")}
            >
              <Shuffle aria-hidden="true" />
              {t("tabroom.draw.action.generate")}
            </Button>
            <ComputeStatus kind="draw" />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleAutoAllocateVenues}
              disabled={roundDebates.length === 0}
              title={t("tabroom.draw.action.allocateVenuesTitle")}
            >
              <RefreshCw aria-hidden="true" />
              {t("tabroom.draw.action.allocateVenues")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPendingDrawRelease(!drawReleased)}
              disabled={roundDebates.length === 0}
            >
              {drawReleased ? (
                <>
                  <CheckCircle2 className="text-success" aria-hidden="true" />
                  {t("tabroom.draw.action.released")}
                </>
              ) : (
                <>
                  <Lock aria-hidden="true" />
                  {t("tabroom.draw.action.release")}
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowDetails((value) => !value)}
              disabled={roundDebates.length === 0}
              aria-pressed={showDetails}
              title={t("tabroom.draw.action.detailsTitle")}
            >
              <Table2 aria-hidden="true" />
              {showDetails ? t("tabroom.draw.action.hideDetails") : t("tabroom.draw.action.details")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleExportDrawCsv}
              disabled={roundDebates.length === 0}
              title={t("tabroom.draw.action.exportCsvTitle")}
            >
              <Download aria-hidden="true" />
              {t("tabroom.draw.action.exportCsv")}
            </Button>
            <IconButton
              size="sm"
              variant="secondary"
              onClick={() => window.print()}
              label={t("tabroom.draw.action.print")}
              icon={<Printer aria-hidden="true" />}
            />
          </>
        }
      />

      {generateError && (
        <Alert tone="danger" role="alert">
          {generateError}
        </Alert>
      )}

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

      {showDetails && drawDetails.length > 0 && <DrawDetailsPanel rows={drawDetails} sides={sideOrder} />}

      {venueAssignmentError && (
        <Alert tone="danger" role="alert">
          {venueAssignmentError}
        </Alert>
      )}
      {drawEditError && (
        <Alert tone="danger" role="alert">
          {drawEditError}
        </Alert>
      )}
      <p aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</p>
      {picked && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent bg-accent-subtle px-3 py-2 text-xs text-fg shadow-lg">
          <span>
            {picked.from.kind === "slot"
              ? rich("tabroom.draw.banner.fromRoom", bold, { team: picked.teamName })
              : rich("tabroom.draw.banner.fromPool", bold, { team: picked.teamName })}
          </span>
          <Button size="sm" variant="secondary" onClick={cancelPick}>
            {t("tabroom.common.cancelEsc")}
          </Button>
        </div>
      )}

      {/* Round selector */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1" role="group" aria-label={t("tabroom.draw.rounds.aria")}>
        <span className="mr-1 shrink-0 text-[11px] font-medium uppercase tracking-wide text-fg-muted" aria-hidden="true">
          {t("tabroom.draw.rounds.label")}
        </span>
        {rounds.map((r) => {
          const selected = activeRound?.id === r.id;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setActiveRound(r)}
              aria-pressed={selected}
              className={cn(
                "h-7 shrink-0 rounded-md border px-2.5 text-xs font-medium transition-colors",
                focusRing,
                selected ? "border-accent bg-accent text-accent-fg" : "border-border-strong bg-surface text-fg hover:bg-muted"
              )}
            >
              {r.name}
            </button>
          );
        })}
      </div>
      {activeRound && divisions.length > 0 && (
        <Select
          label={t("tabroom.draw.division.label")}
          help={t("tabroom.draw.division.help")}
          wrapperClassName="max-w-md space-y-1"
          className="h-7 text-xs"
          value={activeRound.divisionId || ""}
          onChange={(event) => void updateRound({
            ...activeRound,
            divisionId: event.target.value || undefined,
          })}
        >
          <option value="">{t("tabroom.draw.division.all")}</option>
          {divisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}
        </Select>
      )}

      {/* Unassigned teams pool (drop zone) and search */}
      <div className="space-y-3">
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

        {roundDebates.length > 0 && (
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
            <Input
              type="search"
              aria-label={t("tabroom.draw.search.aria")}
              placeholder={t("tabroom.draw.search.placeholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leadingIcon={<Search />}
              wrapperClassName="w-full max-w-sm"
              className="h-7 text-xs"
            />
            <span className="text-xs text-fg-muted" role="status">
              {plural("tabroom.draw.search.showing", roundDebates.length, { shown: filteredDebates.length })}
            </span>
          </div>
        )}
      </div>

      {/* Debates */}
      {roundDebates.length === 0 ? (
        <EmptyState
          icon={<Shuffle aria-hidden="true" />}
          title={activeRound ? t("tabroom.draw.empty.title", { round: activeRound.name }) : t("tabroom.draw.empty.noRound")}
          description={t("tabroom.draw.empty.description")}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={handleGenerate}
                disabled={!activeRound}
                loading={isGenerating}
                loadingText={t("tabroom.draw.action.generating")}
              >
                <Shuffle aria-hidden="true" />
                {t("tabroom.draw.empty.generate", { round: activeRound?.name ?? "" })}
              </Button>
              <Button size="sm" variant="secondary" onClick={handleAddDebateRoom} disabled={!activeRound}>
                <Plus aria-hidden="true" />
                {t("tabroom.draw.empty.buildManually")}
              </Button>
            </div>
          }
        />
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
            const roomLabel = debate.venueName || t("tabroom.draw.roomFallback", { number: dIdx + 1 });

            if (debate.byeTeamId) {
              const byeTeam = Object.values(debate.teams || {}).find((slot) => slot?.teamId === debate.byeTeamId);
              return (
                <Card
                  key={debate.id}
                  className="flex flex-col justify-between gap-2 border-info-border bg-info-subtle px-4 py-3 sm:flex-row sm:items-center"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="info">{t("tabroom.draw.bye.label")}</Badge>
                    <span className="text-[13px] font-semibold text-fg">{byeTeam?.teamName || t("tabroom.draw.bye.teamFallback")}</span>
                  </div>
                  <span className="text-xs font-medium text-fg-muted">
                    {debate.byeResult === "win" ? t("tabroom.draw.bye.win") : t("tabroom.draw.bye.absent")}
                  </span>
                </Card>
              );
            }

            const url = safeVenueUrl(assignedVenue?.url);
            const tooltip = assignedVenue ? venueTooltip(assignedVenue, tournament?.preferences?.venueCategories, "admin") : undefined;

            return (
              <Card key={debate.id} className="overflow-hidden transition-colors hover:border-border-strong">
                {/* Room header */}
                <div className="flex flex-col justify-between gap-2 border-b border-border bg-muted px-3 py-2 sm:flex-row sm:items-center">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-fg">
                      <MapPin className="h-3.5 w-3.5 text-fg-subtle" aria-hidden="true" />
                      <Select
                        aria-label={t("tabroom.draw.room.venueAria", { room: roomLabel })}
                        value={debate.venueId || ""}
                        onChange={(e) => handleChangeVenue(debate.id, e.target.value)}
                        className="h-7 w-auto max-w-[18rem] text-xs font-semibold"
                      >
                        <option value="">{t("tabroom.draw.room.venueUnassigned", { room: roomLabel })}</option>
                        {venues.map((v) => {
                          const available = isVenueAvailableForRound(v, debate.roundId);
                          const parts = [
                            venueDisplayName(v, tournament?.preferences?.venueCategories),
                            ...(v.category ? [v.category] : []),
                            ...(v.capacity !== undefined ? [plural("tabroom.draw.room.venueSeats", v.capacity)] : []),
                            ...(!available ? [t("tabroom.draw.room.venueUnavailable")] : []),
                          ];
                          return (
                            <option
                              key={v.id}
                              value={v.id}
                              disabled={
                                !available ||
                                getVenueIncompatibilities(debate, v).length > 0 ||
                                roundDebates.some((other) => other.id !== debate.id && other.venueId === v.id)
                              }
                            >
                              {parts.join(" · ")}
                            </option>
                          );
                        })}
                      </Select>
                      {tooltip && <span className="text-[11px] font-normal text-fg-muted">{tooltip}</span>}
                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn("rounded-sm text-[11px] font-medium text-accent-text underline", focusRing)}
                          aria-label={t("tabroom.draw.room.linkAria", { venue: assignedVenue?.name ?? roomLabel })}
                        >
                          {t("tabroom.draw.room.link")}
                        </a>
                      )}
                    </div>

                    {activeRound?.stage !== "elimination" && (
                      <Badge title={t("tabroom.draw.room.bracketTitle")}>
                        {t("tabroom.draw.room.bracket", { bracket: debate.bracket ?? 0 })}
                      </Badge>
                    )}
                    <Badge title={t("tabroom.draw.room.rankTitle")}>
                      {t("tabroom.draw.room.rank", { rank: debate.roomRank })}
                    </Badge>
                    {pending && (
                      <Badge className="border-dashed border-border-strong" title={t("tabroom.draw.room.sidesOnBallotTitle")}>
                        {t("tabroom.draw.room.sidesOnBallot")}
                      </Badge>
                    )}
                    {errorCount > 0 && (
                      <StatusPill tone="danger" icon={<AlertTriangle aria-hidden="true" />}>
                        {plural("tabroom.draw.room.problems", errorCount)}
                      </StatusPill>
                    )}
                    {warningCount > 0 && (
                      <StatusPill tone="warning">
                        {plural("tabroom.draw.room.warnings", warningCount)}
                      </StatusPill>
                    )}
                  </div>

                  <IconButton
                    size="sm"
                    variant="ghost"
                    onClick={() => setPendingDeleteId(debate.id)}
                    label={t("tabroom.draw.room.deleteAria", { room: roomLabel })}
                    icon={<Trash2 aria-hidden="true" />}
                    className="self-end hover:text-danger sm:self-auto"
                  />
                </div>

                {/* Postponement and venue requirements */}
                <div className="border-b border-border px-3 py-2.5">
                  <div className="flex flex-wrap items-end gap-x-4 gap-y-2 text-xs">
                    <Checkbox
                      className="pb-1 [&_label]:text-xs"
                      label={t("tabroom.draw.room.postponed")}
                      checked={debate.postponed === true}
                      onChange={(event) => void updateDebate({
                        ...debate,
                        postponed: event.target.checked || undefined,
                        postponedReason: event.target.checked ? debate.postponedReason : undefined,
                      })}
                    />
                    {debate.postponed && (
                      <Input
                        aria-label={t("tabroom.draw.room.postponedReasonAria")}
                        maxLength={500}
                        value={debate.postponedReason || ""}
                        onChange={(event) => void updateDebate({
                          ...debate,
                          postponedReason: event.target.value || undefined,
                        })}
                        placeholder={t("tabroom.draw.room.postponedReasonPlaceholder")}
                        wrapperClassName="min-w-48"
                        className="h-7 min-w-48 w-auto text-xs"
                      />
                    )}
                    <Select
                      label={t("tabroom.draw.room.requiredCategory")}
                      aria-label={t("tabroom.draw.room.requiredCategoryAria", { room: roomLabel })}
                      wrapperClassName="space-y-1"
                      className="h-7 w-auto min-w-32 text-xs"
                      value={debate.requiredVenueCategory || ""}
                      onChange={(e) => void handleUpdateVenueRequirements(debate, {
                        requiredVenueCategory: e.target.value || undefined,
                      })}
                    >
                      <option value="">{t("tabroom.draw.room.anyCategory")}</option>
                      {[...new Set([
                        ...venues.map((venue) => venue.category?.trim()).filter((category): category is string => Boolean(category)),
                        ...(debate.requiredVenueCategory ? [debate.requiredVenueCategory] : []),
                      ])].sort((a, b) => a.localeCompare(b)).map((category) => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </Select>
                    <Input
                      label={t("tabroom.draw.room.minSeats")}
                      aria-label={t("tabroom.draw.room.minSeatsAria", { room: roomLabel })}
                      wrapperClassName="space-y-1"
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
                      className="h-7 w-24 text-xs"
                    />
                    <Checkbox
                      className="pb-1 [&_label]:text-xs"
                      label={t("tabroom.draw.room.accessible")}
                      checked={debate.requiresAccessibleVenue === true}
                      onChange={(e) => void handleUpdateVenueRequirements(debate, {
                        requiresAccessibleVenue: e.target.checked,
                      })}
                    />
                    <Checkbox
                      className="pb-1 [&_label]:text-xs"
                      label={t("tabroom.draw.room.online")}
                      checked={debate.requiresOnlineVenue === true}
                      onChange={(e) => void handleUpdateVenueRequirements(debate, {
                        requiresOnlineVenue: e.target.checked,
                      })}
                    />
                    <Checkbox
                      className="pb-1 [&_label]:text-xs"
                      label={t("tabroom.draw.room.nearTabRoom")}
                      checked={debate.requiresNearTabRoom === true}
                      onChange={(e) => void handleUpdateVenueRequirements(debate, {
                        requiresNearTabRoom: e.target.checked,
                      })}
                    />
                    {assignedVenueIssues.length > 0 && (
                      <span className="flex basis-full items-center gap-1 text-[11px] font-medium text-danger" role="status">
                        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                        {t("tabroom.draw.room.venueNotMeeting", { reasons: assignedVenueIssues.join("; ") })}
                      </span>
                    )}
                  </div>
                </div>

                {/* Matchup grid: drag and drop, or Move then Place / Swap */}
                {flags && flags.issues.length > 0 && (
                  <ul className="mx-3 mt-3 space-y-0.5 text-[11px] text-fg" aria-label={t("tabroom.draw.room.issuesAria", { room: roomLabel })}>
                    {flags.issues.map((issue: DebateFlags["issues"][number], index: number) => (
                      <li key={`${issue.code}-${index}`}>
                        <span className={cn("font-semibold", issue.severity === "error" ? "text-danger" : "text-warning")}>
                          {issue.severity === "error" ? t("tabroom.draw.check.problem") : t("tabroom.draw.check.warning")}
                        </span>{" "}
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 lg:grid-cols-4">
                  {sideOrder.map((side, sideIndex) => {
                    const slot = debate.teams?.[side];
                    const dropKey = `${debate.id}-${side}`;
                    const location: TeamLocation = { kind: "slot", debateId: debate.id, side };
                    return (
                      <DrawTeamSlot
                        key={side}
                        debateId={debate.id}
                        side={side}
                        pendingLabel={pending ? t("tabroom.draw.slot.pendingLabel", { number: sideIndex + 1 }) : undefined}
                        roomLabel={roomLabel}
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
              </Card>
            );
          })}
        </div>
      )}
      {pendingGenerate && (
        <ConfirmActionDialog
          title={pendingGenerate.kind === "discard" ? t("tabroom.draw.confirm.discardTitle") : t("tabroom.draw.confirm.overwriteTitle")}
          description={pendingGenerate.kind === "discard"
            ? plural("tabroom.draw.confirm.discardDescription", pendingGenerate.ballots, {
                debates: plural("tabroom.draw.confirm.debateCount", pendingGenerate.debates),
              })
            : t("tabroom.draw.confirm.overwriteDescription")}
          confirmLabel={pendingGenerate.kind === "discard" ? t("tabroom.draw.confirm.discardConfirm") : t("tabroom.draw.confirm.overwriteConfirm")}
          variant={pendingGenerate.kind === "discard" ? "danger" : "primary"}
          onConfirm={confirmGenerate}
          onCancel={() => setPendingGenerate(null)}
          cancelLabel={t("tabroom.common.noCancel")}
          busyLabel={t("tabroom.common.saving")}
          closeLabel={t("tabroom.common.closeDialog")}
        />
      )}
      {pendingDeleteId && (
        <ConfirmActionDialog
          title={t("tabroom.draw.confirm.deleteTitle", {
            room: pendingDeleteDebate?.venueName || t("tabroom.draw.roomFallback", { number: pendingDeleteDebate?.roomRank ?? "" }),
          })}
          description={t("tabroom.draw.confirm.deleteDescription")}
          confirmLabel={t("tabroom.draw.confirm.deleteConfirm")}
          variant="danger"
          onConfirm={() => {
            const debateId = pendingDeleteId;
            setPendingDeleteId(null);
            void handleDeleteDebate(debateId);
          }}
          onCancel={() => setPendingDeleteId(null)}
          cancelLabel={t("tabroom.common.noCancel")}
          busyLabel={t("tabroom.common.saving")}
          closeLabel={t("tabroom.common.closeDialog")}
        />
      )}
      {pendingDrawRelease !== null && activeRound && (
        <ReleaseActionDialog
          title={pendingDrawRelease ? t("tabroom.draw.release.publishTitle") : t("tabroom.draw.release.unpublishTitle")}
          description={pendingDrawRelease
            ? t("tabroom.draw.release.publishDescription", { round: activeRound.name })
            : t("tabroom.draw.release.unpublishDescription", { round: activeRound.name })}
          confirmLabel={pendingDrawRelease ? t("tabroom.draw.release.publishConfirm") : t("tabroom.draw.release.unpublishConfirm")}
          apply={() => updateRound({ ...activeRound, drawStatus: pendingDrawRelease ? "confirmed" : "draft" })}
          onClose={() => setPendingDrawRelease(null)}
        />
      )}
    </div>
  );
}

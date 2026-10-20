"use client";

import React, { useState, useMemo } from "react";
import type { DragEvent } from "react";
import Link from "next/link";
import { ComputeStatus } from "@/features/tournament/components/ComputeStatus";
import { ComputeCancelledError } from "@/features/tournament/compute/computeClient";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n";
import type { AdjudicatorPanelStrategy, Institution } from "@/types";
import { Adjudicator, Debate, PanelSizingMode, Team } from "@/types";
import {
  calculateAdjDebateConflict,
  calculateDebatePriorities,
  buildPastAdjTeams,
  computeBreakLiveness,
  effectiveAdjScore,
  DebatePriorityInfo,
} from "@/lib/draw/allocator";
import {
  Users2,
  Sparkles,
  AlertTriangle,
  X,
  UserPlus,
  GripVertical,
  RotateCcw,
  Eye,
  EyeOff,
  Layers,
  Gauge,
  Zap,
  Flame,
  Hand,
  Crown,
  GraduationCap,
  Undo2,
  CircleAlert,
} from "lucide-react";
import { safeJsonParse } from "@/lib/safeJson";
import { calculateScaledFeedbackScores, normalizeFeedbackWeight } from "@/lib/feedback/scores";
import { DiversityBadges, PanelDiversityLine } from "@/features/tournament/components/DiversityBadges";
import {
  AvailableAdjudicatorsPanel,
  judgePickKey,
  type JudgeDragPayload,
} from "@/features/tournament/components/AvailableAdjudicatorsPanel";
import { CurrentRoundsBar } from "@/features/tournament/components/CurrentRoundsBar";
import { DEFAULT_SHARD_STATE, ShardControls, type ShardState } from "@/features/tournament/components/ShardControls";
import { usePlaceTargetNavigation } from "@/features/tournament/components/usePlaceTargetNavigation";
import { buildShards } from "@/lib/draw/sharding";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button, IconButton } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Feedback";
import { Badge, type Tone } from "@/components/ui/Badge";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { cn } from "@/components/ui/cn";

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

type SlotRole = "chair" | "panellist" | "trainee";

/** Where a judge is dropped or placed: a slot of a debate, or back to the available pool. */
type JudgeTarget = { kind: "slot"; debateId: string; role: SlotRole } | { kind: "pool" };

/** Result of a manual assignment: written, refused by a rule (error shown), or nothing to do. */
type AssignOutcome = "done" | "refused" | "unchanged";

const STRATEGY_HINT_KEYS: Record<AdjudicatorPanelStrategy, MessageKey> = {
  crabbytab_v1: "tabroom.allocation.strategy.crabbytab_v1",
  panel_average: "tabroom.allocation.strategy.panel_average",
  tabbycat_voting: "tabroom.allocation.strategy.tabbycat_voting",
  tabbycat_consensus: "tabroom.allocation.strategy.tabbycat_consensus",
};

const ROLE_KEYS: Record<SlotRole, MessageKey> = {
  chair: "role.chair",
  panellist: "role.panellist",
  trainee: "role.trainee",
};

const PANEL_SIZES = [1, 3, 5, 7] as const;

/** Drop-zone look: accent while a judge hovers over it (danger when that judge clashes here). */
function dropZoneClass(hovered: boolean, clash: boolean, idle: string) {
  if (!hovered) return idle;
  return clash
    ? "border-dashed border-danger bg-danger-subtle ring-2 ring-danger"
    : "border-dashed border-accent bg-accent-subtle ring-2 ring-accent";
}

/** A placed judge: draggable, with Move (pick) and Remove controls. */
function PlacedJudgeChip({
  adjId,
  name,
  adjudicator,
  role,
  roomLabel,
  sourceDebateId,
  clashes,
  score,
  isPicked,
  pickActive,
  showDiversity,
  institutionsById,
  onPick,
  onRemove,
  onDragStart,
  onDragEnd,
  className,
}: {
  adjId: string;
  name: string;
  adjudicator: Adjudicator | undefined;
  role: SlotRole;
  roomLabel: string;
  sourceDebateId: string;
  clashes: string[];
  score: string | undefined;
  isPicked: boolean;
  pickActive: boolean;
  showDiversity: boolean;
  institutionsById: Map<string, Pick<Institution, "region">>;
  onPick(payload: JudgeDragPayload): void;
  onRemove(payload: JudgeDragPayload): void;
  onDragStart(event: DragEvent<HTMLElement>, payload: JudgeDragPayload): void;
  onDragEnd(): void;
  className?: string;
}) {
  const { t } = useI18n();
  const payload: JudgeDragPayload = { type: "judge", sourceType: role, adjId, adjName: name, sourceDebateId };
  const roleLabel = t(ROLE_KEYS[role]);
  return (
    <div
      draggable
      onDragEnd={onDragEnd}
      onDragStart={(event) => onDragStart(event, payload)}
      className={cn(
        "flex min-w-0 items-start justify-between gap-2 rounded-md border bg-surface px-2 py-1.5 text-xs",
        "cursor-grab active:cursor-grabbing",
        clashes.length > 0 ? "border-danger-border bg-danger-subtle" : "border-border",
        isPicked && "border-accent bg-accent-subtle ring-2 ring-accent",
        className
      )}
    >
      <div className="flex min-w-0 items-start gap-1.5">
        <GripVertical className="mt-0.5 h-3 w-3 shrink-0 text-fg-subtle" aria-hidden="true" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="font-semibold text-fg">{name}</span>
            {adjudicator?.institutionName && (
              <span className="text-[11px] text-fg-muted">({adjudicator.institutionName})</span>
            )}
            {score !== undefined && (
              <span className="font-mono text-[11px] text-fg-muted" title={t("tabroom.allocation.scoreTitle")}>
                {score}
              </span>
            )}
            {isPicked && <Badge tone="accent">{t("tabroom.allocation.pickedBadge")}</Badge>}
          </div>
          {showDiversity && adjudicator && (
            <DiversityBadges participant={adjudicator} institutionsById={institutionsById} />
          )}
          {clashes.length > 0 && (
            <p className="mt-0.5 flex items-start gap-1 text-[11px] font-medium text-danger">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
              <span>{t("tabroom.allocation.clashWithReasons", { reasons: clashes.join("; ") })}</span>
            </p>
          )}
        </div>
      </div>
      {!pickActive && (
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5"
            data-pick-key={judgePickKey(payload.adjId)}
            onClick={() => onPick(payload)}
            aria-label={t("tabroom.allocation.pickPlacedAria", { name, role: roleLabel, room: roomLabel })}
          >
            <Hand aria-hidden="true" />
            {t("tabroom.allocation.move")}
          </Button>
          <IconButton
            size="sm"
            className="h-6 w-6"
            label={t("tabroom.allocation.removeAria", { name, role: roleLabel, room: roomLabel })}
            icon={<X aria-hidden="true" />}
            onClick={() => onRemove(payload)}
          />
        </div>
      )}
    </div>
  );
}

/** A place target shown on every slot while a judge is picked. */
function PlaceTargetButton({
  label,
  ariaLabel,
  describedBy,
  icon,
  onClick,
}: {
  label: string;
  ariaLabel: string;
  describedBy?: string;
  icon: React.ReactNode;
  onClick(): void;
}) {
  return (
    <Button
      size="sm"
      variant="primary"
      className="h-6 px-2"
      data-place-target=""
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
  );
}

export default function AllocationPage() {
  const {
    tournament,
    activeRound,
    rounds,
    setActiveRound,
    updateRound,
    debates,
    adjudicators,
    feedback,
    teams,
    autoAllocate,
    updateDebate,
    updateDebates,
    teamStandings,
    breakCategories,
    institutions,
    venues,
    recordAuditEvent,
  } = useTournament();
  const { t, plural, rich, formatDecimal, formatNumber } = useI18n();

  const [searchQuery, setSearchQuery] = useState("");
  const [panelSize, setPanelSize] = useState<number>(1);
  const [panelSizing, setPanelSizing] = useState<PanelSizingMode>(
    tournament?.preferences?.panelSizingMode ?? "fixed"
  );
  const [showDiversity, setShowDiversity] = useState(false);
  const [feedbackWeightError, setFeedbackWeightError] = useState("");
  const [isAllocating, setIsAllocating] = useState(false);
  const [revealError, setRevealError] = useState("");
  const [manualAssignmentError, setManualAssignmentError] = useState("");
  const [allocationWarnings, setAllocationWarnings] = useState<string[]>([]);
  const [showPriorityPanel, setShowPriorityPanel] = useState(true);
  const [shardState, setShardState] = useState<ShardState>(DEFAULT_SHARD_STATE);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  // Drag & drop state
  const [draggingJudge, setDraggingJudge] = useState<JudgeDragPayload | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  // Pick-then-place state (keyboard and touch; also mouse clicks on a pool card)
  const [picked, setPicked] = useState<JudgeDragPayload | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const cancelPick = () => {
    setPicked(null);
    setAnnouncement(t("tabroom.common.moveCancelled"));
  };
  usePlaceTargetNavigation(Boolean(picked), cancelPick);

  const roundDebates = useMemo(
    () => (activeRound ? debates.filter((d) => d.roundId === activeRound.id && !d.byeTeamId) : []),
    [debates, activeRound]
  );

  const pastAdjudicatorTeams = useMemo(() => {
    if (!activeRound) return new Map<string, Set<string>>();
    const priorRoundIds = new Set(
      rounds
        .filter((round) => !round.cancelled && round.seq < activeRound.seq)
        .map((round) => round.id)
    );
    return buildPastAdjTeams(debates.filter((debate) => priorRoundIds.has(debate.roundId)));
  }, [activeRound, rounds, debates]);

  const teamsMap = useMemo(() => {
    const map = new Map<string, Team>();
    teams.forEach((team) => map.set(team.id, team));
    return map;
  }, [teams]);

  const adjsMap = useMemo(() => {
    const map = new Map<string, Adjudicator>();
    adjudicators.forEach((a) => map.set(a.id, a));
    return map;
  }, [adjudicators]);

  const feedbackScores = useMemo(
    () => calculateScaledFeedbackScores(feedback, debates, tournament?.preferences),
    [feedback, debates, tournament?.preferences]
  );
  const feedbackWeight = activeRound?.feedbackWeight;
  const scoreOf = (adjudicator: Adjudicator) => effectiveAdjScore(adjudicator, feedbackScores, feedbackWeight);
  const institutionsById = useMemo(
    () => new Map(institutions.map((institution) => [institution.id, institution])),
    [institutions]
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

  const shards = useMemo(() => {
    const venueById = new Map(venues.map((venue) => [venue.id, venue]));
    return buildShards(
      roundDebates.map((debate) => ({
        id: debate.id,
        bracket: debate.bracket,
        importance: debatePriorities.get(debate.id)?.priorityScore ?? debate.importance,
        roomRank: debate.roomRank,
        venueName: debate.venueName,
        venueCategory: debate.venueId ? venueById.get(debate.venueId)?.category : undefined,
      })),
      shardState
    );
  }, [roundDebates, debatePriorities, venues, shardState]);
  const openShardIds = useMemo(
    () => (shardState.index === null ? null : new Set(shards[shardState.index] ?? [])),
    [shards, shardState.index]
  );
  const visibleRoundDebates = useMemo(
    () => (openShardIds ? sortedRoundDebates.filter((debate) => openShardIds.has(debate.id)) : sortedRoundDebates),
    [sortedRoundDebates, openShardIds]
  );

  const roomLabelById = new Map(
    visibleRoundDebates.map((debate, index) => [
      debate.id,
      debate.venueName || t("tabroom.allocation.roomFallback", { number: debate.roomRank || index + 1 }),
    ])
  );
  const roomLabelOf = (debateId: string) => {
    const known = roomLabelById.get(debateId);
    if (known) return known;
    const debate = roundDebates.find((d) => d.id === debateId);
    return debate?.venueName || t("tabroom.allocation.roomFallback", { number: debate?.roomRank ?? "?" });
  };

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
      (a, b) =>
        effectiveAdjScore(b, feedbackScores, feedbackWeight) - effectiveAdjScore(a, feedbackScores, feedbackWeight)
    ),
    [filteredAdjs, feedbackScores, feedbackWeight]
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
        .map((a) => effectiveAdjScore(a, feedbackScores, feedbackWeight));
      const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
      map.set(debate.id, Math.round(avg * 10) / 10);
    }
    return map;
  }, [roundDebates, adjsMap, feedbackScores, feedbackWeight]);

  // Priority score tone; the score itself is the visible text.
  const getPriorityTone = (score: number): Tone => {
    if (score >= 7) return "danger";
    if (score >= 4) return "warning";
    return "success";
  };

  const getStrengthTone = (strength: number): Tone => {
    if (strength >= 7) return "success";
    if (strength >= 4) return "info";
    return "neutral";
  };

  // Assign Chair to Debate
  const assignChair = async (debateId: string, adj: Adjudicator): Promise<AssignOutcome> => {
    if (adj.trainee) {
      setManualAssignmentError(t("tabroom.allocation.refuseTraineeChair"));
      return "refused";
    }
    const debate = roundDebates.find((d) => d.id === debateId);
    if (!debate) return "unchanged";

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
    return "done";
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

  const addPanellist = async (debateId: string, adj: Adjudicator): Promise<AssignOutcome> => {
    if (adj.trainee) {
      setManualAssignmentError(t("tabroom.allocation.refuseTraineePanellist"));
      return "refused";
    }
    const debate = roundDebates.find((d) => d.id === debateId);
    if (!debate) return "unchanged";
    if (debate.adjudicators?.panellistIds?.includes(adj.id)) return "unchanged";

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
    return "done";
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

  const addTrainee = async (debateId: string, adj: Adjudicator): Promise<AssignOutcome> => {
    if (!adj.trainee) {
      setManualAssignmentError(t("tabroom.allocation.refuseNonTrainee"));
      return "refused";
    }
    const debate = roundDebates.find((d) => d.id === debateId);
    if (!debate) return "unchanged";
    if (debate.adjudicators?.traineeIds?.includes(adj.id)) return "unchanged";

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
    return "done";
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

  const clearAllocations = async () => {
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

  const handleConfirmClear = async () => {
    setIsClearing(true);
    try {
      await clearAllocations();
    } catch (error) {
      setManualAssignmentError(describeError(error, t("tabroom.allocation.clearFailed")));
    } finally {
      setIsClearing(false);
      setConfirmingClear(false);
    }
  };

  const handleAutoAllocate = async () => {
    if (!activeRound) return;
    setIsAllocating(true);
    setManualAssignmentError("");
    setAllocationWarnings([]);
    try {
      setAllocationWarnings(await autoAllocate(activeRound.id, panelSize, { panelSizing }));
    } catch (error) {
      if (!(error instanceof ComputeCancelledError)) {
        setManualAssignmentError(describeError(error, t("tabroom.allocation.allocateFailed")));
      }
    } finally {
      setIsAllocating(false);
    }
  };

  const handleFeedbackWeightChange = async (value: string) => {
    if (!activeRound) return;
    const percent = parseFloat(value);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      setFeedbackWeightError(t("tabroom.allocation.feedbackWeightRange"));
      return;
    }
    setFeedbackWeightError("");
    const weight = Math.round(percent) / 100;
    if (weight === activeRound.feedbackWeight) return;
    try {
      await updateRound({ ...activeRound, feedbackWeight: weight });
      await recordAuditEvent({
        action: "round.feedback_weight_changed",
        category: "feedback",
        summary: `${activeRound.name} feedback weight set to ${Math.round(weight * 100)}%`,
        roundId: activeRound.id,
        details: { previous: activeRound.feedbackWeight, current: weight },
      });
    } catch (error) {
      setFeedbackWeightError(error instanceof Error ? error.message : t("tabroom.allocation.feedbackWeightFailed"));
    }
  };

  const handleToggleAdjudicatorReveal = async () => {
    if (!activeRound) return;
    setRevealError("");
    try {
      await updateRound({
        ...activeRound,
        adjudicatorsRevealed: !activeRound.adjudicatorsRevealed,
      });
    } catch (error) {
      setRevealError(error instanceof Error ? error.message : t("tabroom.allocation.revealFailed"));
    }
  };

  // ─── One code path for drop, place (pick-then-place) and remove ───
  const applyJudgeMove = async (payload: JudgeDragPayload, target: JudgeTarget) => {
    if (target.kind === "pool") {
      if (payload.sourceDebateId) {
        try {
          if (payload.sourceType === "chair") {
            await removeChair(payload.sourceDebateId);
          } else if (payload.sourceType === "panellist") {
            await removePanellist(payload.sourceDebateId, payload.adjId);
          } else if (payload.sourceType === "trainee") {
            await removeTrainee(payload.sourceDebateId, payload.adjId);
          }
          setPicked(null);
          setAnnouncement(t("tabroom.allocation.announceReturned", { name: payload.adjName }));
        } catch (error) {
          const message = describeError(error, t("tabroom.allocation.changeFailed"));
          setManualAssignmentError(message);
          setAnnouncement(message);
        }
      }
      setDraggingJudge(null);
      return;
    }

    const adj = adjsMap.get(payload.adjId);
    if (!adj) return;
    setManualAssignmentError("");
    const room = roomLabelOf(target.debateId);
    const debate = roundDebates.find((d) => d.id === target.debateId);
    const previousChair =
      debate?.adjudicators?.chairId && debate.adjudicators.chairId !== adj.id ? debate.adjudicators.chairName : undefined;

    try {
      let outcome: AssignOutcome = "unchanged";
      if (target.role === "chair") {
        outcome = await assignChair(target.debateId, adj);
      } else if (target.role === "panellist") {
        outcome = await addPanellist(target.debateId, adj);
      } else if (target.role === "trainee") {
        outcome = await addTrainee(target.debateId, adj);
      }
      if (outcome === "refused") {
        setAnnouncement(
          target.role === "chair"
            ? t("tabroom.allocation.refuseTraineeChair")
            : target.role === "panellist"
              ? t("tabroom.allocation.refuseTraineePanellist")
              : t("tabroom.allocation.refuseNonTrainee")
        );
      } else {
        setPicked(null);
        if (outcome === "unchanged") setAnnouncement(t("tabroom.common.nothingChanged"));
        else if (target.role === "chair")
          setAnnouncement(
            previousChair
              ? t("tabroom.allocation.announceChairReplacing", { name: adj.name, room, previous: previousChair })
              : t("tabroom.allocation.announceChair", { name: adj.name, room })
          );
        else if (target.role === "panellist")
          setAnnouncement(t("tabroom.allocation.announcePanellist", { name: adj.name, room }));
        else setAnnouncement(t("tabroom.allocation.announceTrainee", { name: adj.name, room }));
      }
    } catch (error) {
      const message = describeError(error, t("tabroom.allocation.changeFailed"));
      setManualAssignmentError(message);
      setAnnouncement(message);
    }

    setDraggingJudge(null);
  };

  const pickJudge = (payload: JudgeDragPayload) => {
    if (picked?.adjId === payload.adjId) {
      cancelPick();
      return;
    }
    setPicked(payload);
    setAnnouncement(
      payload.sourceDebateId
        ? t("tabroom.allocation.announcePickedPlaced", {
            name: payload.adjName,
            role: t(ROLE_KEYS[payload.sourceType as SlotRole]),
            room: roomLabelOf(payload.sourceDebateId),
          })
        : t("tabroom.allocation.announcePickedPool", { name: payload.adjName })
    );
  };

  // --- Drag and Drop Handlers for Judges ---
  const handleDragStartJudge = (e: React.DragEvent, payload: JudgeDragPayload) => {
    setPicked(null);
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

  const handleDragLeaveJudgeSlot = (_e: React.DragEvent, targetKey: string) => {
    if (dragOverTarget === targetKey) {
      setDragOverTarget(null);
    }
  };

  const readDropPayload = (e: React.DragEvent): JudgeDragPayload | null => {
    e.preventDefault();
    setDragOverTarget(null);
    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return null;
    return safeJsonParse<JudgeDragPayload | null>(raw, null);
  };

  const handleDropJudgeSlot = async (e: React.DragEvent, targetDebateId: string, targetRole: SlotRole) => {
    const payload = readDropPayload(e);
    if (!payload) return;
    await applyJudgeMove(payload, { kind: "slot", debateId: targetDebateId, role: targetRole });
  };

  const handleDropUnassignJudge = async (e: React.DragEvent) => {
    const payload = readDropPayload(e);
    if (!payload) return;
    await applyJudgeMove(payload, { kind: "pool" });
  };

  const placeHere = (debateId: string, role: SlotRole) => {
    if (picked) void applyJudgeMove(picked, { kind: "slot", debateId, role });
  };

  const revealed = Boolean(activeRound?.adjudicatorsRevealed);
  const preformedCount = activeRound?.preformedPanels?.length ?? 0;
  const pickActive = Boolean(picked);
  const chairsAssigned = roundDebates.filter((d) => d.adjudicators?.chairId).length;

  return (
    <div className="space-y-4">
      <CurrentRoundsBar />
      <PageHeader
        title={t("tabroom.allocation.title")}
        description={t("tabroom.allocation.description")}
        actions={
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={handleAutoAllocate}
              disabled={roundDebates.length === 0}
              loading={isAllocating}
              loadingText={t("tabroom.allocation.optimizing")}
            >
              <Sparkles aria-hidden="true" />
              {t("tabroom.allocation.autoAllocate")}
            </Button>
            <ComputeStatus kind="allocation" />
            <Button
              size="sm"
              onClick={handleToggleAdjudicatorReveal}
              disabled={!activeRound || assignedAdjIds.size === 0}
              aria-pressed={revealed}
              title={revealed ? t("tabroom.allocation.hideTitle") : t("tabroom.allocation.revealTitle")}
            >
              {revealed ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              {revealed ? t("tabroom.allocation.hide") : t("tabroom.allocation.reveal")}
            </Button>
            <Button
              size="sm"
              onClick={() => setShowPriorityPanel(!showPriorityPanel)}
              aria-pressed={showPriorityPanel}
              className={cn(showPriorityPanel && "border-accent bg-accent-subtle text-accent-text")}
            >
              <Gauge aria-hidden="true" />
              {t("tabroom.allocation.priorityInfo")}
            </Button>
            <Button
              size="sm"
              onClick={() => setShowDiversity(!showDiversity)}
              aria-pressed={showDiversity}
              className={cn(showDiversity && "border-accent bg-accent-subtle text-accent-text")}
              title={t("tabroom.allocation.diversityTitle")}
            >
              <Users2 aria-hidden="true" />
              {t("tabroom.allocation.diversity")}
            </Button>
            <Button
              size="sm"
              onClick={() => setConfirmingClear(true)}
              disabled={roundDebates.length === 0 || assignedAdjIds.size === 0}
              title={t("tabroom.allocation.clearTitle")}
            >
              <RotateCcw aria-hidden="true" />
              {t("tabroom.allocation.clear")}
            </Button>
          </>
        }
      />

      {/* Allocation engine settings */}
      <Card className="space-y-2 p-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
          {t("tabroom.allocation.engineHeading")}
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={t("tabroom.allocation.panelsLabel")}
            value={panelSizing}
            onChange={(e) => setPanelSizing(e.target.value as PanelSizingMode)}
            className="h-7 w-auto text-xs"
          >
            <option value="fixed">{t("tabroom.allocation.sizingFixed")}</option>
            <option value="by_priority">{t("tabroom.allocation.sizingByPriority")}</option>
          </Select>
          <Select
            label={panelSizing === "by_priority" ? t("tabroom.allocation.largestPanel") : t("tabroom.allocation.panelSize")}
            value={panelSize}
            onChange={(e) => setPanelSize(parseInt(e.target.value, 10))}
            className="h-7 w-auto text-xs"
          >
            {PANEL_SIZES.map((size) =>
              size === 1 ? (
                <option key={size} value={size}>{t("tabroom.allocation.panelSizeSolo")}</option>
              ) : (
                <option key={size} value={size}>
                  {t("tabroom.allocation.panelSizeOption", { size, panellists: size - 1 })}
                </option>
              )
            )}
          </Select>
          {activeRound && (
            <Input
              key={`${activeRound.id}-${activeRound.feedbackWeight}`}
              label={t("tabroom.allocation.feedbackWeight")}
              title={t("tabroom.allocation.feedbackWeightTitle")}
              type="number"
              min={0}
              max={100}
              step={5}
              defaultValue={Math.round(normalizeFeedbackWeight(activeRound.feedbackWeight) * 100)}
              onBlur={(e) => handleFeedbackWeightChange(e.target.value)}
              error={feedbackWeightError || undefined}
              className="h-7 w-20 text-center font-mono text-xs"
            />
          )}
        </div>
        <p className="text-xs text-fg-muted">
          {t(STRATEGY_HINT_KEYS[tournament?.preferences?.adjudicatorPanelStrategy ?? "crabbytab_v1"])}
          {tournament?.preferences?.usePreformedPanels && preformedCount > 0
            ? ` ${plural("tabroom.allocation.preformedPlacedFirst", preformedCount)}`
            : ""}
        </p>
        <Link
          href={`/${tournament?.slug}/allocation/panels`}
          className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-accent-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Layers className="h-3.5 w-3.5" aria-hidden="true" /> {t("tabroom.allocation.preformedLink")}
        </Link>
      </Card>

      {revealError && <Alert tone="danger" role="alert">{revealError}</Alert>}
      {manualAssignmentError && <Alert tone="danger" role="alert">{manualAssignmentError}</Alert>}
      {allocationWarnings.length > 0 && (
        <Alert tone="warning" role="status" title={t("tabroom.allocation.warningsTitle")}>
          <ul className="list-disc pl-5">
            {allocationWarnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </Alert>
      )}

      {/* Round Selector Bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1" role="group" aria-labelledby="allocation-round-label">
        <span id="allocation-round-label" className="mr-1 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
          {t("tabroom.allocation.selectRound")}
        </span>
        {rounds.map((r) => (
          <Button
            key={r.id}
            size="sm"
            variant={activeRound?.id === r.id ? "primary" : "secondary"}
            aria-pressed={activeRound?.id === r.id}
            onClick={() => setActiveRound(r)}
          >
            {r.name}
          </Button>
        ))}
      </div>

      {/* Picked judge banner */}
      {picked && (
        <div className="sticky top-topbar z-20 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent bg-accent-subtle px-3 py-2 text-[13px] text-fg shadow-lg">
          <div className="flex min-w-0 items-center gap-2">
            <Hand className="h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
            <div className="min-w-0">
              <p>
                {picked.sourceDebateId
                  ? rich("tabroom.allocation.bannerPlaced", { b: (s) => <strong>{s}</strong> }, {
                      name: picked.adjName,
                      role: t(ROLE_KEYS[picked.sourceType as SlotRole]),
                      room: roomLabelOf(picked.sourceDebateId),
                    })
                  : rich("tabroom.allocation.bannerPool", { b: (s) => <strong>{s}</strong> }, { name: picked.adjName })}
              </p>
              <p className="text-xs text-fg-muted">{t("tabroom.allocation.bannerHint")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {picked.sourceDebateId && (
              <PlaceTargetButton
                label={t("tabroom.allocation.returnToPool")}
                ariaLabel={t("tabroom.allocation.returnToPoolAria", { name: picked.adjName })}
                icon={<Undo2 aria-hidden="true" />}
                onClick={() => void applyJudgeMove(picked, { kind: "pool" })}
              />
            )}
            <Button size="sm" onClick={cancelPick}>
              {t("tabroom.common.cancelEsc")}
            </Button>
          </div>
        </div>
      )}
      <p className="sr-only" aria-live="polite" role="status">
        {announcement}
      </p>

      {/* Main Allocation Layout */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left: Available Adjudicators Drawer */}
        <AvailableAdjudicatorsPanel
          adjudicators={sortedFilteredAdjs}
          availableCount={availableAdjs.length}
          feedbackScores={feedbackScores}
          feedbackWeight={feedbackWeight}
          showDiversity={showDiversity}
          institutionsById={institutionsById}
          picked={picked}
          searchQuery={searchQuery}
          dragOverTarget={dragOverTarget}
          onSearchChange={setSearchQuery}
          onPick={pickJudge}
          onReturnToPool={() => picked && void applyJudgeMove(picked, { kind: "pool" })}
          onDragStart={handleDragStartJudge}
          onDragEnd={() => setDraggingJudge(null)}
          onDragOver={handleDragOverJudgeSlot}
          onDragLeave={handleDragLeaveJudgeSlot}
          onDrop={handleDropUnassignJudge}
        />

        {/* Right: Debates Allocation Board */}
        <section className="space-y-3 lg:col-span-8" aria-labelledby="allocation-debates-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="allocation-debates-heading" className="text-[15px] font-semibold text-fg">
              {plural("tabroom.allocation.debatesHeading", roundDebates.length, { round: activeRound?.name ?? "" })}
            </h2>
            <span className="text-xs text-fg-muted">
              {plural("tabroom.allocation.chairsAssigned", roundDebates.length, { assigned: chairsAssigned })}
            </span>
          </div>

          {roundDebates.length > 1 && (
            <ShardControls
              state={shardState}
              onChange={setShardState}
              shardSizes={shards.map((shard) => shard.length)}
            />
          )}
          {openShardIds && (
            <p role="status" className="text-xs text-fg-muted">
              {plural("tabroom.allocation.shardShowing", roundDebates.length, { visible: visibleRoundDebates.length })}
            </p>
          )}

          <div className="space-y-3">
            {visibleRoundDebates.map((debate) => {
              const debateTeams: Team[] = Object.values(debate.teams || {})
                .map((slot) => (slot?.teamId ? teamsMap.get(slot.teamId) : undefined))
                .filter((team): team is Team => team !== undefined);

              const roomLabel = roomLabelOf(debate.id);
              const priority = debatePriorities.get(debate.id);
              const panelStrength = debatePanelStrengths.get(debate.id) ?? 0;

              const panelMembers = [
                debate.adjudicators?.chairId,
                ...(debate.adjudicators?.panellistIds || []),
                ...(debate.adjudicators?.traineeIds || []),
              ]
                .map((id) => (id ? adjsMap.get(id) : undefined))
                .filter((member): member is Adjudicator => member !== undefined);
              const othersOnPanel = (adjId: string) => panelMembers.filter((member) => member.id !== adjId);
              const previewJudge = adjsMap.get(draggingJudge?.adjId ?? picked?.adjId ?? "");
              const judgeClashPreview = previewJudge
                ? calculateAdjDebateConflict(
                    previewJudge,
                    debateTeams,
                    pastAdjudicatorTeams,
                    undefined,
                    othersOnPanel(previewJudge.id)
                  )
                : null;
              const dragJudgeClashPreview = judgeClashPreview?.reasons ?? [];
              const clashPreviewId = `allocation-clash-${debate.id}`;
              const clashDescribedBy = judgeClashPreview?.hasClash ? clashPreviewId : undefined;

              const clashesOf = (adj: Adjudicator | undefined) =>
                adj
                  ? calculateAdjDebateConflict(adj, debateTeams, pastAdjudicatorTeams, undefined, othersOnPanel(adj.id)).reasons
                  : [];

              const chairAdj = debate.adjudicators?.chairId ? adjsMap.get(debate.adjudicators.chairId) : undefined;
              const chairConflicts = clashesOf(chairAdj);

              const chairDropKey = `${debate.id}-chair`;
              const panellistDropKey = `${debate.id}-panellist`;
              const traineeDropKey = `${debate.id}-trainee`;

              const isChairHovered = dragOverTarget === chairDropKey;
              const isPanellistHovered = dragOverTarget === panellistDropKey;
              const isTraineeHovered = dragOverTarget === traineeDropKey;

              // A picked judge is not offered its own current slot.
              const showTarget = (role: SlotRole) =>
                Boolean(picked) && !(picked?.sourceDebateId === debate.id && picked?.sourceType === role);

              const chipProps = {
                roomLabel,
                sourceDebateId: debate.id,
                pickActive,
                showDiversity,
                institutionsById,
                onPick: pickJudge,
                onRemove: (payload: JudgeDragPayload) => void applyJudgeMove(payload, { kind: "pool" }),
                onDragStart: handleDragStartJudge,
                onDragEnd: () => setDraggingJudge(null),
              };

              const panellistIds = debate.adjudicators?.panellistIds || [];
              const traineeIds = debate.adjudicators?.traineeIds || [];

              return (
                <Card
                  key={debate.id}
                  className={cn("overflow-hidden", judgeClashPreview?.hasClash && "border-danger ring-1 ring-danger")}
                >
                  {/* Room & Teams Bar with Priority Info */}
                  <div className="flex flex-col justify-between gap-2 border-b border-border bg-muted px-3 py-2 sm:flex-row sm:items-center">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[13px] font-semibold text-fg">{roomLabel}</h3>

                      {showPriorityPanel && priority && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={getPriorityTone(priority.priorityScore)} title={t("tabroom.allocation.priorityTitle")}>
                            <Gauge className="h-3 w-3" aria-hidden="true" />
                            {t("tabroom.allocation.priorityBadge", { score: formatDecimal(priority.priorityScore, 1) })}
                          </Badge>
                          {panelStrength > 0 && (
                            <Badge tone={getStrengthTone(panelStrength)} title={t("tabroom.allocation.strengthTitle")}>
                              <Zap className="h-3 w-3" aria-hidden="true" />
                              {t("tabroom.allocation.strengthBadge", { score: formatDecimal(panelStrength, 1) })}
                            </Badge>
                          )}
                          <span
                            className="inline-flex items-center gap-0.5 text-[11px] text-fg-muted"
                            title={t("tabroom.allocation.livenessTitle")}
                          >
                            <Flame className="h-3 w-3" aria-hidden="true" />
                            {t("tabroom.allocation.livenessBadge", {
                              percent: formatNumber(priority.breakLiveness, { style: "percent", maximumFractionDigits: 0 }),
                            })}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-fg-muted">
                        {debateTeams
                          .map((team) =>
                            t("tabroom.allocation.teamWithInstitution", {
                              team: team.name,
                              institution: team.institutionName || t("tabroom.allocation.independentShort"),
                            })
                          )
                          .join(t("tabroom.allocation.teamsSeparator"))}
                      </span>

                      {showPriorityPanel && (
                        <Input
                          type="number"
                          min={0}
                          max={10}
                          step={0.5}
                          value={debate.importance || 0}
                          onChange={(e) => updateDebateImportance(debate.id, parseFloat(e.target.value) || 0)}
                          aria-label={t("tabroom.allocation.importanceAria", { room: roomLabel })}
                          title={t("tabroom.allocation.importanceTitle")}
                          className="h-6 w-14 px-1 text-center font-mono text-[11px]"
                        />
                      )}
                    </div>
                  </div>

                  {judgeClashPreview?.hasClash && previewJudge && (
                    <div id={clashPreviewId} className="border-b border-danger-border bg-danger-subtle px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
                        <span className="font-semibold text-danger">
                          {t("tabroom.allocation.previewClashes", { name: previewJudge.name })}
                        </span>
                        {judgeClashPreview.hasInstitutionalClash && (
                          <Badge tone="warning">{t("tabroom.allocation.clashInstitutional")}</Badge>
                        )}
                        {judgeClashPreview.hasHistoryClash && (
                          <Badge tone="info">{t("tabroom.allocation.clashHistory")}</Badge>
                        )}
                        {judgeClashPreview.hasPersonalClash && (
                          <Badge tone="danger">{t("tabroom.allocation.clashPersonal")}</Badge>
                        )}
                        {judgeClashPreview.hasAdjudicatorClash && (
                          <Badge tone="danger">{t("tabroom.allocation.clashAdjudicator")}</Badge>
                        )}
                        <span className="text-fg">{judgeClashPreview.reasons.join("; ")}</span>
                      </div>
                    </div>
                  )}

                  {showDiversity && panelMembers.length > 0 && (
                    <PanelDiversityLine members={panelMembers} institutionsById={institutionsById} />
                  )}

                  {chairConflicts.length > 0 && (
                    <div className="border-b border-danger-border bg-danger-subtle px-3 py-1.5">
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-danger">
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        <span>{t("tabroom.allocation.chairClash", { reasons: chairConflicts.join("; ") })}</span>
                      </span>
                    </div>
                  )}

                  {/* Allocation Slots: drop zones, and place targets while a judge is picked */}
                  <div className="space-y-2 p-3">
                    {/* Chair Slot */}
                    <div
                      onDragOver={(e) => handleDragOverJudgeSlot(e, chairDropKey)}
                      onDragLeave={(e) => handleDragLeaveJudgeSlot(e, chairDropKey)}
                      onDrop={(e) => handleDropJudgeSlot(e, debate.id, "chair")}
                      className={cn(
                        "rounded-md border p-2 transition-colors",
                        dropZoneClass(isChairHovered, dragJudgeClashPreview.length > 0, "border-border bg-surface")
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                          <Badge tone="accent">
                            <Crown className="h-3 w-3" aria-hidden="true" />
                            {t("role.chair")}
                          </Badge>
                          {debate.adjudicators?.chairName ? (
                            <PlacedJudgeChip
                              {...chipProps}
                              adjId={debate.adjudicators.chairId!}
                              name={debate.adjudicators.chairName}
                              adjudicator={chairAdj}
                              role="chair"
                              clashes={[]}
                              score={chairAdj ? formatDecimal(scoreOf(chairAdj), 1) : undefined}
                              isPicked={picked?.adjId === debate.adjudicators.chairId}
                              className="min-w-0 flex-1"
                            />
                          ) : (
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 text-xs italic",
                                isChairHovered && dragJudgeClashPreview.length > 0 ? "font-medium text-danger" : "text-danger"
                              )}
                            >
                              {isChairHovered ? (
                                dragJudgeClashPreview.length > 0 ? (
                                  <>
                                    <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                                    {t("tabroom.allocation.clashDetected", { reasons: dragJudgeClashPreview.join(", ") })}
                                  </>
                                ) : (
                                  t("tabroom.allocation.dropChair")
                                )
                              ) : (
                                <>
                                  <CircleAlert className="h-3 w-3" aria-hidden="true" />
                                  {t("tabroom.allocation.noChair")}
                                </>
                              )}
                            </span>
                          )}
                        </div>

                        {showTarget("chair") && picked && (
                          <PlaceTargetButton
                            label={
                              debate.adjudicators?.chairName
                                ? t("tabroom.allocation.replaceChair")
                                : t("tabroom.allocation.placeChair")
                            }
                            ariaLabel={
                              debate.adjudicators?.chairName
                                ? t("tabroom.allocation.replaceChairAria", {
                                    name: picked.adjName,
                                    room: roomLabel,
                                    previous: debate.adjudicators.chairName,
                                  })
                                : t("tabroom.allocation.placeChairAria", { name: picked.adjName, room: roomLabel })
                            }
                            describedBy={clashDescribedBy}
                            icon={<Crown aria-hidden="true" />}
                            onClick={() => placeHere(debate.id, "chair")}
                          />
                        )}
                      </div>
                    </div>

                    {/* Panellists Drop Zone */}
                    <div
                      onDragOver={(e) => handleDragOverJudgeSlot(e, panellistDropKey)}
                      onDragLeave={(e) => handleDragLeaveJudgeSlot(e, panellistDropKey)}
                      onDrop={(e) => handleDropJudgeSlot(e, debate.id, "panellist")}
                      className={cn(
                        "rounded-md border p-2 transition-colors",
                        dropZoneClass(isPanellistHovered, dragJudgeClashPreview.length > 0, "border-border bg-background")
                      )}
                    >
                      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                          {t("tabroom.allocation.panellistsHeading", { count: panellistIds.length })}
                        </span>
                        {showTarget("panellist") && picked && (
                          <PlaceTargetButton
                            label={t("tabroom.allocation.addPanellist")}
                            ariaLabel={t("tabroom.allocation.addPanellistAria", { name: picked.adjName, room: roomLabel })}
                            describedBy={clashDescribedBy}
                            icon={<UserPlus aria-hidden="true" />}
                            onClick={() => placeHere(debate.id, "panellist")}
                          />
                        )}
                      </div>

                      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        {panellistIds.map((pId, pIdx) => {
                          const pAdj = adjsMap.get(pId);
                          return (
                            <PlacedJudgeChip
                              key={pId}
                              {...chipProps}
                              adjId={pId}
                              name={debate.adjudicators.panellistNames[pIdx]}
                              adjudicator={pAdj}
                              role="panellist"
                              clashes={clashesOf(pAdj)}
                              score={pAdj ? formatDecimal(scoreOf(pAdj), 1) : undefined}
                              isPicked={picked?.adjId === pId}
                            />
                          );
                        })}

                        {panellistIds.length === 0 && (
                          <div className="rounded-md border border-dashed border-border-strong py-2 text-center text-[11px] italic text-fg-muted sm:col-span-2">
                            {isPanellistHovered ? t("tabroom.allocation.dropPanellist") : t("tabroom.allocation.noPanellists")}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Trainees Drop Zone */}
                    <div
                      onDragOver={(e) => handleDragOverJudgeSlot(e, traineeDropKey)}
                      onDragLeave={(e) => handleDragLeaveJudgeSlot(e, traineeDropKey)}
                      onDrop={(e) => handleDropJudgeSlot(e, debate.id, "trainee")}
                      className={cn(
                        "rounded-md border p-2 transition-colors",
                        dropZoneClass(isTraineeHovered, false, "border-border bg-background")
                      )}
                    >
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                          {t("tabroom.allocation.traineesHeading", { count: traineeIds.length })}
                        </span>
                        {showTarget("trainee") && picked && (
                          <PlaceTargetButton
                            label={t("tabroom.allocation.addTrainee")}
                            ariaLabel={t("tabroom.allocation.addTraineeAria", { name: picked.adjName, room: roomLabel })}
                            describedBy={clashDescribedBy}
                            icon={<GraduationCap aria-hidden="true" />}
                            onClick={() => placeHere(debate.id, "trainee")}
                          />
                        )}
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {traineeIds.map((tId, tIdx) => {
                          const tAdj = adjsMap.get(tId);
                          return (
                            <PlacedJudgeChip
                              key={tId}
                              {...chipProps}
                              adjId={tId}
                              name={debate.adjudicators.traineeNames[tIdx]}
                              adjudicator={tAdj}
                              role="trainee"
                              clashes={clashesOf(tAdj)}
                              score={undefined}
                              isPicked={picked?.adjId === tId}
                            />
                          );
                        })}

                        {traineeIds.length === 0 && (
                          <span className="text-[11px] italic text-fg-muted">
                            {isTraineeHovered ? t("tabroom.allocation.dropTrainee") : t("tabroom.allocation.noTrainees")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      </div>

      {confirmingClear && (
        <ConfirmActionDialog
          title={t("tabroom.allocation.clearConfirmTitle")}
          description={t("tabroom.allocation.clearConfirmDescription", { round: activeRound?.name ?? "" })}
          confirmLabel={t("tabroom.allocation.clear")}
          variant="danger"
          isBusy={isClearing}
          onConfirm={() => void handleConfirmClear()}
          onCancel={() => setConfirmingClear(false)}
          cancelLabel={t("tabroom.common.noCancel")}
          busyLabel={t("tabroom.common.saving")}
          closeLabel={t("tabroom.common.closeDialog")}
        />
      )}
    </div>
  );
}

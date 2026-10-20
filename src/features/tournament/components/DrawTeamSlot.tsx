"use client";

import React from "react";
import type { DragEvent } from "react";
import { AlertTriangle, ArrowRightLeft, GripVertical, Hand, Info, X } from "lucide-react";
import { SideBadge } from "@/components/ui/SideBadge";
import type { DebateSide, DebateTeamSlot, Team } from "@/types";
import type { TeamFlag } from "@/lib/draw/drawFlags";
import type { TeamDragPayload } from "./UnassignedTeamsPool";

/**
 * One team slot of a debate in the draw editor: the team with its inline flags, and controls to
 * edit the draw without dragging (pick the team, then pick a slot or the pool to place or swap).
 */

const SLOT_STYLES: Record<DebateSide, string> = {
  OG: "bg-rose-50/50 border-rose-200",
  OO: "bg-sky-50/50 border-sky-200",
  CG: "bg-amber-50/50 border-amber-200",
  CO: "bg-purple-50/50 border-purple-200",
  AFF: "bg-emerald-50/50 border-emerald-200",
  NEG: "bg-slate-50 border-slate-200",
};

/** A flag badge: the short label is visible, the full explanation shows on hover and focus. */
export function FlagBadge({ flag }: { flag: TeamFlag }) {
  const warning = flag.severity === "warning";
  return (
    <span
      tabIndex={0}
      title={flag.detail}
      className={`group relative inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        warning ? "border-amber-300 bg-amber-50 text-amber-900" : "border-gray-200 bg-white text-gray-700"
      }`}
    >
      {warning ? (
        <AlertTriangle className="h-3 w-3 text-amber-600" aria-hidden="true" />
      ) : (
        <Info className="h-3 w-3 text-gray-500" aria-hidden="true" />
      )}
      <span aria-hidden="true">{flag.label}</span>
      <span className="sr-only">{warning ? "Warning: " : ""}{flag.detail}</span>
      <span
        role="tooltip"
        aria-hidden="true"
        className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden w-56 rounded bg-gray-900 px-2 py-1 text-[11px] font-normal leading-snug text-white shadow group-hover:block group-focus:block"
      >
        {flag.detail}
      </span>
    </span>
  );
}

interface DrawTeamSlotProps {
  debateId: string;
  side: DebateSide;
  /** Shown instead of the side while sides are chosen on the ballot, e.g. "Team 1". */
  pendingLabel?: string;
  roomLabel: string;
  slot: DebateTeamSlot | undefined;
  team: Team | undefined;
  points?: number;
  flags: TeamFlag[];
  compact: boolean;
  isDragTarget: boolean;
  /** This slot holds the picked team. */
  isPicked: boolean;
  /** Some team is picked, so this slot is a place/swap target. */
  pickActive: boolean;
  onPick: () => void;
  onPlace: () => void;
  onRemove: () => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, payload: TeamDragPayload) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}

export function DrawTeamSlot(props: DrawTeamSlotProps) {
  const { side, slot, team, flags, compact, pendingLabel } = props;
  const hasTeam = Boolean(slot?.teamId);
  const position = pendingLabel ?? side;
  const where = `${props.roomLabel}${pendingLabel ? "" : ` ${side}`}`;
  return (
    <div
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
      className={`relative rounded-lg border p-2.5 transition ${
        props.isDragTarget
          ? "border-dashed border-blue-500 bg-blue-50 ring-2 ring-blue-300"
          : props.isPicked
            ? "border-blue-500 bg-blue-50 ring-2 ring-blue-400"
            : pendingLabel
              ? "border-gray-200 bg-white"
              : SLOT_STYLES[side]
      } ${compact ? "" : "md:col-span-2"}`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        {pendingLabel ? (
          <span className="inline-flex h-5 items-center rounded-sm border border-dashed border-gray-300 px-1.5 text-[11px] font-semibold text-gray-600">
            {pendingLabel}
          </span>
        ) : (
          <SideBadge side={side} />
        )}
        <div className="flex items-center gap-1">
          {hasTeam && !props.pickActive && (
            <button
              type="button"
              onClick={props.onPick}
              aria-label={`Pick ${slot!.teamName} (${where}) to move or swap`}
              className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Hand className="h-3 w-3" aria-hidden="true" />
              Move
            </button>
          )}
          {props.pickActive && !props.isPicked && (
            <button
              type="button"
              onClick={props.onPlace}
              aria-label={hasTeam ? `Swap the picked team with ${slot!.teamName} (${where})` : `Place the picked team in ${where}`}
              className="inline-flex items-center gap-1 rounded border border-blue-600 bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
            >
              <ArrowRightLeft className="h-3 w-3" aria-hidden="true" />
              {hasTeam ? "Swap here" : "Place here"}
            </button>
          )}
          {hasTeam && !props.pickActive && (
            <button
              type="button"
              onClick={props.onRemove}
              className="rounded p-0.5 text-gray-400 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label={`Remove ${slot!.teamName} from ${where}`}
              title="Remove team from slot"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {hasTeam ? (
        <div
          draggable
          onDragStart={(event) =>
            props.onDragStart(event, {
              type: "team",
              sourceType: "debate",
              debateId: props.debateId,
              side,
              teamId: slot!.teamId,
              teamName: slot!.teamName,
              institutionId: team?.institutionId,
              institutionName: team?.institutionName,
            })
          }
          className="flex cursor-grab items-start justify-between gap-2 rounded p-1 transition hover:bg-white/60 active:cursor-grabbing"
        >
          <div className="min-w-0">
            <div className={`font-bold text-gray-900 ${compact ? "text-sm" : "text-base"}`}>
              {slot!.teamName}
              {props.points !== undefined && (
                <span className="ml-1.5 text-[11px] font-semibold text-gray-500">{props.points} pts</span>
              )}
            </div>
            <div className="text-[11px] text-gray-500">{team?.institutionName || "Independent"}</div>
            {flags.length > 0 && (
              <ul className="mt-1 flex flex-wrap gap-1" aria-label={`Flags for ${slot!.teamName}`}>
                {flags.map((flag, index) => (
                  <li key={`${flag.kind}-${index}`}>
                    <FlagBadge flag={flag} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
        </div>
      ) : (
        <div className="flex h-10 items-center justify-center rounded border border-dashed border-gray-300 text-[11px] italic text-gray-400">
          {props.pickActive ? `Empty: place the picked team here` : `Empty ${position} slot`}
        </div>
      )}
    </div>
  );
}

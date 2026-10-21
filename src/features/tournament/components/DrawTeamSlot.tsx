"use client";

import React from "react";
import type { DragEvent } from "react";
import { AlertTriangle, ArrowRightLeft, GripVertical, Hand, Info, X } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button, IconButton } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
import { SideBadge } from "@/components/ui/SideBadge";
import type { DebateSide, DebateTeamSlot, Team } from "@/types";
import type { TeamFlag } from "@/lib/draw/drawFlags";
import type { TeamDragPayload } from "./UnassignedTeamsPool";
import { TabroomTeamName } from "./TabroomTeamName";

/**
 * One team slot of a debate in the draw editor: the team with its inline flags, and controls to
 * edit the draw without dragging (pick the team, then pick a slot or the pool to place or swap).
 */

type I18n = ReturnType<typeof useI18n>;

/** A flag's badge text and explanation in the viewer's language (English from the lib as fallback). */
export function flagText(flag: TeamFlag, { t, plural, formatList }: Pick<I18n, "t" | "plural" | "formatList">) {
  const p = flag.params;
  if (!p) return { label: flag.label, detail: flag.detail };
  const counts = (p.sideCounts ?? []).map((entry) => `${entry.side} ×${entry.count}`).join(", ");
  switch (flag.kind) {
    case "swing":
      return { label: t("tabroom.draw.flag.swingLabel"), detail: t("tabroom.draw.flag.swingDetail", { team: p.team }) };
    case "rematch": {
      const rounds = p.rounds ?? [];
      return {
        label: t("tabroom.draw.flag.rematchLabel", { rounds: rounds.join(", ") }),
        detail: t("tabroom.draw.flag.rematchDetail", { team: p.team, opponent: p.opponent ?? "", rounds: formatList(rounds) }),
      };
    }
    case "institution":
      return {
        label: t("tabroom.draw.flag.institutionLabel"),
        detail: p.institution
          ? t("tabroom.draw.flag.institutionDetail", { team: p.team, opponent: p.opponent ?? "", institution: p.institution })
          : t("tabroom.draw.flag.institutionDetailUnnamed", { team: p.team, opponent: p.opponent ?? "" }),
      };
    case "side_history":
      return { label: counts, detail: t("tabroom.draw.flag.sideHistoryDetail", { team: p.team, counts }) };
    case "side_imbalance":
      return {
        label: `${p.side ?? ""} ×${p.count ?? 0}`,
        detail: t("tabroom.draw.flag.sideImbalanceDetail", { team: p.team, side: p.side ?? "", count: p.count ?? 0, gap: p.gap ?? 0 }),
      };
    case "pulled_up":
      return {
        label: t("tabroom.draw.flag.pulledUpLabel"),
        detail: t("tabroom.draw.flag.pulledUpDetail", { team: p.team, bracket: p.bracket ?? 0 }),
      };
    case "pullup_history":
      return {
        label: t("tabroom.draw.flag.pullupHistoryLabel", { count: p.count ?? 0 }),
        detail: plural("tabroom.draw.flag.pullupHistoryDetail", p.count ?? 0, { team: p.team }),
      };
    default:
      return { label: flag.label, detail: flag.detail };
  }
}

/** A flag badge: the short label is visible, the full explanation shows on hover and focus. */
export function FlagBadge({ flag }: { flag: TeamFlag }) {
  const i18n = useI18n();
  const { label, detail } = flagText(flag, i18n);
  const warning = flag.severity === "warning";
  return (
    <span
      tabIndex={0}
      title={detail}
      className={cn(
        "group relative inline-flex items-center gap-0.5 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium",
        focusRing,
        warning ? "border-warning-border bg-warning-subtle text-warning" : "border-border bg-surface text-fg-muted"
      )}
    >
      {warning ? (
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      ) : (
        <Info className="h-3 w-3 text-fg-subtle" aria-hidden="true" />
      )}
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">{warning ? i18n.t("tabroom.draw.flag.warningSr", { detail }) : detail}</span>
      <span
        role="tooltip"
        aria-hidden="true"
        className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden w-56 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-normal leading-snug text-fg shadow-lg group-hover:block group-focus:block"
      >
        {detail}
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
  /** The team's break liveness per category (preliminary rounds only). */
  liveness?: React.ReactNode;
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

/** The `data-pick-key` of a slot's Move button, so focus can return to it after a pick. */
export function slotPickKey(debateId: string, side: DebateSide): string {
  return `slot:${debateId}:${side}`;
}

export function DrawTeamSlot(props: DrawTeamSlotProps) {
  const { t, formatNumber } = useI18n();
  const { side, slot, team, flags, compact, pendingLabel } = props;
  const hasTeam = Boolean(slot?.teamId);
  const position = pendingLabel ?? side;
  const where = pendingLabel
    ? props.roomLabel
    : t("tabroom.draw.slot.where", { room: props.roomLabel, side });
  const teamName = slot?.teamName ?? "";
  return (
    <div
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
      className={cn(
        "relative rounded-lg border p-2.5 transition-colors",
        props.isDragTarget
          ? "border-dashed border-accent bg-accent-subtle ring-2 ring-accent"
          : props.isPicked
            ? "border-accent bg-accent-subtle ring-2 ring-accent"
            : pendingLabel
              ? "border-border bg-surface"
              : "border-border bg-background",
        compact ? "" : "md:col-span-2"
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        {pendingLabel ? (
          <span className="inline-flex h-5 items-center rounded-sm border border-dashed border-border-strong px-1.5 text-[11px] font-semibold text-fg-muted">
            {pendingLabel}
          </span>
        ) : (
          <SideBadge side={side} />
        )}
        <div className="flex items-center gap-1">
          {props.isPicked && (
            <span className="text-[10px] font-semibold text-accent-text">{t("tabroom.draw.slot.picked")}</span>
          )}
          {hasTeam && !props.pickActive && (
            <Button
              size="sm"
              variant="secondary"
              onClick={props.onPick}
              aria-label={t("tabroom.draw.slot.pickAria", { team: teamName, where })}
              className="h-6 px-1.5 text-[11px]"
              data-pick-key={slotPickKey(props.debateId, side)}
            >
              <Hand aria-hidden="true" />
              {t("tabroom.draw.slot.move")}
            </Button>
          )}
          {props.pickActive && !props.isPicked && (
            <Button
              size="sm"
              variant="primary"
              onClick={props.onPlace}
              aria-label={
                hasTeam
                  ? t("tabroom.draw.slot.swapAria", { team: teamName, where })
                  : t("tabroom.draw.slot.placeAria", { where })
              }
              className="h-6 px-1.5 text-[11px]"
              data-place-target=""
            >
              <ArrowRightLeft aria-hidden="true" />
              {hasTeam ? t("tabroom.draw.slot.swapHere") : t("tabroom.draw.slot.placeHere")}
            </Button>
          )}
          {hasTeam && !props.pickActive && (
            <IconButton
              size="sm"
              variant="ghost"
              onClick={props.onRemove}
              label={t("tabroom.draw.slot.removeAria", { team: teamName, where })}
              title={t("tabroom.draw.slot.removeTitle")}
              icon={<X aria-hidden="true" />}
              className="h-6 w-6 hover:text-danger"
            />
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
          className="flex cursor-grab items-start justify-between gap-2 rounded-md p-1 transition-colors hover:bg-muted active:cursor-grabbing"
        >
          <div className="min-w-0">
            <div className={cn("font-semibold text-fg", compact ? "text-[13px]" : "text-sm")}>
              <TabroomTeamName team={team} name={teamName} />
              {props.points !== undefined && (
                <span className="ml-1.5 text-[11px] font-medium text-fg-muted">
                  {t("tabroom.draw.slot.points", { points: formatNumber(props.points) })}
                </span>
              )}
            </div>
            <div className="text-[11px] text-fg-muted">{team?.institutionName || t("common.independent")}</div>
            {props.liveness && <div className="mt-1 text-[11px]">{props.liveness}</div>}
            {flags.length > 0 && (
              <ul className="mt-1 flex flex-wrap gap-1" aria-label={t("tabroom.draw.slot.flagsAria", { team: teamName })}>
                {flags.map((flag, index) => (
                  <li key={`${flag.kind}-${index}`}>
                    <FlagBadge flag={flag} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
        </div>
      ) : (
        <div className="flex h-10 items-center justify-center rounded-md border border-dashed border-border-strong text-[11px] italic text-fg-muted">
          {props.pickActive ? t("tabroom.draw.slot.emptyPlace") : t("tabroom.draw.slot.empty", { position })}
        </div>
      )}
    </div>
  );
}

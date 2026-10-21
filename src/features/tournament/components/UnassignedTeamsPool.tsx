"use client";

import { ArrowRightLeft, GripVertical, Hand, Layers } from "lucide-react";
import type { DragEvent } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import type { DebateSide, Team } from "@/types";

export interface TeamDragPayload {
  type: "team";
  sourceType: "debate" | "unassigned";
  debateId?: string;
  side?: DebateSide;
  teamId: string;
  teamName: string;
  institutionId?: string;
  institutionName?: string;
}

interface UnassignedTeamsPoolProps {
  teams: Team[];
  expanded: boolean;
  dragOverTarget: string | null;
  onToggle: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>, target: string) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>, target: string) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, payload: TeamDragPayload) => void;
  /** Keyboard/touch editing: the id of the picked team (if any), and whether it sits in a debate. */
  pickedTeamId?: string;
  pickedFromDebate?: boolean;
  onPick?: (team: Team) => void;
  onReturnToPool?: () => void;
}

/** The `data-pick-key` of a pool team's Move button, so focus can return to it after a pick. */
export function poolPickKey(teamId: string): string {
  return `pool:${teamId}`;
}

export function UnassignedTeamsPool({
  teams,
  expanded,
  dragOverTarget,
  onToggle,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
  pickedTeamId,
  pickedFromDebate,
  onPick,
  onReturnToPool,
}: UnassignedTeamsPoolProps) {
  const { t } = useI18n();
  const dragOver = dragOverTarget === "unassigned-pool";
  return (
    <div
      onDragOver={(event) => onDragOver(event, "unassigned-pool")}
      onDragLeave={(event) => onDragLeave(event, "unassigned-pool")}
      onDrop={onDrop}
      className={cn(
        "rounded-lg border p-3 transition-colors",
        dragOver ? "border-dashed border-accent bg-accent-subtle ring-2 ring-accent" : "border-border bg-surface"
      )}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fg">
            <Layers className="h-3.5 w-3.5 text-fg-subtle" aria-hidden="true" />
            {t("tabroom.draw.pool.title", { count: teams.length })}
          </h2>
          <span className="text-[11px] text-fg-muted">
            {dragOver ? t("tabroom.draw.pool.dropHere") : t("tabroom.draw.pool.hint")}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pickedFromDebate && onReturnToPool && (
            <Button size="sm" variant="primary" onClick={onReturnToPool} data-place-target="">
              <ArrowRightLeft aria-hidden="true" />
              {t("tabroom.draw.pool.returnPicked")}
            </Button>
          )}
          <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={onToggle}>
            {expanded ? t("tabroom.draw.pool.hide") : t("tabroom.draw.pool.show")}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="flex flex-wrap gap-2 pt-1">
          {teams.map((team) => {
            const picked = pickedTeamId === team.id;
            return (
              <div
                key={team.id}
                draggable
                onDragStart={(event) =>
                  onDragStart(event, {
                    type: "team",
                    sourceType: "unassigned",
                    teamId: team.id,
                    teamName: team.name,
                    institutionId: team.institutionId,
                    institutionName: team.institutionName,
                  })
                }
                className={cn(
                  "inline-flex cursor-grab items-center gap-1.5 rounded-md border bg-surface px-2 py-1 text-xs text-fg transition-colors hover:border-accent active:cursor-grabbing",
                  picked ? "border-accent bg-accent-subtle ring-2 ring-accent" : "border-border-strong"
                )}
              >
                <GripVertical className="h-3 w-3 text-fg-subtle" aria-hidden="true" />
                <span className="font-semibold">{team.name}</span>
                {team.isSwing && <span className="text-[10px] font-medium text-fg-muted">{t("tabroom.draw.pool.swing")}</span>}
                {team.institutionName && (
                  <span className="text-[10px] text-fg-muted">({team.institutionName})</span>
                )}
                {onPick && !pickedTeamId && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onPick(team)}
                    aria-label={t("tabroom.draw.pool.pickAria", { team: team.name })}
                    data-pick-key={poolPickKey(team.id)}
                    className="ml-1 h-6 px-1.5 text-[11px]"
                  >
                    <Hand aria-hidden="true" />
                    {t("tabroom.draw.slot.move")}
                  </Button>
                )}
                {picked && <span className="text-[10px] font-semibold text-accent-text">{t("tabroom.draw.slot.picked")}</span>}
              </div>
            );
          })}

          {teams.length === 0 && (
            <span className="text-xs italic text-fg-muted">{t("tabroom.draw.pool.empty")}</span>
          )}
        </div>
      )}
    </div>
  );
}

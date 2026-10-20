"use client";

import { Building2, GripVertical, Hand, Search, Undo2 } from "lucide-react";
import type { DragEvent } from "react";
import type { Adjudicator, Institution } from "@/types";
import { effectiveAdjScore } from "@/lib/draw/allocator";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { cn } from "@/components/ui/cn";
import { DiversityBadges } from "./DiversityBadges";

export interface JudgeDragPayload {
  type: "judge";
  sourceType: "available" | "chair" | "panellist" | "trainee";
  adjId: string;
  adjName: string;
  sourceDebateId?: string;
}

/**
 * `data-pick-key` of a judge's Move button. One key per adjudicator (a judge sits in one place at a
 * time), so focus can return to the judge's new chip after a pick-then-place move.
 */
export function judgePickKey(adjId: string): string {
  return `judge:${adjId}`;
}

interface AvailableAdjudicatorsPanelProps {
  adjudicators: Adjudicator[];
  availableCount: number;
  feedbackScores: Map<string, number>;
  feedbackWeight?: number;
  showDiversity?: boolean;
  institutionsById?: Map<string, Pick<Institution, "region">>;
  /** The judge picked for pick-then-place, if any. */
  picked: JudgeDragPayload | null;
  searchQuery: string;
  dragOverTarget: string | null;
  onSearchChange(value: string): void;
  /** Picks a pool judge (picking the picked judge again cancels). */
  onPick(payload: JudgeDragPayload): void;
  /** Place target: returns the picked (placed) judge to the pool. */
  onReturnToPool(): void;
  onDragStart(event: DragEvent<HTMLElement>, payload: JudgeDragPayload): void;
  onDragEnd(): void;
  onDragOver(event: DragEvent<HTMLElement>, target: string): void;
  onDragLeave(event: DragEvent<HTMLElement>, target: string): void;
  onDrop(event: DragEvent<HTMLElement>): void;
}

function scoreTone(score: number): Tone {
  if (score >= 7) return "success";
  if (score >= 4) return "info";
  return "neutral";
}

export function AvailableAdjudicatorsPanel({
  adjudicators,
  availableCount,
  feedbackScores,
  feedbackWeight,
  showDiversity = false,
  institutionsById = new Map(),
  picked,
  searchQuery,
  dragOverTarget,
  onSearchChange,
  onPick,
  onReturnToPool,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: AvailableAdjudicatorsPanelProps) {
  const { t, formatDecimal, formatNumber } = useI18n();
  const isDragOver = dragOverTarget === "available-drawer";
  const pickActive = Boolean(picked);
  return (
    <section className="space-y-4 lg:col-span-4" aria-labelledby="available-adjudicators-heading">
      <Card
        onDragOver={(event) => onDragOver(event, "available-drawer")}
        onDragLeave={(event) => onDragLeave(event, "available-drawer")}
        onDrop={onDrop}
        className={cn(
          "p-3 transition-colors",
          isDragOver && "border-dashed border-accent bg-accent-subtle ring-2 ring-accent"
        )}
      >
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 id="available-adjudicators-heading" className="flex items-center gap-1.5 text-[15px] font-semibold text-fg">
            {t("tabroom.allocation.availableHeading")}
            <Badge tone="accent">{formatNumber(availableCount)}</Badge>
          </h2>
          <span className="text-[11px] text-fg-muted">
            {isDragOver ? t("tabroom.allocation.dropToPool") : t("tabroom.allocation.availableHint")}
          </span>
        </div>

        {picked?.sourceDebateId && (
          <Button
            size="sm"
            variant="primary"
            className="mb-2 w-full"
            data-place-target=""
            aria-label={t("tabroom.allocation.returnToPoolAria", { name: picked.adjName })}
            onClick={onReturnToPool}
          >
            <Undo2 aria-hidden="true" />
            {t("tabroom.allocation.returnToPool")}
          </Button>
        )}

        <div className="mb-2">
          <Input
          type="text"
          aria-label={t("tabroom.allocation.searchAria")}
          placeholder={t("tabroom.allocation.searchPlaceholder")}
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          leadingIcon={<Search />}
          />
        </div>

        <ul className="max-h-[600px] space-y-1.5 overflow-y-auto pr-1">
          {adjudicators.map((adjudicator) => {
            const selected = picked?.adjId === adjudicator.id;
            const score = effectiveAdjScore(adjudicator, feedbackScores, feedbackWeight);
            const payload: JudgeDragPayload = {
              type: "judge",
              sourceType: "available",
              adjId: adjudicator.id,
              adjName: adjudicator.name,
            };

            return (
              <li
                key={adjudicator.id}
                draggable
                onDragEnd={onDragEnd}
                onDragStart={(event) => onDragStart(event, payload)}
                onClick={() => onPick(payload)}
                className={cn(
                  "flex cursor-grab items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors active:cursor-grabbing",
                  selected
                    ? "border-accent bg-accent-subtle ring-2 ring-accent"
                    : "border-border bg-background hover:border-border-strong hover:bg-surface"
                )}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <GripVertical className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 font-semibold text-fg">
                      <span>{adjudicator.name}</span>
                      {adjudicator.trainee && <Badge tone="warning">{t("role.trainee")}</Badge>}
                      {selected && <Badge tone="accent">{t("tabroom.allocation.pickedBadge")}</Badge>}
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-fg-muted">
                      <Building2 className="h-3 w-3 shrink-0 text-fg-subtle" aria-hidden="true" />
                      <span>{adjudicator.institutionName || t("tabroom.allocation.independentLong")}</span>
                    </div>
                    {showDiversity && (
                      <DiversityBadges participant={adjudicator} institutionsById={institutionsById} />
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Badge tone={scoreTone(score)} className="font-mono" title={t("tabroom.allocation.scoreTitle")}>
                    {formatDecimal(score, 1)}
                  </Badge>
                  {!pickActive && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5"
                      data-pick-key={judgePickKey(adjudicator.id)}
                      aria-label={t("tabroom.allocation.pickPoolAria", { name: adjudicator.name })}
                      onClick={(event) => {
                        event.stopPropagation();
                        onPick(payload);
                      }}
                    >
                      <Hand aria-hidden="true" />
                      {t("tabroom.allocation.move")}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
          {adjudicators.length === 0 && (
            <li className="py-6 text-center text-xs text-fg-muted">{t("tabroom.allocation.noAvailable")}</li>
          )}
        </ul>
      </Card>
    </section>
  );
}

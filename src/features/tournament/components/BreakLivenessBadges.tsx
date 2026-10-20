"use client";

import React from "react";

import type { BreakCategory } from "@/types";
import type { MessageKey } from "@/lib/i18n";
import type { LivenessStatus, TeamCategoryLiveness } from "@/lib/breakqual/liveness";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Badge, type Tone } from "@/components/ui/Badge";

export const LIVENESS_STATUS_KEYS: Record<LivenessStatus, MessageKey> = {
  safe: "results.liveness.safe",
  live: "results.liveness.live",
  dead: "results.liveness.dead",
};

const LIVENESS_TONES: Record<LivenessStatus, Tone> = { safe: "success", live: "warning", dead: "neutral" };

/**
 * A team's break liveness in each of its break categories, written out ("Open: live") so the
 * status never depends on colour alone.
 */
export function BreakLivenessBadges({
  entries,
  categories,
  className,
}: {
  entries: TeamCategoryLiveness[] | undefined;
  categories: BreakCategory[];
  className?: string;
}) {
  const { t } = useI18n();
  if (!entries || entries.length === 0) return <span className="text-fg-muted">—</span>;
  const names = new Map(categories.map((category) => [category.id, category.name]));
  return (
    <span className={className ?? "inline-flex flex-wrap gap-1"}>
      {entries.map((entry) => (
        <Badge key={entry.categoryId} tone={LIVENESS_TONES[entry.status]} className="whitespace-nowrap">
          {t("results.liveness.entry", {
            category: names.get(entry.categoryId) ?? entry.categoryId,
            status: t(LIVENESS_STATUS_KEYS[entry.status]),
          })}
        </Badge>
      ))}
    </span>
  );
}

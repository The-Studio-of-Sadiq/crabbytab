"use client";

import React from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { SHARD_SPLITS, shardLabel, type ShardMix, type ShardSettings, type ShardSort } from "@/lib/draw/sharding";

export interface ShardState extends ShardSettings {
  /** Open shard, or null for the whole round. */
  index: number | null;
}

export const DEFAULT_SHARD_STATE: ShardState = { split: 2, sort: "bracket", mix: "top_to_bottom", index: null };

const SORT_LABELS: Record<ShardSort, MessageKey> = {
  bracket: "tabroom.allocation.shardSortBracket",
  importance: "tabroom.allocation.shardSortPriority",
  venue: "tabroom.allocation.shardSortVenue",
};
const MIX_LABELS: Record<ShardMix, MessageKey> = {
  top_to_bottom: "tabroom.allocation.shardMixTopToBottom",
  interleaved: "tabroom.allocation.shardMixInterleaved",
};

const inlineField = "flex items-center gap-1.5 space-y-0";
const selectClass = "h-7 w-auto text-xs";

/**
 * Tabbycat-style sharding for the allocation board: open one part of the draw to work on it.
 * Shards are a view only; auto-allocation and conflict checks always cover the whole round.
 */
export function ShardControls({
  state,
  onChange,
  shardSizes,
}: {
  state: ShardState;
  onChange(next: ShardState): void;
  /** Number of debates in each shard for the current settings. */
  shardSizes: number[];
}) {
  const { t, plural, formatNumber } = useI18n();
  const update = (patch: Partial<ShardState>) => onChange({ ...state, ...patch });
  return (
    <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs">
      <legend className="sr-only">{t("tabroom.allocation.shards")}</legend>
      <span aria-hidden="true" className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
        {t("tabroom.allocation.shards")}
      </span>
      <Select
        label={t("tabroom.allocation.shardSplit")}
        wrapperClassName={inlineField}
        className={selectClass}
        value={state.split}
        onChange={(event) => update({ split: Number(event.target.value), index: null })}
      >
        {SHARD_SPLITS.map((split) => <option key={split} value={split}>{formatNumber(split)}</option>)}
      </Select>
      <Select
        label={t("tabroom.allocation.shardSort")}
        wrapperClassName={inlineField}
        className={selectClass}
        value={state.sort}
        onChange={(event) => update({ sort: event.target.value as ShardSort })}
      >
        {(Object.keys(SORT_LABELS) as ShardSort[]).map((sort) => (
          <option key={sort} value={sort}>{t(SORT_LABELS[sort])}</option>
        ))}
      </Select>
      <Select
        label={t("tabroom.allocation.shardMix")}
        wrapperClassName={inlineField}
        className={selectClass}
        value={state.mix}
        onChange={(event) => update({ mix: event.target.value as ShardMix })}
      >
        {(Object.keys(MIX_LABELS) as ShardMix[]).map((mix) => (
          <option key={mix} value={mix}>{t(MIX_LABELS[mix])}</option>
        ))}
      </Select>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("tabroom.allocation.shardOpenGroup")}>
        <Button
          size="sm"
          variant={state.index === null ? "primary" : "secondary"}
          aria-pressed={state.index === null}
          onClick={() => update({ index: null })}
        >
          {t("tabroom.allocation.shardAll")}
        </Button>
        {shardSizes.map((size, index) => (
          <Button
            key={index}
            size="sm"
            variant={state.index === index ? "primary" : "secondary"}
            aria-pressed={state.index === index}
            aria-label={plural("tabroom.allocation.shardButtonAria", size, { shard: shardLabel(index) })}
            onClick={() => update({ index })}
          >
            {shardLabel(index)} <span className="font-normal">({formatNumber(size)})</span>
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

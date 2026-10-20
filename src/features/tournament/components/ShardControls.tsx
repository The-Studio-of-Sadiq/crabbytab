"use client";

import React from "react";
import { SHARD_SPLITS, shardLabel, type ShardMix, type ShardSettings, type ShardSort } from "@/lib/draw/sharding";

export interface ShardState extends ShardSettings {
  /** Open shard, or null for the whole round. */
  index: number | null;
}

export const DEFAULT_SHARD_STATE: ShardState = { split: 2, sort: "bracket", mix: "top_to_bottom", index: null };

const SORT_LABELS: Record<ShardSort, string> = { bracket: "Bracket", importance: "Priority", venue: "Venue" };
const MIX_LABELS: Record<ShardMix, string> = { top_to_bottom: "Top to bottom", interleaved: "Interleaved" };

const selectClass =
  "rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100";

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
  const update = (patch: Partial<ShardState>) => onChange({ ...state, ...patch });
  return (
    <fieldset className="flex flex-wrap items-center gap-2 rounded border border-gray-200 bg-gray-50 p-2 text-xs dark:border-gray-700 dark:bg-gray-800">
      <legend className="sr-only">Shards</legend>
      <span className="font-semibold text-gray-700 dark:text-gray-200">Shards</span>
      <label className="flex items-center gap-1">
        <span className="text-gray-600 dark:text-gray-300">Split in</span>
        <select
          className={selectClass}
          value={state.split}
          onChange={(event) => update({ split: Number(event.target.value), index: null })}
        >
          {SHARD_SPLITS.map((split) => <option key={split} value={split}>{split}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1">
        <span className="text-gray-600 dark:text-gray-300">by</span>
        <select
          className={selectClass}
          value={state.sort}
          onChange={(event) => update({ sort: event.target.value as ShardSort })}
        >
          {(Object.keys(SORT_LABELS) as ShardSort[]).map((sort) => <option key={sort} value={sort}>{SORT_LABELS[sort]}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1">
        <span className="text-gray-600 dark:text-gray-300">mix</span>
        <select
          className={selectClass}
          value={state.mix}
          onChange={(event) => update({ mix: event.target.value as ShardMix })}
        >
          {(Object.keys(MIX_LABELS) as ShardMix[]).map((mix) => <option key={mix} value={mix}>{MIX_LABELS[mix]}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Open a shard">
        <button
          type="button"
          aria-pressed={state.index === null}
          onClick={() => update({ index: null })}
          className={`rounded border px-2 py-1 font-semibold ${
            state.index === null
              ? "border-indigo-700 bg-indigo-600 text-white"
              : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
          }`}
        >
          All
        </button>
        {shardSizes.map((size, index) => (
          <button
            key={index}
            type="button"
            aria-pressed={state.index === index}
            onClick={() => update({ index })}
            className={`rounded border px-2 py-1 font-semibold ${
              state.index === index
                ? "border-indigo-700 bg-indigo-600 text-white"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
            }`}
          >
            {shardLabel(index)} <span className="font-normal">({size})</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

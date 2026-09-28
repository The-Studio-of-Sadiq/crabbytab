"use client";

import React from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";

const MAX_METRICS = 8;

/**
 * Ordered list editor for a standings precedence chain: add, remove, and
 * reorder metric ids. Used for both team and speaker precedence.
 */
export function PrecedenceEditor<M extends string>({
  value,
  onChange,
  labels,
  disabledIds = [],
}: {
  value: M[];
  onChange: (next: M[]) => void;
  labels: Record<M, string>;
  /** Metrics greyed out in the "add" list (e.g. BP-only metrics in a two-team tournament). */
  disabledIds?: M[];
}) {
  const allIds = Object.keys(labels) as M[];
  const available = allIds.filter((id) => !value.includes(id));
  const disabledSet = new Set(disabledIds);

  const move = (index: number, dir: -1 | 1) => {
    const next = [...value];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    onChange(next);
  };

  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));
  const add = (id: M) => {
    if (value.length >= MAX_METRICS || value.includes(id)) return;
    onChange([...value, id]);
  };

  return (
    <div className="space-y-2">
      {value.length === 0 && (
        <p className="text-xs text-gray-500 italic">No metrics set — using the format default.</p>
      )}
      <ol className="space-y-1.5">
        {value.map((id, i) => (
          <li
            key={id}
            className="flex items-center justify-between bg-white border border-[#d0d7de] rounded px-3 py-1.5"
          >
            <span className="flex items-center space-x-2 text-sm">
              <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-600 text-[11px] font-bold flex items-center justify-center">
                {i + 1}
              </span>
              <span className="font-medium text-gray-900">{labels[id] ?? id}</span>
            </span>
            <span className="flex items-center space-x-1">
              <button
                type="button"
                aria-label="Move up"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                className="p-1 text-gray-500 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                aria-label="Move down"
                disabled={i === value.length - 1}
                onClick={() => move(i, 1)}
                className="p-1 text-gray-500 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                aria-label="Remove"
                onClick={() => remove(i)}
                className="p-1 text-gray-500 hover:text-red-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          </li>
        ))}
      </ol>

      {value.length < MAX_METRICS && available.length > 0 && (
        <div className="flex items-center space-x-2 pt-1">
          <select
            className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-xs bg-white"
            value=""
            onChange={(e) => e.target.value && add(e.target.value as M)}
          >
            <option value="" disabled>
              Add a metric...
            </option>
            {available.map((id) => (
              <option key={id} value={id} disabled={disabledSet.has(id)}>
                {labels[id]}
                {disabledSet.has(id) ? " (not applicable to this format)" : ""}
              </option>
            ))}
          </select>
          <Plus className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        </div>
      )}
      <p className="text-[11px] text-gray-500">Up to {MAX_METRICS} metrics. Teams tied on every metric here share a rank.</p>
    </div>
  );
}

/** Unordered set editor for "extra" metrics shown on the standings page but not used to rank. */
export function ExtraMetricsEditor<M extends string>({
  value,
  onChange,
  labels,
  exclude = [],
}: {
  value: M[];
  onChange: (next: M[]) => void;
  labels: Record<M, string>;
  /** Metrics already in the precedence chain, hidden here to avoid double-listing. */
  exclude?: M[];
}) {
  const excludeSet = new Set(exclude);
  const options = (Object.keys(labels) as M[]).filter((id) => !excludeSet.has(id));

  const toggle = (id: M) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {options.map((id) => (
        <label key={id} className="flex items-center space-x-2 text-xs text-gray-800 cursor-pointer">
          <input
            type="checkbox"
            className="rounded border-gray-300 text-blue-600"
            checked={value.includes(id)}
            onChange={() => toggle(id)}
          />
          <span>{labels[id]}</span>
        </label>
      ))}
    </div>
  );
}

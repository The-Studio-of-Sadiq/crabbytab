"use client";

import React, { useMemo, useState } from "react";
import type { Venue, VenueCategoryInfo } from "@/types";
import { normaliseCategory, venueCategoryInfo, venueDisplayName } from "@/lib/venues/venues";

/**
 * Display options per room category (Tabbycat VenueCategory): a description shown as the room's
 * tooltip, whether the category is prefixed or suffixed to room names in the draw, and whether
 * the description is shown on public pages.
 */
export function VenueCategoriesEditor({
  venues,
  categories,
  onSave,
}: {
  venues: Venue[];
  categories: VenueCategoryInfo[] | undefined;
  onSave(next: VenueCategoryInfo[]): Promise<void>;
}) {
  const names = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const venue of venues) {
      const name = venue.category?.trim();
      if (name && !byKey.has(normaliseCategory(name))) byKey.set(normaliseCategory(name), name);
    }
    for (const category of categories ?? []) {
      if (!byKey.has(normaliseCategory(category.name))) byKey.set(normaliseCategory(category.name), category.name);
    }
    return [...byKey.values()].sort((a, b) => a.localeCompare(b));
  }, [venues, categories]);
  const [draft, setDraft] = useState<Record<string, VenueCategoryInfo>>({});
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  if (names.length === 0) return null;

  const current = (name: string): VenueCategoryInfo =>
    draft[normaliseCategory(name)] ?? venueCategoryInfo(categories, name) ?? { name, displayInName: "none" };
  const change = (name: string, patch: Partial<VenueCategoryInfo>) => {
    setStatus(null);
    setDraft((value) => ({ ...value, [normaliseCategory(name)]: { ...current(name), ...patch, name } }));
  };
  const dirty = Object.keys(draft).length > 0;

  const save = async () => {
    setSaving(true);
    try {
      const merged = new Map((categories ?? []).map((category) => [normaliseCategory(category.name), category]));
      for (const [key, value] of Object.entries(draft)) {
        merged.set(key, {
          name: value.name,
          ...(value.description?.trim() ? { description: value.description.trim() } : {}),
          displayInName: value.displayInName ?? "none",
          ...(value.publicTooltip ? { publicTooltip: true } : {}),
        });
      }
      await onSave([...merged.values()]);
      setDraft({});
      setStatus({ tone: "success", text: "Room categories saved." });
    } catch (error) {
      setStatus({ tone: "error", text: error instanceof Error ? error.message : "Could not save the room categories." });
    } finally {
      setSaving(false);
    }
  };

  const example = venues.find((venue) => venue.category?.trim());
  return (
    <section
      aria-labelledby="room-categories-heading"
      className="space-y-3 rounded-lg border border-[#d0d7de] bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
    >
      <div>
        <h2 id="room-categories-heading" className="text-sm font-bold text-gray-900 dark:text-gray-100">Room categories</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Describe each category (it follows “This room …” in tooltips) and choose whether its name is shown with room
          names. Team, adjudicator and institution room preferences refer to these categories.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-gray-600 dark:text-gray-300">
              <th className="py-1 pr-2">Category</th>
              <th className="py-1 pr-2">Description</th>
              <th className="py-1 pr-2">In room name</th>
              <th className="py-1">Public tooltip</th>
            </tr>
          </thead>
          <tbody>
            {names.map((name) => {
              const info = current(name);
              return (
                <tr key={name} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="py-1 pr-2 font-semibold text-gray-900 dark:text-gray-100">{name}</td>
                  <td className="py-1 pr-2">
                    <input
                      aria-label={`${name} description`}
                      value={info.description ?? ""}
                      maxLength={200}
                      placeholder="has step-free access"
                      onChange={(event) => change(name, { description: event.target.value })}
                      className="w-full min-w-40 rounded border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <select
                      aria-label={`${name} shown in room names`}
                      value={info.displayInName ?? "none"}
                      onChange={(event) => change(name, { displayInName: event.target.value as VenueCategoryInfo["displayInName"] })}
                      className="rounded border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
                    >
                      <option value="none">Not shown</option>
                      <option value="prefix">Prefix</option>
                      <option value="suffix">Suffix</option>
                    </select>
                  </td>
                  <td className="py-1">
                    <input
                      type="checkbox"
                      aria-label={`Show ${name} description on public pages`}
                      checked={info.publicTooltip === true}
                      onChange={(event) => change(name, { publicTooltip: event.target.checked })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save room categories"}
        </button>
        {example && (
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            Example: {venueDisplayName(example, Object.keys(draft).length ? names.map(current) : categories)}
          </span>
        )}
        {status && (
          <span role={status.tone === "error" ? "alert" : "status"} className={`text-xs ${status.tone === "error" ? "text-red-700" : "text-emerald-700"}`}>
            {status.text}
          </span>
        )}
      </div>
    </section>
  );
}

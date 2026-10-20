"use client";

import React from "react";

import type { BreakCategory } from "@/types";
import { selectableBreakCategories } from "@/lib/teamCategories";
import { resolveSpeakerCategoryIds, type SpeakerCategoryView } from "@/lib/speakerCategories";

/** Checkboxes for a team's eligibility in non-general break categories. */
export function BreakEligibilityField({
  categories,
  value,
  onChange,
}: {
  categories: BreakCategory[];
  value: string[];
  onChange: (categoryIds: string[]) => void;
}) {
  const selectable = selectableBreakCategories(categories);
  const general = categories.filter((category) => category.isGeneral);
  return (
    <fieldset className="p-3 bg-gray-50 border border-gray-200 rounded-md space-y-1.5">
      <legend className="text-xs font-bold text-gray-800 px-1">Break eligibility</legend>
      {selectable.length === 0 ? (
        <p className="text-[11px] text-gray-500">
          No restricted break categories yet. Add ESL, novice or similar categories on the Break page.
        </p>
      ) : (
        selectable.map((category) => (
          <label key={category.id} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={value.includes(category.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...value.filter((id) => id !== category.id), category.id]
                    : value.filter((id) => id !== category.id)
                )
              }
              className="rounded border-gray-300 text-blue-600"
            />
            <span>{category.name}</span>
          </label>
        ))
      )}
      {general.length > 0 && (
        <p className="text-[11px] text-gray-500">
          Every team is eligible for {general.map((category) => category.name).join(", ")}.
        </p>
      )}
    </fieldset>
  );
}

/**
 * Toggle buttons for one speaker's categories. Stores category ids; a category still derived from
 * old labels (not yet saved) is stored by its slug, which keeps resolving once it is saved.
 */
export function SpeakerCategoriesInput({
  id,
  label,
  categories,
  value,
  onChange,
}: {
  id: string;
  label: string;
  categories: SpeakerCategoryView[];
  value: string[] | undefined;
  onChange: (categories: string[]) => void;
}) {
  const selected = resolveSpeakerCategoryIds(value, categories);
  if (categories.length === 0) {
    return <p id={id} className="text-[11px] text-gray-500">No speaker categories yet (add them under Speaker categories).</p>;
  }
  const refFor = (category: SpeakerCategoryView) => (category.unsaved ? category.slug : category.id);
  return (
    <div id={id} role="group" aria-label={label} className="flex flex-wrap gap-1">
      {categories.map((category) => {
        const on = selected.includes(category.id);
        return (
          <button
            key={category.id}
            type="button"
            aria-pressed={on}
            onClick={() =>
              onChange(
                categories
                  .filter((item) => (item.id === category.id ? !on : selected.includes(item.id)))
                  .map(refFor)
              )
            }
            className={`rounded border px-2 py-0.5 text-[11px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              on ? "border-blue-600 bg-blue-600 text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {on ? "✓ " : ""}
            {category.name}
          </button>
        );
      })}
    </div>
  );
}

"use client";

import React, { useState } from "react";

import type { BreakCategory } from "@/types";
import { formatCategoryList, parseCategoryList, selectableBreakCategories } from "@/lib/teamCategories";

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

/** Comma-separated category labels (e.g. "esl, novice") for one speaker. */
export function SpeakerCategoriesInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string[] | undefined;
  onChange: (categories: string[]) => void;
}) {
  const [text, setText] = useState(formatCategoryList(value));
  return (
    <>
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        id={id}
        type="text"
        value={text}
        placeholder="Categories, e.g. esl, novice"
        onChange={(event) => {
          setText(event.target.value);
          onChange(parseCategoryList(event.target.value));
        }}
        onBlur={() => setText(formatCategoryList(parseCategoryList(text)))}
        className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs"
      />
    </>
  );
}

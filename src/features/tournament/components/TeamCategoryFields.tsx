"use client";

import React from "react";
import { Check } from "lucide-react";

import type { BreakCategory } from "@/types";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Checkbox } from "@/components/ui/Field";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
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
  const { t, formatList } = useI18n();
  const selectable = selectableBreakCategories(categories);
  const general = categories.filter((category) => category.isGeneral);
  return (
    <fieldset className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
      <legend className="px-1 text-xs font-medium text-fg">{t("setup.imports.breakEligibility")}</legend>
      {selectable.length === 0 ? (
        <p className="text-xs text-fg-muted">{t("setup.imports.breakEligibilityEmpty")}</p>
      ) : (
        selectable.map((category) => (
          <Checkbox
            key={category.id}
            label={category.name}
            checked={value.includes(category.id)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...value.filter((id) => id !== category.id), category.id]
                  : value.filter((id) => id !== category.id)
              )
            }
          />
        ))
      )}
      {general.length > 0 && (
        <p className="text-xs text-fg-muted">
          {t("setup.imports.breakEligibilityGeneral", { names: formatList(general.map((category) => category.name)) })}
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
  const { t } = useI18n();
  const selected = resolveSpeakerCategoryIds(value, categories);
  if (categories.length === 0) {
    return (
      <p id={id} className="text-xs text-fg-muted">
        {t("setup.imports.speakerCategoriesEmpty")}
      </p>
    );
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
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-sm border px-2 text-[11px] font-medium transition-colors",
              focusRing,
              on ? "border-accent bg-accent text-accent-fg" : "border-border-strong bg-surface text-fg hover:bg-muted"
            )}
          >
            {on && <Check className="h-3 w-3" aria-hidden="true" />}
            {category.name}
          </button>
        );
      })}
    </div>
  );
}

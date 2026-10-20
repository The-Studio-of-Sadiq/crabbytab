"use client";

import React, { useState } from "react";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { focusRing } from "@/components/ui/focus";
import { cn } from "@/components/ui/cn";
import type { Adjudicator } from "@/types";

/** Flags that can be toggled inline in an adjudicator table (Tabbycat's check cells). */
export type AdjudicatorFlag = "breaking" | "isTester";

/**
 * An inline checkbox that saves one adjudicator flag at once (Tabbycat adjfeedback check cells for
 * "breaking" and "tester"). Absent and false mean the same, so unchecking removes the field.
 */
export function AdjudicatorFlagToggle({
  adjudicator,
  flag,
  label,
  disabled,
  disabledReason,
}: {
  adjudicator: Adjudicator;
  flag: AdjudicatorFlag;
  /** Accessible name, e.g. "Breaking: Jane Doe". */
  label: string;
  disabled?: boolean;
  /** Shown as the tooltip when disabled (e.g. "On the adjudication core, so always a tester"). */
  disabledReason?: string;
}) {
  const { adjudicators, updateAdjudicators } = useTournament();
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const checked = flag === "isTester" ? adjudicator.isTester === true || adjudicator.adjCore === true : adjudicator.breaking === true;

  const toggle = async (next: boolean) => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      // Save from the latest copy so a concurrent edit of another field is not overwritten.
      const latest = adjudicators.find((item) => item.id === adjudicator.id) ?? adjudicator;
      await updateAdjudicators([{ ...latest, [flag]: next || undefined }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("results.feedback.tester.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-center">
      <input
        type="checkbox"
        aria-label={label}
        title={disabled ? disabledReason : label}
        checked={checked}
        disabled={disabled || saving}
        aria-busy={saving || undefined}
        onChange={(event) => void toggle(event.target.checked)}
        className={cn(
          "h-4 w-4 cursor-pointer rounded-sm accent-[rgb(var(--color-accent))]",
          focusRing,
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
      />
      {error && (
        <span role="alert" className="mt-0.5 text-[11px] text-danger">
          {error}
        </span>
      )}
    </span>
  );
}

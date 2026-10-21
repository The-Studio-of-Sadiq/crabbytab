"use client";

import { useCallback } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { SCORE_DISPLAY_OPTIONS } from "@/lib/scoreDisplay";

/**
 * Locale-aware `formatScore`: at most two decimals, no grouping, "—" for a missing score. Staff
 * screens use this instead of the English-only `formatScore` once they are translated.
 */
export function useFormatScore(): (value: number | undefined) => string {
  const { formatNumber } = useI18n();
  return useCallback(
    (value: number | undefined) =>
      value === undefined || !Number.isFinite(value) ? "—" : formatNumber(value, SCORE_DISPLAY_OPTIONS),
    [formatNumber]
  );
}

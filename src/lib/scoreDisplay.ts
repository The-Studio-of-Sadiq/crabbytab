/**
 * Display formatting for scores. Stored scores are exact (averaged voting scores such as 224/3 must
 * stay exact so ties hold); screens show at most two decimals and no trailing zeros.
 */
export const SCORE_DISPLAY_OPTIONS: Intl.NumberFormatOptions = {
  maximumFractionDigits: 2,
  useGrouping: false,
};

const englishScoreFormat = new Intl.NumberFormat("en", SCORE_DISPLAY_OPTIONS);

/** For staff (English) screens; public pages use the I18n `formatNumber` with SCORE_DISPLAY_OPTIONS. */
export function formatScore(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "—" : englishScoreFormat.format(value);
}

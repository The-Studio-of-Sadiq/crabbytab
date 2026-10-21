import { getLocaleDefinition, type Locale } from "@/lib/i18n/config";

/**
 * Locale-aware number and date formatting through `Intl`. Formatters are cached per locale and
 * options because constructing them is comparatively expensive and tables format many cells.
 */

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();

function intlTag(locale: Locale): string {
  return getLocaleDefinition(locale).intlLocale;
}

export function formatNumber(locale: Locale, value: number, options?: Intl.NumberFormatOptions): string {
  const key = `${locale}|${JSON.stringify(options ?? {})}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(intlTag(locale), options);
    numberFormats.set(key, format);
  }
  return format.format(value);
}

/** Fixed number of decimals, the localised equivalent of `value.toFixed(digits)`. */
export function formatDecimal(locale: Locale, value: number, digits: number): string {
  return formatNumber(locale, value, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  });
}

export function formatDateTime(
  locale: Locale,
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(intlTag(locale), options);
    dateFormats.set(key, format);
  }
  return format.format(date);
}

export function formatTime(locale: Locale, value: Date | string | number): string {
  return formatDateTime(locale, value, { timeStyle: "medium" });
}

/** List of names joined the way the language joins them ("A, B and C"). */
export function formatList(locale: Locale, items: readonly string[]): string {
  return new Intl.ListFormat(intlTag(locale), { style: "long", type: "conjunction" }).format(items);
}

export function pluralCategory(locale: Locale, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(intlTag(locale));
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

export function pluralCategories(locale: Locale): Intl.LDMLPluralRule[] {
  return new Intl.PluralRules(intlTag(locale)).resolvedOptions().pluralCategories;
}

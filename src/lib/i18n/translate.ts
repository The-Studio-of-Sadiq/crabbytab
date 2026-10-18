import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { formatNumber, pluralCategory } from "@/lib/i18n/format";
import { catalogues, type MessageKey, type PluralKey } from "@/lib/i18n/messages";

/**
 * Message lookup and interpolation.
 *
 * - Placeholders are `{name}`. Numbers passed as values are formatted for the locale.
 * - Plurals use one key per CLDR category: `key_one`, `key_other` (plus `key_few`, `key_many`, …
 *   where the language needs them). `plural(key, count)` picks the category with Intl.PluralRules
 *   and provides `{count}`.
 * - Rich text marks spans with `<tag>…</tag>` (no nesting); see `parseRichText`.
 */

export type MessageValues = Record<string, string | number>;

const PLACEHOLDER = /\{(\w+)\}/g;

export function interpolate(locale: Locale, message: string, values?: MessageValues): string {
  if (!values) return message;
  return message.replace(PLACEHOLDER, (match, name: string) => {
    const value = values[name];
    if (value === undefined) return match;
    return typeof value === "number" ? formatNumber(locale, value) : value;
  });
}

function catalogue(locale: Locale): Partial<Record<string, string>> {
  return catalogues[locale];
}

/** The message for `key` in `locale`, falling back to English and finally to the key itself. */
export function lookupMessage(locale: Locale, key: string): string {
  return catalogue(locale)[key] ?? catalogue(DEFAULT_LOCALE)[key] ?? key;
}

export function translate(locale: Locale, key: MessageKey, values?: MessageValues): string {
  return interpolate(locale, lookupMessage(locale, key), values);
}

/** The uninterpolated plural message for `count`. */
export function lookupPluralMessage(locale: Locale, key: PluralKey, count: number): string {
  const own = catalogue(locale);
  const source = catalogue(DEFAULT_LOCALE);
  // The locale's own `other` wins over English, so a translated sentence is never replaced by an
  // English one just because a rarer category is missing. English is matched with English rules.
  return (
    own[`${key}_${pluralCategory(locale, count)}`] ??
    own[`${key}_other`] ??
    source[`${key}_${pluralCategory(DEFAULT_LOCALE, count)}`] ??
    source[`${key}_other`] ??
    key
  );
}

export function translatePlural(locale: Locale, key: PluralKey, count: number, values?: MessageValues): string {
  return interpolate(locale, lookupPluralMessage(locale, key, count), { count, ...values });
}

export type RichSegment = string | { tag: string; text: string };

const RICH_TAG = /<(\w+)>(.*?)<\/\1>/g;

/** Splits `Use <b>this</b> portal` into ["Use ", {tag:"b", text:"this"}, " portal"]. */
export function parseRichText(message: string): RichSegment[] {
  const segments: RichSegment[] = [];
  let lastIndex = 0;
  for (const match of message.matchAll(RICH_TAG)) {
    const index = match.index ?? 0;
    if (index > lastIndex) segments.push(message.slice(lastIndex, index));
    segments.push({ tag: match[1], text: match[2] });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < message.length) segments.push(message.slice(lastIndex));
  return segments;
}

/**
 * Rich message ready to render: tags are split out of the *template* before values are filled in,
 * so markup-like text inside a value (a team named "<b>x</b>") stays literal text.
 */
export function richSegments(locale: Locale, message: string, values?: MessageValues): RichSegment[] {
  return parseRichText(message).map((segment) =>
    typeof segment === "string"
      ? interpolate(locale, segment, values)
      : { tag: segment.tag, text: interpolate(locale, segment.text, values) }
  );
}

export interface Translator {
  locale: Locale;
  t: (key: MessageKey, values?: MessageValues) => string;
  plural: (key: PluralKey, count: number, values?: MessageValues) => string;
}

export function createTranslator(locale: Locale): Translator {
  return {
    locale,
    t: (key, values) => translate(locale, key, values),
    plural: (key, count, values) => translatePlural(locale, key, count, values),
  };
}

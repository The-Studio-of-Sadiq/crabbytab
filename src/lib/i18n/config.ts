/**
 * Supported UI languages and the rules for choosing one.
 *
 * Catalogues ship in the bundle (see ./messages), so switching language never needs the network.
 * English is the source catalogue; every other catalogue falls back to it key by key.
 */

export interface LocaleDefinition {
  /** BCP 47 language code used as the catalogue key and `<html lang>`. */
  code: string;
  /** Name of the language written in that language, for the switcher. */
  nativeName: string;
  /** English name, for organisers configuring a tournament. */
  englishName: string;
  /**
   * Tag passed to `Intl` formatters. Lets a language keep Latin digits (scores and ranks are
   * compared against paper ballots that use them) while still localising month names.
   */
  intlLocale: string;
  /** Catalogue produced by machine translation and not yet reviewed by a fluent speaker. */
  machineDrafted?: boolean;
}

export const LOCALES = [
  { code: "en", nativeName: "English", englishName: "English", intlLocale: "en" },
  {
    code: "bn",
    nativeName: "বাংলা",
    englishName: "Bengali",
    intlLocale: "bn-u-nu-latn",
    machineDrafted: true,
  },
] as const satisfies readonly LocaleDefinition[];

export type Locale = (typeof LOCALES)[number]["code"];
export type TextDirection = "ltr" | "rtl";

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "crabbytab:locale";

/** Primary language subtags written right to left. Kept independent of LOCALES so adding one just works. */
const RTL_LANGUAGES = new Set(["ar", "arc", "ckb", "dv", "fa", "he", "ks", "ku", "ps", "sd", "ug", "ur", "yi"]);

const LOCALE_CODES: readonly string[] = LOCALES.map((locale) => locale.code);

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && LOCALE_CODES.includes(value);
}

export function getLocaleDefinition(locale: Locale): LocaleDefinition {
  return LOCALES.find((definition) => definition.code === locale) ?? LOCALES[0];
}

export function textDirection(languageTag: string): TextDirection {
  const primary = languageTag.trim().toLowerCase().split(/[-_]/)[0];
  return RTL_LANGUAGES.has(primary) ? "rtl" : "ltr";
}

/**
 * Maps a language tag such as "bn-BD" or "EN_gb" onto a supported locale: exact code first, then
 * the primary language subtag. Returns null when nothing matches.
 */
export function matchLocale(languageTag: unknown): Locale | null {
  if (typeof languageTag !== "string") return null;
  const normalized = languageTag.trim().toLowerCase().replace(/_/g, "-");
  if (!normalized) return null;
  if (isLocale(normalized)) return normalized;
  const primary = normalized.split("-")[0];
  return isLocale(primary) ? primary : null;
}

export interface LocaleInputs {
  /** The viewer's explicit choice from localStorage (null/absent = automatic). */
  stored?: unknown;
  /** The tournament's public language, applied on public pages and private portals only. */
  tournamentDefault?: unknown;
  /** `navigator.languages`, most preferred first. */
  browserLanguages?: readonly string[];
}

/**
 * Picks the UI language. Precedence: the viewer's explicit choice, then the organiser's public
 * language for this tournament (participants' browsers are often left in English even when the
 * tournament runs in another language), then the browser's preferences, then English.
 */
export function resolveLocale({ stored, tournamentDefault, browserLanguages = [] }: LocaleInputs): Locale {
  const explicit = isLocale(stored) ? stored : null;
  if (explicit) return explicit;
  const tournament = matchLocale(tournamentDefault);
  if (tournament) return tournament;
  for (const language of browserLanguages) {
    const match = matchLocale(language);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

/**
 * Inline script for the root layout: sets `<html lang dir>` from the saved choice or the browser
 * before first paint, so a right-to-left page never renders mirrored-wrong for a frame. The React
 * provider takes over after hydration (and also applies a tournament's public language).
 */
export const localeInitScript = `(function(){try{var s=${JSON.stringify(LOCALE_CODES)},r=${JSON.stringify(
  Array.from(RTL_LANGUAGES)
)},p=null;try{p=localStorage.getItem(${JSON.stringify(
  LOCALE_STORAGE_KEY
)})}catch(e){}function m(t){if(typeof t!=="string")return null;t=t.toLowerCase().replace(/_/g,"-");if(s.indexOf(t)>=0)return t;t=t.split("-")[0];return s.indexOf(t)>=0?t:null}var l=s.indexOf(p)>=0?p:null;if(!l){var n=navigator.languages||[navigator.language];for(var i=0;i<n.length&&!l;i++)l=m(n[i])}l=l||${JSON.stringify(
  DEFAULT_LOCALE
)};var h=document.documentElement;h.lang=l;h.dir=r.indexOf(l.split("-")[0])>=0?"rtl":"ltr"}catch(e){}})();`;

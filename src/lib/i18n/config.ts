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

// English first, then every language Tabbycat v2.12.1 offers (settings.LANGUAGES), by code.
export const LOCALES = [
  { code: "en", nativeName: "English", englishName: "English", intlLocale: "en" },
  { code: "ar", nativeName: "العربية", englishName: "Arabic", intlLocale: "ar-u-nu-latn", machineDrafted: true },
  { code: "ast", nativeName: "Asturianu", englishName: "Asturian", intlLocale: "ast", machineDrafted: true },
  { code: "bn", nativeName: "বাংলা", englishName: "Bengali", intlLocale: "bn-u-nu-latn", machineDrafted: true },
  { code: "bg", nativeName: "Български", englishName: "Bulgarian", intlLocale: "bg", machineDrafted: true },
  { code: "ca", nativeName: "Català", englishName: "Catalan", intlLocale: "ca", machineDrafted: true },
  { code: "cs", nativeName: "Čeština", englishName: "Czech", intlLocale: "cs", machineDrafted: true },
  { code: "de", nativeName: "Deutsch", englishName: "German", intlLocale: "de", machineDrafted: true },
  { code: "el", nativeName: "Ελληνικά", englishName: "Greek", intlLocale: "el", machineDrafted: true },
  { code: "es", nativeName: "Español", englishName: "Spanish", intlLocale: "es", machineDrafted: true },
  { code: "fr", nativeName: "Français", englishName: "French", intlLocale: "fr", machineDrafted: true },
  { code: "he", nativeName: "עברית", englishName: "Hebrew", intlLocale: "he", machineDrafted: true },
  { code: "hi", nativeName: "हिन्दी", englishName: "Hindi", intlLocale: "hi-u-nu-latn", machineDrafted: true },
  { code: "id", nativeName: "Bahasa Indonesia", englishName: "Indonesian", intlLocale: "id", machineDrafted: true },
  { code: "it", nativeName: "Italiano", englishName: "Italian", intlLocale: "it", machineDrafted: true },
  { code: "ja", nativeName: "日本語", englishName: "Japanese", intlLocale: "ja", machineDrafted: true },
  { code: "kk", nativeName: "Қазақ тілі", englishName: "Kazakh", intlLocale: "kk", machineDrafted: true },
  { code: "ms", nativeName: "Bahasa Melayu", englishName: "Malay", intlLocale: "ms", machineDrafted: true },
  { code: "pt", nativeName: "Português", englishName: "Portuguese", intlLocale: "pt", machineDrafted: true },
  { code: "ro", nativeName: "Română", englishName: "Romanian", intlLocale: "ro", machineDrafted: true },
  { code: "ru", nativeName: "Русский", englishName: "Russian", intlLocale: "ru", machineDrafted: true },
  { code: "sk", nativeName: "Slovenčina", englishName: "Slovak", intlLocale: "sk", machineDrafted: true },
  { code: "tr", nativeName: "Türkçe", englishName: "Turkish", intlLocale: "tr", machineDrafted: true },
  { code: "uk", nativeName: "Українська", englishName: "Ukrainian", intlLocale: "uk", machineDrafted: true },
  { code: "vi", nativeName: "Tiếng Việt", englishName: "Vietnamese", intlLocale: "vi", machineDrafted: true },
  { code: "zh-Hans", nativeName: "简体中文", englishName: "Simplified Chinese", intlLocale: "zh-Hans", machineDrafted: true },
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
 * Lower-cased language tags mapped to a locale, or to null where a more general tag must not match:
 * Traditional Chinese readers should get English rather than the Simplified catalogue.
 */
const TAG_TABLE: Record<string, Locale | null> = {
  ...Object.fromEntries(LOCALE_CODES.map((code) => [code.toLowerCase(), code])),
  zh: "zh-Hans",
  "zh-cn": "zh-Hans",
  "zh-sg": "zh-Hans",
  "zh-my": "zh-Hans",
  "zh-hant": null,
  "zh-tw": null,
  "zh-hk": null,
  "zh-mo": null,
};

/**
 * Maps a language tag such as "bn-BD", "EN_gb" or "zh-Hans-CN" onto a supported locale, dropping
 * trailing subtags until one matches. Returns null when nothing matches.
 */
export function matchLocale(languageTag: unknown): Locale | null {
  if (typeof languageTag !== "string") return null;
  const subtags = languageTag.trim().toLowerCase().replace(/_/g, "-").split("-");
  for (let length = subtags.length; length > 0; length--) {
    const candidate = subtags.slice(0, length).join("-");
    if (candidate in TAG_TABLE) return TAG_TABLE[candidate];
  }
  return null;
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
export const localeInitScript = `(function(){try{var s=${JSON.stringify(LOCALE_CODES)},a=${JSON.stringify(
  TAG_TABLE
)},r=${JSON.stringify(Array.from(RTL_LANGUAGES))},p=null;try{p=localStorage.getItem(${JSON.stringify(
  LOCALE_STORAGE_KEY
)})}catch(e){}function m(t){if(typeof t!=="string")return null;var u=t.toLowerCase().replace(/_/g,"-").split("-");for(var k=u.length;k>0;k--){var c=u.slice(0,k).join("-");if(Object.prototype.hasOwnProperty.call(a,c))return a[c]}return null}var l=s.indexOf(p)>=0?p:null;if(!l){var n=navigator.languages||[navigator.language];for(var i=0;i<n.length&&!l;i++)l=m(n[i])}l=l||${JSON.stringify(
  DEFAULT_LOCALE
)};var h=document.documentElement;h.lang=l;h.dir=r.indexOf(l.split("-")[0].toLowerCase())>=0?"rtl":"ltr"}catch(e){}})();`;

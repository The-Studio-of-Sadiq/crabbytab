"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  formatDateTime,
  formatDecimal,
  formatList,
  formatNumber,
  formatTime,
  isLocale,
  loadCatalogue,
  loadedCatalogue,
  lookupMessage,
  lookupPluralMessage,
  matchLocale,
  resolveLocale,
  richSegments,
  textDirection,
  translate,
  translatePlural,
  type Locale,
  type MessageKey,
  type MessageValues,
  type PluralKey,
  type RichSegment,
  type TextDirection,
} from "@/lib/i18n";

/** Renders a tagged span of a rich message, e.g. `{ b: (text) => <strong>{text}</strong> }`. */
export type RichTags = Record<string, (text: string) => React.ReactNode>;

interface I18nContextValue {
  locale: Locale;
  dir: TextDirection;
  /** The viewer's explicit choice; null means automatic (tournament or browser language). */
  preference: Locale | null;
  setPreference: (next: Locale | null) => void;
  setTournamentDefault: (value: string | null) => void;
  t: (key: MessageKey, values?: MessageValues) => string;
  plural: (key: PluralKey, count: number, values?: MessageValues) => string;
  rich: (key: MessageKey, tags: RichTags, values?: MessageValues) => React.ReactNode;
  richPlural: (key: PluralKey, count: number, tags: RichTags, values?: MessageValues) => React.ReactNode;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDecimal: (value: number, digits: number) => string;
  formatDateTime: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatTime: (value: Date | string | number) => string;
  formatList: (items: readonly string[]) => string;
}

function renderSegments(segments: RichSegment[], tags: RichTags): React.ReactNode {
  return segments.map((segment, index) => {
    if (typeof segment === "string") return <React.Fragment key={index}>{segment}</React.Fragment>;
    const render = tags[segment.tag];
    return <React.Fragment key={index}>{render ? render(segment.text) : segment.text}</React.Fragment>;
  });
}

function buildValue(
  locale: Locale,
  preference: Locale | null,
  setPreference: (next: Locale | null) => void,
  setTournamentDefault: (value: string | null) => void
): I18nContextValue {
  return {
    locale,
    dir: textDirection(locale),
    preference,
    setPreference,
    setTournamentDefault,
    t: (key, values) => translate(locale, key, values),
    plural: (key, count, values) => translatePlural(locale, key, count, values),
    rich: (key, tags, values) => renderSegments(richSegments(locale, lookupMessage(locale, key), values), tags),
    richPlural: (key, count, tags, values) =>
      renderSegments(richSegments(locale, lookupPluralMessage(locale, key, count), { count, ...values }), tags),
    formatNumber: (value, options) => formatNumber(locale, value, options),
    formatDecimal: (value, digits) => formatDecimal(locale, value, digits),
    formatDateTime: (value, options) => formatDateTime(locale, value, options),
    formatTime: (value) => formatTime(locale, value),
    formatList: (items) => formatList(locale, items),
  };
}

const noop = () => {};
// English without a provider, so a component rendered in isolation still shows text.
const I18nContext = createContext<I18nContextValue>(buildValue(DEFAULT_LOCALE, null, noop, noop));

function readStoredPreference(): Locale | null {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    // Storage can be unavailable (privacy mode); behave as automatic.
    return null;
  }
}

function browserLanguages(): readonly string[] {
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

/**
 * Holds the active UI language. The server and the first client render use English (the server
 * cannot see localStorage), then the saved or detected language applies right after hydration.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<Locale | null>(null);
  const [tournamentDefault, setTournamentDefaultState] = useState<string | null>(null);
  const [languages, setLanguages] = useState<readonly string[]>([]);

  useEffect(() => {
    setPreferenceState(readStoredPreference());
    setLanguages(browserLanguages());
    const handleLanguageChange = () => setLanguages(browserLanguages());
    const handleStorage = (event: StorageEvent) => {
      if (event.key === LOCALE_STORAGE_KEY) setPreferenceState(isLocale(event.newValue) ? event.newValue : null);
    };
    window.addEventListener("languagechange", handleLanguageChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("languagechange", handleLanguageChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const requested = resolveLocale({ stored: preference, tournamentDefault, browserLanguages: languages });
  const locale = useLoadedLocale(requested);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = textDirection(locale);
  }, [locale]);

  const setPreference = useCallback((next: Locale | null) => {
    setPreferenceState(next);
    try {
      if (next) window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
      else window.localStorage.removeItem(LOCALE_STORAGE_KEY);
    } catch {
      // Not persisted when storage is unavailable; the choice still applies to this page view.
    }
  }, []);

  const setTournamentDefault = useCallback((value: string | null) => {
    setTournamentDefaultState(matchLocale(value));
  }, []);

  const value = useMemo(
    () => buildValue(locale, preference, setPreference, setTournamentDefault),
    [locale, preference, setPreference, setTournamentDefault]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * `locale` once its catalogue has loaded. Until then the previous language stays on screen, so a
 * switch never flashes English mid-way. If the catalogue cannot load (offline before its chunk
 * was cached) the language still applies and every message falls back to English.
 */
export function useLoadedLocale(locale: Locale): Locale {
  const [shown, setShown] = useState<Locale>(() => (loadedCatalogue(locale) ? locale : DEFAULT_LOCALE));
  useEffect(() => {
    if (loadedCatalogue(locale)) {
      setShown(locale);
      return;
    }
    let active = true;
    loadCatalogue(locale)
      .catch((error: unknown) => console.warn(`Could not load the ${locale} translation; showing English:`, error))
      .finally(() => {
        if (active) setShown(locale);
      });
    return () => {
      active = false;
    };
  }, [locale]);
  return shown;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

/**
 * Applies a tournament's public language while the calling component is mounted. Used by the
 * tournament shell on public pages and private portals only; staff pages keep the viewer's choice.
 */
export function useTournamentLocale(value: string | null | undefined) {
  const { setTournamentDefault } = useI18n();
  useEffect(() => {
    setTournamentDefault(value ?? null);
    return () => setTournamentDefault(null);
  }, [setTournamentDefault, value]);
}

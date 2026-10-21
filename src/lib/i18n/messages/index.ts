import type { Locale } from "@/lib/i18n/config";
import { en } from "@/lib/i18n/messages/en";

type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other";

/** Every key in the English source catalogue. */
export type MessageKey = keyof typeof en;

/** Base names of plural messages: `public.completedRounds` for `public.completedRounds_other`. */
export type PluralKey = MessageKey extends infer K ? (K extends `${infer Base}_other` ? Base : never) : never;

/**
 * A translation. Keys may be missing (they fall back to English) and may add plural categories
 * English lacks (`_few`, `_many`, …); the catalogue test rejects anything else.
 */
export type Catalogue = Partial<Record<MessageKey | `${PluralKey}_${PluralSuffix}`, string>>;

const json = (module: { default: unknown }) => module.default as Catalogue;

/**
 * English ships in every bundle as the fallback; every other catalogue is a separate chunk loaded
 * when that language is chosen, so 25 translations do not weigh on each page's first load.
 * The machine-drafted catalogues are JSON (see docs/internationalization.md).
 */
const loaders: Record<Exclude<Locale, "en">, () => Promise<Catalogue>> = {
  bn: () => import("@/lib/i18n/messages/bn").then((module) => module.bn),
  ar: () => import("@/lib/i18n/messages/locales/ar.json").then(json),
  ast: () => import("@/lib/i18n/messages/locales/ast.json").then(json),
  bg: () => import("@/lib/i18n/messages/locales/bg.json").then(json),
  ca: () => import("@/lib/i18n/messages/locales/ca.json").then(json),
  cs: () => import("@/lib/i18n/messages/locales/cs.json").then(json),
  de: () => import("@/lib/i18n/messages/locales/de.json").then(json),
  el: () => import("@/lib/i18n/messages/locales/el.json").then(json),
  es: () => import("@/lib/i18n/messages/locales/es.json").then(json),
  fr: () => import("@/lib/i18n/messages/locales/fr.json").then(json),
  he: () => import("@/lib/i18n/messages/locales/he.json").then(json),
  hi: () => import("@/lib/i18n/messages/locales/hi.json").then(json),
  id: () => import("@/lib/i18n/messages/locales/id.json").then(json),
  it: () => import("@/lib/i18n/messages/locales/it.json").then(json),
  ja: () => import("@/lib/i18n/messages/locales/ja.json").then(json),
  kk: () => import("@/lib/i18n/messages/locales/kk.json").then(json),
  ms: () => import("@/lib/i18n/messages/locales/ms.json").then(json),
  pt: () => import("@/lib/i18n/messages/locales/pt.json").then(json),
  ro: () => import("@/lib/i18n/messages/locales/ro.json").then(json),
  ru: () => import("@/lib/i18n/messages/locales/ru.json").then(json),
  sk: () => import("@/lib/i18n/messages/locales/sk.json").then(json),
  tr: () => import("@/lib/i18n/messages/locales/tr.json").then(json),
  uk: () => import("@/lib/i18n/messages/locales/uk.json").then(json),
  vi: () => import("@/lib/i18n/messages/locales/vi.json").then(json),
  "zh-Hans": () => import("@/lib/i18n/messages/locales/zh-Hans.json").then(json),
};

const loaded: Partial<Record<Locale, Catalogue>> = { en };
const pending = new Map<Locale, Promise<Catalogue>>();

/** The catalogue for `locale` if it has loaded; undefined until then (lookups fall back to English). */
export function loadedCatalogue(locale: Locale): Catalogue | undefined {
  return loaded[locale];
}

/** Loads `locale`'s catalogue once. A failed load is not cached, so a later call retries it. */
export function loadCatalogue(locale: Locale): Promise<Catalogue> {
  const ready = loaded[locale];
  if (ready) return Promise.resolve(ready);
  let request = pending.get(locale);
  if (!request) {
    request = loaders[locale as Exclude<Locale, "en">]()
      .then((catalogue) => {
        loaded[locale] = catalogue;
        return catalogue;
      })
      .finally(() => pending.delete(locale));
    pending.set(locale, request);
  }
  return request;
}

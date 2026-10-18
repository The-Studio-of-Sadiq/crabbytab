import { describe, expect, it } from "vitest";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { pluralCategories } from "@/lib/i18n/format";
import { catalogues } from "@/lib/i18n/messages";
import { en } from "@/lib/i18n/messages/en";
import { parseRichText } from "@/lib/i18n/translate";

/**
 * Guards every shipped catalogue against drift from the English source: no missing keys, no
 * stray keys, the same placeholders and markup, and every plural form the language needs.
 */

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const sourceKeys = Object.keys(en);
const pluralBases = new Set(sourceKeys.filter((key) => key.endsWith("_other")).map((key) => key.replace(/_other$/, "")));

function placeholders(message: string): string[] {
  return Array.from(message.matchAll(/\{(\w+)\}/g), (match) => match[1]).sort();
}

function tags(message: string): string[] {
  return parseRichText(message)
    .flatMap((segment) => (typeof segment === "string" ? [] : [segment.tag]))
    .sort();
}

/** The English message a translated key should mirror (plural variants mirror English `_other`). */
function sourceFor(key: string): string | undefined {
  const source = (en as Record<string, string>)[key];
  if (source !== undefined) return source;
  const base = key.replace(PLURAL_SUFFIX, "");
  return pluralBases.has(base) ? en[`${base}_other` as keyof typeof en] : undefined;
}

describe("English source catalogue", () => {
  it("defines both English plural forms for every plural message", () => {
    for (const base of pluralBases) {
      expect(en, base).toHaveProperty(`${base}_one`);
    }
  });

  it("has no empty messages", () => {
    for (const [key, message] of Object.entries(en)) expect(message.trim(), key).not.toBe("");
  });
});

describe.each(LOCALES.filter((locale) => locale.code !== "en").map((locale) => locale.code as Locale))(
  "%s catalogue",
  (code) => {
    const catalogue = catalogues[code] as Record<string, string>;

    it("translates every English key", () => {
      const missing = sourceKeys.filter((key) => catalogue[key] === undefined);
      expect(missing).toEqual([]);
    });

    it("has no keys English does not define", () => {
      const unknown = Object.keys(catalogue).filter((key) => sourceFor(key) === undefined);
      expect(unknown).toEqual([]);
    });

    it("provides every plural category the language uses", () => {
      const categories = pluralCategories(code);
      const missing = Array.from(pluralBases).flatMap((base) =>
        categories.filter((category) => catalogue[`${base}_${category}`] === undefined).map((category) => `${base}_${category}`)
      );
      expect(missing).toEqual([]);
    });

    it("keeps the same placeholders and markup as English", () => {
      for (const [key, message] of Object.entries(catalogue)) {
        const source = sourceFor(key);
        if (source === undefined) continue;
        expect(placeholders(message), `${key} placeholders`).toEqual(placeholders(source));
        expect(tags(message), `${key} markup`).toEqual(tags(source));
        expect(message.trim(), key).not.toBe("");
      }
    });
  }
);

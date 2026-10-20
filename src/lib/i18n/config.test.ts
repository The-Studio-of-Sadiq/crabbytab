import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALES,
  isLocale,
  localeInitScript,
  matchLocale,
  resolveLocale,
  textDirection,
} from "@/lib/i18n/config";

describe("matchLocale", () => {
  it("matches exact codes case-insensitively", () => {
    expect(matchLocale("en")).toBe("en");
    expect(matchLocale("BN")).toBe("bn");
    expect(matchLocale("  bn ")).toBe("bn");
  });

  it("falls back to the primary language subtag", () => {
    expect(matchLocale("bn-BD")).toBe("bn");
    expect(matchLocale("en_GB")).toBe("en");
    expect(matchLocale("en-US-u-ca-gregory")).toBe("en");
  });

  it("matches region and script tags for Tabbycat's languages", () => {
    expect(matchLocale("pt-BR")).toBe("pt");
    expect(matchLocale("ar-EG")).toBe("ar");
    expect(matchLocale("zh-Hans")).toBe("zh-Hans");
    expect(matchLocale("ZH_hans_cn")).toBe("zh-Hans");
    expect(matchLocale("zh-CN")).toBe("zh-Hans");
    expect(matchLocale("zh")).toBe("zh-Hans");
  });

  it("does not give Traditional Chinese readers the Simplified catalogue", () => {
    expect(matchLocale("zh-TW")).toBeNull();
    expect(matchLocale("zh-Hant-HK")).toBeNull();
  });

  it("returns null for unsupported or invalid input", () => {
    expect(matchLocale("sw-KE")).toBeNull();
    expect(matchLocale("")).toBeNull();
    expect(matchLocale(null)).toBeNull();
    expect(matchLocale(42)).toBeNull();
  });
});

describe("resolveLocale", () => {
  it("defaults to English with no signals", () => {
    expect(resolveLocale({})).toBe(DEFAULT_LOCALE);
    expect(resolveLocale({ browserLanguages: ["sw", "fi"] })).toBe("en");
  });

  it("uses the first supported browser language", () => {
    expect(resolveLocale({ browserLanguages: ["sw-KE", "bn-BD", "en"] })).toBe("bn");
    expect(resolveLocale({ browserLanguages: ["en-GB", "bn"] })).toBe("en");
  });

  it("prefers the tournament's public language over the browser", () => {
    expect(resolveLocale({ tournamentDefault: "bn", browserLanguages: ["en-US"] })).toBe("bn");
  });

  it("ignores an unsupported tournament language", () => {
    expect(resolveLocale({ tournamentDefault: "sw", browserLanguages: ["bn"] })).toBe("bn");
  });

  it("lets the viewer's explicit choice win over everything", () => {
    expect(resolveLocale({ stored: "en", tournamentDefault: "bn", browserLanguages: ["bn"] })).toBe("en");
  });

  it("treats a corrupt stored value as automatic", () => {
    expect(resolveLocale({ stored: "klingon", browserLanguages: ["bn"] })).toBe("bn");
    expect(resolveLocale({ stored: "bn-BD", browserLanguages: ["en"] })).toBe("en");
  });
});

describe("textDirection", () => {
  it("marks right-to-left scripts", () => {
    expect(textDirection("ar")).toBe("rtl");
    expect(textDirection("he-IL")).toBe("rtl");
    expect(textDirection("ur_PK")).toBe("rtl");
    expect(textDirection("FA")).toBe("rtl");
  });

  it("keeps every other language left-to-right", () => {
    expect(textDirection("en")).toBe("ltr");
    expect(textDirection("bn")).toBe("ltr");
  });
});

describe("LOCALES", () => {
  it("has unique codes, English first, and valid Intl tags", () => {
    const codes = LOCALES.map((locale) => locale.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes[0]).toBe("en");
    for (const locale of LOCALES) {
      expect(isLocale(locale.code)).toBe(true);
      expect(() => new Intl.NumberFormat(locale.intlLocale)).not.toThrow();
    }
  });
});

describe("localeInitScript", () => {
  function run(stored: string | null, languages: string[]) {
    const root = { lang: "", dir: "" };
    const context = {
      localStorage: { getItem: () => stored },
      navigator: { languages, language: languages[0] },
      document: { documentElement: root },
    };
    new Function("localStorage", "navigator", "document", localeInitScript)(
      context.localStorage,
      context.navigator,
      context.document
    );
    return root;
  }

  it("applies the same precedence as resolveLocale before hydration", () => {
    expect(run(null, ["bn-BD"])).toEqual({ lang: "bn", dir: "ltr" });
    expect(run("en", ["bn"])).toEqual({ lang: "en", dir: "ltr" });
    expect(run("nope", ["sw"])).toEqual({ lang: "en", dir: "ltr" });
    expect(run(null, ["he-IL"])).toEqual({ lang: "he", dir: "rtl" });
    expect(run(null, ["zh-CN"])).toEqual({ lang: "zh-Hans", dir: "ltr" });
    expect(run(null, ["zh-TW", "fr"])).toEqual({ lang: "fr", dir: "ltr" });
    expect(run("zh-Hans", ["en"])).toEqual({ lang: "zh-Hans", dir: "ltr" });
  });
});

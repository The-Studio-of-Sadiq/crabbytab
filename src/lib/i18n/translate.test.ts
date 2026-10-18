import { describe, expect, it } from "vitest";
import { catalogues } from "@/lib/i18n/messages";
import {
  createTranslator,
  interpolate,
  lookupMessage,
  parseRichText,
  richSegments,
  translate,
  translatePlural,
} from "@/lib/i18n/translate";
import { formatDateTime, formatDecimal, formatList, formatNumber } from "@/lib/i18n/format";

describe("translate", () => {
  it("returns the locale's own message", () => {
    expect(translate("en", "common.cancel")).toBe("Cancel");
    expect(translate("bn", "common.cancel")).toBe(catalogues.bn["common.cancel"]);
  });

  it("fills placeholders and leaves unknown ones visible", () => {
    expect(translate("en", "checkIn.title", { round: "Round 3" })).toBe("Check in for Round 3");
    expect(interpolate("en", "Hello {name} and {other}", { name: "Ada" })).toBe("Hello Ada and {other}");
  });

  it("formats numeric values for the locale", () => {
    expect(translate("en", "public.tab.motions", { count: 1200 })).toBe("Motions (1,200)");
  });

  it("falls back to English for a key a catalogue lacks, then to the key", () => {
    const bn = catalogues.bn as Record<string, string>;
    const saved = bn["common.close"];
    delete bn["common.close"];
    try {
      expect(lookupMessage("bn", "common.close")).toBe("Close");
    } finally {
      bn["common.close"] = saved;
    }
    expect(lookupMessage("en", "does.not.exist")).toBe("does.not.exist");
  });
});

describe("translatePlural", () => {
  it("picks the English plural category", () => {
    expect(translatePlural("en", "portal.showing", 1)).toBe("Showing 1 debate");
    expect(translatePlural("en", "portal.showing", 0)).toBe("Showing 0 debates");
    expect(translatePlural("en", "portal.showing", 2)).toBe("Showing 2 debates");
  });

  it("passes extra values alongside count", () => {
    expect(translatePlural("en", "publicAudit.snapshot", 3, { time: "noon" })).toBe(
      "Snapshot released noon · 3 events"
    );
  });

  it("uses the locale's own other form before English when a category is missing", () => {
    const bn = catalogues.bn as Record<string, string>;
    const saved = bn["portal.showing_one"];
    delete bn["portal.showing_one"];
    try {
      expect(translatePlural("bn", "portal.showing", 1)).toBe(interpolate("bn", bn["portal.showing_other"], { count: 1 }));
    } finally {
      bn["portal.showing_one"] = saved;
    }
  });
});

describe("rich text", () => {
  it("splits tagged spans out of a message", () => {
    expect(parseRichText("Use <b>this</b> portal to <b>vote</b>.")).toEqual([
      "Use ",
      { tag: "b", text: "this" },
      " portal to ",
      { tag: "b", text: "vote" },
      ".",
    ]);
    expect(parseRichText("plain")).toEqual(["plain"]);
  });

  it("keeps markup inside values as literal text", () => {
    expect(richSegments("en", "<n>{count}</n> wins for {team}", { count: 2, team: "<b>Evil</b>" })).toEqual([
      { tag: "n", text: "2" },
      " wins for <b>Evil</b>",
    ]);
  });
});

describe("createTranslator", () => {
  it("binds the locale", () => {
    const { t, plural, locale } = createTranslator("en");
    expect(locale).toBe("en");
    expect(t("common.tba")).toBe("TBA");
    expect(plural("motionStats.resultsFrom", 1)).toBe("Results from 1 released debate");
  });
});

describe("formatting", () => {
  it("formats numbers and fixed decimals per locale", () => {
    expect(formatNumber("en", 1234.5)).toBe("1,234.5");
    expect(formatDecimal("en", 75.125, 2)).toBe("75.13");
    expect(formatDecimal("en", 150, 1)).toBe("150.0");
    // Bengali keeps Latin digits (configured via -u-nu-latn) so scores match paper ballots.
    expect(formatDecimal("bn", 75.5, 1)).toBe("75.5");
  });

  it("joins lists the way the language does", () => {
    expect(formatList("en", ["A", "B", "C"])).toBe("A, B, and C");
    expect(formatList("en", [])).toBe("");
  });

  it("returns an empty string for invalid dates", () => {
    expect(formatDateTime("en", "not a date")).toBe("");
    expect(formatDateTime("en", "2026-01-02T03:04:05Z", { timeZone: "UTC", dateStyle: "short" })).toBe("1/2/26");
  });
});

import { describe, it, expect } from "vitest";
import {
  validateSlug,
  slugify,
  eliminationRoundCount,
  isPowerOfTwo,
  eliminationRoundLabels,
} from "./presets";

describe("Setup Presets (setup/presets)", () => {
  describe("slugify", () => {
    it("converts strings to clean url slugs", () => {
      expect(slugify("Australasian Debating Championship 2026")).toBe(
        "australasian-debating-championship-2026"
      );
      expect(slugify("  Hello   World! 123  ")).toBe("hello-world-123");
      expect(slugify("---special---chars---")).toBe("special-chars");
    });
  });

  describe("validateSlug", () => {
    it("validates valid slugs", () => {
      expect(validateSlug("wudc-2026")).toBe("");
      expect(validateSlug("australs26")).toBe("");
      expect(validateSlug("round-1")).toBe("");
    });

    it("rejects too short or too long slugs", () => {
      expect(validateSlug("ab")).toBe("The URL slug must be at least 3 characters.");
      expect(validateSlug("a".repeat(41))).toBe("The URL slug must be 40 characters or fewer.");
    });

    it("rejects invalid characters or uppercase", () => {
      expect(validateSlug("WUDC-2026")).toBe("Use only lowercase letters, numbers and single hyphens.");
      expect(validateSlug("wudc_2026")).toBe("Use only lowercase letters, numbers and single hyphens.");
      expect(validateSlug("wudc--2026")).toBe("Use only lowercase letters, numbers and single hyphens.");
    });

    it("rejects reserved slugs", () => {
      expect(validateSlug("login")).toBe('"login" is reserved. Please choose another slug.');
      expect(validateSlug("tournaments")).toBe('"tournaments" is reserved. Please choose another slug.');
      expect(validateSlug("wudc-demo")).toBe('"wudc-demo" is reserved. Please choose another slug.');
    });
  });

  describe("isPowerOfTwo", () => {
    it("identifies powers of two correctly", () => {
      expect(isPowerOfTwo(1)).toBe(true);
      expect(isPowerOfTwo(2)).toBe(true);
      expect(isPowerOfTwo(4)).toBe(true);
      expect(isPowerOfTwo(8)).toBe(true);
      expect(isPowerOfTwo(16)).toBe(true);
      expect(isPowerOfTwo(32)).toBe(true);
      expect(isPowerOfTwo(64)).toBe(true);

      expect(isPowerOfTwo(0)).toBe(false);
      expect(isPowerOfTwo(-4)).toBe(false);
      expect(isPowerOfTwo(3)).toBe(false);
      expect(isPowerOfTwo(6)).toBe(false);
      expect(isPowerOfTwo(12)).toBe(false);
    });
  });

  describe("eliminationRoundCount", () => {
    it("calculates elimination round counts for BP (teamsPerDebate = 4)", () => {
      // In BP, 4 teams = 1 round (Grand Final)
      // 8 teams = 2 rounds (SF, GF)
      // 16 teams = 3 rounds (QF, SF, GF)
      // 32 teams = 4 rounds (OF, QF, SF, GF)
      expect(eliminationRoundCount(4, 4)).toBe(1);
      expect(eliminationRoundCount(8, 4)).toBe(2);
      expect(eliminationRoundCount(16, 4)).toBe(3);
      expect(eliminationRoundCount(32, 4)).toBe(4);
      expect(eliminationRoundCount(2, 4)).toBe(0); // < 4 teams cannot form a BP room
    });

    it("calculates elimination round counts for Two-Team (teamsPerDebate = 2)", () => {
      // In 2-team, 2 teams = 1 round (GF)
      // 4 teams = 2 rounds (SF, GF)
      // 8 teams = 3 rounds (QF, SF, GF)
      // 16 teams = 4 rounds (OF, QF, SF, GF)
      expect(eliminationRoundCount(2, 2)).toBe(1);
      expect(eliminationRoundCount(4, 2)).toBe(2);
      expect(eliminationRoundCount(8, 2)).toBe(3);
      expect(eliminationRoundCount(16, 2)).toBe(4);
    });
  });

  describe("eliminationRoundLabels", () => {
    it("returns correct round names in chronological order", () => {
      const labels = eliminationRoundLabels(3);
      expect(labels).toEqual([
        { name: "Quarterfinals", abbr: "QF" },
        { name: "Semifinals", abbr: "SF" },
        { name: "Grand Final", abbr: "GF" },
      ]);
    });
  });
});

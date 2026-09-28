import { describe, it, expect } from "vitest";
import {
  validateSpeakerScore,
  validateReplyScore,
  validateFeedbackScore,
} from "./validator";

describe("Scoring Validator (scoring/validator)", () => {
  describe("validateSpeakerScore", () => {
    const prefs = {
      minSpeakerScore: 68,
      maxSpeakerScore: 84,
      stepSpeakerScore: 1,
    };

    it("accepts valid scores within bounds matching step", () => {
      expect(validateSpeakerScore(68, prefs).valid).toBe(true);
      expect(validateSpeakerScore(75, prefs).valid).toBe(true);
      expect(validateSpeakerScore(84, prefs).valid).toBe(true);
    });

    it("rejects scores below minSpeakerScore or above maxSpeakerScore", () => {
      const low = validateSpeakerScore(67, prefs);
      expect(low.valid).toBe(false);
      expect(low.error).toContain("between 68 and 84");

      const high = validateSpeakerScore(85, prefs);
      expect(high.valid).toBe(false);
      expect(high.error).toContain("between 68 and 84");
    });

    it("rejects non-step increments", () => {
      const res = validateSpeakerScore(74.5, prefs);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("multiple of 1");
    });

    it("supports half-point step increments (stepSpeakerScore: 0.5)", () => {
      const halfPrefs = {
        minSpeakerScore: 65,
        maxSpeakerScore: 85,
        stepSpeakerScore: 0.5,
      };
      expect(validateSpeakerScore(74.5, halfPrefs).valid).toBe(true);
      expect(validateSpeakerScore(75.0, halfPrefs).valid).toBe(true);
      expect(validateSpeakerScore(74.25, halfPrefs).valid).toBe(false);
    });
  });

  describe("validateReplyScore", () => {
    const prefs = {
      minReplyScore: 34,
      maxReplyScore: 42,
      stepSpeakerScore: 1, // reply step is 0.5
    };

    it("accepts valid reply scores", () => {
      expect(validateReplyScore(34, prefs).valid).toBe(true);
      expect(validateReplyScore(37.5, prefs).valid).toBe(true);
      expect(validateReplyScore(42, prefs).valid).toBe(true);
    });

    it("rejects reply scores out of bounds", () => {
      expect(validateReplyScore(33.5, prefs).valid).toBe(false);
      expect(validateReplyScore(42.5, prefs).valid).toBe(false);
    });

    it("rejects invalid step increments", () => {
      expect(validateReplyScore(37.2, prefs).valid).toBe(false);
    });
  });

  describe("validateFeedbackScore", () => {
    const prefs = {
      feedbackMinScore: 1,
      feedbackMaxScore: 10,
    };

    it("validates feedback score within bounds", () => {
      expect(validateFeedbackScore(1, prefs).valid).toBe(true);
      expect(validateFeedbackScore(7, prefs).valid).toBe(true);
      expect(validateFeedbackScore(10, prefs).valid).toBe(true);
      expect(validateFeedbackScore(0, prefs).valid).toBe(false);
      expect(validateFeedbackScore(11, prefs).valid).toBe(false);
    });
  });
});

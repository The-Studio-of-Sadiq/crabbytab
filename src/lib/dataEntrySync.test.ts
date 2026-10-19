import { describe, expect, it } from "vitest";
import type { Debate } from "@/types";
import {
  canAssistantOverwriteBallot,
  nextAssistantResultStatus,
  prepareAssistantBallot,
  redactAssistantDebate,
  sanitizeDataEntryRecord,
  validateAssistantFeedback,
} from "./dataEntrySync";

const debate = {
  id: "d1",
  tournamentId: "t1",
  roundId: "r1",
  roundSeq: 1,
  bracket: 0,
  roomRank: 1,
  importance: 0,
  resultStatus: "none",
  sidesConfirmed: true,
  flags: [],
  teams: {
    AFF: { teamId: "team-a", teamName: "A", side: "AFF" },
    NEG: { teamId: "team-b", teamName: "B", side: "NEG" },
  },
  adjudicators: {
    chairId: "chair",
    panellistIds: ["wing"],
    panellistNames: ["Wing"],
    traineeIds: [],
    traineeNames: [],
  },
} as unknown as Debate;

const actor = { uid: "assistant-uid", name: "Assistant" };

function ballotInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "ballot-d1-v1",
    tournamentId: "t1",
    roundId: "r1",
    debateId: "d1",
    version: 2,
    speakerScores: {
      AFF: [{ speakerId: "s1", speakerName: "S1", position: 1, score: 75 }],
      NEG: [{ speakerId: "s2", speakerName: "S2", position: 1, score: 74 }],
    },
    teamScores: {
      AFF: { side: "AFF", teamId: "team-a", points: 1, totalSpeakerScore: 75, rank: 1 },
      NEG: { side: "NEG", teamId: "team-b", points: 0, totalSpeakerScore: 74, rank: 2 },
    },
    timestamp: "now",
    ...overrides,
  };
}

describe("sanitizeDataEntryRecord", () => {
  it("drops break, seed and confirmation fields from teams", () => {
    const { record, createOnly } = sanitizeDataEntryRecord("teams", {
      id: "team-a",
      tournamentId: "t1",
      name: "A",
      breakStatus: "breaking",
      breakCategoryIds: ["open"],
      seed: 1,
      checkedIn: true,
      breakCategories: ["novice"],
      speakers: [{ id: "s1", name: "S1", email: "s1@example.com" }],
    }, "t1");
    expect(record).toEqual({
      id: "team-a",
      tournamentId: "t1",
      name: "A",
      checkedIn: true,
      speakers: [{ id: "s1", name: "S1" }],
    });
    expect(createOnly).toEqual({ breakCategories: ["novice"] });
  });

  it("keeps adjudicator scores and email out of updates", () => {
    const { record, createOnly } = sanitizeDataEntryRecord("adjudicators", {
      id: "adj",
      tournamentId: "t1",
      name: "Adj",
      email: "adj@example.com",
      baseScore: 9,
      testScore: 8,
      checkedIn: true,
    }, "t1");
    expect(record).toEqual({ id: "adj", tournamentId: "t1", name: "Adj", checkedIn: true });
    expect(createOnly).toEqual({ baseScore: 9, testScore: 8 });
    expect(() => sanitizeDataEntryRecord("adjudicators", {
      id: "adj", tournamentId: "t1", baseScore: "9",
    }, "t1")).toThrow();
  });

  it("strips confirmation and submitter fields from ballots", () => {
    const { record } = sanitizeDataEntryRecord("ballots", {
      ...ballotInput(),
      confirmed: true,
      discarded: true,
      submitterId: "someone-else",
      submitterType: "judge",
      confirmedBy: "director",
    }, "t1");
    expect(record).not.toHaveProperty("confirmed");
    expect(record).not.toHaveProperty("submitterId");
    expect(record).not.toHaveProperty("confirmedBy");
  });

  it("keeps only sheet fields of ballot receipts; the server stamps who received them", () => {
    const { record } = sanitizeDataEntryRecord("ballotIntake", {
      id: "intake-ABCDEFGH",
      tournamentId: "t1",
      roundId: "r1",
      debateId: "d1",
      sheetCode: "ABCDEFGH",
      adjudicatorId: "chair",
      receivedAt: "2026-10-19T10:00:00.000Z",
      receivedBy: "spoofed",
      receivedByName: "Someone else",
    }, "t1");
    expect(record).toEqual({
      id: "intake-ABCDEFGH",
      tournamentId: "t1",
      roundId: "r1",
      debateId: "d1",
      sheetCode: "ABCDEFGH",
      adjudicatorId: "chair",
      receivedAt: "2026-10-19T10:00:00.000Z",
    });
  });

  it("rejects records for another tournament", () => {
    expect(() => sanitizeDataEntryRecord("teams", { id: "x", tournamentId: "other" }, "t1")).toThrow();
  });
});

describe("prepareAssistantBallot", () => {
  it("stamps an unconfirmed tab-room ballot from the signed-in assistant", () => {
    const ballot = prepareAssistantBallot(
      { ...ballotInput(), confirmed: true, submitterId: "spoofed" },
      { debate, actor }
    );
    expect(ballot).toMatchObject({
      id: "ballot-d1-v1",
      version: 2,
      confirmed: false,
      discarded: false,
      submitterType: "tabroom",
      submitterId: "assistant-uid",
      submitterName: "Assistant",
      chairId: "chair",
    });
  });

  it("rejects ballots for missing or deleted debates", () => {
    expect(() => prepareAssistantBallot(ballotInput(), { debate: undefined, actor })).toThrow(/does not exist/);
    expect(() => prepareAssistantBallot(ballotInput(), {
      debate: { ...debate, deletedAt: "yesterday" },
      actor,
    })).toThrow(/does not exist/);
    expect(() => prepareAssistantBallot(ballotInput({ roundId: "r2" }), { debate, actor })).toThrow(/round/);
  });

  it("validates team results and speaker scores", () => {
    expect(() => prepareAssistantBallot(ballotInput({
      teamScores: { AFF: { teamId: "team-a", points: 1, rank: 1 } },
    }), { debate, actor })).toThrow(/every debate side/);
    expect(() => prepareAssistantBallot(ballotInput({
      teamScores: {
        AFF: { teamId: "team-x", points: 1, rank: 1 },
        NEG: { teamId: "team-b", points: 0, rank: 2 },
      },
    }), { debate, actor })).toThrow(/team result/);
    expect(() => prepareAssistantBallot(ballotInput({
      teamScores: {
        AFF: { teamId: "team-a", points: 1, rank: 1 },
        NEG: { teamId: "team-b", points: 0, rank: 1 },
      },
    }), { debate, actor })).toThrow(/team result/);
    expect(() => prepareAssistantBallot(ballotInput({
      speakerScores: {
        AFF: [{ speakerId: "s1", position: 1, score: 200 }],
        NEG: [],
      },
    }), { debate, actor })).toThrow(/between/);
  });

  it("applies reply score rules to position 4 when replies are enabled", () => {
    const withReply = ballotInput({
      speakerScores: {
        AFF: [{ speakerId: "reply-AFF", position: 4, score: 37.5 }],
        NEG: [],
      },
    });
    expect(() => prepareAssistantBallot(withReply, { debate, actor })).toThrow();
    expect(() => prepareAssistantBallot(withReply, {
      debate,
      actor,
      preferences: { replyScoresEnabled: true },
    })).not.toThrow();
  });
});

describe("canAssistantOverwriteBallot", () => {
  it("only allows the assistant's own unconfirmed ballots", () => {
    expect(canAssistantOverwriteBallot({ submitterId: "assistant-uid", confirmed: false }, "assistant-uid")).toBe(true);
    expect(canAssistantOverwriteBallot({ submitterId: "assistant-uid", confirmed: true }, "assistant-uid")).toBe(false);
    expect(canAssistantOverwriteBallot({ submitterId: "assistant-uid", discarded: true }, "assistant-uid")).toBe(false);
    expect(canAssistantOverwriteBallot({ submitterId: "chair", confirmed: false }, "assistant-uid")).toBe(false);
  });
});

describe("validateAssistantFeedback", () => {
  const feedback = {
    id: "fb",
    debateId: "d1",
    roundId: "r1",
    sourceType: "team",
    sourceId: "team-a",
    targetType: "adjudicator",
    targetAdjudicatorId: "chair",
    score: 4,
  };

  it("accepts feedback between participants of the debate", () => {
    expect(() => validateAssistantFeedback(feedback, debate)).not.toThrow();
    expect(() => validateAssistantFeedback({
      ...feedback,
      sourceType: "adjudicator",
      sourceId: "chair",
      targetType: "team",
      targetTeamId: "team-b",
    }, debate)).not.toThrow();
  });

  it("rejects spoofed sources, foreign targets and bad scores", () => {
    expect(() => validateAssistantFeedback({ ...feedback, sourceId: "team-z" }, debate)).toThrow(/participants/);
    expect(() => validateAssistantFeedback({ ...feedback, targetAdjudicatorId: "stranger" }, debate)).toThrow(/participants/);
    expect(() => validateAssistantFeedback({ ...feedback, score: 99 }, debate)).toThrow(/score/);
    expect(() => validateAssistantFeedback(feedback, undefined)).toThrow(/does not exist/);
  });
});

describe("nextAssistantResultStatus", () => {
  it("only moves a debate from none to draft", () => {
    expect(nextAssistantResultStatus("none", "draft")).toBe("draft");
    expect(nextAssistantResultStatus("none", "confirmed")).toBe("draft");
    expect(nextAssistantResultStatus(undefined, "confirmed")).toBe("draft");
    expect(nextAssistantResultStatus("confirmed", "none")).toBe("confirmed");
    expect(nextAssistantResultStatus("draft", "none")).toBe("draft");
    expect(nextAssistantResultStatus("none", "none")).toBe("none");
  });
});

describe("redactAssistantDebate", () => {
  const raw = { ...debate, motionId: "m1", motionText: "THW test" } as unknown as Record<string, unknown>;

  it("hides unrevealed panels and unreleased motions", () => {
    const redacted = redactAssistantDebate(raw, { adjudicatorsRevealed: false, motionsReleased: false });
    expect(redacted.adjudicators).toEqual({ panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] });
    expect(redacted).not.toHaveProperty("motionText");
    expect(redacted).not.toHaveProperty("motionId");
  });

  it("shows revealed panels and released motions", () => {
    const shown = redactAssistantDebate(raw, { adjudicatorsRevealed: true, motionsReleased: true });
    expect(shown.adjudicators).toEqual(debate.adjudicators);
    expect(shown.motionText).toBe("THW test");
  });
});

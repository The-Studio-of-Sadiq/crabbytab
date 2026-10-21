import { describe, expect, it } from "vitest";
import type { Debate, Round } from "@/types";
import {
  buildPublicFeedback,
  buildPublicFormsDirectory,
  isPublicFormEnabled,
  publicBallotRound,
  publicFeedbackOptions,
  PublicFormError,
  publicFormsRequirePassword,
  selectPublicBallotDebate,
} from "@/lib/publicForms";
import {
  hashPublicFormsPassword,
  hasPublicFormsPassword,
  publicFormsPasswordError,
  verifyPublicFormsPassword,
} from "@/lib/publicFormsPassword";
import { createPublicNamer } from "@/lib/publicView/names";
import { getPublicSiteSettings } from "@/lib/publicFeatures";

function round(id: string, seq: number, extra: Partial<Round> = {}): Round {
  return { id, tournamentId: "t1", seq, name: `Round ${seq}`, stage: "preliminary", drawStatus: "released", ...extra } as Round;
}

function debate(id: string, roundId: string, extra: Partial<Debate> = {}): Debate {
  return {
    id,
    tournamentId: "t1",
    roundId,
    roundSeq: 1,
    bracket: 0,
    roomRank: 0,
    importance: 0,
    resultStatus: "none",
    flags: [],
    venueName: "Room A",
    teams: {
      AFF: { side: "AFF", teamId: "aff", teamName: "Aff" },
      NEG: { side: "NEG", teamId: "neg", teamName: "Neg" },
    },
    adjudicators: {
      chairId: "chair",
      chairName: "Chair",
      panellistIds: ["panel"],
      panellistNames: ["Panel"],
      traineeIds: ["trainee"],
      traineeNames: ["Trainee"],
    },
    ...extra,
  } as Debate;
}

describe("public form mode gating", () => {
  it("is off unless switched on, and feedback also needs feedback enabled", () => {
    expect(isPublicFormEnabled(undefined, "ballot")).toBe(false);
    expect(isPublicFormEnabled({}, "feedback")).toBe(false);
    expect(isPublicFormEnabled({ publicBallotForm: true }, "ballot")).toBe(true);
    expect(isPublicFormEnabled({ publicBallotForm: true }, "feedback")).toBe(false);
    expect(isPublicFormEnabled({ publicFeedbackForm: true }, "feedback")).toBe(true);
    expect(isPublicFormEnabled({ publicFeedbackForm: true, feedbackEnabled: false }, "feedback")).toBe(false);
    expect(publicFormsRequirePassword({})).toBe(false);
    expect(publicFormsRequirePassword({ publicFormsUsePassword: true })).toBe(true);
  });
});

describe("public form password", () => {
  it("stores only a salted hash and checks it in constant time", () => {
    const stored = hashPublicFormsPassword("debate2026");
    expect(JSON.stringify(stored)).not.toContain("debate2026");
    expect(hasPublicFormsPassword(stored)).toBe(true);
    expect(verifyPublicFormsPassword(stored, "debate2026")).toBe(true);
    expect(verifyPublicFormsPassword(stored, "Debate2026")).toBe(false);
    expect(verifyPublicFormsPassword(stored, "")).toBe(false);
    expect(verifyPublicFormsPassword(stored, undefined)).toBe(false);
    // Two hashes of one password differ (random salt).
    expect(hashPublicFormsPassword("debate2026").hash).not.toBe(stored.hash);
  });

  it("never matches when no valid hash is stored", () => {
    expect(verifyPublicFormsPassword(undefined, "anything")).toBe(false);
    expect(verifyPublicFormsPassword({ algorithm: "scrypt", salt: "x", hash: "short" }, "anything")).toBe(false);
    expect(hasPublicFormsPassword(null)).toBe(false);
  });

  it("checks the length of new passwords", () => {
    expect(publicFormsPasswordError("abc")).toMatch(/at least/);
    expect(publicFormsPasswordError("x".repeat(129))).toMatch(/at most/);
    expect(publicFormsPasswordError(42)).not.toBeNull();
    expect(publicFormsPasswordError("good pass")).toBeNull();
  });
});

describe("selectPublicBallotDebate", () => {
  const open = round("r2", 2);
  const debates = [debate("d1", "r1"), debate("d2", "r2")];

  it("finds the adjudicator's debate in the open round", () => {
    expect(selectPublicBallotDebate({ round: open, roundHasMotions: false, adjudicator: { id: "panel" }, debates }).id).toBe("d2");
  });

  it("refuses with Tabbycat's reasons", () => {
    const attempt = (input: Partial<Parameters<typeof selectPublicBallotDebate>[0]>) => () =>
      selectPublicBallotDebate({ round: open, roundHasMotions: false, adjudicator: { id: "chair" }, debates, ...input });
    expect(attempt({ round: undefined })).toThrow(/No round/);
    expect(attempt({ round: round("r2", 2, { drawStatus: "draft" }) })).toThrow(/draw/);
    expect(attempt({ roundHasMotions: true })).toThrow(/motions/);
    expect(attempt({ round: round("r2", 2, { motionsReleased: true }), roundHasMotions: true })).not.toThrow();
    expect(attempt({ adjudicator: { id: "nobody" } })).toThrow(/don't have a debate/);
    expect(attempt({ debates: [debate("d2", "r2"), debate("d3", "r2")] })).toThrow(/two or more/);
    expect(attempt({ adjudicator: { id: "trainee" } })).toThrow(/voting panellist/);
    expect(attempt({ adjudicator: { id: "panel", trainee: true } })).toThrow(PublicFormError);
    expect(attempt({
      adjudicator: { id: "panel" },
      debates: [debate("d2", "r2", { adjudicators: { panellistIds: ["panel"], panellistNames: [], traineeIds: [], traineeNames: [] } })],
    })).toThrow(/doesn't have a chair/);
  });

  it("uses the explicit current round when the tab room set one", () => {
    const rounds = [round("r1", 1), round("r2", 2)];
    expect(publicBallotRound(rounds)?.id).toBe("r2");
    expect(publicBallotRound(rounds, "r1")?.id).toBe("r1");
  });
});

describe("buildPublicFormsDirectory", () => {
  const teams = [{ id: "aff", name: "Aff" }, { id: "neg", name: "Neg" }];
  const adjudicators = [
    { id: "chair", name: "Zed Chair" },
    { id: "panel", name: "Ann Panel" },
    { id: "trainee", name: "Tia Trainee" },
  ];
  const namer = (preferences = {}) => createPublicNamer(teams as never, adjudicators as never, getPublicSiteSettings(preferences));
  const base = {
    rounds: [round("r1", 1)],
    debates: [debate("d1", "r1")],
    teams,
    adjudicators,
    motions: [],
  };

  it("is absent while both forms are off", () => {
    expect(buildPublicFormsDirectory({ ...base, preferences: {}, namer: namer(), revealedRoundIds: new Set() })).toBeUndefined();
  });

  it("lists the open round's voting adjudicators, with rooms only once panels are public", () => {
    const hidden = buildPublicFormsDirectory({ ...base, preferences: { publicBallotForm: true }, namer: namer(), revealedRoundIds: new Set() });
    expect(hidden?.ballot).toEqual({
      roundId: "r1",
      roundName: "Round 1",
      adjudicators: [{ id: "panel", name: "Ann Panel" }, { id: "chair", name: "Zed Chair" }],
    });
    expect(hidden?.feedback).toBeUndefined();
    const revealed = buildPublicFormsDirectory({ ...base, preferences: { publicBallotForm: true }, namer: namer(), revealedRoundIds: new Set(["r1"]) });
    expect(revealed?.ballot?.adjudicators[0]).toEqual({ id: "panel", name: "Ann Panel", venueName: "Room A" });
  });

  it("says why no round takes ballots", () => {
    const motions = [{ rounds: ["r1"] }];
    expect(buildPublicFormsDirectory({ ...base, motions, preferences: { publicBallotForm: true }, namer: namer(), revealedRoundIds: new Set() })?.ballot)
      .toMatchObject({ roundId: "r1", closedReason: "motions_not_released", adjudicators: [] });
    expect(buildPublicFormsDirectory({ ...base, rounds: [], preferences: { publicBallotForm: true }, namer: namer(), revealedRoundIds: new Set() })?.ballot)
      .toMatchObject({ roundId: null, closedReason: "no_round" });
  });

  it("lists every team and adjudicator for feedback, through the public namer, and says whether a password is needed", () => {
    const directory = buildPublicFormsDirectory({
      ...base,
      preferences: { publicFeedbackForm: true, publicFormsUsePassword: true },
      namer: namer(),
      revealedRoundIds: new Set(),
    });
    expect(directory?.usePassword).toBe(true);
    expect(directory?.feedback?.teams.map((team) => team.id)).toEqual(["aff", "neg"]);
    expect(directory?.feedback?.adjudicators.map((adjudicator) => adjudicator.id)).toEqual(["panel", "trainee", "chair"]);
  });
});

describe("public feedback", () => {
  const roundsById = new Map([
    ["r1", round("r1", 1, { adjudicatorsRevealed: true })],
    ["r2", round("r2", 2, { drawStatus: "draft", adjudicatorsRevealed: true })],
  ]);
  const context = {
    preferences: { feedbackMinScore: 1, feedbackMaxScore: 5 },
    debates: [debate("d1", "r1"), debate("d2", "r2")],
    roundsById,
    teamName: (_id: string, drawn: string | undefined) => drawn ?? "",
  };

  it("offers the targets the feedback paths allow, from released draws only", () => {
    const team = publicFeedbackOptions({ ...context, sourceType: "team", sourceId: "aff" });
    expect(team.map((option) => `${option.debateId}:${option.targetType}:${option.targetId}`)).toEqual(["d1:adjudicator:chair"]);
    const chair = publicFeedbackOptions({ ...context, sourceType: "adjudicator", sourceId: "chair" });
    expect(chair.some((option) => option.targetId === "chair")).toBe(false);
    expect(publicFeedbackOptions({ ...context, preferences: { feedbackEnabled: false }, sourceType: "team", sourceId: "aff" })).toEqual([]);
  });

  it("hides the panel from teams until adjudicators are revealed", () => {
    const hiddenRounds = new Map([["r1", round("r1", 1, { adjudicatorsRevealed: false })]]);
    const revealedRounds = new Map([["r1", round("r1", 1, { adjudicatorsRevealed: true })]]);
    // Absent adjudicatorsRevealed hides the panel, as on private URLs.
    expect(publicFeedbackOptions({ ...context, roundsById: hiddenRounds, sourceType: "team", sourceId: "aff" })).toEqual([]);
    expect(publicFeedbackOptions({ ...context, roundsById: revealedRounds, sourceType: "team", sourceId: "aff" })).toHaveLength(1);
  });

  it("validates and builds the record like private-URL feedback", () => {
    const revealed = { ...context, roundsById: new Map([["r1", round("r1", 1, { adjudicatorsRevealed: true })]]) };
    const extra = { tournamentId: "t1", sourceName: "Aff", id: "fb1", timestamp: "2026-10-21T00:00:00.000Z", sourceType: "team" as const, sourceId: "aff" };
    const record = buildPublicFeedback({ debateId: "d1", targetType: "adjudicator", targetId: "chair", score: 4, agreeWithDecision: false }, { ...revealed, ...extra });
    expect(record).toEqual({
      id: "fb1",
      tournamentId: "t1",
      roundId: "r1",
      debateId: "d1",
      targetType: "adjudicator",
      targetAdjudicatorId: "chair",
      targetAdjudicatorName: "Chair",
      sourceType: "team",
      sourceId: "aff",
      sourceName: "Aff",
      score: 4,
      agreeWithDecision: false,
      confirmed: true,
      timestamp: "2026-10-21T00:00:00.000Z",
    });
    expect(() => buildPublicFeedback({ debateId: "d1", targetId: "chair", score: 6 }, { ...revealed, ...extra })).toThrow(/invalid details/);
    expect(() => buildPublicFeedback({ debateId: "d1", targetId: "panel", score: 3 }, { ...revealed, ...extra })).toThrow(/does not match/);
    expect(() => buildPublicFeedback({ debateId: "d1", targetId: "chair", score: 3, comments: "x".repeat(5001) }, { ...revealed, ...extra })).toThrow(/invalid details/);
    expect(() => buildPublicFeedback({ debateId: "d1", targetType: "venue", targetId: "chair", score: 3 }, { ...revealed, ...extra })).toThrow(/target type/);
  });
});

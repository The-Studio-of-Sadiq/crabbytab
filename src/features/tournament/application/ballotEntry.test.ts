import { describe, expect, it } from "vitest";
import type { BallotSubmission, Debate, Motion } from "@/types";
import {
  blankEntry,
  entryFromBallot,
  nextBallotVersion,
  resolveCheckState,
  roundMotions,
  sheetsFromPortalBallots,
} from "./ballotEntry";

const rules = { format: "wsdc" as const, preferences: { substantiveSpeakers: 3, replyScoresEnabled: true, ballotMode: "voting" as const } };
const rosters = {
  AFF: [{ id: "a1", name: "A1" }, { id: "a2", name: "A2" }, { id: "a3", name: "A3" }],
  NEG: [{ id: "n1", name: "N1" }, { id: "n2", name: "N2" }, { id: "n3", name: "N3" }],
};
const debate = {
  id: "d1",
  motionId: "m1",
  adjudicators: { chairId: "c", panellistIds: ["p1", "p2"], panellistNames: [], traineeIds: ["t"], traineeNames: [] },
} as unknown as Debate;
const adjudicators = [{ id: "c", name: "Chair" }, { id: "p1", name: "Pan 1" }, { id: "p2", name: "Pan 2" }, { id: "t", name: "Trainee" }];

function ballot(overrides: Partial<BallotSubmission>): BallotSubmission {
  return {
    id: "b",
    tournamentId: "t",
    roundId: "r1",
    debateId: "d1",
    version: 1,
    confirmed: false,
    discarded: false,
    submitterType: "tabroom",
    timestamp: "2026-10-18T10:00:00.000Z",
    speakerScores: {} as BallotSubmission["speakerScores"],
    teamScores: {} as BallotSubmission["teamScores"],
    ...overrides,
  };
}

describe("blank entries", () => {
  it("starts with empty scores, roster order and one sheet per voting adjudicator", () => {
    const entry = blankEntry(debate, rosters, adjudicators, rules);
    expect(entry.speakerScores.AFF?.map((speech) => speech.speakerId)).toEqual(["a1", "a2", "a3", "a1"]);
    expect(entry.speakerScores.AFF?.every((speech) => Number.isNaN(speech.score))).toBe(true);
    expect(entry.sheets?.map((sheet) => sheet.adjudicatorName)).toEqual(["Chair", "Pan 1", "Pan 2"]);
    expect(entry.motionId).toBe("m1");
  });

  it("reloads a saved ballot, keeping blank sheets for adjudicators without one", () => {
    const blank = blankEntry(debate, rosters, adjudicators, rules);
    const savedSheet = { ...blank.sheets![1], speakerScores: { ...blank.sheets![1].speakerScores } };
    const entry = entryFromBallot(ballot({ sheets: [savedSheet], vetoes: { AFF: "m2" }, forfeitSide: undefined }), blank, rules);
    expect(entry.sheets?.[1]).toBe(savedSheet);
    expect(entry.vetoes).toEqual({ AFF: "m2" });
  });

  it("fills sheets from the adjudicators' own portal ballots", () => {
    const blank = blankEntry(debate, rosters, adjudicators, rules);
    const portal = ballot({ submitterType: "judge", submitterId: "p2", speakerScores: { AFF: [], NEG: [] } as unknown as BallotSubmission["speakerScores"] });
    const result = sheetsFromPortalBallots(blank.sheets!, [portal], "d1");
    expect(result.filled).toBe(1);
    expect(result.sheets[2].speakerScores).toBe(portal.speakerScores);
  });
});

describe("check workflow", () => {
  const pending = ballot({ id: "v2", version: 2, submitterId: "alice" });
  const ballots = [ballot({ id: "v1", confirmed: true }), pending];

  it("numbers versions after the highest existing one", () => {
    expect(nextBallotVersion(ballots, "d1")).toBe(3);
    expect(nextBallotVersion([], "d1")).toBe(1);
  });

  it("routes the pending entry to a different checker", () => {
    expect(resolveCheckState({ ballots, debateId: "d1", userId: "bob", doubleEntry: false })).toEqual({ kind: "single" });
    expect(resolveCheckState({ ballots: [], debateId: "d1", userId: "bob", doubleEntry: true })).toEqual({ kind: "first-entry" });
    expect(resolveCheckState({ ballots, debateId: "d1", userId: "bob", doubleEntry: true })).toEqual({ kind: "review", pending });
    expect(resolveCheckState({ ballots, debateId: "d1", userId: "bob", doubleEntry: true, checkMode: "blind" })).toEqual({ kind: "blind-check", pending });
    expect(resolveCheckState({ ballots, debateId: "d1", userId: "alice", doubleEntry: true })).toEqual({ kind: "awaiting-other", pending });
    expect(resolveCheckState({ ballots, debateId: "d1", userId: null, doubleEntry: true }).kind).toBe("review");
  });
});

describe("round motions", () => {
  const motions = [
    { id: "m1", rounds: ["r1"] },
    { id: "m2", rounds: ["r2"] },
  ] as Motion[];
  it("offers only the round's motions, or all of them when none are assigned", () => {
    expect(roundMotions(motions, "r1").map((motion) => motion.id)).toEqual(["m1"]);
    expect(roundMotions(motions, "r9").map((motion) => motion.id)).toEqual(["m1", "m2"]);
  });
});

import { describe, expect, it } from "vitest";
import type { Adjudicator, BallotSubmission, Debate, FeedbackSubmission, Round } from "@/types";
import { adminTeamRecord, teamConflicts, teamFeedback } from "./teamRecord";

const rounds = [
  { id: "r1", name: "Round 1", seq: 1, resultsReleased: false, stage: "preliminary" },
  { id: "r2", name: "Round 2", seq: 2, resultsReleased: true, stage: "preliminary" },
  { id: "rx", name: "Cancelled", seq: 3, resultsReleased: false, cancelled: true },
] as unknown as Round[];

const debate = (id: string, roundId: string): Debate =>
  ({
    id,
    roundId,
    venueName: "Room 1",
    teams: {
      AFF: { teamId: "a", teamName: "Alpha", side: "AFF" },
      NEG: { teamId: "b", teamName: "Beta", side: "NEG" },
    },
    adjudicators: { chairId: "j1", chairName: "Old", panellistIds: ["j2"], panellistNames: ["P"], traineeIds: [], traineeNames: [] },
  }) as unknown as Debate;

const ballot = (debateId: string, overrides: Partial<BallotSubmission> = {}): BallotSubmission =>
  ({
    id: `${debateId}-b`,
    debateId,
    version: 1,
    confirmed: true,
    discarded: false,
    speakerScores: {
      AFF: [
        { speakerId: "s2", speakerName: "Bo", position: 2, score: 74 },
        { speakerId: "s1", speakerName: "Ann", position: 1, score: 76, ghost: true },
      ],
    },
    teamScores: { AFF: { side: "AFF", teamId: "a", points: 1, win: true, totalSpeakerScore: 150 } },
    ...overrides,
  }) as unknown as BallotSubmission;

const adjudicators = [
  { id: "j1", name: "Chair Person", conflicts: [] },
  { id: "j2", name: "Panel Person", conflicts: [{ type: "personal", teamId: "a" }] },
  { id: "j3", name: "Inst Person", conflicts: [{ type: "institution", institutionId: "i1" }], institutionId: "i9" },
  { id: "j4", name: "Declared", conflicts: [], institutionId: "i5" },
] as unknown as Adjudicator[];

describe("admin team record", () => {
  it("shows unreleased results from the confirmed ballot and skips cancelled rounds", () => {
    const rows = adminTeamRecord("a", {
      rounds,
      debates: [debate("d2", "r2"), debate("d1", "r1"), debate("dx", "rx")],
      ballots: [ballot("d1"), ballot("d2", { confirmed: false })],
      adjudicators,
    });
    expect(rows.map((row) => row.debateId)).toEqual(["d1", "d2"]);
    expect(rows[0]).toMatchObject({
      status: "confirmed",
      released: false,
      side: "AFF",
      opponents: ["Beta"],
      panel: { chair: "Chair Person", panellists: ["Panel Person"], trainees: [] },
      result: { points: 1, win: true, speakerTotal: 150 },
    });
    expect(rows[0].speeches.map((speech) => [speech.speakerName, speech.ghost ?? false])).toEqual([
      ["Ann", true],
      ["Bo", false],
    ]);
    expect(rows[1]).toMatchObject({ status: "unconfirmed", released: true, speeches: [] });
    expect(rows[1].result).toBeUndefined();
  });

  it("lists conflicted adjudicators with the reason", () => {
    const conflicts = teamConflicts({ id: "a", institutionId: "i1", institutionConflictIds: ["i5"] }, adjudicators);
    expect(conflicts.map((row) => [row.adjudicatorName, row.reason])).toEqual([
      ["Declared", "team_institution"],
      ["Inst Person", "institution"],
      ["Panel Person", "personal"],
    ]);
  });

  it("splits feedback the team gave and received", () => {
    const feedback = [
      { id: "1", sourceType: "team", sourceId: "a", timestamp: "1" },
      { id: "2", sourceType: "adjudicator", sourceId: "j1", targetType: "team", targetTeamId: "a", timestamp: "2" },
      { id: "3", sourceType: "team", sourceId: "b", timestamp: "3" },
    ] as FeedbackSubmission[];
    const lists = teamFeedback("a", feedback);
    expect(lists.submitted.map((item) => item.id)).toEqual(["1"]);
    expect(lists.received.map((item) => item.id)).toEqual(["2"]);
  });
});

import { describe, expect, it } from "vitest";
import type { BallotSubmission, Debate, DebateSide, SpeakerScoreEntry, Tournament } from "@/types";
import type { BallotRules } from "./result";
import {
  buildMergedBallot,
  latestIndividualBallots,
  MERGED_BALLOT_SUBMITTER_NAME,
  mergeIndividualBallots,
  votingAdjudicatorIds,
} from "./individualBallots";
import { planIndividualBallotWrites, applyPrivateBallotConfirmation, usesIndividualBallots, votingRoundPrivateBallot } from "@/lib/privateIndividualBallots";
import { isTabRoomConfirmed } from "@/lib/privateSync";

const rules: BallotRules = {
  format: "wsdc",
  preferences: { ballotMode: "voting", substantiveSpeakers: 2, replyScoresEnabled: false, minSpeakerScore: 60, maxSpeakerScore: 80 },
};

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
    AFF: { teamId: "aff", teamName: "Aff", side: "AFF" },
    NEG: { teamId: "neg", teamName: "Neg", side: "NEG" },
  },
  adjudicators: { chairId: "c", panellistIds: ["p1", "p2"], panellistNames: [], traineeIds: ["t"], traineeNames: [] },
} as unknown as Debate;

function speeches(side: DebateSide, scores: number[], speakerPrefix = side.toLowerCase()): SpeakerScoreEntry[] {
  return scores.map((score, index) => ({
    speakerId: `${speakerPrefix}${index + 1}`,
    speakerName: `${speakerPrefix}${index + 1}`,
    position: index + 1,
    score,
  }));
}

function sheet(adjudicatorId: string, aff: number[], neg: number[], overrides: Partial<BallotSubmission> = {}): BallotSubmission {
  return {
    id: `ballot-d1-adj-${adjudicatorId}-1`,
    tournamentId: "t1",
    roundId: "r1",
    debateId: "d1",
    version: 1,
    confirmed: false,
    discarded: false,
    submitterType: "judge",
    submitterId: adjudicatorId,
    submitterName: adjudicatorId.toUpperCase(),
    singleAdjudicator: true,
    motionId: "m1",
    speakerScores: { AFF: speeches("AFF", aff), NEG: speeches("NEG", neg) } as BallotSubmission["speakerScores"],
    teamScores: {
      AFF: { side: "AFF", teamId: "aff", points: 0, totalSpeakerScore: 0 },
      NEG: { side: "NEG", teamId: "neg", points: 0, totalSpeakerScore: 0 },
    } as BallotSubmission["teamScores"],
    timestamp: "2026-10-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("individual ballots merge", () => {
  it("lists the chair and panellists as voters, never trainees", () => {
    expect(votingAdjudicatorIds(debate)).toEqual(["c", "p1", "p2"]);
  });

  it("merges the latest sheet of every voting adjudicator into a voting result (2-1 split)", () => {
    const ballots = [
      sheet("c", [75, 75], [70, 70]),
      sheet("p1", [74, 74], [71, 71]),
      sheet("p2", [70, 70], [75, 75]),
    ];
    const merge = mergeIndividualBallots(debate, ballots, rules);
    expect(merge.errors).toEqual([]);
    expect(merge.missingAdjudicatorIds).toEqual([]);
    expect(merge.result?.teamScores.AFF.win).toBe(true);
    expect(merge.result?.teamScores.AFF.votes).toBe(2);
    expect(merge.result?.sheets).toHaveLength(3);
    // Majority average: (75 + 74) / 2 for the first affirmative speech.
    expect(merge.result?.speakerScores.AFF[0].score).toBe(74.5);
  });

  it("uses each adjudicator's highest version and ignores discarded sheets", () => {
    const older = sheet("c", [70, 70], [75, 75], { id: "old", version: 1 });
    const newer = sheet("c", [75, 75], [70, 70], { id: "new", version: 3 });
    const discarded = sheet("c", [60, 60], [80, 80], { id: "gone", version: 4, discarded: true });
    expect(latestIndividualBallots([older, newer, discarded], "d1").get("c")?.id).toBe("new");
  });

  it("reports missing adjudicators and refuses to build an incomplete merge", () => {
    const merge = mergeIndividualBallots(debate, [sheet("c", [75, 75], [70, 70])], rules);
    expect(merge.missingAdjudicatorIds).toEqual(["p1", "p2"]);
    expect(buildMergedBallot(merge, { debate, version: 2, timestamp: "now", confirmed: true })).toBeNull();
  });

  it("reports sheets that disagree on speakers, motion or tied totals", () => {
    const ballots = [
      sheet("c", [75, 75], [70, 70]),
      { ...sheet("p1", [74, 74], [71, 71]), motionId: "m2" },
      { ...sheet("p2", [72, 72], [72, 72]), speakerScores: { AFF: speeches("AFF", [72, 72], "x"), NEG: speeches("NEG", [72, 72]) } } as BallotSubmission,
    ];
    const merge = mergeIndividualBallots(debate, ballots, rules);
    expect(merge.errors.some((error) => error.includes("different motions"))).toBe(true);
    expect(merge.errors.some((error) => error.includes("different speakers for AFF speech 1"))).toBe(true);
    expect(merge.errors.some((error) => error.includes("tied team totals"))).toBe(true);
    expect(merge.result).toBeUndefined();
  });

  it("builds a merged ballot that a later sheet can still re-merge", () => {
    const merge = mergeIndividualBallots(debate, [
      sheet("c", [75, 75], [70, 70]),
      sheet("p1", [74, 74], [71, 71]),
      sheet("p2", [70, 70], [75, 75]),
    ], rules);
    const merged = buildMergedBallot(merge, { debate, version: 4, timestamp: "2026-10-20T11:00:00.000Z", confirmed: true })!;
    expect(merged.submitterName).toBe(MERGED_BALLOT_SUBMITTER_NAME);
    expect(merged.submitterId).toBeUndefined();
    expect(merged.mergedFromIds).toHaveLength(3);
    expect(isTabRoomConfirmed(merged)).toBe(false);
  });
});

describe("private-URL ballot policy", () => {
  const tournament = { format: "wsdc" as const, preferences: { ...rules.preferences, individualBallots: true } } as never;

  it("stores sheets unconfirmed in voting rounds with individual ballots", () => {
    expect(usesIndividualBallots(tournament, { stage: "preliminary" })).toBe(true);
    const chairBallot = sheet("c", [75, 75], [70, 70], { confirmed: true, confirmedBy: "C", singleAdjudicator: undefined });
    const applied = applyPrivateBallotConfirmation(chairBallot, tournament, { stage: "preliminary" });
    expect(applied.confirmed).toBe(false);
    expect(applied.singleAdjudicator).toBe(true);
    expect(applied.confirmedBy).toBeUndefined();
  });

  it("leaves a chair's consensus ballot unconfirmed when the tab room confirms private ballots", () => {
    const bp = { format: "bp" as const, preferences: { privateBallotConfirmation: "tab_room" } } as never;
    const chairBallot = sheet("c", [75, 75], [70, 70], { confirmed: true, confirmedBy: "C", singleAdjudicator: undefined });
    expect(applyPrivateBallotConfirmation(chairBallot, bp, undefined).confirmed).toBe(false);
    const chairPolicy = { format: "bp" as const, preferences: {} } as never;
    expect(applyPrivateBallotConfirmation(chairBallot, chairPolicy, undefined).confirmed).toBe(true);
  });
});

describe("planIndividualBallotWrites", () => {
  const debates = new Map([["d1", debate]]);
  const existing = (ballots: BallotSubmission[]) =>
    new Map([["d1", ballots.map((ballot) => ({ id: ballot.id, data: ballot }))]]);
  const base = {
    lockedDebateIds: new Set<string>(),
    debates,
    rulesFor: () => rules,
    timestamp: "2026-10-20T12:00:00.000Z",
  };

  it("waits for the rest of the panel", () => {
    const plan = planIndividualBallotWrites({
      ...base,
      submissions: [sheet("c", [75, 75], [70, 70])],
      existingByDebate: existing([]),
      autoConfirm: true,
    });
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0].confirmed).toBe(false);
    expect(plan.merged).toEqual([]);
    expect(plan.pendingReasons.get("d1")).toContain("2 more");
  });

  it("merges and confirms once the last sheet arrives, replacing the adjudicator's earlier sheet", () => {
    const earlier = sheet("p2", [60, 60], [80, 80], { id: "p2-old", version: 2 });
    const plan = planIndividualBallotWrites({
      ...base,
      submissions: [sheet("p2", [70, 70], [75, 75], { id: "p2-new" })],
      existingByDebate: existing([
        sheet("c", [75, 75], [70, 70], { version: 1 }),
        sheet("p1", [74, 74], [71, 71], { version: 1 }),
        earlier,
      ]),
      autoConfirm: true,
    });
    expect(plan.discardExistingIds).toEqual(["p2-old"]);
    expect(plan.merged).toHaveLength(1);
    expect(plan.merged[0].confirmed).toBe(true);
    expect(plan.merged[0].mergedFromIds).toContain("p2-new");
    expect(plan.merged[0].version).toBe(4);
  });

  it("leaves a complete set for the tab room when it confirms private ballots", () => {
    const plan = planIndividualBallotWrites({
      ...base,
      submissions: [sheet("p2", [70, 70], [75, 75])],
      existingByDebate: existing([sheet("c", [75, 75], [70, 70]), sheet("p1", [74, 74], [71, 71])]),
      autoConfirm: false,
    });
    expect(plan.merged).toEqual([]);
    expect(plan.pendingReasons.get("d1")).toContain("tab room");
  });

  it("never touches a debate the tab room already confirmed", () => {
    const confirmed = { ...sheet("c", [75, 75], [70, 70], { id: "tab", singleAdjudicator: undefined }), submitterType: "tabroom" as const, confirmed: true };
    const plan = planIndividualBallotWrites({
      ...base,
      submissions: [sheet("p1", [74, 74], [71, 71])],
      existingByDebate: existing([confirmed]),
      autoConfirm: true,
    });
    expect(plan.discardExistingIds).toEqual([]);
    expect(plan.writes[0].confirmed).toBe(false);
    expect(plan.merged).toEqual([]);
  });
});

describe("individual ballots with declared winners", () => {
  it("carries each adjudicator's own result into the merged sheets", async () => {
    const { mergeIndividualBallots } = await import("./individualBallots");
    const speeches = (prefix: string) => [1, 2].map((position) => ({ speakerId: `${prefix}${position}`, speakerName: `${prefix}${position}`, position, score: 70 }));
    const ballot = (adjudicatorId: string, winner: "AFF" | "NEG") => ({
      id: `b-${adjudicatorId}`, tournamentId: "t", roundId: "r", debateId: "d", version: 1, confirmed: false, discarded: false,
      submitterType: "judge" as const, submitterId: adjudicatorId, singleAdjudicator: true, timestamp: "2026-01-01",
      speakerScores: { AFF: speeches("a"), NEG: speeches("n") } as never,
      teamScores: {
        AFF: { side: "AFF" as const, teamId: "ta", points: winner === "AFF" ? 1 : 0, totalSpeakerScore: 140, rank: winner === "AFF" ? 1 : 2 },
        NEG: { side: "NEG" as const, teamId: "tn", points: winner === "NEG" ? 1 : 0, totalSpeakerScore: 140, rank: winner === "NEG" ? 1 : 2 },
      } as never,
    });
    const debate = {
      id: "d",
      teams: { AFF: { teamId: "ta", teamName: "A", side: "AFF" }, NEG: { teamId: "tn", teamName: "N", side: "NEG" } } as never,
      adjudicators: { chairId: "c", panellistIds: ["p"], panellistNames: [], traineeIds: [], traineeNames: [] },
    };
    const rules = { format: "custom_2team" as const, preferences: { substantiveSpeakers: 2, ballotMode: "voting" as const, winnersInBallots: "tied-points" as const } };
    const merge = mergeIndividualBallots(debate, [ballot("c", "NEG"), ballot("p", "NEG")], rules);
    expect(merge.errors).toEqual([]);
    expect(merge.result?.sheets?.map((sheet) => sheet.declaredWinner)).toEqual(["NEG", "NEG"]);
    expect(merge.result?.teamScores.NEG).toMatchObject({ win: true, votes: 2 });
  });
});

describe("Tabbycat parity: merge clears only what the sheets disagree on", () => {
  it("clears a disagreeing speaker and keeps every score, but never auto-confirms", () => {
    const ballots = [
      sheet("c", [75, 75], [70, 70]),
      sheet("p1", [74, 74], [71, 71]),
      { ...sheet("p2", [70, 70], [75, 75]), speakerScores: { AFF: speeches("AFF", [70, 70], "x"), NEG: speeches("NEG", [75, 75]) } } as BallotSubmission,
    ];
    const merge = mergeIndividualBallots(debate, ballots, rules);
    expect(merge.errors).toEqual(expect.arrayContaining([expect.stringContaining("different speakers for AFF speech 1")]));
    expect(merge.clearedSpeeches).toEqual([{ side: "AFF", index: 0 }, { side: "AFF", index: 1 }]);
    expect(merge.result?.teamScores.AFF.votes).toBe(2);
    expect(merge.result?.speakerScores.AFF[0]).toMatchObject({ speakerId: "", score: 74.5 });
    expect(merge.result?.speakerScores.NEG[0].speakerId).toBe("neg1");
    expect(merge.result?.motionId).toBe("m1");
    expect(buildMergedBallot(merge, { debate, version: 2, timestamp: "now", confirmed: true })).toBeNull();
  });

  it("clears a disagreeing motion and keeps the speakers", () => {
    const ballots = [sheet("c", [75, 75], [70, 70]), sheet("p1", [74, 74], [71, 71]), { ...sheet("p2", [70, 70], [75, 75]), motionId: "m2" }];
    const merge = mergeIndividualBallots(debate, ballots, rules);
    expect(merge.result?.motionId).toBeUndefined();
    expect(merge.result?.speakerScores.AFF[0].speakerId).toBe("aff1");
    expect(merge.errors).toEqual([expect.stringContaining("different motions")]);
  });
});

describe("Tabbycat parity: the chair's casting vote", () => {
  it("refuses to break a 1-1 tie when the chair has no scoresheet", () => {
    const panel = { ...debate, adjudicators: { ...debate.adjudicators, panellistIds: ["p1", "p2"] } } as Debate;
    const merge = mergeIndividualBallots(
      { ...panel, adjudicators: { ...panel.adjudicators, chairId: "absent" } },
      [sheet("p1", [75, 75], [70, 70]), sheet("p2", [70, 70], [75, 75])],
      rules
    );
    expect(merge.result).toBeUndefined();
    expect(merge.errors.join(" ")).toMatch(/chair's scoresheet is missing/);
  });
});

describe("private-URL ballots in a voting round without individual ballots", () => {
  const tournament = { format: "wsdc", preferences: { ...rules.preferences, individualBallots: false } } as unknown as Tournament;
  const round = { stage: "preliminary" as const };

  it("turns a solo chair's sheet into a voting ballot with its sheet and votes", () => {
    const solo = { ...debate, adjudicators: { chairId: "c", panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] } } as unknown as Debate;
    const own = { ...sheet("c", [75, 75], [70, 70]), singleAdjudicator: undefined, confirmed: true, confirmedBy: "C" };
    const ballot = votingRoundPrivateBallot(own, { tournament, round, debate: solo });
    expect(ballot.confirmed).toBe(true);
    expect(ballot.sheets).toHaveLength(1);
    expect(ballot.teamScores.AFF).toMatchObject({ win: true, votes: 1 });
    expect(ballot.teamScores.NEG.votes).toBe(0);
  });

  it("keeps one panel member's sheet unconfirmed instead of making it the result", () => {
    const own = { ...sheet("c", [75, 75], [70, 70]), singleAdjudicator: undefined, confirmed: true, confirmedBy: "C", confirmedTimestamp: "now" };
    const ballot = votingRoundPrivateBallot(own, { tournament, round, debate });
    expect(ballot.confirmed).toBe(false);
    expect(ballot.confirmedBy).toBeUndefined();
    expect(ballot.sheets).toBeUndefined();
  });

  it("leaves consensus rounds alone", () => {
    const own = { ...sheet("c", [75, 75], [70, 70]), confirmed: true };
    const consensus = { format: "wsdc", preferences: { ...rules.preferences, ballotMode: "consensus" } } as unknown as Tournament;
    expect(votingRoundPrivateBallot(own, { tournament: consensus, round, debate })).toBe(own);
  });
});

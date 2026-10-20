import { describe, expect, it } from "vitest";
import type { AdjudicatorSheet, DebateSide, Speaker, SpeakerScoreEntry } from "@/types";
import {
  aggregateVotingSheets,
  buildBallotResult,
  consensusTeamScores,
  diffBallots,
  markGhostSpeeches,
  teamSpeakerTotal,
  validateBallotEntry,
  type BallotRules,
  type BallotValidationContext,
} from "@/lib/ballots/result";

const twoTeam: BallotRules = {
  format: "wsdc",
  preferences: { substantiveSpeakers: 3, replyScoresEnabled: true, minSpeakerScore: 60, maxSpeakerScore: 80, stepSpeakerScore: 1, minReplyScore: 30, maxReplyScore: 40 },
};
const bp: BallotRules = { format: "bp", preferences: { substantiveSpeakers: 2, minSpeakerScore: 50, maxSpeakerScore: 100, stepSpeakerScore: 1 } };

const affRoster: Speaker[] = [{ id: "a1", name: "Ana" }, { id: "a2", name: "Ben" }, { id: "a3", name: "Cai" }];
const negRoster: Speaker[] = [{ id: "n1", name: "Dee" }, { id: "n2", name: "Eli" }, { id: "n3", name: "Fay" }];
const teamIds = { AFF: "team-aff", NEG: "team-neg" };

function speeches(roster: Speaker[], scores: number[], reply?: { id: string; score: number }): SpeakerScoreEntry[] {
  const entries = scores.map((score, index) => ({
    speakerId: roster[index].id,
    speakerName: roster[index].name,
    position: index + 1,
    score,
  }));
  if (reply) {
    const speaker = roster.find((candidate) => candidate.id === reply.id)!;
    entries.push({ speakerId: speaker.id, speakerName: speaker.name, position: 4, score: reply.score });
  }
  return entries;
}

function sheet(id: string, aff: number[], neg: number[]): AdjudicatorSheet {
  return {
    adjudicatorId: id,
    adjudicatorName: id,
    speakerScores: {
      AFF: speeches(affRoster, aff, { id: "a1", score: 35 }),
      NEG: speeches(negRoster, neg, { id: "n1", score: 35 }),
    } as Record<DebateSide, SpeakerScoreEntry[]>,
  };
}

describe("ghost speeches", () => {
  it("flags the second speech by the same speaker and keeps it out of the team total by default", () => {
    const entries = markGhostSpeeches(
      [
        { speakerId: "a1", speakerName: "Ana", position: 1, score: 70 },
        { speakerId: "a2", speakerName: "Ben", position: 2, score: 72 },
        { speakerId: "a1", speakerName: "Ana", position: 3, score: 74 },
      ],
      twoTeam
    );
    expect(entries.map((entry) => Boolean(entry.ghost))).toEqual([false, false, true]);
    expect(teamSpeakerTotal(entries, twoTeam)).toBe(142);
    expect(teamSpeakerTotal(entries, { ...twoTeam, preferences: { ...twoTeam.preferences, teamScoreIncludesGhosts: true } })).toBe(216);
  });

  it("respects an explicit choice of which speech is the ghost", () => {
    const entries = markGhostSpeeches(
      [
        { speakerId: "a1", speakerName: "Ana", position: 1, score: 70, ghost: true },
        { speakerId: "a1", speakerName: "Ana", position: 2, score: 72 },
      ],
      bp
    );
    expect(entries.map((entry) => Boolean(entry.ghost))).toEqual([true, false]);
  });
});

describe("consensus results", () => {
  it("computes real two-team margins from the totals", () => {
    const scores = { AFF: speeches(affRoster, [75, 74, 73], { id: "a1", score: 37 }), NEG: speeches(negRoster, [70, 70, 70], { id: "n2", score: 35 }) };
    const result = consensusTeamScores(scores, { AFF: 1, NEG: 2 }, teamIds, twoTeam);
    expect(result.AFF).toMatchObject({ points: 1, win: true, totalSpeakerScore: 259, margin: 14 });
    expect(result.NEG).toMatchObject({ points: 0, win: false, totalSpeakerScore: 245, margin: -14 });
  });

  it("gives BP points by rank and no margin", () => {
    const result = consensusTeamScores({}, { OG: 2, OO: 1, CG: 4, CO: 3 }, {}, bp);
    expect([result.OG.points, result.OO.points, result.CG.points, result.CO.points]).toEqual([2, 3, 0, 1]);
    expect(result.OG.margin).toBeUndefined();
  });
});

describe("voting ballots", () => {
  it("awards the majority and averages only the majority's scores", () => {
    const result = aggregateVotingSheets(
      [sheet("chair", [75, 75, 75], [70, 70, 70]), sheet("p1", [74, 74, 74], [72, 72, 72]), sheet("p2", [70, 70, 70], [76, 76, 76])],
      "chair",
      teamIds,
      twoTeam
    );
    expect(result.winner).toBe("AFF");
    expect(result.votes).toEqual({ AFF: 2, NEG: 1 });
    expect(result.majorityAdjudicatorIds).toEqual(["chair", "p1"]);
    expect(result.speakerScores.AFF[0].score).toBe(74.5);
    expect(result.teamScores.AFF).toMatchObject({ win: true, votes: 2, totalSpeakerScore: 258.5, margin: 10.5 });
    expect(result.teamScores.NEG).toMatchObject({ win: false, votes: 1, margin: -10.5 });
  });

  it("lets the chair break a tied panel", () => {
    const result = aggregateVotingSheets(
      [sheet("p1", [75, 75, 75], [70, 70, 70]), sheet("chair", [70, 70, 70], [75, 75, 75])],
      "chair",
      teamIds,
      twoTeam
    );
    expect(result.winner).toBe("NEG");
  });

  it("includes dissenters in the margin when configured", () => {
    const sheets = [sheet("chair", [75, 75, 75], [70, 70, 70]), sheet("p1", [74, 74, 74], [72, 72, 72]), sheet("p2", [70, 70, 70], [76, 76, 76])];
    const rules = { ...twoTeam, preferences: { ...twoTeam.preferences, marginIncludesDissenters: true } };
    expect(aggregateVotingSheets(sheets, "chair", teamIds, rules).teamScores.AFF.margin).toBe(1);
  });
});

describe("validation", () => {
  const context: BallotValidationContext = { ...twoTeam, rosters: { AFF: affRoster, NEG: negRoster }, roundMotionIds: ["m1", "m2", "m3"] };
  const valid = {
    speakerScores: { AFF: speeches(affRoster, [75, 74, 73], { id: "a1", score: 37 }), NEG: speeches(negRoster, [70, 70, 70], { id: "n2", score: 35 }) },
    ranks: { AFF: 1, NEG: 2 },
    motionId: "m1",
  };

  it("accepts a well-formed consensus ballot", () => {
    expect(validateBallotEntry(valid, context)).toEqual([]);
  });

  it("rejects low-point wins unless allowed", () => {
    const entry = { ...valid, ranks: { AFF: 2, NEG: 1 } };
    const declared = { ...context, preferences: { ...context.preferences, winnersInBallots: "high-points" as const } };
    expect(validateBallotEntry(entry, declared).join(" ")).toMatch(/Low-point wins/);
    const allowed = { ...context, preferences: { ...context.preferences, allowLowPointWins: true } };
    expect(validateBallotEntry(entry, allowed)).toEqual([]);
    // Without declared winners the result is read from the totals, whatever ranks were entered.
    expect(validateBallotEntry(entry, context)).toEqual([]);
    expect(buildBallotResult(entry, teamIds, undefined, twoTeam).teamScores.AFF.win).toBe(true);
  });

  it("requires the reply to come from an earlier speaker and rejects unmarked double speeches", () => {
    const entry = {
      ...valid,
      speakerScores: {
        AFF: speeches(affRoster, [75, 74, 73], { id: "a3", score: 37 }),
        NEG: [...speeches(negRoster, [70, 70]), { speakerId: "n1", speakerName: "Dee", position: 3, score: 70 }, { speakerId: "n2", speakerName: "Eli", position: 4, score: 35 }],
      },
    };
    const errors = validateBallotEntry(entry, context).join(" ");
    expect(errors).toMatch(/reply must be given by one of the first 2 speakers/);
    expect(errors).toMatch(/Dee speaks more than once/);
  });

  it("validates vetoes against the round's motions", () => {
    const vetoesOff = validateBallotEntry({ ...valid, vetoes: { AFF: "m2" } }, context);
    expect(vetoesOff.join(" ")).toMatch(/not enabled/);
    const on = { ...context, preferences: { ...context.preferences, enableMotionVetoes: true } };
    expect(validateBallotEntry({ ...valid, vetoes: { AFF: "m2", NEG: "m3" } }, on)).toEqual([]);
    expect(validateBallotEntry({ ...valid, vetoes: { AFF: "m1" } }, on).join(" ")).toMatch(/cannot veto the motion that was debated/);
  });

  it("accepts a forfeit without scores only when forfeits are enabled", () => {
    expect(validateBallotEntry({ speakerScores: {}, forfeitSide: "NEG" }, context).join(" ")).toMatch(/not enabled/);
    const on = { ...context, preferences: { ...context.preferences, enableForfeits: true } };
    expect(validateBallotEntry({ speakerScores: {}, forfeitSide: "NEG" }, on)).toEqual([]);
  });

  it("requires a winner on every voting sheet and matching speaker order", () => {
    const voting = { ...context, preferences: { ...context.preferences, ballotMode: "voting" as const } };
    const tied = sheet("p1", [70, 70, 70], [70, 70, 70]);
    expect(validateBallotEntry({ speakerScores: {}, sheets: [sheet("chair", [75, 75, 75], [70, 70, 70]), tied] }, voting).join(" "))
      .toMatch(/tied/);
  });
});

describe("assembling and diffing", () => {
  it("records forfeits with no speaker scores", () => {
    const result = buildBallotResult({ speakerScores: {}, forfeitSide: "AFF" }, teamIds, undefined, twoTeam);
    expect(result.speakerScores).toEqual({ AFF: [], NEG: [] });
    expect(result.teamScores.AFF).toMatchObject({ forfeit: true, points: 0 });
    expect(result.teamScores.NEG).toMatchObject({ win: true, points: 1 });
  });

  it("lists differing fields between two entries", () => {
    const scores = { AFF: speeches(affRoster, [75, 74, 73]), NEG: speeches(negRoster, [70, 70, 70]) };
    const first = { motionId: "m1", ...buildBallotResult({ speakerScores: scores, ranks: { AFF: 1, NEG: 2 } }, teamIds, undefined, { ...twoTeam, preferences: { ...twoTeam.preferences, replyScoresEnabled: false } }) };
    const changed = { ...scores, NEG: speeches(negRoster, [70, 71, 70]) };
    const second = { motionId: "m2", ...buildBallotResult({ speakerScores: changed, ranks: { AFF: 1, NEG: 2 } }, teamIds, undefined, { ...twoTeam, preferences: { ...twoTeam.preferences, replyScoresEnabled: false } }) };
    expect(diffBallots(first, second, "wsdc").map((difference) => difference.field)).toEqual(["Motion", "NEG speech 2"]);
    expect(diffBallots(first, first, "wsdc")).toEqual([]);
  });
});

describe("voting averages keep full precision", () => {
  it("keeps equal averages tied instead of rounding them apart (224/3, as in Tabbycat)", () => {
    // Each AFF speaker's three scores sum to 224, so every average is exactly 224/3. Rounding to
    // 0.01 used to store 74.67 for some and 74.665-style values for others, splitting the tie.
    const sheets = [
      sheet("chair", [75, 74, 75], [70, 70, 70]),
      sheet("p1", [74, 75, 74], [70, 70, 70]),
      sheet("p2", [75, 75, 75], [70, 70, 70]),
    ];
    const result = aggregateVotingSheets(sheets, "chair", teamIds, twoTeam);
    const substantive = result.speakerScores.AFF.filter((entry) => entry.position <= 3).map((entry) => entry.score);
    expect(new Set(substantive).size).toBe(1);
    expect(substantive[0]).toBeCloseTo(224 / 3, 9);
    // Team total is the exact mean of the sheet totals (259, 258, 260), not a sum of averages.
    expect(result.teamScores.AFF.totalSpeakerScore).toBe(259);
  });

  it("stores the exact mean margin rather than a value rounded to 0.01", () => {
    const sheets = [
      sheet("chair", [72, 72, 72], [70, 70, 70]),
      sheet("p1", [71, 71, 71], [70, 70, 70]),
      sheet("p2", [71, 70, 71], [70, 70, 70]),
    ];
    const result = aggregateVotingSheets(sheets, "chair", teamIds, twoTeam);
    // AFF totals 251, 248 and 247 against NEG's 245: margins 6, 3 and 2, mean 11/3.
    expect(result.teamScores.AFF.margin).toBeCloseTo(11 / 3, 9);
    expect(result.teamScores.AFF.margin).not.toBe(3.67);
  });
});

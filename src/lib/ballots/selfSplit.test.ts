import { describe, expect, it } from "vitest";
import type { Adjudicator, AdjudicatorSheet, BallotSubmission, Debate, DebateSide, SpeakerScoreEntry, Team, Tournament } from "@/types";
import {
  aggregateVotingSheets,
  ballotVotesPossible,
  buildBallotResult,
  diffBallots,
  selfSplitAllowed,
  validateBallotEntry,
  type BallotEntry,
  type BallotRules,
} from "./result";
import { mergeIndividualBallots } from "./individualBallots";
import { buildPrivateBallot, privateSelfSplitAllowed, privateUrlBallotsEnabled } from "@/lib/privateBallot";
import { entryFromBallot } from "@/features/tournament/application/ballotEntry";

/** Tabbycat `allow_self_split_ballots` (Karl Popper rules), results/result.py `_is_self_split`. */

const preferences = {
  ballotMode: "voting" as const,
  substantiveSpeakers: 2,
  replyScoresEnabled: false,
  minSpeakerScore: 60,
  maxSpeakerScore: 80,
  stepSpeakerScore: 1,
  allowSelfSplitBallots: true,
};
const rules: BallotRules = { format: "custom_2team", preferences };

function speeches(side: DebateSide, scores: number[]): SpeakerScoreEntry[] {
  return scores.map((score, index) => ({
    speakerId: `${side.toLowerCase()}${index + 1}`,
    speakerName: `${side} ${index + 1}`,
    position: index + 1,
    score,
  }));
}

function sheet(adjudicatorId: string, aff: number[], neg: number[]): AdjudicatorSheet {
  return { adjudicatorId, adjudicatorName: adjudicatorId, speakerScores: { AFF: speeches("AFF", aff), NEG: speeches("NEG", neg) } as AdjudicatorSheet["speakerScores"] };
}

const rosters = {
  AFF: [{ id: "aff1", name: "AFF 1" }, { id: "aff2", name: "AFF 2" }],
  NEG: [{ id: "neg1", name: "NEG 1" }, { id: "neg2", name: "NEG 2" }],
};
const teamIds = { AFF: "team-aff", NEG: "team-neg" };

function soloEntry(selfSplit?: boolean): BallotEntry {
  return { speakerScores: {}, sheets: [sheet("chair", [75, 74], [70, 71])], ...(selfSplit ? { selfSplit } : {}) };
}

describe("selfSplitAllowed", () => {
  it("needs the preference, a two-team voting ballot and exactly one voting adjudicator", () => {
    expect(selfSplitAllowed(rules, 1)).toBe(true);
    expect(selfSplitAllowed(rules, 3)).toBe(false);
    expect(selfSplitAllowed({ ...rules, preferences: { ...preferences, allowSelfSplitBallots: false } }, 1)).toBe(false);
    expect(selfSplitAllowed({ ...rules, preferences: { ...preferences, allowSelfSplitBallots: undefined } }, 1)).toBe(false);
    expect(selfSplitAllowed({ ...rules, preferences: { ...preferences, ballotMode: "consensus" } }, 1)).toBe(false);
    expect(selfSplitAllowed({ format: "bp", preferences }, 1)).toBe(false);
    // Elimination rounds follow their own ballot mode.
    const elimConsensus: BallotRules = { ...rules, stage: "elimination", preferences: { ...preferences, eliminationBallotMode: "consensus" } };
    expect(selfSplitAllowed(elimConsensus, 1)).toBe(false);
  });
});

describe("self-split voting ballots", () => {
  it("records the winner with 2 votes and the loser with 1, leaving scores and margin alone", () => {
    const plain = aggregateVotingSheets([sheet("chair", [75, 74], [70, 71])], "chair", teamIds, rules);
    const split = aggregateVotingSheets([sheet("chair", [75, 74], [70, 71])], "chair", teamIds, rules, { selfSplit: true });
    expect(plain.votes).toEqual({ AFF: 1, NEG: 0 });
    expect(split.votes).toEqual({ AFF: 2, NEG: 1 });
    expect(split.selfSplit).toBe(true);
    expect(split.teamScores.AFF).toMatchObject({ win: true, votes: 2, margin: plain.teamScores.AFF.margin, totalSpeakerScore: 149 });
    expect(split.teamScores.NEG).toMatchObject({ win: false, votes: 1 });
    expect(split.speakerScores).toEqual(plain.speakerScores);
  });

  it("ignores the flag for a panel of more than one sheet", () => {
    const panel = [sheet("chair", [75, 74], [70, 71]), sheet("p1", [75, 74], [70, 71]), sheet("p2", [70, 70], [75, 75])];
    const result = aggregateVotingSheets(panel, "chair", teamIds, rules, { selfSplit: true });
    expect(result.votes).toEqual({ AFF: 2, NEG: 1 });
    expect(result.selfSplit).toBe(false);
  });

  it("builds and validates a solo adjudicator's split ballot", () => {
    expect(validateBallotEntry(soloEntry(true), { ...rules, rosters, votingAdjudicatorCount: 1 })).toEqual([]);
    const result = buildBallotResult(soloEntry(true), teamIds, "chair", rules);
    expect(result.selfSplit).toBe(true);
    expect(result.teamScores.AFF.votes).toBe(2);
    expect(result.teamScores.NEG.votes).toBe(1);
    expect(buildBallotResult(soloEntry(), teamIds, "chair", rules).selfSplit).toBeUndefined();
  });

  it("rejects a declared split when it is not allowed", () => {
    const off: BallotRules = { ...rules, preferences: { ...preferences, allowSelfSplitBallots: false } };
    expect(validateBallotEntry(soloEntry(true), { ...off, rosters, votingAdjudicatorCount: 1 }).join(" ")).toMatch(/split decision/);
    // A panel of three, even if only one sheet has been entered so far.
    expect(validateBallotEntry(soloEntry(true), { ...rules, rosters, votingAdjudicatorCount: 3 }).join(" ")).toMatch(/split decision/);
    // Consensus ballots record no votes.
    const consensus: BallotRules = { ...rules, preferences: { ...preferences, ballotMode: "consensus" } };
    const entry: BallotEntry = { speakerScores: { AFF: speeches("AFF", [75, 74]), NEG: speeches("NEG", [70, 71]) }, ranks: { AFF: 1, NEG: 2 }, selfSplit: true };
    expect(validateBallotEntry(entry, { ...consensus, rosters }).join(" ")).toMatch(/split decision/);
    // The result builder never applies a split the rules do not allow.
    expect(buildBallotResult(soloEntry(true), teamIds, "chair", off).teamScores.AFF.votes).toBe(1);
  });

  it("counts a self-split ballot as 3 possible votes", () => {
    const split = buildBallotResult(soloEntry(true), teamIds, "chair", rules);
    expect(ballotVotesPossible({ ...split, selfSplit: true })).toBe(3);
    const plain = buildBallotResult(soloEntry(), teamIds, "chair", rules);
    expect(ballotVotesPossible(plain)).toBe(1);
  });

  it("reports a changed split declaration between two entries", () => {
    const split = buildBallotResult(soloEntry(true), teamIds, "chair", rules);
    const plain = buildBallotResult(soloEntry(), teamIds, "chair", rules);
    expect(diffBallots({ ...split }, { ...plain }, "custom_2team").map((difference) => difference.field)).toContain("Split decision");
    expect(diffBallots({ ...split }, { ...split }, "custom_2team")).toEqual([]);
  });

  it("loads the split back into the tab-room entry", () => {
    const blank: BallotEntry = { speakerScores: {}, sheets: [sheet("chair", [], [])] };
    const ballot = { ...buildBallotResult(soloEntry(true), teamIds, "chair", rules) } as unknown as BallotSubmission;
    expect(entryFromBallot(ballot, blank, rules).selfSplit).toBe(true);
    expect(entryFromBallot({ ...ballot, selfSplit: undefined }, blank, rules).selfSplit).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Private URL ballots                                                        */
/* -------------------------------------------------------------------------- */

const tournament: Tournament = {
  id: "t1",
  name: "KP",
  shortName: "KP",
  slug: "kp",
  format: "custom_2team",
  active: true,
  ownerId: "owner",
  admins: {},
  preferences: {
    teamsInDebate: 2,
    drawRule: "random",
    sideAllocationRule: "balanced",
    ballotDoubleEntry: false,
    publicDraw: true,
    publicResults: true,
    publicStandings: true,
    publicMotions: true,
    feedbackEnabled: true,
    feedbackMinScore: 1,
    feedbackMaxScore: 10,
    minReplyScore: 30,
    maxReplyScore: 40,
    ...preferences,
    individualBallots: true,
  },
  createdAt: "",
  updatedAt: "",
};

const soloDebate: Debate = {
  id: "d1",
  tournamentId: "t1",
  roundId: "r1",
  roundSeq: 1,
  bracket: 0,
  roomRank: 0,
  importance: 0,
  resultStatus: "none",
  sidesConfirmed: true,
  flags: [],
  teams: {
    AFF: { side: "AFF", teamId: "team-aff", teamName: "Aff" },
    NEG: { side: "NEG", teamId: "team-neg", teamName: "Neg" },
  } as Debate["teams"],
  adjudicators: { chairId: "chair", panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
};

const teams = new Map<string, Team>(
  (["AFF", "NEG"] as const).map((side) => [
    `team-${side.toLowerCase()}`,
    {
      id: `team-${side.toLowerCase()}`,
      tournamentId: "t1",
      name: side,
      speakers: rosters[side],
      breakCategories: [],
      speakerCategories: [],
    },
  ])
);

const chair: Adjudicator = { id: "chair", tournamentId: "t1", name: "Chair", baseScore: 5, trainee: false, independent: false, conflicts: [] };

function privateInput(selfSplit?: unknown) {
  return {
    id: "ballot-d1-adj-chair-1",
    submitterType: "judge",
    submitterId: "chair",
    speakerScores: { AFF: speeches("AFF", [75, 74]), NEG: speeches("NEG", [70, 71]) },
    teamScores: { AFF: { rank: 1 }, NEG: { rank: 2 } },
    ...(selfSplit !== undefined ? { selfSplit } : {}),
  };
}

describe("self-split ballots through private URLs", () => {
  it("are offered only to a solo adjudicator, whose sheet becomes the voting ballot", () => {
    expect(privateSelfSplitAllowed(tournament, { stage: "preliminary" }, soloDebate)).toBe(true);
    const panel = { ...soloDebate, adjudicators: { ...soloDebate.adjudicators, panellistIds: ["p1", "p2"] } };
    expect(privateSelfSplitAllowed(tournament, { stage: "preliminary" }, panel)).toBe(false);
    // Without individual ballots a solo adjudicator's private ballot becomes the voting ballot
    // itself (votingRoundPrivateBallot), so the split is recorded there too.
    const noIndividual = { ...tournament, preferences: { ...tournament.preferences, individualBallots: false } };
    expect(privateSelfSplitAllowed(noIndividual, { stage: "preliminary" }, soloDebate)).toBe(true);
    const ballot = buildPrivateBallot(privateInput(true), { tournament: noIndividual, adjudicator: chair, debate: soloDebate, teams, tournamentId: "t1" });
    expect(ballot.teamScores.AFF.votes).toBe(2);
    expect(ballot.teamScores.NEG.votes).toBe(1);
    expect(ballot.selfSplit).toBe(true);
  });

  it("stores the flag, and the merged voting ballot records 2 votes to 1", () => {
    const ballot = buildPrivateBallot(privateInput(true), { tournament, adjudicator: chair, debate: soloDebate, teams, tournamentId: "t1" });
    expect(ballot.selfSplit).toBe(true);
    const merge = mergeIndividualBallots(soloDebate, [{ ...ballot, singleAdjudicator: true, confirmed: false }], { format: tournament.format, preferences: tournament.preferences });
    expect(merge.errors).toEqual([]);
    expect(merge.result?.selfSplit).toBe(true);
    expect(merge.result?.teamScores.AFF.votes).toBe(2);
    expect(merge.result?.teamScores.NEG.votes).toBe(1);
    expect(ballotVotesPossible(merge.result!)).toBe(3);
  });

  it("does not merge a split when the preference is off", () => {
    const ballot = buildPrivateBallot(privateInput(), { tournament, adjudicator: chair, debate: soloDebate, teams, tournamentId: "t1" });
    const forged = { ...ballot, selfSplit: true, singleAdjudicator: true };
    const off = { ...tournament.preferences, allowSelfSplitBallots: false };
    const merge = mergeIndividualBallots(soloDebate, [forged], { format: tournament.format, preferences: off });
    expect(merge.result?.selfSplit).toBeUndefined();
    expect(merge.result?.teamScores.AFF.votes).toBe(1);
  });

  it("rejects a split from a panel member or with the preference off, and a malformed flag", () => {
    const panel = { ...soloDebate, adjudicators: { ...soloDebate.adjudicators, panellistIds: ["p1"] } };
    expect(() => buildPrivateBallot(privateInput(true), { tournament, adjudicator: chair, debate: panel, teams, tournamentId: "t1" })).toThrow(/split decision/);
    const off = { ...tournament, preferences: { ...tournament.preferences, allowSelfSplitBallots: false } };
    expect(() => buildPrivateBallot(privateInput(true), { tournament: off, adjudicator: chair, debate: soloDebate, teams, tournamentId: "t1" })).toThrow(/split decision/);
    expect(() => buildPrivateBallot(privateInput("yes"), { tournament, adjudicator: chair, debate: soloDebate, teams, tournamentId: "t1" })).toThrow(/flag is invalid/);
    const plain = buildPrivateBallot(privateInput(false), { tournament, adjudicator: chair, debate: soloDebate, teams, tournamentId: "t1" });
    expect(plain.selfSplit).toBeUndefined();
  });
});

describe("participant ballots setting (Tabbycat participant_ballots)", () => {
  it("keeps private-URL ballots on unless turned off", () => {
    expect(privateUrlBallotsEnabled(tournament)).toBe(true);
    expect(privateUrlBallotsEnabled({ preferences: { ...tournament.preferences, privateUrlBallots: true } })).toBe(true);
    expect(privateUrlBallotsEnabled({ preferences: { ...tournament.preferences, privateUrlBallots: false } })).toBe(false);
  });
});

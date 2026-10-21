import { describe, expect, it } from "vitest";
import type { BallotSubmission, Debate, Round, SpeakerScoreEntry, Team, Tournament } from "@/types";
import { buildBallotResult, type BallotRules } from "./result";
import { changedTotalPreferences, recomputeStoredBallots } from "./resave";
import { calculateStandings } from "@/lib/standings/calculator";
import { saveTournamentCommand } from "@/features/tournament/application/settings";

/* Tabbycat `resaveballots`: stored totals follow a scoring-settings change. */

const prefs = { substantiveSpeakers: 3, replyScoresEnabled: false, minSpeakerScore: 60, maxSpeakerScore: 80, stepSpeakerScore: 1 };
const rules: BallotRules = { format: "wsdc", preferences: prefs };
const aff: SpeakerScoreEntry[] = [
  { speakerId: "a1", speakerName: "A1", position: 1, score: 75 },
  { speakerId: "a2", speakerName: "A2", position: 2, score: 74 },
  { speakerId: "a1", speakerName: "A1", position: 3, score: 73 },
];
const neg: SpeakerScoreEntry[] = [1, 2, 3].map((position) => ({ speakerId: `n${position}`, speakerName: `N${position}`, position, score: 70 }));
const result = buildBallotResult({ speakerScores: { AFF: aff, NEG: neg }, ranks: { AFF: 1, NEG: 2 } }, { AFF: "ta", NEG: "tn" }, undefined, rules);
const round = { id: "r1", seq: 1, stage: "preliminary", name: "R1" } as Round;
const debate = {
  id: "d1",
  roundId: "r1",
  roundSeq: 1,
  roomRank: 1,
  teams: { AFF: { teamId: "ta", side: "AFF", teamName: "A" }, NEG: { teamId: "tn", side: "NEG", teamName: "N" } },
  adjudicators: { panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
} as unknown as Debate;
const teams = [
  { id: "ta", name: "A", speakers: [{ id: "a1", name: "A1" }, { id: "a2", name: "A2" }, { id: "a3", name: "A3" }] },
  { id: "tn", name: "N", speakers: [{ id: "n1", name: "N1" }, { id: "n2", name: "N2" }, { id: "n3", name: "N3" }] },
] as unknown as Team[];
const ballot = {
  id: "b1", tournamentId: "t", roundId: "r1", debateId: "d1", version: 1, confirmed: true, discarded: false,
  submitterType: "tabroom", timestamp: "x", ...result,
} as unknown as BallotSubmission;
const tournamentOff = { id: "t", name: "T", format: "wsdc", preferences: { ...prefs, teamScoreIncludesGhosts: false } } as unknown as Tournament;
const tournamentOn = { ...tournamentOff, preferences: { ...prefs, teamScoreIncludesGhosts: true } } as Tournament;

describe("recomputeStoredBallots", () => {
  it("recalculates the stored team total when ghost speeches start counting", () => {
    expect(ballot.teamScores.AFF.totalSpeakerScore).toBe(149);
    const outcome = recomputeStoredBallots([ballot], { tournament: tournamentOn, rounds: [round], debates: [debate] });
    expect(outcome.updated).toHaveLength(1);
    expect(outcome.updated[0].teamScores.AFF.totalSpeakerScore).toBe(222);
    expect(outcome.updated[0].teamScores.AFF.margin).toBe(12);
    // Without the ghost speech A totalled 149 to N's 210 and lost; with it A has 222 and wins, so
    // the recalculation changes the result itself (as Tabbycat's resave would).
    expect(outcome.updated[0].teamScores.AFF.win).toBe(true);
    expect(outcome.resultChangedIds).toEqual(["b1"]);
    const standings = calculateStandings(tournamentOn, [round], teams, [debate], outcome.updated);
    expect(standings.teams.find((row) => row.teamId === "ta")!.totalSpeakerScore).toBe(222);
  });

  it("leaves ballots that already match the settings alone", () => {
    expect(recomputeStoredBallots([ballot], { tournament: tournamentOff, rounds: [round], debates: [debate] }).updated).toEqual([]);
  });

  it("only reacts to settings that feed stored totals", () => {
    expect(changedTotalPreferences({ teamScoreIncludesGhosts: false }, { teamScoreIncludesGhosts: true })).toEqual(["teamScoreIncludesGhosts"]);
    expect(changedTotalPreferences({ minSpeakerScore: 60 }, { minSpeakerScore: 50 })).toEqual([]);
  });
});

describe("saving settings recalculates stored ballots (with confirmation and an audit entry)", () => {
  it("needs the override, then saves the recalculated ballots and records ballots.resaved", async () => {
    let savedBallots: BallotSubmission[] = [];
    let savedDebates: Debate[] = [];
    const audit: string[] = [];
    const dependencies = {
      ballots: [ballot],
      rounds: [round],
      localRepository: { saveTournament() {} },
      recordAuditEvent: async (event: { action: string }) => { audit.push(event.action); },
      warn() {},
      resave: {
        debates: [debate],
        saveBallots: (items: BallotSubmission[]) => { savedBallots = items; },
        saveDebates: (items: Debate[]) => { savedDebates = items; },
      },
    };
    await expect(saveTournamentCommand(tournamentOn, tournamentOff, dependencies)).rejects.toThrow(/recalculated/);
    expect(savedBallots).toEqual([]);
    await saveTournamentCommand(tournamentOn, tournamentOff, dependencies, { reason: "Tabbycat default" } as never);
    expect(savedBallots[0].teamScores.AFF.totalSpeakerScore).toBe(222);
    expect(savedDebates[0].teams.AFF?.speakerScoreTotal).toBe(222);
    expect(audit).toContain("ballots.resaved");
  });
});

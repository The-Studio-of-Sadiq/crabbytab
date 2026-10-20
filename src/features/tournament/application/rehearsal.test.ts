import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ballotSides, validateBallotEntry, type BallotRules } from "@/lib/ballots/result";
import { createSeededRng } from "@/lib/draw/rng";
import { expectedFeedbackForDebate } from "@/lib/feedback/progress";
import { feedbackPathsForRound } from "@/lib/feedback/paths";
import { questionsForFeedbackSource, validateFeedbackAnswers } from "@/lib/feedback/questions";
import { buildDemoTournament, isDemoTournament, type DemoFormat } from "@/lib/rehearsal/demoTournament";
import { TournamentHarness } from "@/test/lifecycleHarness";
import { FIXED_TIME } from "@/test/tournamentFixtures";
import type { Round, TournamentPreferences } from "@/types";
import {
  SIMULATED_LABEL,
  addFeedbackInSequence,
  planSimulatedBallots,
  planSimulatedFeedback,
  submitBallotsInSequence,
} from "./rehearsal";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(FIXED_TIME));
});
afterAll(() => {
  vi.useRealTimers();
});

const NOW = new Date(FIXED_TIME);

/** A demo tournament loaded into the in-memory tab room, round 1 drawn, allocated and released. */
async function demoWithDraw(format: DemoFormat, preferences: Partial<TournamentPreferences> = {}, panelSize = 1) {
  const demo = buildDemoTournament({ format, slug: `demo-${format}`, ownerId: "owner", seed: 7, now: NOW });
  const tournament = { ...demo.tournament, preferences: { ...demo.tournament.preferences, ...preferences } };
  const harness = new TournamentHarness(tournament, (round: Round) => 900 + round.seq);
  harness.load(tournament, demo.collections as never);
  const round = harness.rounds.find((item) => item.seq === 1)!;
  await harness.generateDraw(round.id);
  await harness.allocate(round.id, panelSize);
  await harness.patchRound(round.id, { drawStatus: "confirmed" });
  return { harness, round: harness.round(round.id) };
}

function plan(harness: TournamentHarness, round: Round, seed = 3) {
  return planSimulatedBallots({
    tournament: harness.tournament,
    round,
    debates: harness.debates,
    teams: harness.teams,
    motions: harness.motions,
    ballots: harness.ballots,
    rng: createSeededRng(seed),
    submitter: { id: "tab-1", name: "Tab director" },
    now: NOW,
  });
}

describe("demo tournament", () => {
  it.each(["bp", "wsdc"] as const)("is deterministic and internally consistent (%s)", (format) => {
    const first = buildDemoTournament({ format, slug: `demo-${format}`, ownerId: "o", seed: 11, now: NOW });
    const second = buildDemoTournament({ format, slug: `demo-${format}`, ownerId: "o", seed: 11, now: NOW });
    expect(second).toEqual(first);
    expect(buildDemoTournament({ format, slug: `demo-${format}`, ownerId: "o", seed: 12, now: NOW })).not.toEqual(first);

    const { collections, tournament } = first;
    expect(isDemoTournament(tournament)).toBe(true);
    const allIds = Object.values(collections).flat().map((record) => (record as { id: string }).id);
    expect(new Set(allIds).size).toBe(allIds.length);
    const institutionIds = new Set(collections.institutions.map((item) => item.id));
    const speakers = format === "bp" ? 2 : 3;
    for (const team of collections.teams) {
      expect(team.speakers).toHaveLength(speakers);
      expect(institutionIds.has(team.institutionId!)).toBe(true);
      expect(team.breakCategories.every((id) => collections.breakCategories.some((category) => category.id === id))).toBe(true);
    }
    for (const adjudicator of collections.adjudicators) {
      if (adjudicator.institutionId) expect(institutionIds.has(adjudicator.institutionId)).toBe(true);
      for (const conflict of adjudicator.conflicts) expect(collections.teams.some((team) => team.id === conflict.teamId)).toBe(true);
    }
    expect(collections.teams.length % (format === "bp" ? 4 : 2)).toBe(0);
    expect(collections.rounds.filter((round) => round.stage === "elimination").length).toBeGreaterThan(0);
    expect(collections.motions.every((motion) => motion.rounds.length === 1 && !motion.released)).toBe(true);
  });

  it("refuses a slug without the demo prefix", () => {
    expect(() => buildDemoTournament({ format: "bp", slug: "real-open", ownerId: "o" })).toThrow(/demo-/);
  });
});

describe("simulated results", () => {
  it.each(["bp", "wsdc"] as const)("produces a valid confirmed ballot for every debate (%s)", async (format) => {
    const { harness, round } = await demoWithDraw(format);
    const { ballots, skipped } = plan(harness, round);
    const debates = harness.roundDebates(round.id).filter((debate) => !debate.byeTeamId);
    expect(skipped).toEqual([]);
    expect(ballots).toHaveLength(debates.length);
    const rules: BallotRules = { format, preferences: harness.tournament.preferences, stage: round.stage };
    for (const ballot of ballots) {
      expect(ballot).toMatchObject({ confirmed: true, discarded: false, submitterType: "tabroom" });
      expect(ballot.submitterName).toContain(SIMULATED_LABEL);
      const points = ballotSides(format).map((side) => ballot.teamScores[side].points).sort();
      expect(points).toEqual(format === "bp" ? [0, 1, 2, 3] : [0, 1]);
      // The higher-ranked team never has the lower total (no low-point wins).
      const sides = ballotSides(format).sort((left, right) => ballot.teamScores[right].points - ballot.teamScores[left].points);
      const totals = sides.map((side) => ballot.teamScores[side].totalSpeakerScore);
      expect([...totals].sort((a, b) => b - a)).toEqual(totals);
      const debate = debates.find((item) => item.id === ballot.debateId)!;
      const rosters = Object.fromEntries(ballotSides(format).map((side) => [side, harness.teams.find((team) => team.id === debate.teams[side].teamId)!.speakers]));
      expect(validateBallotEntry({ speakerScores: ballot.speakerScores, ranks: Object.fromEntries(sides.map((side, index) => [side, index + 1])) }, { ...rules, rosters })).toEqual([]);
    }
  });

  it("is reproducible from a seed", async () => {
    const { harness, round } = await demoWithDraw("wsdc");
    expect(plan(harness, round, 5).ballots).toEqual(plan(harness, round, 5).ballots);
    expect(plan(harness, round, 5).ballots).not.toEqual(plan(harness, round, 6).ballots);
  });

  it("builds voting ballots with one untied sheet per voting adjudicator", async () => {
    const { harness, round } = await demoWithDraw("wsdc", { ballotMode: "voting" }, 3);
    const { ballots, skipped } = plan(harness, round);
    expect(skipped).toEqual([]);
    for (const ballot of ballots) {
      const debate = harness.debates.find((item) => item.id === ballot.debateId)!;
      expect(ballot.sheets).toHaveLength(1 + debate.adjudicators.panellistIds.length);
    }
  });

  it("submits through the ballot command, so every debate is resulted and standings follow", async () => {
    const { harness, round } = await demoWithDraw("bp");
    const { ballots } = plan(harness, round);
    const audit: string[] = [];
    const state = await submitBallotsInSequence(ballots, { ballots: harness.ballots, debates: harness.debates, rounds: harness.rounds }, {
      adjudicators: harness.adjudicators,
      recordAuditEvent: async (event) => { audit.push(event.action); },
      updateRound: async () => undefined,
    });
    expect(state.ballots).toHaveLength(ballots.length);
    const resulted = state.debates.filter((debate) => debate.roundId === round.id && !debate.byeTeamId);
    expect(resulted.every((debate) => debate.resultStatus === "confirmed")).toBe(true);
    expect(audit.filter((action) => action === "ballot.submitted")).toHaveLength(ballots.length);
    harness.ballots = state.ballots;
    harness.debates = state.debates;
    expect(harness.standings().teams.reduce((sum, row) => sum + row.points, 0)).toBe(6 * resulted.length);
  });

  it("respects the round's state rules: a completed round needs an override", async () => {
    const { harness, round } = await demoWithDraw("wsdc");
    const { ballots } = plan(harness, round);
    const completed = { ...round, completed: true };
    const rounds = harness.rounds.map((item) => (item.id === round.id ? completed : item));
    await expect(submitBallotsInSequence(ballots, { ballots: harness.ballots, debates: harness.debates, rounds }, {
      adjudicators: harness.adjudicators,
      recordAuditEvent: async () => undefined,
      updateRound: async () => undefined,
    })).rejects.toMatchObject({ name: "TournamentRuleError" });
  });

  it("skips debates that already have a ballot and reports them", async () => {
    const { harness, round } = await demoWithDraw("wsdc");
    const first = plan(harness, round);
    harness.ballots = [first.ballots[0]];
    const second = plan(harness, round);
    expect(second.ballots).toHaveLength(first.ballots.length - 1);
    expect(second.skipped).toEqual([{ debateId: first.ballots[0].debateId, reason: "The debate already has a ballot." }]);
  });
});

describe("simulated feedback", () => {
  it("follows the feedback paths, answers the questions validly and goes through the command", async () => {
    const { harness, round } = await demoWithDraw("bp", {}, 3);
    const { feedback, skipped } = planSimulatedFeedback({
      tournament: harness.tournament,
      round,
      debates: harness.debates,
      teams: harness.teams,
      adjudicators: harness.adjudicators,
      feedback: [],
      rng: createSeededRng(4),
    });
    expect(skipped).toEqual([]);
    const paths = feedbackPathsForRound(harness.tournament.preferences, round);
    const expected = harness.roundDebates(round.id).flatMap((debate) => expectedFeedbackForDebate(debate, paths));
    expect(feedback).toHaveLength(expected.length);
    for (const item of feedback) {
      expect(item.score).toBeGreaterThanOrEqual(harness.tournament.preferences.feedbackMinScore);
      expect(item.score).toBeLessThanOrEqual(harness.tournament.preferences.feedbackMaxScore);
      expect(validateFeedbackAnswers(questionsForFeedbackSource(item.sourceType, harness.tournament.preferences), item.answers ?? {})).toBeNull();
    }
    let counter = 0;
    const saved = await addFeedbackInSequence(feedback, {
      tournament: harness.tournament,
      feedback: [],
      createId: () => `fb-sim-${++counter}`,
      recordAuditEvent: async () => undefined,
    });
    expect(saved).toHaveLength(feedback.length);
    expect(new Set(saved.map((item) => item.id)).size).toBe(saved.length);

    // A second run adds nothing: every expected pair already has feedback.
    const again = planSimulatedFeedback({
      tournament: harness.tournament, round, debates: harness.debates, teams: harness.teams,
      adjudicators: harness.adjudicators, feedback: saved, rng: createSeededRng(4),
    });
    expect(again.feedback).toEqual([]);
  });

  it("does nothing when feedback is off", async () => {
    const { harness, round } = await demoWithDraw("wsdc", { feedbackEnabled: false });
    const result = planSimulatedFeedback({
      tournament: harness.tournament, round, debates: harness.debates, teams: harness.teams,
      adjudicators: harness.adjudicators, feedback: [], rng: createSeededRng(1),
    });
    expect(result.feedback).toEqual([]);
    expect(result.skipped[0].reason).toMatch(/not enabled/);
  });
});

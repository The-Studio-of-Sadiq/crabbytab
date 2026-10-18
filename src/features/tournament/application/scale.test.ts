import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Round, TournamentFormat } from "@/types";
import { createSeededRng } from "@/lib/draw/rng";
import { buildPublicViewSections, chunkSectionJson, latestPublicRoundId, PUBLIC_PROJECTION_BASE_SECTIONS, roundSectionName } from "@/lib/publicView/snapshot";
import type { SourceRecord } from "@/lib/publicView/projection";
import { TournamentHarness } from "@/test/lifecycleHarness";
import { FIXED_TIME, makeAdjudicators, makeTeams, makeTournament, makeVenues, simulateBallot } from "@/test/tournamentFixtures";

/**
 * Scale benchmark: 1000-team BP (550 adjudicators) and WSDC (1100 adjudicators) tournaments run
 * through the real application commands (draw, allocation, ballots, standings, public view).
 * Asserts nothing crashes, every round is a valid draw, the public view's cache entries and
 * responses stay under Vercel's limits, and generous time budgets (CI machines are slower).
 *
 * CRABBYTAB_SCALE=full runs all 9 rounds; the default runs 2 rounds of each (a random or single-bracket
 * first round and a power-paired second);
 * CRABBYTAB_SCALE=off skips it (e.g. on slow CI runners).
 */

const mode = process.env.CRABBYTAB_SCALE ?? "quick";
const TEAMS = 1000;
// Auto-allocation is the slow step at this size (5-15 s a round for 500 WSDC rooms with panels of
// two); it runs in a Web Worker in the app, so it does not freeze the page.
const BUDGET_MS = { draw: 15_000, allocation: 30_000, standings: 3_000, publicView: 3_000 };
/** Vercel Data Cache entry limit is 2 MB and a function response 4.5 MB; keep clear of both. */
const MAX_SECTION_BYTES = 1_500_000;
const MAX_RESPONSE_BYTES = 3_000_000;

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const kb = (value: number) => `${Math.round(value / 1024)} KB`;

function time<T>(run: () => T): [T, number] {
  const start = performance.now();
  const result = run();
  return [result, performance.now() - start];
}
async function timeAsync<T>(run: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const result = await run();
  return [result, performance.now() - start];
}

function setUp(format: TournamentFormat, adjudicators: number): TournamentHarness {
  // Two-team pairing with the default one_up_one_down rule ignores side limits, so by round 7 of 9
  // it can pair two teams that have both reached the 5-per-side limit, and the draw (correctly)
  // refuses. min_cost matching treats side limits as hard constraints while pairing.
  const tournament = makeTournament(format, format === "bp" ? {} : { conflictAvoidance: "min_cost" }, `t-scale-${format}`);
  const harness = new TournamentHarness(tournament, (round: Round) => 500 + round.seq);
  harness.teams = makeTeams(TEAMS, { tournamentId: tournament.id, institutionCount: 150, speakersPerTeam: format === "bp" ? 2 : 3 });
  harness.adjudicators = makeAdjudicators(adjudicators, { tournamentId: tournament.id, institutionCount: 150 });
  harness.venues = makeVenues(format === "bp" ? TEAMS / 4 + 10 : TEAMS / 2 + 10, tournament.id);
  return harness;
}

async function playRounds(harness: TournamentHarness, rounds: number, panelSize: number) {
  const rng = createSeededRng(99);
  const report: string[] = [];
  for (let seq = 1; seq <= rounds; seq++) {
    const round = await harness.createRound({ roundSeq: seq, name: `Round ${seq}`, abbr: `R${seq}`, stage: "preliminary" });
    const [debates, drawMs] = await timeAsync(() => harness.generateDraw(round.id));
    const [, allocationMs] = await timeAsync(() => harness.allocate(round.id, panelSize));

    // Every team debates exactly once, and no adjudicator sits on two panels.
    const teamIds = debates.flatMap((debate) => Object.values(debate.teams).map((slot) => slot?.teamId));
    expect(new Set(teamIds).size).toBe(TEAMS);
    expect(teamIds).toHaveLength(TEAMS);
    const panelIds = harness.roundDebates(round.id).flatMap((debate) => [
      debate.adjudicators.chairId,
      ...debate.adjudicators.panellistIds,
      ...debate.adjudicators.traineeIds,
    ]).filter(Boolean);
    expect(new Set(panelIds).size).toBe(panelIds.length);
    expect(harness.roundDebates(round.id).every((debate) => debate.adjudicators.chairId)).toBe(true);
    expect(harness.drawCheck(round.id).filter((issue) => issue.severity === "error")).toEqual([]);

    await harness.patchRound(round.id, { drawStatus: "released", adjudicatorsRevealed: true });
    for (const debate of harness.roundDebates(round.id)) {
      await harness.submitBallot(simulateBallot(debate, harness.teams, harness.tournament, rng));
    }
    await harness.completeRound(round.id);
    await harness.patchRound(round.id, { resultsReleased: true, teamSpeaksReleased: true });
    const [standings, standingsMs] = time(() => harness.standings());
    expect(standings.teams).toHaveLength(TEAMS);

    const line = `R${seq}: draw ${Math.round(drawMs)} ms, allocation ${Math.round(allocationMs)} ms, standings ${Math.round(standingsMs)} ms`;
    console.info(`${harness.tournament.format} ${line}`);
    report.push(line);
    expect(drawMs).toBeLessThan(BUDGET_MS.draw);
    expect(allocationMs).toBeLessThan(BUDGET_MS.allocation);
    expect(standingsMs).toBeLessThan(BUDGET_MS.standings);
  }
  return report;
}

function checkPublicView(harness: TournamentHarness): string {
  const source = Object.fromEntries(
    (["rounds", "teams", "adjudicators", "debates", "ballots", "motions", "breakCategories", "institutions", "venues"] as const)
      .map((name) => [name, harness.collections()[name]])
  );
  const [sections, buildMs] = time(() =>
    buildPublicViewSections(harness.tournament as unknown as SourceRecord, source as never)
  );
  expect(buildMs).toBeLessThan(BUDGET_MS.publicView);
  const sizes = Object.entries(sections).map(([name, value]) => [name, bytes(value)] as const);
  for (const [name, size] of sizes) expect(size, name).toBeLessThan(MAX_SECTION_BYTES);
  // Each section is stored in Firestore chunks of at most 700 KB.
  for (const [, value] of Object.entries(sections)) for (const chunk of chunkSectionJson(value)) expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(700_000);

  const latest = latestPublicRoundId(sections.rounds as Array<Record<string, unknown>>)!;
  const response = bytes([
    ...PUBLIC_PROJECTION_BASE_SECTIONS.map((section) => sections[section]),
    sections[roundSectionName(latest)],
  ]);
  expect(response).toBeLessThan(MAX_RESPONSE_BYTES);
  const total = sizes.reduce((sum, [, size]) => sum + size, 0);
  const largest = [...sizes].sort((a, b) => b[1] - a[1])[0];
  return `public view ${kb(total)} in ${sizes.length} sections (largest ${largest[0]} ${kb(largest[1])}), ` +
    `first response ${kb(response)}, built in ${Math.round(buildMs)} ms; working copy ${kb(bytes(harness.collections()))}`;
}

const scale = mode === "off" ? describe.skip : describe;

scale("1000-team tournaments", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(FIXED_TIME));
    vi.spyOn(Math, "random").mockImplementation(createSeededRng(11));
  });
  afterAll(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("runs a British Parliamentary tournament (550 adjudicators)", async () => {
    const harness = setUp("bp", 550);
    const report = await playRounds(harness, mode === "full" ? 9 : 2, 2);
    report.push(checkPublicView(harness));
    console.info(`BP, ${TEAMS} teams:\n  ${report.join("\n  ")}`);
  }, 600_000);

  it("runs a WSDC tournament (1100 adjudicators), including the single-bracket first round", async () => {
    const harness = setUp("wsdc", 1100);
    const report = await playRounds(harness, mode === "full" ? 9 : 2, 2);
    report.push(checkPublicView(harness));
    console.info(`WSDC, ${TEAMS} teams:\n  ${report.join("\n  ")}`);
  }, 600_000);
});

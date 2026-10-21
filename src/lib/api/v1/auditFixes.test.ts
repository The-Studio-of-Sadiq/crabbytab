import { beforeEach, describe, expect, it } from "vitest";
import { createSeededRng } from "@/lib/draw/rng";
import { API_TOKEN_SCOPES, type ApiTokenScope } from "@/lib/apiScopes";
import type { BallotSubmission, Debate, Team } from "@/types";
import { createApiTestContext, type ApiTestContext } from "@/test/apiFixture";
import { simulateBallot } from "@/test/tournamentFixtures";
import type { StoredRecord } from "./store";

/** Regression tests for the REST API v1 audit (scratch-tmp/audit2/api.json). */

type Json = Record<string, unknown>;

let api: ApiTestContext;
let writer: string;
const base = "/tournaments/api-open";
const ALL_WRITE = API_TOKEN_SCOPES.filter((scope) => scope.startsWith("write:")) as ApiTokenScope[];

beforeEach(async () => {
  api = await createApiTestContext();
  writer = api.token([...ALL_WRITE, "read:standings", "read:results", "read:draws", "read:tournament"]);
});

function entry() {
  return api.store.tournaments.get("t-api")!;
}
function preferences(): Json {
  return entry().tournament.preferences as Json;
}
function setPreferences(changes: Json) {
  entry().tournament.preferences = { ...preferences(), ...changes };
}
function stored(collection: string): StoredRecord[] {
  return entry().collections[collection as "teams"] ?? [];
}
function active(collection: string) {
  return stored(collection).filter((record) => typeof record.deletedAt !== "string");
}
function round2Debates(): Debate[] {
  const round = active("rounds").find((item) => item.seq === 2)!;
  return active("debates").filter((debate) => debate.roundId === round.id) as unknown as Debate[];
}
function round1Debate(): Debate {
  return (active("debates") as unknown as Debate[]).find((item) => item.roundSeq === 1 && !item.byeTeamId)!;
}
async function releaseRound2() {
  await api.call("POST", `${base}/rounds/2/pairings/allocate-adjudicators`, { token: writer, body: { panelSize: 1 } });
  await api.call("PATCH", `${base}/rounds/2`, { token: writer, body: { drawStatus: "confirmed", adjudicatorsRevealed: true } });
}
function entryFor(debate: Debate, seed = 5) {
  const ballot = simulateBallot(debate, active("teams") as unknown as Team[], api.harness.tournament, createSeededRng(seed));
  const ranks = Object.fromEntries(Object.entries(ballot.teamScores).map(([side, score]) => [side, score.win ? 1 : 2]));
  return { speakerScores: ballot.speakerScores, ranks };
}

describe("results-only ballots", () => {
  it("keep noSpeakerScores, so standings do not count their speeches", async () => {
    setPreferences({ speakersInBallots: "never" });
    await releaseRound2();
    const debate = round2Debates().find((item) => !item.byeTeamId)!;
    const result = await api.call("POST", `${base}/rounds/2/pairings/${debate.id}/ballots`, {
      token: writer,
      body: { entry: { speakerScores: {}, ranks: { AFF: 1, NEG: 2 } }, confirmed: true },
    });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    expect(result.body).toMatchObject({ noSpeakerScores: true, confirmed: true });
    expect(stored("ballots").find((ballot) => ballot.id === (result.body as Json).id)).toMatchObject({ noSpeakerScores: true });
  });
});

describe("PATCH /preferences", () => {
  async function patch(changes: Json) {
    return api.call("PATCH", `${base}/preferences`, { token: writer, body: { preferences: changes } });
  }

  it("refuses values outside a setting's choices and unknown preferences, saving nothing", async () => {
    const before = JSON.stringify(preferences());
    const result = await patch({ drawRule: "bogus", sideAllocationRule: "nonsense", arbitraryNewKey: 1 });
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { issues: [{ path: "arbitraryNewKey", message: "is not a known preference" }] } });
    const choices = await patch({ drawRule: "bogus", sideAllocationRule: "nonsense" });
    expect(choices.status).toBe(422);
    expect((choices.body as { error: { issues: Array<{ path: string }> } }).error.issues.map((issue) => issue.path).sort())
      .toEqual(["drawRule", "sideAllocationRule"]);
    expect(JSON.stringify(preferences())).toBe(before);
  });

  it("validates structured preferences with their own validators", async () => {
    const backwards = await patch({
      scheduleEvents: [{ id: "e1", type: "briefing", startTime: "2026-10-01T10:00:00.000Z", endTime: "2026-10-01T09:00:00.000Z" }],
    });
    expect(backwards.status).toBe(422);
    expect(JSON.stringify(backwards.body)).toContain("ends before it starts");
    const unknownRound = await patch({ scheduleEvents: [{ id: "e1", type: "debate", startTime: "2026-10-01T10:00:00.000Z", roundId: "nope" }] });
    expect(unknownRound.status).toBe(422);
    const ok = await patch({ scheduleEvents: [{ id: "e1", type: "briefing", startTime: "2026-10-01T10:00:00.000Z" }] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    const duplicateCategory = await patch({ venueCategories: [{ name: "Step-free" }, { name: "step-free " }] });
    expect(duplicateCategory.status).toBe(422);
    const badCriteria = await patch({
      scoreCriteria: [{ id: "c1", name: "Style", seq: 1, speechType: "all", weight: 0, minScore: 1, maxScore: 10, step: 1, required: true }],
    });
    expect(badCriteria.status).toBe(422);
    expect(JSON.stringify(badCriteria.body)).toContain("weight must be greater than 0");
    const wrongShape = await patch({ feedbackPaths: { teams: "everyone" } });
    expect(wrongShape.status).toBe(422);
    const badMetric = await patch({ teamStandingsPrecedence: ["wins", "not_a_metric"] });
    expect(badMetric.status).toBe(422);
  });

  it("keeps managed and required preferences protected", async () => {
    expect((await patch({ speakerCategories: [] })).status).toBe(422);
    expect((await patch({ teamFeedbackQuestions: [] })).status).toBe(422);
    expect((await patch({ drawRule: null })).status).toBe(422);
    const removed = await patch({ publicLanguage: "fr" });
    expect(removed.status).toBe(200);
    expect((await patch({ publicLanguage: null })).status).toBe(200);
    expect(preferences().publicLanguage).toBeUndefined();
    expect((await patch({ publicLanguage: "xx" })).status).toBe(422);
  });

  it("checks score ranges stay ordered", async () => {
    const result = await patch({ feedbackMinScore: 10, feedbackMaxScore: 5 });
    expect(result.status).toBe(422);
  });
});

describe("public standings with a tab limit", () => {
  it("serve the published top-N tab, as the public page shows it", async () => {
    setPreferences({ releaseTeamTab: true, releaseSpeakerTab: true, teamTabLimit: 2, speakerTabLimit: 3 });
    const full = (await api.call("GET", `${base}/teams/standings`, { token: writer })).body as { data: Array<{ teamId: string; rank: number }> };
    const publicToken = api.token(["read:public"]);
    const result = await api.call("GET", `${base}/teams/standings`, { token: publicToken });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const rows = (result.body as { data: Array<{ teamId: string; rank: number }> }).data;
    const expected = full.data.filter((row) => row.rank > 0 && row.rank <= 2);
    expect(rows.map((row) => [row.teamId, row.rank])).toEqual(expected.map((row) => [row.teamId, row.rank]));
    expect(rows.length).toBeGreaterThan(0);

    const speakers = await api.call("GET", `${base}/speakers/standings`);
    expect(speakers.status).toBe(200);
    for (const row of (speakers.body as { data: Array<{ rank: number }> }).data) expect(row.rank).toBeLessThanOrEqual(3);

    const recompute = await api.call("GET", `${base}/teams/standings?round=1`, { token: publicToken });
    expect(recompute.status).toBe(422);
    const unreleased = await api.call("GET", `${base}/speakers/standings/replies`, { token: publicToken });
    expect(unreleased.status).toBe(403);
  });
});

describe("blind double entry", () => {
  beforeEach(() => setPreferences({ ballotDoubleEntry: true, ballotCheckMode: "blind" }));

  it("compares a check with the version it checks", async () => {
    await releaseRound2();
    const debate = round2Debates().find((item) => !item.byeTeamId)!;
    const first = await api.call("POST", `${base}/rounds/2/pairings/${debate.id}/ballots`, { token: writer, body: { entry: entryFor(debate) } });
    expect(first.status).toBe(201);
    const checker = api.token(["write:results"]);
    const differing = entryFor(debate);
    const speech = differing.speakerScores.AFF![0];
    differing.speakerScores.AFF![0] = { ...speech, score: speech.score === 70 ? 71 : 70 };
    const mismatch = await api.call("POST", `${base}/rounds/2/pairings/${debate.id}/ballots`, {
      token: checker,
      body: { entry: differing, confirmed: true, checksVersion: 1 },
    });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body).toMatchObject({ error: { code: "conflict", differences: [expect.objectContaining({ field: "AFF speech 1" })] } });
    expect(active("ballots").filter((ballot) => ballot.debateId === debate.id)).toHaveLength(1);

    const missing = await api.call("POST", `${base}/rounds/2/pairings/${debate.id}/ballots`, {
      token: checker,
      body: { entry: entryFor(debate), confirmed: true, checksVersion: 7 },
    });
    expect(missing.status).toBe(422);

    const matching = await api.call("POST", `${base}/rounds/2/pairings/${debate.id}/ballots`, {
      token: checker,
      body: { entry: entryFor(debate), confirmed: true, checksVersion: 1 },
    });
    expect(matching.status, JSON.stringify(matching.body)).toBe(201);
    expect(matching.body).toMatchObject({ confirmed: true, checksVersion: 1 });
  });

  it("saves a differing check when the client keeps it", async () => {
    await releaseRound2();
    const debate = round2Debates().find((item) => !item.byeTeamId)!;
    await api.call("POST", `${base}/rounds/2/pairings/${debate.id}/ballots`, { token: writer, body: { entry: entryFor(debate) } });
    const differing = entryFor(debate);
    const speech = differing.speakerScores.AFF![0];
    differing.speakerScores.AFF![0] = { ...speech, score: speech.score === 70 ? 71 : 70 };
    const kept = await api.call("POST", `${base}/rounds/2/pairings/${debate.id}/ballots`, {
      token: api.token(["write:results"]),
      body: { entry: differing, confirmed: true, checksVersion: 1, acceptDifferences: true },
    });
    expect(kept.status, JSON.stringify(kept.body)).toBe(201);
  });
});

describe("ballot review", () => {
  it("DELETE discards a version", async () => {
    await releaseRound2();
    const debate = round2Debates().find((item) => !item.byeTeamId)!;
    const created = await api.call("POST", `${base}/rounds/2/pairings/${debate.id}/ballots`, { token: writer, body: { entry: entryFor(debate) } });
    const id = (created.body as Json).id as string;
    const removed = await api.call("DELETE", `${base}/rounds/2/pairings/${debate.id}/ballots/${id}`, { token: writer });
    expect(removed.status).toBe(204);
    expect(stored("ballots").find((ballot) => ballot.id === id)).toMatchObject({ discarded: true, confirmed: false });
    expect((await api.call("DELETE", `${base}/rounds/2/pairings/${debate.id}/ballots/${id}`, { token: writer })).status).toBe(404);
  });

  it("unconfirm withdraws the result and keeps its content as a new unconfirmed version", async () => {
    await releaseRound2();
    const debate = round2Debates().find((item) => !item.byeTeamId)!;
    const created = await api.call("POST", `${base}/rounds/2/pairings/${debate.id}/ballots`, { token: writer, body: { entry: entryFor(debate), confirmed: true } });
    const original = created.body as BallotSubmission;
    const result = await api.call("PATCH", `${base}/rounds/2/pairings/${debate.id}/ballots/${original.id}`, {
      token: writer,
      body: { action: "unconfirm" },
    });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const copy = result.body as BallotSubmission;
    expect(copy).toMatchObject({ confirmed: false, discarded: false, version: 2, teamScores: original.teamScores, speakerScores: original.speakerScores });
    expect(stored("ballots").find((ballot) => ballot.id === original.id)).toMatchObject({ discarded: true });
    expect(stored("debates").find((item) => item.id === debate.id)).toMatchObject({ resultStatus: "draft" });
    const again = await api.call("PATCH", `${base}/rounds/2/pairings/${debate.id}/ballots/${copy.id}`, { token: writer, body: { action: "unconfirm" } });
    expect(again.status).toBe(409);
  });

  it("unconfirming a completed round's result needs an override", async () => {
    const debate = round1Debate();
    const ballot = active("ballots").find((item) => item.debateId === debate.id && item.confirmed)!;
    const refused = await api.call("PATCH", `${base}/rounds/1/pairings/${debate.id}/ballots/${ballot.id}`, { token: writer, body: { action: "unconfirm" } });
    expect(refused.status).toBe(409);
    expect(stored("ballots").find((item) => item.id === ballot.id)).toMatchObject({ confirmed: true });
  });
});

describe("feedback audit", () => {
  it("names the stored record's id", async () => {
    const debate = round1Debate();
    const result = await api.call("POST", `${base}/feedback`, {
      token: writer,
      body: { debateId: debate.id, sourceType: "team", sourceId: debate.teams.NEG.teamId, targetAdjudicatorId: debate.adjudicators.chairId, score: 3 },
    });
    expect(result.status).toBe(201);
    const id = (result.body as Json).id;
    expect(stored("feedback").some((item) => item.id === id)).toBe(true);
    const event = stored("auditEvents").find((item) => item.action === "feedback.submitted");
    expect((event?.details as Json).feedbackId).toBe(id);
  });
});

describe("preformed panels", () => {
  it("one panel is read from the same round as the list", async () => {
    const round = active("rounds").find((item) => item.seq === 2)!;
    round.preformedPanels = [{ id: "panel-a", panellistIds: [], traineeIds: [], importance: 0 }];
    // A second record with the same sequence number (e.g. left by a failed renumbering).
    stored("rounds").push({ ...round, id: "zz-duplicate", preformedPanels: [{ id: "panel-z", panellistIds: [], traineeIds: [], importance: 0 }] });
    const list = await api.call("GET", `${base}/rounds/2/preformed-panels`, { token: writer });
    const listedIds = ((list.body as { data: Array<{ id: string }> }).data).map((panel) => panel.id);
    for (const id of ["panel-a", "panel-z"]) {
      const one = await api.call("GET", `${base}/rounds/2/preformed-panels/${id}`, { token: writer });
      expect(one.status === 200).toBe(listedIds.includes(id));
    }
  });
});

describe("public ballots", () => {
  it("serves the confirmed ballots of public results once ballots are released", async () => {
    const debate = round1Debate();
    const refused = await api.call("GET", `${base}/rounds/1/pairings/${debate.id}/ballots`);
    expect(refused.status).toBe(403);
    setPreferences({ releaseBallots: true });
    const listed = await api.call("GET", `${base}/rounds/1/pairings/${debate.id}/ballots`);
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    const ballots = (listed.body as { data: BallotSubmission[] }).data;
    expect(ballots.length).toBeGreaterThan(0);
    expect(ballots.every((ballot) => ballot.confirmed && !ballot.discarded)).toBe(true);
    expect(JSON.stringify(ballots)).not.toMatch(/submitterName/);
    const round = await api.call("GET", `${base}/rounds/1/ballots`, { token: api.token(["read:public"]) });
    expect(round.status).toBe(200);
    // Round 2 has no public results: nothing is served.
    const unreleased = round2Debates().find((item) => !item.byeTeamId)!;
    expect((await api.call("GET", `${base}/rounds/2/pairings/${unreleased.id}/ballots`)).status).toBe(404);
  });
});

describe("participants' own records", () => {
  function teamHeaders(team: Team) {
    return { authorization: `Key ${team.privateUrlKey}`, "x-passcode": String(team.privatePasscode) };
  }

  it("a team sees its released results and its own feedback; nothing else", async () => {
    const debate = round1Debate();
    const team = active("teams").find((item) => item.id === debate.teams.AFF.teamId) as unknown as Team;
    const ballots = await api.call("GET", `${base}/me/ballots`, { headers: teamHeaders(team) });
    expect(ballots.status, JSON.stringify(ballots.body)).toBe(200);
    const data = (ballots.body as { data: BallotSubmission[] }).data;
    expect(data.length).toBeGreaterThan(0);
    const ownDebates = new Set((active("debates") as unknown as Debate[])
      .filter((item) => Object.values(item.teams).some((slot) => slot?.teamId === team.id))
      .map((item) => item.id));
    expect(data.every((ballot) => ownDebates.has(ballot.debateId))).toBe(true);
    // Round 1's team speaks are not released: no speaker scores.
    expect(data.every((ballot) => Object.keys(ballot.speakerScores ?? {}).length === 0)).toBe(true);

    const feedback = await api.call("GET", `${base}/me/feedback`, { headers: teamHeaders(team) });
    expect(feedback.status).toBe(200);
    expect((feedback.body as { data: Array<{ id: string }> }).data.map((item) => item.id)).toEqual(["fb-1"]);
    const otherTeam = active("teams").find((item) => item.id === debate.teams.NEG.teamId) as unknown as Team;
    const other = await api.call("GET", `${base}/me/feedback`, { headers: teamHeaders(otherTeam) });
    expect((other.body as { data: unknown[] }).data).toEqual([]);
    expect((await api.call("GET", `${base}/me/ballots`)).status).toBe(401);
  });

  it("/me accepts a speaker's own private URL key", async () => {
    const team = active("teams")[0] as unknown as Team & StoredRecord;
    const speaker = team.speakers[0];
    team.speakers = team.speakers.map((item, index) => (index === 0 ? { ...item, privateUrlKey: "spk_key0", privatePasscode: "spkpass" } : item));
    (team as unknown as Json).speakerUrlKeys = ["spk_key0"];
    const me = await api.call("GET", `${base}/me`, { headers: { authorization: "Key spk_key0", "x-passcode": "spkpass" } });
    expect(me.status, JSON.stringify(me.body)).toBe(200);
    expect(me.body).toMatchObject({ type: "team", id: team.id, speakerId: speaker.id });
    const wrong = await api.call("GET", `${base}/me`, { headers: { authorization: "Key spk_key0", "x-passcode": "nope" } });
    expect(wrong.status).toBe(401);
  });
});

describe("public reads Tabbycat makes public", () => {
  it("feedback questions and score criteria", async () => {
    expect((await api.call("GET", `${base}/feedback-questions`)).status).toBe(200);
    expect((await api.call("GET", `${base}/score-criteria`)).status).toBe(200);
  });

  it("break and speaker eligibility once released", async () => {
    expect((await api.call("GET", `${base}/break-categories/bc-open/eligibility`)).status).toBe(403);
    expect((await api.call("GET", `${base}/speaker-categories/spkcat-esl/eligibility`)).status).toBe(403);
    setPreferences({ publicParticipants: true, publicBreakCategories: true });
    const breakEligibility = await api.call("GET", `${base}/break-categories/bc-open/eligibility`);
    expect(breakEligibility.status, JSON.stringify(breakEligibility.body)).toBe(200);
    expect((breakEligibility.body as { teamIds: string[] }).teamIds).toHaveLength(6);
    const speakerEligibility = await api.call("GET", `${base}/speaker-categories/spkcat-esl/eligibility`);
    expect(speakerEligibility.status).toBe(200);
    expect((speakerEligibility.body as { speakerIds: string[] }).speakerIds).toHaveLength(1);
    // A private category is not in the public view.
    expect((await api.call("GET", `${base}/speaker-categories/spkcat-novice/eligibility`)).status).toBe(404);
  });

  it("institutions filtered by region", async () => {
    const institutions = stored("institutions");
    institutions[0].region = "Asia";
    institutions[1].region = "Europe";
    const result = await api.call("GET", `${base}/institutions?region=Asia`, { token: writer });
    expect(result.status).toBe(200);
    expect((result.body as { data: Array<{ id: string }> }).data.map((item) => item.id)).toEqual([institutions[0].id]);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { createSeededRng } from "@/lib/draw/rng";
import { API_TOKEN_SCOPES, type ApiTokenScope } from "@/lib/apiScopes";
import type { Adjudicator, BallotSubmission, Debate, Team } from "@/types";
import { createApiTestContext, type ApiTestContext } from "@/test/apiFixture";
import { simulateBallot } from "@/test/tournamentFixtures";
import type { StoredRecord } from "./store";

/** Participant (private URL key) submissions through v1: ballots, feedback, self check-in. */

type Json = Record<string, unknown>;

let api: ApiTestContext;
let writer: string;
const base = "/tournaments/api-open";

beforeEach(async () => {
  api = await createApiTestContext();
  writer = api.token(API_TOKEN_SCOPES.filter((scope) => scope.startsWith("write:")) as ApiTokenScope[]);
});

function stored(collection: string): StoredRecord[] {
  return api.store.tournaments.get("t-api")!.collections[collection as "teams"] ?? [];
}
function active(collection: string) {
  return stored(collection).filter((record) => typeof record.deletedAt !== "string");
}
function keyOf(adjudicatorId: string) {
  const adjudicator = active("adjudicators").find((item) => item.id === adjudicatorId) as unknown as Adjudicator;
  return { authorization: `Key ${adjudicator.privateUrlKey}`, "x-passcode": String(adjudicator.privatePasscode) };
}
function teamKey(teamId: string) {
  const team = active("teams").find((item) => item.id === teamId) as unknown as Team;
  return { authorization: `Key ${team.privateUrlKey}`, "x-passcode": String(team.privatePasscode) };
}
function round2Debates(): Debate[] {
  const round = active("rounds").find((item) => item.seq === 2)!;
  return active("debates").filter((debate) => debate.roundId === round.id) as unknown as Debate[];
}
function portalBallot(debate: Debate) {
  const ballot = simulateBallot(debate, active("teams") as unknown as Team[], api.harness.tournament, createSeededRng(3));
  return {
    debateId: debate.id,
    speakerScores: Object.fromEntries(Object.entries(ballot.speakerScores).map(([side, speeches]) => [
      side,
      speeches!.map(({ speakerId, position, score }) => ({ speakerId, position, score })),
    ])),
    teamScores: Object.fromEntries(Object.entries(ballot.teamScores).map(([side, score]) => [side, { rank: score.win ? 1 : 2 }])),
  };
}

async function releaseRound2() {
  await api.call("POST", `${base}/rounds/2/pairings/allocate-adjudicators`, { token: writer, body: { panelSize: 1 } });
  await api.call("PATCH", `${base}/rounds/2`, { token: writer, body: { drawStatus: "confirmed", adjudicatorsRevealed: true } });
}

describe("participant ballots", () => {
  it("refuses debates of unreleased draws and other adjudicators' debates", async () => {
    const debate = round2Debates().find((item) => !item.byeTeamId)!;
    await api.call("POST", `${base}/rounds/2/pairings/allocate-adjudicators`, { token: writer, body: { panelSize: 1 } });
    const chairId = (active("debates").find((item) => item.id === debate.id) as unknown as Debate).adjudicators.chairId!;
    const unreleased = await api.call("POST", `${base}/me/ballots`, { headers: keyOf(chairId), body: portalBallot(debate) });
    expect(unreleased.status).toBe(404);
    await api.call("PATCH", `${base}/rounds/2`, { token: writer, body: { drawStatus: "confirmed" } });
    const other = active("adjudicators").find((item) => item.id !== chairId && !round2Debates().some((d) => d.adjudicators.chairId === item.id))
      ?? active("adjudicators").find((item) => item.id !== chairId)!;
    const notTheirs = await api.call("POST", `${base}/me/ballots`, { headers: keyOf(other.id), body: portalBallot(debate) });
    expect(notTheirs.status).toBe(404);
    const team = await api.call("POST", `${base}/me/ballots`, { headers: teamKey(debate.teams.AFF.teamId), body: portalBallot(debate) });
    expect(team.status).toBe(403);
    const badKey = await api.call("POST", `${base}/me/ballots`, { headers: { ...keyOf(chairId), "x-passcode": "wrong" }, body: portalBallot(debate) });
    expect(badKey.status).toBe(401);
  });

  it("stores a chair's ballot confirmed, superseding nothing, audited as the participant", async () => {
    await releaseRound2();
    const debate = round2Debates().find((item) => !item.byeTeamId)!;
    const result = await api.call("POST", `${base}/me/ballots`, { headers: keyOf(debate.adjudicators.chairId!), body: portalBallot(debate) });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    expect(result.body).toMatchObject({ confirmed: true, submitterType: "judge", version: 1 });
    const event = stored("auditEvents").find((item) => item.action === "ballot.submitted" && String(item.actorId).startsWith("participant:"))!;
    expect(event).toMatchObject({ actorId: `participant:adjudicator:${debate.adjudicators.chairId}`, actorType: "public" });

    // A second submission supersedes the first (kept as a discarded version).
    const again = await api.call("POST", `${base}/me/ballots`, { headers: keyOf(debate.adjudicators.chairId!), body: portalBallot(debate) });
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({ version: 2, confirmed: true });
    const ballots = active("ballots").filter((item) => item.debateId === debate.id) as unknown as BallotSubmission[];
    expect(ballots.filter((item) => item.discarded)).toHaveLength(1);
  });

  it("keeps a completed round's result: the ballot is stored unconfirmed for the tab room", async () => {
    const debate = (active("debates") as unknown as Debate[]).find((item) => item.roundSeq === 1 && !item.byeTeamId)!;
    const result = await api.call("POST", `${base}/me/ballots`, { headers: keyOf(debate.adjudicators.chairId!), body: portalBallot(debate) });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    expect(result.body).toMatchObject({ confirmed: false });
    const confirmed = active("ballots").filter((item) => item.debateId === debate.id && item.confirmed && !item.discarded);
    expect(confirmed).toHaveLength(1);
  });

  it("validates the ballot like the portal and honours privateUrlBallots: false", async () => {
    await releaseRound2();
    const debate = round2Debates().find((item) => !item.byeTeamId)!;
    const body = portalBallot(debate);
    (body.speakerScores.AFF as Json[]).pop();
    expect((await api.call("POST", `${base}/me/ballots`, { headers: keyOf(debate.adjudicators.chairId!), body })).status).toBe(422);
    const entry = api.store.tournaments.get("t-api")!;
    entry.tournament.preferences = { ...(entry.tournament.preferences as Json), privateUrlBallots: false };
    const off = await api.call("POST", `${base}/me/ballots`, { headers: keyOf(debate.adjudicators.chairId!), body: portalBallot(debate) });
    expect(off.status).toBe(403);
  });
});

describe("participant feedback and self check-in", () => {
  it("lets a team give feedback on its chair once panels are revealed", async () => {
    await releaseRound2();
    const debate = round2Debates().find((item) => !item.byeTeamId)!;
    const body = { debateId: debate.id, targetAdjudicatorId: debate.adjudicators.chairId, score: 4, answers: { "q-clarity": true } };
    const result = await api.call("POST", `${base}/me/feedback`, { headers: teamKey(debate.teams.AFF.teamId), body });
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    expect(result.body).toMatchObject({ sourceType: "team", sourceId: debate.teams.AFF.teamId, score: 4 });
    const outOfRange = await api.call("POST", `${base}/me/feedback`, { headers: teamKey(debate.teams.AFF.teamId), body: { ...body, score: 99 } });
    expect(outOfRange.status).toBe(422);
  });

  it("self check-in only when allowed", async () => {
    const team = active("teams")[0];
    expect((await api.call("PUT", `${base}/me/checkin`, { headers: teamKey(team.id), body: { available: true } })).status).toBe(403);
    const entry = api.store.tournaments.get("t-api")!;
    entry.tournament.preferences = { ...(entry.tournament.preferences as Json), allowSelfCheckIn: true };
    const result = await api.call("PUT", `${base}/me/checkin`, { headers: teamKey(team.id), body: { available: false } });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body).toMatchObject({ available: false });
    const record = active("teams").find((item) => item.id === team.id)!;
    expect((record.checkInHistory as Json[]).at(-1)).toMatchObject({ source: "self", available: false });
  });
});

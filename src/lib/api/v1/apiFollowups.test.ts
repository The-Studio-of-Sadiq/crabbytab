import { beforeEach, describe, expect, it } from "vitest";
import { RoundValidationError } from "@/features/tournament/application/rounds";
import { API_TOKEN_SCOPES, type ApiTokenScope } from "@/lib/apiScopes";
import { AdjudicatorAllocationError } from "@/lib/draw/tabbycatHungarian";
import type { Adjudicator, Debate, FeedbackSubmission, Team } from "@/types";
import { createApiTestContext, type ApiTestContext } from "@/test/apiFixture";
import { ApiError } from "./errors";
import { commandError } from "./routes/write/shared";
import { serializeDebate } from "./serializers";
import type { StoredRecord } from "./store";

/**
 * API follow-ups from the Tabbycat differential harness review: debate importance on CrabbyTab's
 * 0-10 scale, allocator and round-validation refusals as 4xx, team-slot draw flags in pairings,
 * and feedback superseding (as Tabbycat: a source's newer confirmed feedback on the same target in
 * the same debate replaces the older one, which is kept unconfirmed).
 */

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
function round2Debates(): Debate[] {
  const round = active("rounds").find((item) => item.seq === 2)!;
  return active("debates").filter((debate) => debate.roundId === round.id) as unknown as Debate[];
}
function teamKey(teamId: string) {
  const team = active("teams").find((item) => item.id === teamId) as unknown as Team;
  return { authorization: `Key ${team.privateUrlKey}`, "x-passcode": String(team.privatePasscode) };
}
async function releaseRound2() {
  await api.call("POST", `${base}/rounds/2/pairings/allocate-adjudicators`, { token: writer, body: { panelSize: 1 } });
  await api.call("PATCH", `${base}/rounds/2`, { token: writer, body: { drawStatus: "confirmed", adjudicatorsRevealed: true } });
}
function feedbackOn(debateId: string): FeedbackSubmission[] {
  return active("feedback").filter((item) => item.debateId === debateId) as unknown as FeedbackSubmission[];
}

describe("debate importance (0-10)", () => {
  it("refuses Tabbycat's negative levels and stores values on CrabbyTab's scale", async () => {
    const debate = round2Debates().find((item) => !item.byeTeamId)!;
    const path = `${base}/rounds/2/pairings/${debate.id}`;
    const negative = await api.call("PATCH", path, { token: writer, body: { importance: -2 } });
    expect(negative.status).toBe(422);
    expect(JSON.stringify(negative.body)).toContain("importance");
    const tooHigh = await api.call("PATCH", path, { token: writer, body: { importance: 11 } });
    expect(tooHigh.status).toBe(422);

    const ok = await api.call("PATCH", path, { token: writer, body: { importance: 7 } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(active("debates").find((item) => item.id === debate.id)).toMatchObject({ importance: 7 });
  });

  it("refuses a negative importance when adding a debate", async () => {
    const debate = round2Debates().find((item) => !item.byeTeamId)!;
    const teams = Object.fromEntries(Object.entries(debate.teams).map(([side, slot]) => [side, slot!.teamId]));
    const result = await api.call("POST", `${base}/rounds/2/pairings`, { token: writer, body: { teams, importance: -1 } });
    expect(result.status).toBe(422);
    expect(JSON.stringify(result.body)).toContain("importance");
  });
});

describe("command refusals as API errors", () => {
  it("maps AdjudicatorAllocationError to 409 and RoundValidationError to 422", () => {
    const allocation = commandError(new AdjudicatorAllocationError("There are no available adjudicators."));
    expect(allocation).toBeInstanceOf(ApiError);
    expect(allocation).toMatchObject({ status: 409, code: "conflict", message: "There are no available adjudicators." });
    const round = commandError(new RoundValidationError("An elimination round must use the elimination draw."));
    expect(round).toBeInstanceOf(ApiError);
    expect(round).toMatchObject({ status: 422, code: "validation_failed" });
  });

  it("answers an allocation with no available adjudicators with 409, changing nothing", async () => {
    const round = active("rounds").find((item) => item.seq === 2)!;
    for (const adjudicator of active("adjudicators")) {
      (adjudicator as unknown as Adjudicator).roundAvailability = { [String(round.id)]: false };
    }
    const before = JSON.stringify(round2Debates().map((debate) => debate.adjudicators));
    const result = await api.call("POST", `${base}/rounds/2/pairings/allocate-adjudicators`, { token: writer, body: { panelSize: 1 } });
    expect(result.status, JSON.stringify(result.body)).toBe(409);
    expect(result.body).toMatchObject({ error: { code: "conflict" } });
    expect(JSON.stringify(round2Debates().map((debate) => debate.adjudicators))).toBe(before);
  });
});

describe("pairing team slots", () => {
  it("include the team's draw flags", () => {
    const debate = round2Debates().find((item) => !item.byeTeamId)!;
    const flagged: Debate = {
      ...debate,
      teams: { ...debate.teams, AFF: { ...debate.teams.AFF!, flags: ["bub_up_hist"], pulledUp: true } },
    };
    const teams = serializeDebate(flagged).teams as Record<string, Json>;
    expect(teams.AFF).toMatchObject({ flags: ["bub_up_hist"], pulledUp: true });
  });
});

describe("feedback supersedes the source's earlier feedback on the same target and debate", () => {
  it("through the participant route (private URL)", async () => {
    await releaseRound2();
    const debate = round2Debates().find((item) => !item.byeTeamId)!;
    const chairId = debate.adjudicators.chairId!;
    const aff = debate.teams.AFF!.teamId;
    const neg = debate.teams.NEG!.teamId;
    const body = { debateId: debate.id, targetAdjudicatorId: chairId, score: 4, answers: { "q-clarity": true } };

    const first = await api.call("POST", `${base}/me/feedback`, { headers: teamKey(aff), body });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    // Another source's feedback on the same chair is not affected.
    const other = await api.call("POST", `${base}/me/feedback`, { headers: teamKey(neg), body: { ...body, score: 2 } });
    expect(other.status, JSON.stringify(other.body)).toBe(201);
    const second = await api.call("POST", `${base}/me/feedback`, { headers: teamKey(aff), body: { ...body, score: 3 } });
    expect(second.status, JSON.stringify(second.body)).toBe(201);

    const records = feedbackOn(debate.id);
    const byId = new Map(records.map((item) => [item.id, item]));
    expect(byId.get((first.body as Json).id as string)).toMatchObject({ confirmed: false, score: 4 });
    expect(byId.get((second.body as Json).id as string)).toMatchObject({ confirmed: true, score: 3 });
    expect(byId.get((other.body as Json).id as string)).toMatchObject({ confirmed: true, score: 2 });
    expect(records.filter((item) => item.sourceId === aff && item.confirmed)).toHaveLength(1);
  });

  it("through tab-room entry (TabRoom.addFeedback)", async () => {
    await releaseRound2();
    const debate = round2Debates().find((item) => !item.byeTeamId)!;
    const body = {
      debateId: debate.id,
      sourceType: "team",
      sourceId: debate.teams.AFF!.teamId,
      targetAdjudicatorId: debate.adjudicators.chairId!,
      score: 5,
    };
    const first = await api.call("POST", `${base}/feedback`, { token: writer, body });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await api.call("POST", `${base}/feedback`, { token: writer, body: { ...body, score: 2 } });
    expect(second.status, JSON.stringify(second.body)).toBe(201);

    const records = feedbackOn(debate.id);
    const byId = new Map(records.map((item) => [item.id, item]));
    expect(byId.get((first.body as Json).id as string)).toMatchObject({ confirmed: false, score: 5 });
    expect(byId.get((second.body as Json).id as string)).toMatchObject({ confirmed: true, score: 2 });
    expect(records.filter((item) => item.confirmed)).toHaveLength(1);
  });
});

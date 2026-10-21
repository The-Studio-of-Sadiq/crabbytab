import { beforeEach, describe, expect, it } from "vitest";
import { API_TOKEN_SCOPES, type ApiTokenScope } from "@/lib/apiScopes";
import type { Debate } from "@/types";
import { createApiTestContext, type ApiTestContext } from "@/test/apiFixture";
import type { StoredRecord } from "./store";

/** Tabbycat parity for draws: generate-draw options and 409, hand-edited pairings, preformed panels. */

type Json = Record<string, unknown>;

let api: ApiTestContext;
let writer: string;
const base = "/tournaments/api-open";
const ALL_WRITE = API_TOKEN_SCOPES.filter((scope) => scope.startsWith("write:")) as ApiTokenScope[];

beforeEach(async () => {
  api = await createApiTestContext();
  writer = api.token(ALL_WRITE);
});

function stored(collection: string): StoredRecord[] {
  return api.store.tournaments.get("t-api")!.collections[collection as "teams"] ?? [];
}
function active(collection: string) {
  return stored(collection).filter((record) => typeof record.deletedAt !== "string");
}
function roundDebates(seq: number): Debate[] {
  const round = active("rounds").find((item) => item.seq === seq)!;
  return active("debates").filter((debate) => debate.roundId === round.id) as unknown as Debate[];
}
function audit(action: string) {
  return stored("auditEvents").filter((event) => event.action === action && String(event.actorId ?? "").startsWith("api-token:"));
}
function snapshot() {
  const { apiTokens: _tokens, ...data } = api.store.tournaments.get("t-api")!;
  return JSON.stringify(data);
}

describe("generate-draw", () => {
  it("refuses a round that already has a draw unless replaceExistingDraw is sent", async () => {
    const before = snapshot();
    const refused = await api.call("POST", `${base}/rounds/2/pairings/generate-draw`, { token: writer, body: {} });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: { code: "conflict", message: expect.stringContaining("already has a draw") } });
    expect(snapshot()).toBe(before);
    const replaced = await api.call("POST", `${base}/rounds/2/pairings/generate-draw`, { token: writer, body: { replaceExistingDraw: true } });
    expect(replaced.status).toBe(200);
  });

  it("generates a fresh round without the flag, applying per-request options without saving them", async () => {
    await api.call("POST", `${base}/rounds`, { token: writer, body: { name: "Round 3", abbreviation: "R3", stage: "preliminary" } });
    const preferencesBefore = JSON.stringify(api.store.tournaments.get("t-api")!.tournament.preferences);
    const result = await api.call("POST", `${base}/rounds/3/pairings/generate-draw`, {
      token: writer,
      body: { drawType: "random", options: { avoidSameInstitution: false, pairingMethod: "slide" }, override: { reason: "Rehearsal" } },
    });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body).toMatchObject({ round: { drawType: "random", drawStatus: "draft" } });
    expect(JSON.stringify(api.store.tournaments.get("t-api")!.tournament.preferences)).toBe(preferencesBefore);
    expect(audit("draw.generated").at(-1)).toMatchObject({
      details: expect.objectContaining({ requestedDrawType: "random", requestedDrawOptions: { avoidSameInstitution: false, pairingMethod: "slide" } }),
    });
  });

  it("validates options", async () => {
    const unknown = await api.call("POST", `${base}/rounds/2/pairings/generate-draw`, { token: writer, body: { replaceExistingDraw: true, options: { pullup: "top" } } });
    expect(unknown.status).toBe(422);
    const badSide = await api.call("POST", `${base}/rounds/2/pairings/generate-draw`, { token: writer, body: { replaceExistingDraw: true, options: { sideAllocationRule: "manual_ballot" } } });
    expect(badSide.status).toBe(422);
  });
});

describe("hand-edited pairings", () => {
  it("deletes a debate and re-adds it by hand, refusing teams already drawn", async () => {
    const [first, second] = roundDebates(2).filter((debate) => !debate.byeTeamId);
    const teams = { AFF: first.teams.AFF.teamId, NEG: first.teams.NEG.teamId };
    const clash = await api.call("POST", `${base}/rounds/2/pairings`, { token: writer, body: { teams } });
    expect(clash.status).toBe(409);
    expect((await api.call("DELETE", `${base}/rounds/2/pairings/${first.id}`, { token: writer })).status).toBe(204);
    expect(stored("debates").find((item) => item.id === first.id)).toMatchObject({ deletedAt: expect.any(String) });
    const wrongSides = await api.call("POST", `${base}/rounds/2/pairings`, { token: writer, body: { teams: { OG: teams.AFF, OO: teams.NEG } } });
    expect(wrongSides.status).toBe(422);
    const occupied = await api.call("POST", `${base}/rounds/2/pairings`, { token: writer, body: { teams, venueId: second.venueId } });
    expect(occupied.status).toBe(409);
    const created = await api.call("POST", `${base}/rounds/2/pairings`, { token: writer, body: { teams } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ teams: { AFF: { teamId: teams.AFF }, NEG: { teamId: teams.NEG } } });
  });

  it("swaps sides through PATCH teams", async () => {
    const debate = roundDebates(2).find((item) => !item.byeTeamId)!;
    const result = await api.call("PATCH", `${base}/rounds/2/pairings/${debate.id}`, {
      token: writer,
      body: { teams: { AFF: debate.teams.NEG.teamId, NEG: debate.teams.AFF.teamId } },
    });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body).toMatchObject({ teams: { AFF: { teamId: debate.teams.NEG.teamId } } });
  });

  it("will not touch a debate with ballots and deletes a whole draft draw", async () => {
    const resulted = roundDebates(1).find((item) => !item.byeTeamId)!;
    const refused = await api.call("DELETE", `${base}/rounds/1/pairings/${resulted.id}`, { token: writer, body: { override: { reason: "x" } } });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: { violations: expect.arrayContaining([expect.objectContaining({ rule: "debate_has_ballots", overridable: false })]) } });

    const deleted = await api.call("DELETE", `${base}/rounds/2/pairings`, { token: writer });
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
    expect(deleted.body).toMatchObject({ round: { drawStatus: "none" } });
    expect(roundDebates(2)).toHaveLength(0);
    expect(audit("draw.deleted")).toHaveLength(1);
    // With no draw, generate-draw needs no flag.
    expect((await api.call("POST", `${base}/rounds/2/pairings/generate-draw`, { token: writer, body: {} })).status).toBe(200);
  });
});

describe("preformed panels", () => {
  it("adds, edits and deletes single panels with the panel command's validation", async () => {
    const [chair, panellist] = active("adjudicators");
    const created = await api.call("POST", `${base}/rounds/2/preformed-panels`, {
      token: writer,
      body: { chairId: chair.id, panellistIds: [], traineeIds: [], importance: 3 },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = (created.body as Json).id as string;
    const updated = await api.call("PATCH", `${base}/rounds/2/preformed-panels/${id}`, { token: writer, body: { panellistIds: [panellist.id] } });
    expect(updated.body).toMatchObject({ chairId: chair.id, panellistIds: [panellist.id], importance: 3 });
    const duplicate = await api.call("POST", `${base}/rounds/2/preformed-panels`, {
      token: writer,
      body: { chairId: chair.id, panellistIds: [], traineeIds: [], importance: 1 },
    });
    expect(duplicate.status).toBe(422);
    expect((await api.call("GET", `${base}/rounds/2/preformed-panels/${id}`, { token: writer })).body).toMatchObject({ id });
    expect((await api.call("DELETE", `${base}/rounds/2/preformed-panels/${id}`, { token: writer })).status).toBe(204);
    expect((await api.call("GET", `${base}/rounds/2/preformed-panels/${id}`, { token: writer })).status).toBe(404);
  });

  it("creates blank panels from the anticipated draw", async () => {
    const result = await api.call("POST", `${base}/rounds/2/preformed-panels/from-anticipated-draw`, { token: writer, body: { prioritise: "bracket" } });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const panels = (result.body as { data: Json[] }).data;
    expect(panels.length).toBe(4);
    expect(panels[0]).toMatchObject({ roomRank: 1, bracketMin: expect.any(Number), bracketMax: expect.any(Number) });
    const read = await api.call("GET", `${base}/rounds/2/preformed-panels`, { token: writer });
    expect((read.body as { data: Json[] }).data).toHaveLength(4);
    expect((await api.call("DELETE", `${base}/rounds/2/preformed-panels`, { token: writer })).status).toBe(204);
    expect(((await api.call("GET", `${base}/rounds/2/preformed-panels`, { token: writer })).body as { data: Json[] }).data).toHaveLength(0);
  });
});

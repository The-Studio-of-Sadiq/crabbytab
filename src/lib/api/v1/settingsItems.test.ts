import { beforeEach, describe, expect, it } from "vitest";
import { API_TOKEN_SCOPES, type ApiTokenScope } from "@/lib/apiScopes";
import { createApiTestContext, type ApiTestContext } from "@/test/apiFixture";
import type { StoredRecord } from "./store";

/** Tabbycat parity: per-item feedback questions, score criteria, venue categories, ?break. */

type Json = Record<string, unknown>;

let api: ApiTestContext;
let writer: string;
const base = "/tournaments/api-open";

beforeEach(async () => {
  api = await createApiTestContext();
  writer = api.token([...API_TOKEN_SCOPES.filter((scope) => scope.startsWith("write:")) as ApiTokenScope[]]);
});

function preferences(): Json {
  return api.store.tournaments.get("t-api")!.tournament.preferences as Json;
}
function active(collection: string): StoredRecord[] {
  return (api.store.tournaments.get("t-api")!.collections[collection as "teams"] ?? []).filter((record) => typeof record.deletedAt !== "string");
}

describe("feedback questions one at a time", () => {
  it("adds, filters, changes and deletes a question", async () => {
    const created = await api.call("POST", `${base}/feedback-questions`, {
      token: writer,
      body: { id: "q-time", label: "On time?", type: "yes_no", required: false, sources: ["adjudicator"] },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await api.call("POST", `${base}/feedback-questions`, { token: writer, body: { id: "q-time", label: "x", type: "text", required: false, sources: ["team"] } })).status).toBe(409);
    const fromTeams = (await api.call("GET", `${base}/feedback-questions?fromTeams=true`, { token: writer })).body as { data: Json[] };
    expect(fromTeams.data.map((question) => question.id)).not.toContain("q-time");
    const updated = await api.call("PATCH", `${base}/feedback-questions/q-time`, { token: writer, body: { sources: ["team", "adjudicator"] } });
    expect(updated.body).toMatchObject({ id: "q-time", sources: ["team", "adjudicator"] });
    expect((preferences().teamFeedbackQuestions as Json[]).some((question) => question.id === "q-time")).toBe(true);
    expect((await api.call("GET", `${base}/feedback-questions/q-time`, { token: writer })).status).toBe(200);
    const invalid = await api.call("PATCH", `${base}/feedback-questions/q-time`, { token: writer, body: { type: "select_one" } });
    expect(invalid.status).toBe(422);
    expect((await api.call("DELETE", `${base}/feedback-questions/q-time`, { token: writer })).status).toBe(204);
    expect((await api.call("GET", `${base}/feedback-questions/q-time`, { token: writer })).status).toBe(404);
  });
});

describe("score criteria", () => {
  it("is locked once ballots exist, as in the tab room, and validated", async () => {
    const criterion = { id: "matter", name: "Matter", seq: 1, speechType: "substantive", weight: 1, minScore: 1, maxScore: 10, step: 1, required: true };
    const locked = await api.call("POST", `${base}/score-criteria`, { token: writer, body: criterion });
    expect(locked.status).toBe(409);
    expect(locked.body).toMatchObject({ error: { code: "rule_violation" } });
    const bad = await api.call("PUT", `${base}/score-criteria`, { token: writer, body: { criteria: [{ ...criterion, minScore: 10, maxScore: 1 }] } });
    expect(bad.status).toBe(422);
  });
});

describe("venue categories", () => {
  it("creates, renames and deletes a category across venues", async () => {
    const [first, second] = active("venues");
    const created = await api.call("POST", `${base}/venue-categories`, {
      token: writer,
      body: { name: "Accessible", description: "has step-free access", publicTooltip: true, venueIds: [first.id] },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ name: "Accessible", venueIds: [first.id], description: "has step-free access" });
    expect((await api.call("POST", `${base}/venue-categories`, { token: writer, body: { name: "accessible" } })).status).toBe(409);

    const renamed = await api.call("PATCH", `${base}/venue-categories/accessible`, { token: writer, body: { name: "Step-free", venueIds: [first.id, second.id] } });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(renamed.body).toMatchObject({ name: "Step-free", venueIds: [first.id, second.id], description: "has step-free access" });
    expect(active("venues").find((venue) => venue.id === second.id)).toMatchObject({ category: "Step-free" });

    const list = (await api.call("GET", `${base}/venue-categories`, { token: writer })).body as { data: Json[] };
    expect(list.data.map((item) => item.name)).toContain("Step-free");
    expect((await api.call("DELETE", `${base}/venue-categories/Step-free`, { token: writer })).status).toBe(204);
    expect(active("venues").find((venue) => venue.id === first.id)?.category).toBeUndefined();
    expect((preferences().venueCategories as Json[]).some((info) => info.name === "Step-free")).toBe(false);
    expect((await api.call("GET", `${base}/venue-categories/Step-free`, { token: writer })).status).toBe(404);
  });
});

describe("adjudicator ?break", () => {
  it("lists only breaking adjudicators, publicly once released", async () => {
    const entry = api.store.tournaments.get("t-api")!;
    entry.collections.adjudicators![0].breaking = true;
    const admin = await api.call("GET", `${base}/adjudicators?break=true`, { token: writer });
    expect((admin.body as { data: Json[] }).data).toHaveLength(1);
    const publicToken = api.token(["read:public"]);
    expect((await api.call("GET", `${base}/adjudicators?break=true`, { token: publicToken })).status).toBe(403);
    entry.tournament.preferences = { ...(entry.tournament.preferences as Json), publicBreakingAdjudicators: true };
    const released = await api.call("GET", `${base}/adjudicators?break=true`, { token: publicToken });
    expect(released.status).toBe(200);
    expect((released.body as { data: Json[] }).data).toHaveLength(1);
  });
});

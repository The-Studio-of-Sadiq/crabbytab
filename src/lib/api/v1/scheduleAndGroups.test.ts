import { beforeEach, describe, expect, it } from "vitest";
import { createApiTestContext, type ApiTestContext } from "@/test/apiFixture";

/** Schedule events (Tabbycat ScheduleEvent) and read-only user groups. */

type Json = Record<string, unknown>;

let api: ApiTestContext;
let writer: string;
const base = "/tournaments/api-open";

beforeEach(async () => {
  api = await createApiTestContext();
  writer = api.token(["write:tournament", "read:staff"]);
});

describe("schedule events", () => {
  it("creates, lists in order, changes and deletes events with the schedule page's validation", async () => {
    const round = api.harness.rounds.find((item) => item.seq === 2)!;
    const late = await api.call("POST", `${base}/schedule-events`, {
      token: writer,
      body: { type: "debate", startTime: "2026-10-02T14:00:00Z", endTime: "2026-10-02T15:30:00Z", roundId: round.id },
    });
    expect(late.status, JSON.stringify(late.body)).toBe(201);
    expect(late.body).toMatchObject({ title: `${round.name} — Debate` });
    const early = await api.call("POST", `${base}/schedule-events`, { token: writer, body: { type: "briefing", title: "Welcome", startTime: "2026-10-02T09:00:00Z" } });
    const list = (await api.call("GET", `${base}/schedule-events`, { token: writer })).body as { data: Json[] };
    expect(list.data.map((event) => event.title)).toEqual(["Welcome", `${round.name} — Debate`]);

    const backwards = await api.call("PATCH", `${base}/schedule-events/${(late.body as Json).id}`, { token: writer, body: { endTime: "2026-10-02T13:00:00Z" } });
    expect(backwards.status).toBe(422);
    const unknownRound = await api.call("POST", `${base}/schedule-events`, { token: writer, body: { type: "debate", startTime: "2026-10-02T14:00:00Z", roundId: "nope" } });
    expect(unknownRound.status).toBe(422);
    const changed = await api.call("PATCH", `${base}/schedule-events/${(early.body as Json).id}`, { token: writer, body: { title: "Opening" } });
    expect(changed.body).toMatchObject({ title: "Opening" });
    expect((await api.call("DELETE", `${base}/schedule-events/${(early.body as Json).id}`, { token: writer })).status).toBe(204);
    expect(((await api.call("GET", `${base}/schedule-events`, { token: writer })).body as { data: Json[] }).data).toHaveLength(1);
  });

  it("shows public tokens the schedule only once it is public", async () => {
    await api.call("POST", `${base}/schedule-events`, { token: writer, body: { type: "briefing", title: "Welcome", startTime: "2026-10-02T09:00:00Z" } });
    const publicToken = api.token(["read:public"]);
    expect((await api.call("GET", `${base}/schedule-events`, { token: publicToken })).status).toBe(403);
    await api.call("PATCH", `${base}/preferences`, { token: writer, body: { preferences: { publicSchedule: true } } });
    const result = await api.call("GET", `${base}/schedule-events`, { token: publicToken });
    expect(result.status).toBe(200);
    expect((result.body as { data: Json[] }).data).toEqual([expect.objectContaining({ title: "Welcome" })]);
  });
});

describe("user groups", () => {
  it("lists built-in and custom groups read-only, with the staff scope", async () => {
    api.store.tournaments.get("t-api")!.customPermissionGroups = [{ id: "custom_tabs", name: "Tab desk", permissions: ["checkins.edit", "bogus"] }];
    const result = await api.call("GET", `${base}/user-groups`, { token: writer });
    expect(result.status).toBe(200);
    const groups = (result.body as { data: Json[] }).data;
    expect(groups.find((group) => group.id === "tab_assistant")).toMatchObject({ builtIn: true });
    expect(groups.find((group) => group.id === "custom_tabs")).toEqual({ id: "custom_tabs", name: "Tab desk", builtIn: false, permissions: ["checkins.edit"] });
    expect((await api.call("GET", `${base}/user-groups/custom_tabs`, { token: writer })).status).toBe(200);
    const noScope = api.token(["read:tournament"]);
    expect((await api.call("GET", `${base}/user-groups`, { token: noScope })).status).toBe(403);
    expect((await api.call("POST", `${base}/user-groups`, { token: writer, body: {} })).status).toBe(405);
  });
});

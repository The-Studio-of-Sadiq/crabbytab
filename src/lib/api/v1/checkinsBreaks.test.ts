import { beforeEach, describe, expect, it } from "vitest";
import { API_TOKEN_SCOPES, type ApiTokenScope } from "@/lib/apiScopes";
import type { Debate } from "@/types";
import { createApiTestContext, type ApiTestContext } from "@/test/apiFixture";
import type { StoredRecord } from "./store";

/** Tabbycat parity: availability toggles/bulk/filters, check-in toggles, breaks, eligibility, feedback DELETE. */

type Json = Record<string, unknown>;

let api: ApiTestContext;
let writer: string;
const base = "/tournaments/api-open";

beforeEach(async () => {
  api = await createApiTestContext();
  writer = api.token([...API_TOKEN_SCOPES.filter((scope) => scope.startsWith("write:")) as ApiTokenScope[]]);
});

function stored(collection: string): StoredRecord[] {
  return api.store.tournaments.get("t-api")!.collections[collection as "teams"] ?? [];
}
function active(collection: string) {
  return stored(collection).filter((record) => typeof record.deletedAt !== "string");
}
function find(collection: string, id: string) {
  return active(collection).find((record) => record.id === id)!;
}
function snapshot() {
  const { apiTokens: _tokens, ...data } = api.store.tournaments.get("t-api")!;
  return JSON.stringify(data);
}
async function availability(query = "") {
  return (await api.call("GET", `${base}/rounds/2/availabilities${query}`, { token: writer })).body as Record<string, Json[]>;
}

describe("availabilities", () => {
  it("sets venues per round, toggles, filters and clears a kind", async () => {
    const [venue] = active("venues");
    const [team] = active("teams");
    const set = await api.call("PUT", `${base}/rounds/2/availabilities`, { token: writer, body: { venues: { [venue.id]: false } } });
    expect(set.body).toMatchObject({ updated: 1 });
    expect(find("venues", venue.id)).toMatchObject({ roundAvailability: { [active("rounds").find((r) => r.seq === 2)!.id]: false } });
    expect(find("venues", venue.id).available).not.toBe(false);
    // Only venues listed when asked.
    const venuesOnly = await availability("?venues=true");
    expect(venuesOnly.teams).toEqual([]);
    expect(venuesOnly.venues.find((item) => item.id === venue.id)).toMatchObject({ available: false });
    // Round 1 is untouched by round 2's entry.
    const round1 = (await api.call("GET", `${base}/rounds/1/availabilities?venues=true`, { token: writer })).body as Record<string, Json[]>;
    expect(round1.venues.find((item) => item.id === venue.id)).toMatchObject({ available: true });

    const toggled = await api.call("PATCH", `${base}/rounds/2/availabilities`, { token: writer, body: { venues: [venue.id], teams: [team.id] } });
    expect(toggled.body).toMatchObject({ updated: 2 });
    const after = await availability();
    expect(after.venues.find((item) => item.id === venue.id)).toMatchObject({ available: true });
    expect(after.teams.find((item) => item.id === team.id)).toMatchObject({ available: false });
    expect((find("teams", team.id).checkInHistory as Json[]).at(-1)).toMatchObject({ source: "tab", available: false });

    expect((await api.call("DELETE", `${base}/rounds/2/availabilities`, { token: writer })).status).toBe(400);
    const cleared = await api.call("DELETE", `${base}/rounds/2/availabilities?adjudicators=true`, { token: writer });
    expect(cleared.status).toBe(200);
    expect((await availability("?adjudicators=true")).adjudicators.every((item) => item.available === false)).toBe(true);
  });
});

describe("check-ins", () => {
  it("toggles people and venues, records events and returns identifiers", async () => {
    const [adjudicator] = active("adjudicators");
    const first = await api.call("PATCH", `${base}/adjudicators/${adjudicator.id}/checkin`, { token: writer });
    const second = await api.call("PATCH", `${base}/adjudicators/${adjudicator.id}/checkin`, { token: writer });
    expect((first.body as Json).checkedIn).toBe(!(second.body as Json).checkedIn);
    expect((find("adjudicators", adjudicator.id).checkInHistory as Json[]).length).toBe(2);

    const [venue] = active("venues");
    const venueIn = await api.call("PUT", `${base}/venues/${venue.id}/checkin`, { token: writer });
    expect(venueIn.body).toMatchObject({ checkedIn: true, checkedInAt: "2026-10-01T12:00:00.000Z" });
    const venueToggle = await api.call("PATCH", `${base}/venues/${venue.id}/checkin`, { token: writer });
    expect(venueToggle.body).toMatchObject({ checkedIn: false });

    const identifier = await api.call("POST", `${base}/venues/${venue.id}/checkin`, { token: writer });
    expect(identifier.body).toEqual({ id: venue.id, identifier: venue.id, barcode: "code39" });
    expect((await api.call("POST", `${base}/teams/nope/checkin`, { token: writer })).status).toBe(404);
  });

  it("withdraws and toggles a debate's paper-ballot receipt", async () => {
    await api.call("POST", `${base}/rounds/2/pairings/allocate-adjudicators`, { token: writer, body: { panelSize: 1 } });
    await api.call("PATCH", `${base}/rounds/2`, { token: writer, body: { drawStatus: "confirmed" } });
    const round = active("rounds").find((item) => item.seq === 2)!;
    const debate = active("debates").find((item) => item.roundId === round.id && !item.byeTeamId) as unknown as Debate;
    const path = `${base}/rounds/2/pairings/${debate.id}/checkin`;
    expect((await api.call("PATCH", path, { token: writer })).body).toMatchObject({ checkedIn: true });
    expect(active("ballotIntake").filter((item) => item.debateId === debate.id)).toHaveLength(1);
    expect((await api.call("DELETE", path, { token: writer })).body).toMatchObject({ checkedIn: false });
    expect(active("ballotIntake").filter((item) => item.debateId === debate.id)).toHaveLength(0);
    expect(stored("auditEvents").some((event) => event.action === "ballot.receipt_withdrawn")).toBe(true);
    const code = await api.call("POST", path, { token: writer });
    expect(code.body).toMatchObject({ id: debate.id, identifier: expect.any(String) });
  });
});

describe("breaks and eligibility", () => {
  it("adds break and speaker-category eligibility without removing anyone", async () => {
    const outside = active("teams").find((team) => !(team.breakCategories as string[]).includes("bc-open"))!;
    const added = await api.call("PATCH", `${base}/break-categories/bc-open/eligibility`, { token: writer, body: { teamIds: [outside.id] } });
    expect(added.body).toEqual({ categoryId: "bc-open", added: [outside.id] });
    expect(active("teams").filter((team) => (team.breakCategories as string[]).includes("bc-open"))).toHaveLength(7);

    const speaker = (active("teams")[2].speakers as Json[])[0];
    const speakers = await api.call("PATCH", `${base}/speaker-categories/spkcat-esl/eligibility`, { token: writer, body: { speakerIds: [speaker.id] } });
    expect(speakers.body).toEqual({ categoryId: "spkcat-esl", added: [speaker.id] });
    const read = await api.call("GET", `${base}/speaker-categories/spkcat-esl/eligibility`, { token: writer });
    expect((read.body as { speakerIds: string[] }).speakerIds).toHaveLength(2);
  });

  it("sets remarks atomically with regeneration", async () => {
    const before = snapshot();
    const [team] = active("teams");
    const unknown = await api.call("PATCH", `${base}/break-categories/bc-open/break`, { token: writer, body: { remarks: { nope: "withdrawn" } } });
    expect(unknown.status).toBe(422);
    // No elimination rounds yet: the regeneration fails, so the remark is not saved either.
    const failed = await api.call("PATCH", `${base}/break-categories/bc-open/break`, { token: writer, body: { remarks: { [team.id]: "withdrawn" } } });
    expect(failed.status).toBe(422);
    expect(snapshot()).toBe(before);
  });

  it("clears a generated break unless its rounds have a draw", async () => {
    await api.call("POST", `${base}/rounds`, { token: writer, body: { name: "Final", abbreviation: "F", stage: "elimination", drawType: "elimination" } });
    // Writes replace the stored state, so the generated break is set up after the last write.
    const entry = api.store.tournaments.get("t-api")!;
    const category = entry.collections.breakCategories!.find((item) => item.id === "bc-open")!;
    const [first, second] = active("teams");
    category.generatedBreak = { breakingTeamIds: [first.id], reserveTeamIds: [], generatedAt: "2026-10-01T00:00:00.000Z" };
    Object.assign(first, { breakStatus: "breaking", breakCategoryIds: ["bc-open"] });
    Object.assign(second, { breakStatus: "eliminated", breakCategoryIds: [] });
    const final = entry.collections.rounds!.find((round) => round.seq === 3)!;
    final.breakCategoryIds = ["bc-open"];
    final.drawStatus = "draft";
    const refused = await api.call("DELETE", `${base}/break-categories/bc-open/break`, { token: writer });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: { violations: [expect.objectContaining({ rule: "break_category_in_use" })] } });

    api.store.tournaments.get("t-api")!.collections.rounds!.find((round) => round.seq === 3)!.drawStatus = "none";
    const cleared = await api.call("DELETE", `${base}/break-categories/bc-open/break`, { token: writer });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(204);
    expect(find("breakCategories", "bc-open").generatedBreak).toBeUndefined();
    expect(find("teams", first.id).breakStatus).toBeUndefined();
    expect(find("teams", second.id).breakStatus).toBeUndefined();
    expect(find("rounds", final.id).breakCategoryIds).toEqual([]);
    expect((await api.call("DELETE", `${base}/break-categories/bc-open/break`, { token: writer })).status).toBe(404);
  });
});

describe("feedback DELETE", () => {
  it("soft-deletes and audits", async () => {
    const result = await api.call("DELETE", `${base}/feedback/fb-1`, { token: writer });
    expect(result.status).toBe(204);
    expect(stored("feedback").find((item) => item.id === "fb-1")).toMatchObject({ deletedAt: expect.any(String) });
    expect(stored("syncConflicts")).toEqual([expect.objectContaining({ recordId: "fb-1", resolution: "recoverable-delete" })]);
    expect(stored("auditEvents").some((event) => event.action === "feedback.deleted")).toBe(true);
    expect((await api.call("DELETE", `${base}/feedback/fb-1`, { token: writer })).status).toBe(404);
  });
});

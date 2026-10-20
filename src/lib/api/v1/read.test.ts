import { beforeAll, describe, expect, it } from "vitest";
import { createApiTestContext, type ApiTestContext } from "@/test/apiFixture";
import { buildOpenApiDocument } from "./openapi";
import { API_ROUTES } from "./routes";

type Json = Record<string, unknown>;
type ListBody = { data: Json[]; nextCursor?: string | null };

let api: ApiTestContext;
let admin: string;
let publicToken: string;
const base = "/tournaments/api-open";

beforeAll(async () => {
  api = await createApiTestContext();
  admin = api.token([
    "read:tournament", "read:rounds", "read:participants", "read:venues", "read:breaks", "read:draws",
    "read:results", "read:feedback", "read:checkins", "read:standings",
  ]);
  publicToken = api.token(["read:public"]);
});

function body<T = Json>(result: { body: unknown }): T {
  return result.body as T;
}

describe("authentication and scopes", () => {
  it("serves the root without a token and lists links", async () => {
    const result = await api.call("GET", "/");
    expect(result.status).toBe(200);
    expect(body(result)).toMatchObject({ openapi: "/api/openapi.json" });
    expect(result.headers["Cache-Control"]).toContain("no-store");
  });

  it("requires a bearer token", async () => {
    const result = await api.call("GET", `${base}/teams`);
    expect(result.status).toBe(401);
    expect(body(result)).toMatchObject({ error: { code: "unauthenticated" } });
  });

  it("rejects unknown and revoked tokens", async () => {
    const result = await api.call("GET", `${base}/teams`, { token: `ct_live_${"0".repeat(64)}` });
    expect(result.status).toBe(401);
  });

  it("does not reveal whether a tournament exists to a token of another tournament", async () => {
    const result = await api.call("GET", "/tournaments/unknown-slug/teams", { token: admin });
    expect(result.status).toBe(404);
  });

  it("enforces per-resource scopes", async () => {
    const roundsOnly = api.token(["read:rounds"]);
    expect((await api.call("GET", `${base}/rounds`, { token: roundsOnly })).status).toBe(200);
    const denied = await api.call("GET", `${base}/teams`, { token: roundsOnly });
    expect(denied.status).toBe(403);
    expect(body(denied)).toMatchObject({ error: { code: "forbidden" } });
  });

  it("treats write scopes as read scopes for the same resource", async () => {
    const writer = api.token(["write:participants"]);
    expect((await api.call("GET", `${base}/teams`, { token: writer })).status).toBe(200);
  });

  it("accepts tokens stored with the legacy single `scope` field", async () => {
    const { createApiToken, hashApiToken } = await import("@/lib/apiTokens");
    const secret = createApiToken();
    api.store.tournaments.get("t-api")!.apiTokens!.push({ id: "legacy", name: "Legacy", scope: "read:draws", tokenHash: hashApiToken(secret) });
    const result = await api.call("GET", `${base}/rounds/2/pairings`, { token: secret });
    expect(result.status).toBe(200);
    expect(body<ListBody>(result).data.length).toBeGreaterThan(0);
  });

  it("refuses administrator-only endpoints to public tokens", async () => {
    for (const path of [`${base}/preferences`, `${base}/feedback`, `${base}/rounds/1/ballots`, `${base}/rounds/1/availabilities`]) {
      const result = await api.call("GET", path, { token: publicToken });
      expect(result.status, path).toBe(403);
    }
  });

  it("answers 405 with Allow for a known path and unknown method", async () => {
    const result = await api.call("DELETE", `${base}/teams/standings`, { token: admin });
    expect(result.status).toBe(405);
    expect(result.headers.Allow).toBe("GET");
  });

  it("rate-limits a token that exceeds its per-minute budget", async () => {
    const busy = api.token(["read:rounds"]);
    let last = 200;
    for (let index = 0; index < 305; index += 1) {
      last = (await api.call("GET", `${base}/rounds`, { token: busy, address: "198.51.100.1" })).status;
    }
    expect(last).toBe(429);
  });
});

describe("validation", () => {
  it("rejects malformed query values", async () => {
    const result = await api.call("GET", `${base}/teams?limit=0`, { token: admin });
    expect(result.status).toBe(422);
    expect(body(result)).toMatchObject({ error: { code: "validation_failed", issues: [{ path: "limit" }] } });
  });

  it("rejects unknown query parameters", async () => {
    const result = await api.call("GET", `${base}/teams?colour=red`, { token: admin });
    expect(result.status).toBe(422);
  });

  it("rejects forged cursors", async () => {
    const result = await api.call("GET", `${base}/teams?cursor=${encodeURIComponent("a/b")}`, { token: admin });
    expect([400, 422]).toContain(result.status);
  });

  it("returns 404 for a malformed round sequence", async () => {
    expect((await api.call("GET", `${base}/rounds/zero`, { token: admin })).status).toBe(404);
    expect((await api.call("GET", `${base}/rounds/9`, { token: admin })).status).toBe(404);
  });
});

describe("administrator reads", () => {
  it("paginates teams in id order without repeats", async () => {
    const seen: string[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    do {
      const result = await api.call("GET", `${base}/teams?limit=3${cursor ? `&cursor=${cursor}` : ""}`, { token: admin });
      expect(result.status).toBe(200);
      const page = body<ListBody>(result);
      seen.push(...page.data.map((team) => String(team.id)));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual([...api.harness.teams.map((team) => team.id)].sort());
  });

  it("never exposes private URL keys, passcodes or email addresses", async () => {
    const results = await Promise.all([
      api.call("GET", `${base}/teams?limit=200`, { token: admin }),
      api.call("GET", `${base}/speakers?limit=200`, { token: admin }),
      api.call("GET", `${base}/adjudicators?limit=200`, { token: admin }),
    ]);
    for (const result of results) {
      const text = JSON.stringify(result.body);
      expect(text).not.toMatch(/privateUrlKey|privatePasscode|email|_key\d|pass\d/);
    }
  });

  it("reads one page of documents, not the whole collection", async () => {
    const before = api.store.reads.count;
    await api.call("GET", `${base}/teams?limit=2`, { token: admin });
    // tournament lookup + token + one page (limit + 1 for the next-page probe)
    expect(api.store.reads.count - before).toBeLessThanOrEqual(3);
  });

  it("lists a round's pairings in room order, including unreleased draws", async () => {
    const result = await api.call("GET", `${base}/rounds/2/pairings`, { token: admin });
    const pairings = body<ListBody>(result).data;
    expect(pairings.length).toBe(api.harness.roundDebates(api.harness.rounds[1].id).length);
    expect(pairings.map((pairing) => pairing.roomRank)).toEqual([...pairings.map((pairing) => pairing.roomRank)].sort((a, b) => Number(a) - Number(b)));
  });

  it("returns ballots of a debate and 404 for a ballot of another debate", async () => {
    const [first, second] = api.harness.roundDebates(api.harness.rounds[0].id).filter((debate) => !debate.byeTeamId);
    const list = await api.call("GET", `${base}/rounds/1/pairings/${first.id}/ballots`, { token: admin });
    const ballots = body<ListBody>(list).data;
    expect(ballots).toHaveLength(1);
    expect(ballots[0]).toMatchObject({ debateId: first.id, confirmed: true });
    const wrong = await api.call("GET", `${base}/rounds/1/pairings/${second.id}/ballots/${ballots[0].id}`, { token: admin });
    expect(wrong.status).toBe(404);
  });

  it("filters ballots of a round by confirmation", async () => {
    const result = await api.call("GET", `${base}/rounds/1/ballots?confirmed=true`, { token: admin });
    expect(body<ListBody>(result).data.every((ballot) => ballot.confirmed === true)).toBe(true);
  });

  it("computes team standings exactly as the tab room does", async () => {
    const result = await api.call("GET", `${base}/teams/standings`, { token: admin });
    const rows = body<ListBody>(result).data;
    const expected = api.harness.standings().teams;
    expect(rows.map((row) => [row.teamId, row.rank, row.points])).toEqual(expected.map((row) => [row.teamId, row.rank, row.points]));
  });

  it("computes standings after a given round", async () => {
    const result = await api.call("GET", `${base}/speakers/standings?round=1`, { token: admin });
    expect(result.status).toBe(200);
    expect(body<ListBody>(result).data.length).toBeGreaterThan(0);
  });

  it("needs read:feedback for adjudicator standings", async () => {
    const standingsOnly = api.token(["read:standings"]);
    expect((await api.call("GET", `${base}/adjudicators/standings`, { token: standingsOnly })).status).toBe(403);
    const result = await api.call("GET", `${base}/adjudicators/standings`, { token: admin });
    expect(result.status).toBe(200);
    expect(body<ListBody>(result).data.some((row) => row.feedbackCount === 1)).toBe(true);
  });

  it("reports round availability and check-in status", async () => {
    const result = await api.call("GET", `${base}/rounds/1/availabilities`, { token: admin });
    expect(body<{ teams: Json[] }>(result).teams.every((team) => team.available === true)).toBe(true);
    const team = api.harness.teams[0];
    const checkin = await api.call("GET", `${base}/teams/${team.id}/checkin`, { token: admin });
    expect(body(checkin)).toMatchObject({ id: team.id, checkedIn: true });
    const speaker = await api.call("GET", `${base}/speakers/${team.speakers[0].id}/checkin`, { token: admin });
    expect(body(speaker)).toMatchObject({ id: team.speakers[0].id, teamId: team.id });
  });

  it("lists speaker category eligibility and break eligibility", async () => {
    const speakers = await api.call("GET", `${base}/speaker-categories/spkcat-esl/eligibility`, { token: admin });
    expect(body(speakers)).toEqual({ categoryId: "spkcat-esl", speakerIds: [api.harness.teams[0].speakers[0].id] });
    const teams = await api.call("GET", `${base}/break-categories/bc-open/eligibility`, { token: admin });
    expect(body<{ teamIds: string[] }>(teams).teamIds).toHaveLength(6);
  });

  it("lists feedback questions with who is asked", async () => {
    const result = await api.call("GET", `${base}/feedback-questions`, { token: admin });
    expect(body<ListBody>(result).data).toEqual([
      expect.objectContaining({ id: "q-clarity", sources: ["team", "adjudicator"] }),
    ]);
  });

  it("refuses to combine feedback filters", async () => {
    const result = await api.call("GET", `${base}/feedback?roundId=a&sourceId=b`, { token: admin });
    expect(result.status).toBe(400);
  });
});

describe("public tokens see only the public site's data", () => {
  it("lists rounds and only released motions", async () => {
    const motions = await api.call("GET", `${base}/motions`, { token: publicToken });
    expect(body<ListBody>(motions).data.map((motion) => motion.id)).toEqual(["motion-1"]);
  });

  it("serves released draws and nothing of draft draws", async () => {
    const released = await api.call("GET", `${base}/rounds/1/pairings`, { token: publicToken });
    expect(body<ListBody>(released).data.length).toBeGreaterThan(0);
    const draft = await api.call("GET", `${base}/rounds/2/pairings`, { token: publicToken });
    expect([200, 404]).toContain(draft.status);
    if (draft.status === 200) expect(body<ListBody>(draft).data).toEqual([]);
  });

  it("hides participant lists and tabs until they are released", async () => {
    expect((await api.call("GET", `${base}/teams`, { token: publicToken })).status).toBe(403);
    expect((await api.call("GET", `${base}/institutions`, { token: publicToken })).status).toBe(403);
    expect((await api.call("GET", `${base}/teams/standings`, { token: publicToken })).status).toBe(403);
  });

  it("serves the released tab, computed like the public site", async () => {
    const entry = api.store.tournaments.get("t-api")!;
    const original = entry.tournament.preferences;
    entry.tournament.preferences = { ...(original as Json), releaseTeamTab: true, publicParticipants: true };
    try {
      const standings = await api.call("GET", `${base}/teams/standings`, { token: publicToken });
      expect(standings.status).toBe(200);
      expect(body<ListBody>(standings).data).toHaveLength(api.harness.teams.length);
      const teams = await api.call("GET", `${base}/teams?limit=200`, { token: publicToken });
      expect(teams.status).toBe(200);
      expect(JSON.stringify(teams.body)).not.toContain("institutionConflictIds");
      // A public token cannot ask for a partial tab.
      expect((await api.call("GET", `${base}/teams/standings?round=1`, { token: publicToken })).status).toBe(400);
    } finally {
      entry.tournament.preferences = original;
    }
  });

  it("lists only public speaker categories", async () => {
    const result = await api.call("GET", `${base}/speaker-categories`, { token: publicToken });
    expect(body<ListBody>(result).data.map((category) => category.id)).toEqual(["spkcat-esl"]);
  });

  it("keeps the legacy draws endpoint's shape", async () => {
    const result = await api.call("GET", `${base}/draws`, { token: publicToken });
    const value = body<{ tournament: Json; rounds: Json[]; debates: Json[] }>(result);
    expect(value.tournament).toMatchObject({ slug: "api-open" });
    expect(value.rounds.map((round) => round.seq)).toEqual([1]);
    expect(value.debates.every((debate) => debate.roundSeq === 1)).toBe(true);
  });
});

describe("/me", () => {
  it("identifies a participant by private URL key and passcode", async () => {
    const team = api.harness.teams[2];
    const result = await api.call("GET", `${base}/me`, { headers: { authorization: `Key ${team.privateUrlKey}`, "x-passcode": team.privatePasscode! } });
    expect(result.status).toBe(200);
    expect(body(result)).toMatchObject({ type: "team", id: team.id, name: team.name });
    expect(JSON.stringify(result.body)).not.toContain(team.privatePasscode!);
  });

  it("gives the same answer for an unknown key and a wrong passcode", async () => {
    const team = api.harness.teams[2];
    const wrong = await api.call("GET", `${base}/me`, { headers: { authorization: `Key ${team.privateUrlKey}`, "x-passcode": "nope" } });
    const unknown = await api.call("GET", `${base}/me`, { headers: { authorization: "Key team_unknown", "x-passcode": "nope" } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it("throttles repeated private key attempts per address", async () => {
    let last = 0;
    for (let index = 0; index < 125; index += 1) {
      last = (await api.call("GET", `${base}/me`, { headers: { authorization: "Key team_guess", "x-passcode": "x" }, address: "192.0.2.99" })).status;
    }
    expect(last).toBe(429);
  });
});

describe("OpenAPI document", () => {
  const document = buildOpenApiDocument(API_ROUTES) as {
    openapi: string;
    paths: Record<string, Record<string, { operationId: string; parameters: Array<{ name: string; in: string }> }>>;
    components: { schemas: Record<string, unknown> };
  };

  it("is OpenAPI 3.1 with unique operation ids", () => {
    expect(document.openapi).toBe("3.1.0");
    const ids = Object.values(document.paths).flatMap((methods) => Object.values(methods).map((operation) => operation.operationId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(API_ROUTES.length);
  });

  it("declares every path parameter and resolves every schema reference", () => {
    for (const [path, methods] of Object.entries(document.paths)) {
      const names = [...path.matchAll(/\{([A-Za-z]+)\}/g)].map(([, name]) => name);
      for (const operation of Object.values(methods)) {
        expect(operation.parameters.filter((parameter) => parameter.in === "path").map((parameter) => parameter.name)).toEqual(names);
      }
    }
    const references = [...JSON.stringify(document).matchAll(/"#\/components\/schemas\/([A-Za-z]+)"/g)].map(([, name]) => name);
    for (const name of references) expect(document.components.schemas, name).toHaveProperty(name);
  });
});

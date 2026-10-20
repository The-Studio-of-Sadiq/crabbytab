import { beforeEach, describe, expect, it } from "vitest";
import type { BallotSubmission } from "@/types";
import { createApiTestContext, type ApiTestContext } from "@/test/apiFixture";

/** Tabbycat parity for standings queries: category, metrics, public rounds, current rounds, speech kinds. */

type Json = Record<string, unknown>;
type Rows = { data: Json[] };

let api: ApiTestContext;
let admin: string;
let publicToken: string;
const base = "/tournaments/api-open";

beforeEach(async () => {
  api = await createApiTestContext();
  admin = api.token(["read:standings", "read:breaks"]);
  publicToken = api.token(["read:public"]);
});

function setPreferences(patch: Json) {
  const entry = api.store.tournaments.get("t-api")!;
  entry.tournament.preferences = { ...(entry.tournament.preferences as Json), ...patch };
}

describe("team standings queries", () => {
  it("ranks a break category's teams among themselves", async () => {
    const all = (await api.call("GET", `${base}/teams/standings`, { token: admin })).body as Rows;
    const result = await api.call("GET", `${base}/teams/standings?category=bc-open`, { token: admin });
    expect(result.status).toBe(200);
    const rows = (result.body as Rows).data;
    const eligible = new Set(api.harness.teams.filter((team) => team.breakCategories.includes("bc-open")).map((team) => team.id));
    expect(rows.map((row) => row.teamId).sort()).toEqual([...eligible].sort());
    expect(rows[0].rank).toBe(1);
    expect(all.data.length).toBeGreaterThan(rows.length);
    expect((await api.call("GET", `${base}/teams/standings?category=nope`, { token: admin })).status).toBe(404);
  });

  it("re-ranks by a per-request metrics list and rejects unknown metrics", async () => {
    const result = await api.call("GET", `${base}/teams/standings?metrics=speaks_sum`, { token: admin });
    expect(result.status).toBe(200);
    const sums = (result.body as Rows).data.map((row) => (row.metrics as Json).speaks_sum as number);
    expect(sums).toEqual([...sums].sort((left, right) => right - left));
    const unknown = await api.call("GET", `${base}/teams/standings?metrics=speaks_sum,nonsense`, { token: admin });
    expect(unknown.status).toBe(422);
    expect(unknown.body).toMatchObject({ error: { issues: [{ path: "metrics" }] } });
  });

  it("lets public tokens filter by break category only once eligibility is public", async () => {
    setPreferences({ releaseTeamTab: true });
    expect((await api.call("GET", `${base}/teams/standings?category=bc-open`, { token: publicToken })).status).toBe(403);
    setPreferences({ publicBreakCategories: true });
    const result = await api.call("GET", `${base}/teams/standings?category=bc-open`, { token: publicToken });
    expect(result.status).toBe(200);
    expect((result.body as Rows).data).toHaveLength(6);
  });
});

describe("speaker standings queries", () => {
  it("ranks a speaker category within itself, public categories only for public tokens", async () => {
    const result = await api.call("GET", `${base}/speakers/standings?category=spkcat-novice`, { token: admin });
    expect(result.status).toBe(200);
    expect((result.body as Rows).data.every((row) => row.rank === 0 || row.rank === 1)).toBe(true);
    setPreferences({ releaseSpeakerTab: true });
    expect((await api.call("GET", `${base}/speakers/standings?category=spkcat-esl`, { token: publicToken })).status).toBe(200);
    expect((await api.call("GET", `${base}/speakers/standings?category=spkcat-novice`, { token: publicToken })).status).toBe(404);
  });

  it("lists speeches by kind: substantive by default, replies and ghosts on request", async () => {
    // Mark one substantive speech of a confirmed round-1 ballot as a ghost.
    const ballots = api.store.tournaments.get("t-api")!.collections.ballots as unknown as BallotSubmission[];
    const ballot = ballots.find((item) => item.confirmed && !item.discarded)!;
    const ghost = ballot.speakerScores.AFF![1];
    ghost.ghost = true;
    const substantive = (await api.call("GET", `${base}/speakers/standings/rounds`, { token: admin })).body as Rows;
    const kinds = (rows: Rows) => new Set(rows.data.flatMap((row) => (row.rounds as Json[]).map((speech) => speech.kind)));
    expect([...kinds(substantive)]).toEqual(["substantive"]);
    const withAll = (await api.call("GET", `${base}/speakers/standings/rounds?replies=true&ghost=true`, { token: admin })).body as Rows;
    expect(kinds(withAll)).toEqual(new Set(["substantive", "reply", "ghost"]));
    const ghostOnly = (await api.call("GET", `${base}/speakers/standings/rounds?substantive=false&ghost=true`, { token: admin })).body as Rows;
    expect(ghostOnly.data).toEqual([expect.objectContaining({ id: ghost.speakerId, rounds: [expect.objectContaining({ kind: "ghost", score: ghost.score })] })]);
  });
});

describe("current-round team results", () => {
  it("shows released, non-silent rounds to public tokens, without speaks until released", async () => {
    const result = await api.call("GET", `${base}/teams/standings/current-rounds`, { token: publicToken });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const value = result.body as { rounds: Json[]; data: Json[] };
    expect(value.rounds).toEqual([expect.objectContaining({ seq: 1, teamSpeaksReleased: false })]);
    expect(value.data.length).toBe(api.harness.teams.length);
    const first = value.data.find((row) => (row.rounds as Json[]).length > 0)!;
    expect(first).not.toHaveProperty("points");
    expect((first.rounds as Json[])[0]).not.toHaveProperty("speakerScore");
    expect((first.rounds as Json[])[0]).toHaveProperty("points");
    setPreferences({ publicStandings: false });
    expect((await api.call("GET", `${base}/teams/standings/current-rounds`, { token: publicToken })).status).toBe(403);
  });
});

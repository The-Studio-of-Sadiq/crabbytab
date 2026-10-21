import { beforeEach, describe, expect, it } from "vitest";
import { createSeededRng } from "@/lib/draw/rng";
import type { BallotSubmission, Debate, Team } from "@/types";
import { createApiTestContext, type ApiTestContext } from "@/test/apiFixture";
import { simulateBallot } from "@/test/tournamentFixtures";
import { API_TOKEN_SCOPES, type ApiTokenScope } from "@/lib/apiScopes";
import type { StoredRecord } from "./store";

type Json = Record<string, unknown>;

let api: ApiTestContext;
let writer: string;
const base = "/tournaments/api-open";
const ALL_WRITE = API_TOKEN_SCOPES.filter((scope) => scope.startsWith("write:")) as ApiTokenScope[];

beforeEach(async () => {
  api = await createApiTestContext();
  writer = api.token([...ALL_WRITE, "read:standings"]);
});

function stored(collection: string): StoredRecord[] {
  return api.store.tournaments.get("t-api")!.collections[collection as "teams"] ?? [];
}
function active(collection: string) {
  return stored(collection).filter((record) => typeof record.deletedAt !== "string");
}
function audit() {
  return stored("auditEvents").filter((event) => String(event.actorId ?? "").startsWith("api-token:"));
}
/** The tournament's data; tokens are left out (a token's lastUsedAt is refreshed on use). */
function snapshot() {
  const { apiTokens: _tokens, ...data } = api.store.tournaments.get("t-api")!;
  return JSON.stringify(data);
}
function body<T = Json>(result: { body: unknown }): T {
  return result.body as T;
}
function round2Debates(): Debate[] {
  const round = active("rounds").find((item) => item.seq === 2)!;
  return active("debates").filter((debate) => debate.roundId === round.id) as unknown as Debate[];
}

describe("write authorization", () => {
  it("needs a write scope for the resource", async () => {
    const reader = api.token(["read:participants"]);
    const result = await api.call("POST", `${base}/institutions`, { token: reader, body: { name: "X", code: "X" } });
    expect(result.status).toBe(403);
    const otherWriter = api.token(["write:venues"]);
    expect((await api.call("POST", `${base}/institutions`, { token: otherWriter, body: { name: "X", code: "X" } })).status).toBe(403);
  });

  it("refuses public tokens", async () => {
    const publicToken = api.token(["read:public"]);
    expect((await api.call("POST", `${base}/venues`, { token: publicToken, body: { name: "R", priority: 1 } })).status).toBe(403);
  });

  it("requires a JSON body of the declared shape", async () => {
    const missing = await api.call("POST", `${base}/venues`, { token: writer });
    expect(missing.status).toBe(422);
    expect(body(missing)).toMatchObject({ error: { issues: expect.arrayContaining([{ path: "name", message: "is required" }]) } });
    const unknownField = await api.call("POST", `${base}/venues`, { token: writer, body: { name: "R", priority: 1, colour: "red" } });
    expect(unknownField.status).toBe(422);
    expect(body(unknownField)).toMatchObject({ error: { issues: [{ path: "colour", message: "is not a known field" }] } });
  });

  it("refuses oversized bodies", async () => {
    const result = await api.call("POST", `${base}/venues`, { token: writer, body: { name: "R".repeat(300_000), priority: 1 } });
    expect(result.status).toBe(413);
  });
});

describe("participants", () => {
  it("creates a team through the entity command: ids, keys, audit, version 1", async () => {
    const result = await api.call("POST", `${base}/teams`, {
      token: writer,
      body: { name: "New Team", institutionId: "inst-1", speakers: [{ name: "A", email: "a@example.test" }, { name: "B" }] },
    });
    expect(result.status).toBe(201);
    const team = body<Json & { id: string; speakers: Json[] }>(result);
    expect(team).toMatchObject({ name: "New Team", institutionName: "Institution 1", syncVersion: 1 });
    expect(JSON.stringify(team)).not.toMatch(/privateUrlKey|privatePasscode|email/);
    const record = stored("teams").find((item) => item.id === team.id)!;
    expect(record).toMatchObject({ syncVersion: 1, tournamentId: "t-api" });
    expect(record.privateUrlKey).toEqual(expect.stringMatching(/^team_/));
    expect(record.privatePasscode).toEqual(expect.any(String));
    expect((record.speakers as Json[])[0]).toMatchObject({ email: "a@example.test" });
    expect(audit()).toEqual([expect.objectContaining({
      action: "team.created",
      actorType: "system",
      actorName: expect.stringContaining("API token"),
      details: expect.objectContaining({ apiTokenId: expect.any(String), requestId: expect.any(String) }),
    })]);
  });

  it("refuses duplicate team names and unknown references", async () => {
    const duplicate = await api.call("POST", `${base}/teams`, { token: writer, body: { name: " team 01 ", speakers: [] } });
    expect(duplicate.status).toBe(409);
    const unknown = await api.call("POST", `${base}/teams`, { token: writer, body: { name: "Z", institutionId: "nope", speakers: [] } });
    expect(unknown.status).toBe(422);
  });

  it("updates with optimistic concurrency, bumping the version and archiving the old one", async () => {
    const team = active("teams")[0];
    const stale = await api.call("PATCH", `${base}/teams/${team.id}`, { token: writer, body: { name: "Renamed", expectedVersion: 7 } });
    expect(stale.status).toBe(409);
    expect(body(stale)).toMatchObject({ error: { code: "conflict" } });
    const ok = await api.call("PATCH", `${base}/teams/${team.id}`, { token: writer, body: { name: "Renamed", expectedVersion: 0 } });
    expect(ok.status).toBe(200);
    expect(stored("teams").find((item) => item.id === team.id)).toMatchObject({ name: "Renamed", syncVersion: 1 });
    expect(stored("syncConflicts")).toEqual([expect.objectContaining({ recordId: team.id, resolution: "superseded" })]);
  });

  it("will not remove a speaker with recorded speeches", async () => {
    const debate = (active("debates") as unknown as Debate[]).find((item) => item.roundSeq === 1 && !item.byeTeamId)!;
    const team = active("teams").find((item) => item.id === debate.teams.AFF.teamId) as unknown as Team;
    const result = await api.call("DELETE", `${base}/speakers/${team.speakers[0].id}`, { token: writer });
    expect(result.status).toBe(409);
  });

  it("refuses to delete a team that has debated (the UI rule) and changes nothing", async () => {
    const before = snapshot();
    const debate = (active("debates") as unknown as Debate[]).find((item) => !item.byeTeamId)!;
    const result = await api.call("DELETE", `${base}/teams/${debate.teams.AFF.teamId}`, { token: writer });
    expect(result.status).toBe(409);
    expect(body(result)).toMatchObject({ error: { code: "rule_violation", violations: [{ rule: "entity_in_use", overridable: false }] } });
    expect(snapshot()).toBe(before);
  });

  it("soft-deletes an unused venue and records the deletion", async () => {
    const created = body<{ id: string }>(await api.call("POST", `${base}/venues`, { token: writer, body: { name: "Spare room", priority: 1 } }));
    const result = await api.call("DELETE", `${base}/venues/${created.id}`, { token: writer });
    expect(result.status).toBe(204);
    expect(stored("venues").find((item) => item.id === created.id)).toMatchObject({ deletedAt: expect.any(String), syncVersion: 2 });
    expect((await api.call("GET", `${base}/venues/${created.id}`, { token: writer })).status).toBe(404);
  });

  it("validates adjudicator conflicts", async () => {
    const result = await api.call("POST", `${base}/adjudicators`, {
      token: writer,
      body: { name: "New judge", baseScore: 5, conflicts: [{ type: "personal", teamId: "team-1", institutionId: "inst-1" }] },
    });
    expect(result.status).toBe(422);
    const ok = await api.call("POST", `${base}/adjudicators`, {
      token: writer,
      body: { name: "New judge", baseScore: 5, conflicts: [{ type: "personal", teamId: "team-1" }] },
    });
    expect(ok.status).toBe(201);
  });

  it("records base score changes in the score history", async () => {
    const adjudicator = active("adjudicators")[0];
    await api.call("PATCH", `${base}/adjudicators/${adjudicator.id}`, { token: writer, body: { baseScore: 7.5, scoreChangeReason: "Test round" } });
    const record = stored("adjudicators").find((item) => item.id === adjudicator.id)!;
    expect(record.scoreHistory).toEqual([expect.objectContaining({ field: "baseScore", value: 7.5, reason: "Test round" })]);
  });
});

describe("rounds, draws and allocation", () => {
  it("creates and deletes a round", async () => {
    const created = await api.call("POST", `${base}/rounds`, { token: writer, body: { name: "Round 3", abbreviation: "R3", stage: "preliminary" } });
    expect(created.status).toBe(201);
    expect(body(created)).toMatchObject({ seq: 3, drawStatus: "none" });
    expect((await api.call("DELETE", `${base}/rounds/3`, { token: writer })).status).toBe(204);
  });

  it("regenerates a draft draw, soft-deleting the replaced debates", async () => {
    const oldIds = round2Debates().map((debate) => debate.id);
    const result = await api.call("POST", `${base}/rounds/2/pairings/generate-draw`, { token: writer, body: { replaceExistingDraw: true } });
    expect(result.status).toBe(200);
    const value = body<{ round: Json; pairings: Json[] }>(result);
    expect(value.round).toMatchObject({ drawStatus: "draft", drawSeed: expect.any(Number) });
    expect(value.pairings.length).toBe(oldIds.length);
    for (const id of oldIds) expect(stored("debates").find((debate) => debate.id === id)).toMatchObject({ deletedAt: expect.any(String) });
    const fresh = round2Debates();
    expect(fresh.every((debate) => Array.isArray((debate as unknown as Json).participantIds))).toBe(true);
  });

  it("refuses to regenerate a completed round's draw", async () => {
    const before = snapshot();
    const result = await api.call("POST", `${base}/rounds/1/pairings/generate-draw`, { token: writer, body: { replaceExistingDraw: true, discardExistingResults: true } });
    expect(result.status).toBe(409);
    expect(body(result)).toMatchObject({ error: { code: "rule_violation" } });
    expect(snapshot()).toBe(before);
  });

  it("allocates, releases and edits a pairing under the draw rules", async () => {
    expect((await api.call("POST", `${base}/rounds/2/pairings/allocate-adjudicators`, { token: writer, body: { panelSize: 1 } })).status).toBe(200);
    const release = await api.call("PATCH", `${base}/rounds/2`, { token: writer, body: { drawStatus: "confirmed", adjudicatorsRevealed: true } });
    expect(release.status).toBe(200);
    expect(body(release)).toMatchObject({ drawStatus: "confirmed", adjudicatorsRevealed: true });

    const [first, second] = round2Debates().filter((debate) => !debate.byeTeamId);
    const taken = second.adjudicators.chairId!;
    const clash = await api.call("PATCH", `${base}/rounds/2/pairings/${first.id}`, {
      token: writer,
      body: { adjudicators: { chairId: taken, panellistIds: [], traineeIds: [] } },
    });
    expect(clash.status).toBe(409);

    const venue = active("venues").find((item) => !round2Debates().some((debate) => debate.venueId === item.id))
      ?? active("venues")[0];
    const moved = await api.call("PATCH", `${base}/rounds/2/pairings/${first.id}`, { token: writer, body: { venueId: venue.id } });
    expect(moved.status).toBe(200);
    expect(body(moved)).toMatchObject({ venueId: venue.id, venueName: venue.name });
  });
});

describe("ballots", () => {
  async function releaseRound2() {
    await api.call("POST", `${base}/rounds/2/pairings/allocate-adjudicators`, { token: writer, body: { panelSize: 1 } });
    await api.call("PATCH", `${base}/rounds/2`, { token: writer, body: { drawStatus: "confirmed" } });
  }

  function entryFor(debate: Debate, seed = 5) {
    const ballot = simulateBallot(debate, active("teams") as unknown as Team[], api.harness.tournament, createSeededRng(seed));
    // A consensus ballot names the winner (rank 1) as the form does.
    const ranks = Object.fromEntries(Object.entries(ballot.teamScores).map(([side, score]) => [side, score.win ? 1 : 2]));
    return { speakerScores: ballot.speakerScores, ranks };
  }

  it("submits and confirms a ballot, computing the result", async () => {
    await releaseRound2();
    const debate = round2Debates().find((item) => !item.byeTeamId)!;
    const result = await api.call("POST", `${base}/rounds/2/pairings/${debate.id}/ballots`, {
      token: writer,
      body: { entry: entryFor(debate), confirmed: true },
    });
    expect(result.status).toBe(201);
    const ballot = body<BallotSubmission>(result);
    expect(ballot).toMatchObject({ confirmed: true, version: 1, submitterType: "tabroom" });
    const points = Object.values(ballot.teamScores).map((score) => score.points).sort();
    expect(points).toEqual([0, 1]);
    expect(stored("debates").find((item) => item.id === debate.id)).toMatchObject({ resultStatus: "confirmed" });
  });

  it("rejects an invalid ballot with the form's messages", async () => {
    await releaseRound2();
    const debate = round2Debates().find((item) => !item.byeTeamId)!;
    const entry = entryFor(debate);
    entry.speakerScores.AFF![0] = { ...entry.speakerScores.AFF![0], score: 999 };
    const result = await api.call("POST", `${base}/rounds/2/pairings/${debate.id}/ballots`, { token: writer, body: { entry } });
    expect(result.status).toBe(422);
    expect(body(result)).toMatchObject({ error: { code: "validation_failed", issues: [expect.objectContaining({ path: "entry" })] } });
  });

  it("needs an audited override to change a completed round's result", async () => {
    const debate = (active("debates") as unknown as Debate[]).find((item) => item.roundSeq === 1 && !item.byeTeamId)!;
    const entry = entryFor(debate, 9);
    const refused = await api.call("POST", `${base}/rounds/1/pairings/${debate.id}/ballots`, { token: writer, body: { entry, confirmed: true } });
    expect(refused.status).toBe(409);
    expect(body(refused)).toMatchObject({ error: { code: "rule_violation", violations: [expect.objectContaining({ overridable: true })] } });
    const forced = await api.call("POST", `${base}/rounds/1/pairings/${debate.id}/ballots`, {
      token: writer,
      body: { entry, confirmed: true, override: { reason: "Adjudicator corrected the sheet" } },
    });
    expect(forced.status).toBe(201);
    expect(audit()).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "rules.overridden", summary: expect.stringContaining("Adjudicator corrected the sheet") }),
    ]));
  });

  it("treats the token as one person under double entry", async () => {
    const entry = api.store.tournaments.get("t-api")!;
    entry.tournament.preferences = { ...(entry.tournament.preferences as Json), ballotDoubleEntry: true };
    await releaseRound2();
    const debate = round2Debates().find((item) => !item.byeTeamId)!;
    const first = await api.call("POST", `${base}/rounds/2/pairings/${debate.id}/ballots`, { token: writer, body: { entry: entryFor(debate) } });
    expect(first.status).toBe(201);
    const confirm = await api.call("PATCH", `${base}/rounds/2/pairings/${debate.id}/ballots/${body<Json>(first).id}`, {
      token: writer,
      body: { action: "confirm" },
    });
    expect(confirm.status).toBe(409);
    expect(body(confirm)).toMatchObject({ error: { violations: [expect.objectContaining({ rule: "same_person_check" })] } });
    const otherPerson = api.token(["write:results"]);
    const checked = await api.call("PATCH", `${base}/rounds/2/pairings/${debate.id}/ballots/${body<Json>(first).id}`, {
      token: otherPerson,
      body: { action: "confirm" },
    });
    expect(checked.status).toBe(200);
    expect(body(checked)).toMatchObject({ confirmed: true });
  });

  it("discards a ballot version", async () => {
    const debate = (active("debates") as unknown as Debate[]).find((item) => item.roundSeq === 1 && !item.byeTeamId)!;
    const ballot = active("ballots").find((item) => item.debateId === debate.id)!;
    const refused = await api.call("PATCH", `${base}/rounds/1/pairings/${debate.id}/ballots/${ballot.id}`, { token: writer, body: { action: "discard" } });
    expect(refused.status).toBe(409);
  });
});

describe("tournament settings", () => {
  it("locks scoring settings once ballots exist, and type-checks preferences", async () => {
    const locked = await api.call("PATCH", `${base}/preferences`, { token: writer, body: { preferences: { maxSpeakerScore: 90 } } });
    expect(locked.status).toBe(409);
    const wrongType = await api.call("PATCH", `${base}/preferences`, { token: writer, body: { preferences: { publicDraw: "yes" } } });
    expect(wrongType.status).toBe(422);
    const managed = await api.call("PATCH", `${base}/preferences`, { token: writer, body: { preferences: { speakerCategories: [] } } });
    expect(managed.status).toBe(422);
    const ok = await api.call("PATCH", `${base}/preferences`, { token: writer, body: { preferences: { publicParticipants: true } } });
    expect(ok.status).toBe(200);
    expect(api.store.tournaments.get("t-api")!.tournament).toMatchObject({ preferences: expect.objectContaining({ publicParticipants: true }), syncVersion: 1 });
  });

  it("renames the tournament", async () => {
    const result = await api.call("PATCH", base, { token: writer, body: { name: "API Open 2026" } });
    expect(result.status).toBe(200);
    expect(body(result)).toMatchObject({ name: "API Open 2026", slug: "api-open" });
  });

  it("replaces feedback questions per source", async () => {
    const result = await api.call("PUT", `${base}/feedback-questions`, {
      token: writer,
      body: { questions: [{ id: "q1", label: "Clear?", type: "yes_no", required: true, sources: ["team"] }] },
    });
    expect(result.status).toBe(200);
    const preferences = api.store.tournaments.get("t-api")!.tournament.preferences as Json;
    expect(preferences.teamFeedbackQuestions).toHaveLength(1);
    expect(preferences.adjudicatorFeedbackQuestions).toEqual([]);
    const invalid = await api.call("PUT", `${base}/feedback-questions`, {
      token: writer,
      body: { questions: [{ id: "q1", label: "Pick", type: "select_one", required: true, sources: ["team"] }] },
    });
    expect(invalid.status).toBe(422);
  });

  it("manages speaker categories and their members", async () => {
    const created = body<{ id: string }>(await api.call("POST", `${base}/speaker-categories`, { token: writer, body: { name: "U21", public: true } }));
    const speakerIds = (active("teams")[1].speakers as Array<{ id: string }>).map((speaker) => speaker.id);
    const set = await api.call("PUT", `${base}/speaker-categories/${created.id}/eligibility`, { token: writer, body: { speakerIds } });
    expect(set.status).toBe(200);
    const read = await api.call("GET", `${base}/speaker-categories/${created.id}/eligibility`, { token: writer });
    expect(body<{ speakerIds: string[] }>(read).speakerIds.sort()).toEqual([...speakerIds].sort());
    expect((await api.call("POST", `${base}/speaker-categories`, { token: writer, body: { name: "u21" } })).status).toBe(422);
  });
});

describe("breaks", () => {
  it("creates a category and sets its eligibility", async () => {
    const created = await api.call("POST", `${base}/break-categories`, { token: writer, body: { name: "ESL", breakSize: 2, isGeneral: false } });
    expect(created.status).toBe(201);
    const category = body<{ id: string }>(created);
    const teamIds = active("teams").slice(0, 4).map((team) => team.id);
    expect((await api.call("PUT", `${base}/break-categories/${category.id}/eligibility`, { token: writer, body: { teamIds } })).status).toBe(200);
    const read = await api.call("GET", `${base}/break-categories/${category.id}/eligibility`, { token: writer });
    expect(body<{ teamIds: string[] }>(read).teamIds.sort()).toEqual([...teamIds].sort());
  });

  it("generates a break only with the tab room's rules and an override while prelims are unfinished", async () => {
    const missingRounds = await api.call("POST", `${base}/break-categories/bc-open/break`, { token: writer, body: {} });
    expect(missingRounds.status).toBe(422);
    expect(body(missingRounds)).toMatchObject({ error: { message: expect.stringContaining("elimination rounds") } });
    for (const [name, abbreviation] of [["Semifinal", "SF"], ["Grand Final", "GF"]]) {
      await api.call("POST", `${base}/rounds`, { token: writer, body: { name, abbreviation, stage: "elimination", drawType: "elimination" } });
    }
    // Round 2 has no results yet, so the standings are not final: an overridable rule.
    const refused = await api.call("POST", `${base}/break-categories/bc-open/break`, { token: writer, body: {} });
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(body(refused)).toMatchObject({ error: { violations: expect.arrayContaining([expect.objectContaining({ rule: "prelims_incomplete", overridable: true })]) } });
    const generated = await api.call("POST", `${base}/break-categories/bc-open/break`, {
      token: writer,
      body: { override: { reason: "Rehearsal" } },
    });
    if (generated.status === 409) {
      // A tie at the cutoff blocks the break until resolved; it is never broken arbitrarily.
      expect(body(generated)).toMatchObject({ error: { violations: expect.arrayContaining([expect.objectContaining({ overridable: false })]) } });
    } else {
      expect(generated.status, JSON.stringify(generated.body)).toBe(200);
      expect(body<{ generatedBreak: { breakingTeamIds: string[] } }>(generated).generatedBreak.breakingTeamIds).toHaveLength(4);
    }
  });

  it("validates break sizes like the break page", async () => {
    const duplicate = await api.call("POST", `${base}/break-categories`, { token: writer, body: { name: "open", breakSize: 4 } });
    expect(duplicate.status).toBe(422);
    const negative = await api.call("POST", `${base}/break-categories`, { token: writer, body: { name: "Neg", breakSize: -2 } });
    expect(negative.status).toBe(422);
  });
});

describe("availability and check-ins", () => {
  it("sets round availability and check-ins", async () => {
    const [team] = active("teams");
    const [adjudicator] = active("adjudicators");
    const set = await api.call("PUT", `${base}/rounds/2/availabilities`, {
      token: writer,
      body: { teams: { [team.id]: false }, adjudicators: { [adjudicator.id]: false } },
    });
    expect(set.status).toBe(200);
    const read = await api.call("GET", `${base}/rounds/2/availabilities`, { token: writer });
    expect(body<{ teams: Json[] }>(read).teams.find((item) => item.id === team.id)).toMatchObject({ available: false });

    const out = await api.call("DELETE", `${base}/adjudicators/${adjudicator.id}/checkin`, { token: writer });
    expect(body(out)).toMatchObject({ checkedIn: false });
    const back = await api.call("PUT", `${base}/adjudicators/${adjudicator.id}/checkin`, { token: writer });
    expect(body(back)).toMatchObject({ checkedIn: true, checkedInAt: "2026-10-01T12:00:00.000Z" });
  });

  it("records a paper ballot once", async () => {
    const debate = round2Debates().find((item) => !item.byeTeamId)!;
    await api.call("POST", `${base}/rounds/2/pairings/allocate-adjudicators`, { token: writer, body: { panelSize: 1 } });
    await api.call("PATCH", `${base}/rounds/2`, { token: writer, body: { drawStatus: "confirmed" } });
    const first = await api.call("PUT", `${base}/rounds/2/pairings/${debate.id}/checkin`, { token: writer });
    expect(first.status).toBe(200);
    await api.call("PUT", `${base}/rounds/2/pairings/${debate.id}/checkin`, { token: writer });
    expect(active("ballotIntake").filter((item) => item.debateId === debate.id)).toHaveLength(1);
  });
});

describe("feedback", () => {
  it("checks that the source and target took part in the debate", async () => {
    const debate = (active("debates") as unknown as Debate[]).find((item) => item.roundSeq === 1 && !item.byeTeamId)!;
    const outsider = active("adjudicators").find((item) => item.id !== debate.adjudicators.chairId)!;
    const wrong = await api.call("POST", `${base}/feedback`, {
      token: writer,
      body: { debateId: debate.id, sourceType: "team", sourceId: debate.teams.AFF.teamId, targetAdjudicatorId: outsider.id, score: 3 },
    });
    expect(wrong.status).toBe(422);
    const ok = await api.call("POST", `${base}/feedback`, {
      token: writer,
      body: {
        debateId: debate.id, sourceType: "team", sourceId: debate.teams.NEG.teamId,
        targetAdjudicatorId: debate.adjudicators.chairId, score: 3, answers: { "q-clarity": true },
      },
    });
    expect(ok.status).toBe(201);
    const id = body<{ id: string }>(ok).id;
    const ignored = await api.call("PATCH", `${base}/feedback/${id}`, { token: writer, body: { ignored: true } });
    expect(body(ignored)).toMatchObject({ ignored: true });
  });

  it("validates answers against the questions", async () => {
    const debate = (active("debates") as unknown as Debate[]).find((item) => item.roundSeq === 1 && !item.byeTeamId)!;
    const result = await api.call("POST", `${base}/feedback`, {
      token: writer,
      body: {
        debateId: debate.id, sourceType: "team", sourceId: debate.teams.NEG.teamId,
        targetAdjudicatorId: debate.adjudicators.chairId, score: 3, answers: { "q-clarity": "maybe" },
      },
    });
    expect(result.status).toBe(422);
  });
});

describe("motions", () => {
  it("keeps the round's motion release flag in step", async () => {
    const motion = await api.call("PATCH", `${base}/motions/motion-2`, { token: writer, body: { released: true } });
    expect(motion.status).toBe(200);
    expect(active("rounds").find((round) => round.seq === 2)).toMatchObject({ motionsReleased: true });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { createFakeAdminFirestore, type FakeAdminFirestore } from "@/test/fakeAdminFirestore";

let fake: FakeAdminFirestore;
vi.mock("@/lib/firebaseAdmin", () => ({
  getAdminFirestore: () => fake.firestore,
  getAdminAuth: () => ({ verifyIdToken: async (token: string) => ({ uid: token, email: `${token}@example.com` }) }),
}));

import { POST } from "./route";

const T = "tournaments/t1";
const params = { params: Promise.resolve({ tournamentId: "t1" }) };

function request(uid: string, body: unknown): NextRequest {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { authorization: `Bearer ${uid}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const adjudicator = (id: string, extra: Record<string, unknown> = {}) => ({
  tournamentId: "t1", name: id.toUpperCase(), baseScore: 5, trainee: false, independent: false, conflicts: [],
  privateUrlKey: `adj_${id}`, privatePasscode: "p", syncVersion: 1, ...extra,
});

function seed(staff: Record<string, unknown>, extra: Record<string, Record<string, unknown>> = {}) {
  fake = createFakeAdminFirestore({
    [T]: { name: "T", format: "wsdc", preferences: {}, ownerId: "owner", admins: {} },
    [`${T}/staff/bob`]: { role: "dataEntry", ...staff },
    [`${T}/adjudicators/a1`]: adjudicator("a1"),
    [`${T}/adjudicators/a2`]: adjudicator("a2"),
    [`${T}/adjudicators/a3`]: adjudicator("a3"),
    [`${T}/rounds/r1`]: { seq: 1, name: "Round 1", stage: "preliminary", drawStatus: "draft", completed: false },
    [`${T}/debates/d1`]: {
      roundId: "r1", resultStatus: "none", syncVersion: 4,
      teams: { AFF: { teamId: "x", side: "AFF" }, NEG: { teamId: "y", side: "NEG" } },
      adjudicators: { chairId: "a1", chairName: "A1", panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    },
    [`${T}/debates/d2`]: {
      roundId: "r1", resultStatus: "none", syncVersion: 4,
      teams: { AFF: { teamId: "z", side: "AFF" }, NEG: { teamId: "w", side: "NEG" } },
      adjudicators: { chairId: "a2", chairName: "A2", panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    },
    ...extra,
  });
}

const conflictEdit = (syncVersion = 1) => ({
  collections: {
    adjudicators: [{
      id: "a1", tournamentId: "t1", name: "A1", trainee: false, independent: false,
      conflicts: [{ type: "personal", teamId: "x" }], syncVersion,
    }],
  },
  debates: [],
});

describe("POST data-entry-sync: Equity and Adjudication Core permissions", () => {
  beforeEach(() => seed({ groups: ["tab_assistant"], permissions: [] }));

  it("refuses conflict edits from a tabulation assistant (they never see conflicts)", async () => {
    const response = await POST(request("bob", conflictEdit()), params);
    expect(response.status).toBe(200);
    expect(fake.store.get(`${T}/adjudicators/a1`)?.conflicts).toEqual([]);
  });

  it("refuses conflict edits from staff who can see but not edit them", async () => {
    seed({ groups: ["adjudication_core"] });
    const response = await POST(request("bob", conflictEdit()), params);
    const body = await response.json();
    expect(body.rejected).toEqual([{ collectionName: "adjudicators", recordId: "a1" }]);
    expect(fake.store.get(`${T}/adjudicators/a1`)?.conflicts).toEqual([]);
  });

  it("lets Equity staff change conflicts, keeping the private URL", async () => {
    seed({ groups: ["equity"] });
    const response = await POST(request("bob", conflictEdit()), params);
    expect(response.status).toBe(200);
    expect(fake.store.get(`${T}/adjudicators/a1`)?.conflicts).toEqual([{ type: "personal", teamId: "x" }]);
    expect(fake.store.get(`${T}/adjudicators/a1`)?.privateUrlKey).toBe("adj_a1");
  });

  it("does not let a stale copy undo newer conflicts", async () => {
    seed({ groups: ["equity"] }, { [`${T}/adjudicators/a1`]: adjudicator("a1", { syncVersion: 5 }) });
    const body = await (await POST(request("bob", conflictEdit(1)), params)).json();
    expect(body.rejected).toEqual([{ collectionName: "adjudicators", recordId: "a1" }]);
    expect(fake.store.get(`${T}/adjudicators/a1`)?.conflicts).toEqual([]);
  });

  it("applies a custom group from the server-only definitions, and nothing once it is deleted", async () => {
    seed({ groups: ["custom_eq"] }, {
      [`${T}/serverOnly/staffPermissionGroups`]: { groups: [{ id: "custom_eq", name: "Eq", permissions: ["conflicts.view", "conflicts.edit"] }] },
    });
    await POST(request("bob", conflictEdit()), params);
    expect(fake.store.get(`${T}/adjudicators/a1`)?.conflicts).toHaveLength(1);

    seed({ groups: ["custom_eq"] });
    const response = await POST(request("bob", conflictEdit()), params);
    expect(response.status).toBe(403);
  });

  it("records adjudication-core score changes in the score history", async () => {
    seed({ groups: ["adjudication_core"] });
    await POST(request("bob", {
      collections: {
        adjudicators: [{ id: "a1", tournamentId: "t1", name: "A1", trainee: false, independent: false, baseScore: 7.5, syncVersion: 1 }],
      },
      debates: [],
    }), params);
    const stored = fake.store.get(`${T}/adjudicators/a1`)!;
    expect(stored.baseScore).toBe(7.5);
    expect(stored.scoreHistory).toEqual([expect.objectContaining({ field: "baseScore", previous: 5, value: 7.5, actorId: "bob" })]);
  });

  it("refuses score changes from staff without the score permission", async () => {
    seed({ groups: ["check_in_desk"], extraPermissions: [] });
    await POST(request("bob", {
      collections: { adjudicators: [{ id: "a1", tournamentId: "t1", name: "A1", baseScore: 9, syncVersion: 1 }] },
      debates: [],
    }), params);
    expect(fake.store.get(`${T}/adjudicators/a1`)?.baseScore).toBe(5);
  });

  const move = (syncVersion = 4) => ({
    collections: {},
    debates: [
      { id: "d1", roundId: "r1", syncVersion, adjudicators: { chairId: "a1", panellistIds: ["a3"], traineeIds: [] } },
      { id: "d2", roundId: "r1", syncVersion, adjudicators: { chairId: "a2", panellistIds: [], traineeIds: [] } },
    ],
  });

  it("lets the adjudication core change allocations, updating names and the participant index", async () => {
    seed({ groups: ["adjudication_core"] });
    const body = await (await POST(request("bob", move()), params)).json();
    expect(body.refusedAllocations).toEqual([]);
    const stored = fake.store.get(`${T}/debates/d1`)!;
    expect(stored.adjudicators).toMatchObject({ chairId: "a1", panellistIds: ["a3"], panellistNames: ["A3"] });
    expect(stored.participantIds).toEqual(["a1", "a3", "x", "y"]);
    expect(stored.syncVersion).toBe(5);
  });

  it("refuses allocation changes from a tabulation assistant and from stale copies", async () => {
    await POST(request("bob", move()), params);
    expect((fake.store.get(`${T}/debates/d1`)!.adjudicators as { panellistIds: string[] }).panellistIds).toEqual([]);

    seed({ groups: ["adjudication_core"] });
    const body = await (await POST(request("bob", move(3)), params)).json();
    expect(body.refusedAllocations).toHaveLength(1);
    expect((fake.store.get(`${T}/debates/d1`)!.adjudicators as { panellistIds: string[] }).panellistIds).toEqual([]);
  });
});

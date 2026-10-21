import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { createFakeAdminFirestore, type FakeAdminFirestore } from "@/test/fakeAdminFirestore";

let fake: FakeAdminFirestore;
vi.mock("@/lib/firebaseAdmin", () => ({
  getAdminFirestore: () => fake.firestore,
  getAdminAuth: () => ({ verifyIdToken: async (token: string) => ({ uid: token, email: `${token}@example.com` }) }),
}));

import { GET, PUT } from "./route";

const T = "tournaments/t1";
const params = { params: Promise.resolve({ tournamentId: "t1" }) };

function request(uid: string, method: string, body?: unknown): NextRequest {
  return new Request("http://localhost/api", {
    method,
    headers: { authorization: `Bearer ${uid}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  fake = createFakeAdminFirestore({
    [T]: { name: "T", ownerId: "owner", admins: {} },
    [`${T}/staff/bob`]: { role: "dataEntry", groups: ["custom_eq"], permissions: [] },
    [`${T}/staff/cat`]: { role: "dataEntry", groups: ["check_in_desk"], permissions: ["checkins.edit"] },
  });
});

const groups = [{ id: "custom_eq", name: "Equity team", permissions: ["conflicts.view", "conflicts.edit"] }];

describe("staff permission groups route", () => {
  it("refuses data-entry staff and strangers", async () => {
    expect((await PUT(request("bob", "PUT", { groups }), params)).status).toBe(403);
    expect((await GET(request("stranger", "GET"), params)).status).toBe(403);
    expect(fake.store.has(`${T}/serverOnly/staffPermissionGroups`)).toBe(false);
  });

  it("saves groups and refreshes the stored permissions of staff in them", async () => {
    const response = await PUT(request("owner", "PUT", { groups }), params);
    expect(response.status).toBe(200);
    expect(fake.store.get(`${T}/staff/bob`)?.permissions).toEqual(["conflicts.view", "conflicts.edit"]);
    expect(fake.store.get(`${T}/staff/cat`)?.permissions).toEqual(["checkins.edit"]);
    const read = await (await GET(request("owner", "GET"), params)).json();
    expect(read.groups).toEqual(groups);

    // Deleting the group takes its permissions away; it does not fall back to the default set.
    await PUT(request("owner", "PUT", { groups: [] }), params);
    expect(fake.store.get(`${T}/staff/bob`)?.permissions).toEqual([]);
  });

  it("refuses invalid groups", async () => {
    const response = await PUT(request("owner", "PUT", { groups: [{ id: "custom_x", name: "X", permissions: ["everything"] }] }), params);
    expect(response.status).toBe(400);
  });
});

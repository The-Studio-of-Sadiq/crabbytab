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

function request(uid: string, body: unknown): NextRequest {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { authorization: `Bearer ${uid}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const params = { params: Promise.resolve({ tournamentId: "t1" }) };

function seed(staff: Record<string, unknown>, preferences: Record<string, unknown> = {}) {
  fake = createFakeAdminFirestore({
    [T]: { name: "T", format: "wsdc", preferences, ownerId: "owner", admins: {} },
    [`${T}/staff/bob`]: { role: "dataEntry", ...staff },
    [`${T}/rounds/r1`]: { seq: 1, name: "Round 1", stage: "preliminary", drawStatus: "released", completed: false },
    [`${T}/debates/d1`]: {
      roundId: "r1",
      resultStatus: "draft",
      flags: [],
      teams: { AFF: { teamId: "aff", teamName: "Aff", side: "AFF" }, NEG: { teamId: "neg", teamName: "Neg", side: "NEG" } },
      adjudicators: { chairId: "c", panellistIds: [], panellistNames: [], traineeIds: [], traineeNames: [] },
    },
    [`${T}/ballots/b1`]: {
      tournamentId: "t1",
      roundId: "r1",
      debateId: "d1",
      version: 1,
      confirmed: false,
      discarded: false,
      submitterType: "tabroom",
      submitterId: "alice",
      speakerScores: { AFF: [], NEG: [] },
      teamScores: {
        AFF: { side: "AFF", teamId: "aff", points: 1, totalSpeakerScore: 0, win: true, rank: 1 },
        NEG: { side: "NEG", teamId: "neg", points: 0, totalSpeakerScore: 0, win: false, rank: 2 },
      },
      timestamp: "2026-10-20T10:00:00.000Z",
    },
  });
}

describe("POST /api/tournaments/{id}/assistant-ballots", () => {
  beforeEach(() => seed({}));

  it("lets data-entry staff confirm a ballot someone else entered", async () => {
    const response = await POST(request("bob", { action: "confirm", ballotId: "b1", version: 1 }), params);
    expect(response.status).toBe(200);
    expect(fake.store.get(`${T}/ballots/b1`)?.confirmed).toBe(true);
    expect(fake.store.get(`${T}/ballots/b1`)?.confirmedById).toBe("bob");
    expect(fake.store.get(`${T}/debates/d1`)?.resultStatus).toBe("confirmed");
  });

  it("refuses staff whose groups do not include confirming others' ballots", async () => {
    seed({ groups: ["check_in_desk"] });
    const response = await POST(request("bob", { action: "confirm", ballotId: "b1", version: 1 }), params);
    expect(response.status).toBe(403);
    expect(fake.store.get(`${T}/ballots/b1`)?.confirmed).toBe(false);
  });

  it("refuses everyone when assistant access is switched off", async () => {
    seed({}, { assistantAccess: "none" });
    const response = await POST(request("bob", { action: "confirm", ballotId: "b1", version: 1 }), params);
    expect(response.status).toBe(403);
  });

  it("refuses accounts that are not data-entry staff", async () => {
    const response = await POST(request("mallory", { action: "confirm", ballotId: "b1", version: 1 }), params);
    expect(response.status).toBe(403);
  });

  it("refuses the person who entered the ballot", async () => {
    fake.store.set(`${T}/staff/alice`, { role: "dataEntry" });
    const response = await POST(request("alice", { action: "confirm", ballotId: "b1", version: 1 }), params);
    expect(response.status).toBe(409);
    expect(fake.store.get(`${T}/ballots/b1`)?.confirmed).toBe(false);
  });
});

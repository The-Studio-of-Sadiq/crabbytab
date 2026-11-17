import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { createFakeAdminFirestore, type FakeAdminFirestore } from "@/test/fakeAdminFirestore";

let fake: FakeAdminFirestore;
vi.mock("@/lib/firebaseAdmin", () => ({
  getAdminFirestore: () => fake.firestore,
  getAdminAuth: () => ({ verifyIdToken: async (token: string) => ({ uid: token, email: `${token}@example.com` }) }),
}));

import { GET } from "./route";

function request(uid: string): NextRequest {
  return new Request("http://localhost/api/tournaments", {
    headers: { authorization: `Bearer ${uid}` },
  }) as unknown as NextRequest;
}

async function list(uid: string) {
  const response = await GET(request(uid));
  const body = await response.json() as { role: string; tournaments: Array<{ id: string; accessRole: string }> };
  return { status: response.status, role: body.role, ids: body.tournaments.map((item) => `${item.id}:${item.accessRole}`).sort() };
}

/** Many tournaments the account has nothing to do with, so a full scan would show in the reads. */
function seed(options: { collectionGroupError?: Error } = {}) {
  const documents: Record<string, Record<string, unknown>> = {
    "tournaments/own": { slug: "own", name: "Own", format: "bp", ownerId: "alice", admins: { alice: true } },
    "tournaments/coadmin": { slug: "coadmin", name: "Co-admin", format: "bp", ownerId: "carol", admins: { carol: true, alice: true } },
    "tournaments/assist": { slug: "assist", name: "Assist", format: "bp", ownerId: "carol", admins: { carol: true } },
    "tournaments/assist/staff/alice": { uid: "alice", email: "alice@example.com", role: "dataEntry" },
    "tournaments/legacy": { slug: "legacy", name: "Legacy", format: "bp", ownerId: "carol", admins: { carol: true } },
    // A staff record from before staff records carried a uid: found by email.
    "tournaments/legacy/staff/alice": { email: "alice@example.com", role: "admin" },
    "tournaments/spoof": { slug: "spoof", name: "Spoof", format: "bp", ownerId: "carol", admins: { carol: true } },
    // Someone else's record with this account's email never grants access: the id must be the uid.
    "tournaments/spoof/staff/mallory": { email: "alice@example.com", role: "admin" },
  };
  for (let index = 0; index < 50; index += 1) {
    documents[`tournaments/other${index}`] = { slug: `other${index}`, name: `Other ${index}`, format: "bp", ownerId: "carol", admins: { carol: true } };
  }
  fake = createFakeAdminFirestore(documents, options);
}

describe("GET /api/tournaments", () => {
  beforeEach(() => seed());

  it("lists owned, administered and staff tournaments without reading the others", async () => {
    const result = await list("alice");
    expect(result.status).toBe(200);
    expect(result.ids).toEqual(["assist:dataEntry", "coadmin:admin", "legacy:admin", "own:admin"]);
    expect(result.role).toBe("admin");
    // Two tournament queries, two staff queries, and the two staff tournaments: nowhere near 55.
    expect(fake.reads()).toBeLessThanOrEqual(10);
  });

  it("lists only a global admin's own tournaments instead of every tournament", async () => {
    vi.stubEnv("FIREBASE_ADMIN_UIDS", "dave");
    try {
      seed();
      fake.store.set("tournaments/daves", { slug: "daves", name: "Dave's", format: "bp", ownerId: "dave", admins: { dave: true } });
      const result = await list("dave");
      expect(result.role).toBe("globalAdmin");
      expect(result.ids).toEqual(["daves:admin"]);
      expect(fake.reads()).toBeLessThanOrEqual(5);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("costs a handful of reads for an account with no tournaments", async () => {
    const result = await list("nobody");
    expect(result.ids).toEqual([]);
    expect(result.role).toBe("none");
    expect(fake.reads()).toBeLessThanOrEqual(4);
  });

  it("falls back to reading every tournament when the staff index is missing", async () => {
    seed({ collectionGroupError: Object.assign(new Error("index required"), { code: 9 }) });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await list("alice");
      expect(result.ids).toEqual(["assist:dataEntry", "coadmin:admin", "legacy:admin", "own:admin"]);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("does not fall back to a full scan for a global admin when the staff index is missing", async () => {
    vi.stubEnv("FIREBASE_ADMIN_UIDS", "alice");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      seed({ collectionGroupError: Object.assign(new Error("index required"), { code: 9 }) });
      const result = await list("alice");
      expect(result.ids).toEqual(["coadmin:admin", "own:admin"]);
      expect(fake.reads()).toBeLessThanOrEqual(4);
    } finally {
      warn.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
